/* scripts/lib/setup/cmd-deploy.mjs — `setup.mjs deploy`: doctor local -> aplicar-config -> testes -> varredura de
 * segredos -> wrangler deploy -> segredos que faltam -> doctor --remote. Só publica com o doctor sem erros e com a
 * autorização da pessoa (pergunta, ou --yes). */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { criarRelatorio } from './saida.mjs';
import { executarDoctor, resolverUrl } from './doctor.mjs';
import { criarEstado, URL_DO_ULTIMO_DEPLOY } from './estado.mjs';
import { criarWrangler, exigirLogin } from './cloudflare.mjs';
import { garantirSessionSecret } from './cmd-cloudflare.mjs';
import { autorizar } from './comum.mjs';
import { falha, SAIDA } from './erros.mjs';

const silencioso = () => ({ out: () => {}, err: () => {} });

export const deploy = {
  nome: 'deploy',
  resumo: 'Confere tudo (doctor), roda os testes e publica no Cloudflare; depois testa o site publicado.',
  uso: 'deploy [--com-testes] [--sem-remoto] [--url https://...] [--yes] [--dry-run]   (--dry-run mostra o plano completo e o que impede de publicar hoje)',
  flags: { 'sem-testes': 'bool', 'com-testes': 'bool', 'sem-remoto': 'bool', url: 'valor', conta: 'valor' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const dry = f.dryRun;

    /* 1. doctor local: erro bloqueia */
    const sub = criarRelatorio('doctor', { json: true, ...silencioso() });
    await executarDoctor(ctx, sub, { only: ['env', 'config', 'cloudflare', 'video', 'acesso', 'seguranca'] });
    rel.checagens.push(...sub.checagens);
    const erros = sub.checagens.filter((c) => c.status === 'erro');
    if (erros.length && !dry) {
      rel.acao('doctor', `O doctor achou ${erros.length} problema(s): não vou publicar`, 'falhou');
      rel.passo('Corrija os itens com ERRO acima (cada um diz o que fazer) e rode o deploy de novo.');
      return SAIDA.FALHA;
    }
    /* Na simulação, os problemas não escondem o plano: mostramos os dois (o que impede hoje e o que seria feito). */
    if (erros.length) rel.acao('doctor', `O doctor acharia ${erros.length} problema(s) hoje: a publicação de verdade NÃO rodaria até corrigi-los (itens com ERRO acima)`, 'pendente');
    else rel.acao('doctor', 'O doctor não achou erros', dry ? 'simulado' : 'feito');

    /* 2. autorização */
    if (!dry) await autorizar(ctx, 'autorizar-deploy', 'Posso publicar o site agora na sua conta Cloudflare?', 'node scripts/setup.mjs deploy --yes');

    /* 3. arquivos gerados */
    if (dry) rel.acao('aplicar-config', 'Regeneraria os arquivos do site', 'simulado');
    else {
      const ap = await ctx.aplicarConfig({ raiz: ctx.raiz, verificar: false });
      if (!ap.ok) throw falha('aplicar-falhou', 'não consegui gerar os arquivos do site a partir do config.');
      rel.acao('aplicar-config', ap.alterados.length ? `Arquivos do site atualizados (${ap.alterados.length})` : 'Arquivos do site já estavam em dia', ap.alterados.length ? 'feito' : 'ja-estava');
    }

    /* 4. testes do PRODUTO: eles conferem a marca neutra "Plataforma Exemplo", então só fazem sentido no repositório
     * do produto. Num site já personalizado (o caso do cliente) quebrariam por causa do nome e das cores dele, e
     * não dizem nada sobre o site. Aqui o que protege o cliente é o doctor (config, arquivos gerados, segredos). */
    const cfgAtual = await criarEstado(ctx).config();
    const siteDoProduto = Boolean(cfgAtual.ok && cfgAtual.config.marca.nome === 'Plataforma Exemplo');
    if (f['sem-testes']) { rel.aviso('pulei os testes (--sem-testes). Agente: isto só com o "sim" explícito de quem mantém o produto.'); rel.acao('testes', 'Testes pulados por --sem-testes', 'pulado'); }
    else if (!siteDoProduto && !f['com-testes']) rel.acao('testes', 'Testes do produto não se aplicam a um site com a sua marca (eles esperam o nome de exemplo); o doctor acima já conferiu a configuração, os arquivos gerados e os segredos. Para rodá-los mesmo assim: --com-testes', 'pulado');
    else if (dry) rel.acao('testes', 'Rodaria os testes (npm test)', 'simulado');
    else {
      const t = await ctx.exec('npm', ['test'], { cwd: ctx.raiz });
      if (t.codigo !== 0) {
        rel.acao('testes', 'Os testes falharam: não vou publicar', 'falhou');
        rel.dado('testes', { codigo: t.codigo, final: (t.saida + t.erro).split(/\r?\n/).slice(-15).join('\n') });
        throw falha('testes-falharam', 'os testes automáticos falharam, então não publiquei.', { dica: 'Rode npm test para ver qual falhou e peça ajuda com a mensagem.' });
      }
      rel.acao('testes', 'Testes passaram', 'feito');
    }

    /* 5. publicar */
    const wr = criarWrangler(ctx);
    if (dry) {
      rel.acao('deploy', 'Publicaria com wrangler deploy', 'simulado');
      rel.acao('segredos', 'Depois da publicação: criaria sozinho o SESSION_SECRET e conferiria se a senha do administrador existe', 'simulado');
      rel.acao('doctor-remoto', 'Depois da publicação: testaria o site de fora (doctor --remote)', 'simulado');
      if (erros.length) {
        rel.dado('bloqueios', erros.map((c) => ({ id: c.id, mensagem: c.mensagem, correcao: c.correcao })));
        rel.resumir(`Simulação: a publicação de verdade NÃO rodaria hoje (${erros.length} problema(s) a corrigir).`);
        rel.passo('Corrija os itens com ERRO acima, rode o doctor e depois o deploy.');
        return SAIDA.FALHA;
      }
      rel.passo('Para publicar de verdade: node scripts/setup.mjs deploy (peça a autorização da pessoa antes).');
      return SAIDA.OK;
    }
    await exigirLogin(ctx, wr, { contaId: f.conta });
    const pub = await wr.publicar();
    if (!pub.ok) { rel.acao('deploy', 'O wrangler não conseguiu publicar', 'falhou'); throw falha('deploy-falhou', 'a publicação falhou.', { dica: pub.saida.split('\n').slice(-6).join(' ') }); }
    rel.acao('deploy', `Publicado${pub.url ? ' em ' + pub.url : ''}`, 'feito');
    if (pub.url) {
      await mkdir(path.dirname(URL_DO_ULTIMO_DEPLOY(ctx.raiz)), { recursive: true });
      await writeFile(URL_DO_ULTIMO_DEPLOY(ctx.raiz), JSON.stringify({ url: pub.url, em: ctx.agora().toISOString() }) + '\n', 'utf8');
    }
    rel.dado('url', pub.url || null);

    /* 6. segredos que só podem existir depois do Worker */
    await garantirSessionSecret(ctx, rel, wr);
    const segredos = await wr.listarSegredos();
    const faltam = ['ADMIN_PASSWORD'].filter((n) => !segredos.nomes.includes(n));
    if (faltam.length) rel.pendencia('admin-sem-senha', 'o site está no ar, mas ainda não há senha de administrador: ninguém consegue entrar no /admin.', 'node scripts/setup.mjs segredo ADMIN_PASSWORD');

    /* 7. teste do site publicado */
    const codigo = faltam.length ? SAIDA.PENDENTE : SAIDA.OK;
    if (!f['sem-remoto']) {
      const estado = criarEstado(ctx);
      const url = await resolverUrl(ctx, estado, { url: pub.url || f.url });
      if (!url) rel.aviso('não achei o endereço do site para testar. Rode: node scripts/setup.mjs doctor --remote --url https://...');
      else {
        const rem = criarRelatorio('doctor', { json: true, ...silencioso() });
        await executarDoctor(ctx, rem, { only: ['remoto'], url });
        rel.checagens.push(...rem.checagens);
        if (rem.checagens.some((c) => c.status === 'erro')) {
          rel.passo('O site foi publicado, mas o teste de fora achou problema. NÃO divulgue o endereço: leia os itens com ERRO acima.');
          return SAIDA.FALHA;
        }
      }
    }
    rel.passo(faltam.length ? 'Defina a senha do administrador (comando acima) e abra /admin para enviar o primeiro vídeo.' : 'Abra /admin, entre com a senha do administrador e envie o primeiro vídeo.');
    return codigo;
  }
};
