/* scripts/lib/setup/cmd-video.mjs — `setup.mjs video`: escolhe o provedor de vídeo, pede as credenciais por prompt
 * oculto (guardadas só no .env, ignorado pelo git), testa com validarCredenciais() do adaptador e, se pedido, envia
 * os segredos ao Worker. */
import path from 'node:path';
import { criarProvedor, listarProvedores, moduloDe } from '../provedores/index.mjs';
import { erroUso, pendente, falha } from './erros.mjs';
import { definirCaminho, lerCaminho, validarBruto } from './config-io.mjs';
import { salvarConfig, siteAtual, protegerSegredosLocais } from './comum.mjs';
import { gravarNoArquivoEnv, mascarar, lerArquivoEnv } from './segredos.mjs';
import { guardarSegredo } from './cmd-segredo.mjs';
import { criarChaveDeAssinatura, explicarFalhaDaChave, VARIAVEIS_DA_CHAVE } from './stream-chave.mjs';
import { CREDENCIAIS_DE_ASSINATURA, NAO_SECRETAS, ONDE_ACHAR, credenciaisNecessarias } from './credenciais.mjs';

export { CREDENCIAIS_DE_ASSINATURA };

export const PROVEDORES_ROTULO = Object.freeze({
  bunny: { rotulo: 'Bunny Stream', detalhe: 'barato, assina vídeo (bom para o modo privado); você paga ao Bunny direto' },
  'cloudflare-stream': { rotulo: 'Cloudflare Stream', detalhe: 'tudo na sua conta Cloudflare; cobra por minuto armazenado e assistido' },
  'hls-generico': { rotulo: 'HLS genérico', detalhe: 'você já tem os vídeos em HLS em outro lugar; NÃO assina (só serve para o modo público)' }
});

export const video = {
  nome: 'video',
  resumo: 'Escolhe o provedor de vídeo, guarda as chaves (prompt oculto) e testa a conexão.',
  uso: 'video [--provedor bunny|cloudflare-stream|hls-generico] [--base-url https://...] [--testar] [--sem-teste] [--enviar-segredos] [--criar-chave-assinatura]',
  flags: { provedor: 'valor', 'base-url': 'valor', testar: 'bool', 'sem-teste': 'bool', 'enviar-segredos': 'bool', 'criar-chave-assinatura': 'bool', conta: 'valor' },
  async executar(ctx, rel) {
    const f = ctx.flags;
    const { bruto, existe } = await siteAtual(ctx);
    if (!existe) throw erroUso('não existe config/site.json. Rode antes: node scripts/setup.mjs init');
    const validos = listarProvedores();
    let id = f.provedor || lerCaminho(bruto, 'video.provedor') || 'bunny';
    if (!validos.includes(id)) throw erroUso(`provedor "${id}" desconhecido. Use: ${validos.join(', ')}.`);
    if (!f.provedor && !f.testar && ctx.interativo && !f.yes) {
      id = await ctx.perguntar.escolher('Qual provedor de vídeo?', validos.map((v) => ({ valor: v, rotulo: PROVEDORES_ROTULO[v]?.rotulo || v, detalhe: PROVEDORES_ROTULO[v]?.detalhe })), id);
    }
    const modulo = moduloDe(id);
    const modo = lerCaminho(bruto, 'acesso.modo') || 'privado';
    const restrito = modo !== 'publico';

    const novo = JSON.parse(JSON.stringify(bruto));
    definirCaminho(novo, 'video.provedor', id);
    if (id === 'hls-generico') {
      let base = f['base-url'] || lerCaminho(novo, 'video.hlsGenerico.baseUrl') || ctx.env.HLS_BASE_URL;
      if (!base && ctx.interativo && !f.yes && !f.testar) base = await ctx.perguntar.texto('Endereço base dos seus vídeos HLS (https://...)', '');
      if (!base) throw pendente('falta-base-url', 'o HLS genérico precisa do endereço base dos vídeos.', { comando: 'node scripts/setup.mjs video --provedor hls-generico --base-url https://videos.seudominio.com/acervo' });
      if (!/^https:\/\/[^\s]+$/.test(base)) throw erroUso('--base-url precisa começar com https://');
      definirCaminho(novo, 'video.hlsGenerico.baseUrl', base);
    }
    if (!f.testar && JSON.stringify(novo) !== JSON.stringify(bruto)) await salvarConfig(ctx, rel, novo, `Provedor de vídeo agora é "${id}"`);
    else if (!f.testar) rel.acao('config', 'config/site.json já estava assim', 'ja-estava');

    /* credenciais: obrigatórias, mais as de assinatura nos modos restritos */
    const envArquivo = await lerArquivoEnv(path.join(ctx.raiz, '.env'));
    const env = { ...envArquivo };
    for (const [k, v] of Object.entries(ctx.env)) if (typeof v === 'string' && v !== '') env[k] = v;
    const precisa = credenciaisNecessarias(modulo, id, modo);
    /* A chave de assinatura do Stream o setup CRIA sozinho (a pessoa não cola JWK): fica fora dos prompts. */
    const geraChave = id === 'cloudflare-stream' && (restrito || f['criar-chave-assinatura']);
    const faltandoTudo = precisa.filter(([, def]) => !env[def.env]);
    const faltando = faltandoTudo.filter(([, def]) => !(geraChave && VARIAVEIS_DA_CHAVE.includes(def.env)));
    for (const [, def] of precisa) if (env[def.env]) rel.acao(`cred:${def.env}`, `${def.env} já definida (${mascarar(env[def.env])})`, 'ja-estava');

    if (faltando.length && !f.testar) {
      if (f.dryRun) for (const [, def] of faltando) rel.acao(`cred:${def.env}`, `Pediria ${def.env} num prompt oculto`, 'simulado');
      else if (!ctx.interativo) {
        const nomes = faltando.map(([, d]) => d.env);
        const aviso = geraChave ? ' A chave de assinatura do vídeo (CLOUDFLARE_STREAM_KEY_ID e CLOUDFLARE_STREAM_KEY_JWK) NÃO precisa ser digitada: o setup a cria sozinho depois, com o token.' : '';
        throw pendente('credenciais-do-video', `faltam as credenciais do provedor "${id}": ${nomes.join(', ')}. As chaves secretas só podem ser digitadas pela pessoa, num terminal (a digitação fica escondida).${aviso}`, {
          comando: 'node scripts/setup.mjs video', dados: { faltando: nomes, ondeAchar: Object.fromEntries(nomes.filter((n) => ONDE_ACHAR[n]).map((n) => [n, ONDE_ACHAR[n]])), naoSecretas: nomes.filter((n) => NAO_SECRETAS.has(n)) },
          dica: 'Agente: mostre à pessoa onde achar cada item (docs/contas-e-chaves.md, seção do provedor) e peça que rode o comando num segundo terminal aberto na pasta do projeto. Quem é só um número ou endereço (' + (nomes.filter((n) => NAO_SECRETAS.has(n)).join(', ') || 'nenhum aqui') + ') aparece na tela ao digitar; as chaves secretas ficam escondidas. Alternativa: pôr as variáveis no .env e rodar de novo.'
        });
      } else {
        await protegerSegredosLocais(ctx, rel);
        for (const [, def] of faltando) {
          if (ONDE_ACHAR[def.env]) rel.info(`\n${def.env}: ${ONDE_ACHAR[def.env]}`);
          const aberto = NAO_SECRETAS.has(def.env);
          const pergunta = `Digite ${def.env}${def.obrigatoria ? '' : ' (necessário para o vídeo ficar protegido)'}`;
          const v = (aberto ? await ctx.perguntar.texto(pergunta) : await ctx.perguntar.senha(pergunta.replace('Digite', 'Cole'))).trim();
          if (!v) { if (def.obrigatoria) throw falha('valor-vazio', `${def.env} não pode ficar vazio.`); continue; }
          if (/[\r\n]/.test(v)) throw falha('valor-invalido', `${def.env}: cole só o texto da chave, em uma linha.`);
          const estado = await gravarNoArquivoEnv(path.join(ctx.raiz, '.env'), def.env, v);
          env[def.env] = v;
          rel.acao(`cred:${def.env}`, `${def.env} guardada em .env (ignorado pelo git) ${mascarar(v)}`, estado === 'igual' ? 'ja-estava' : 'feito');
        }
      }
    }

    /* chave de assinatura do Stream: criada aqui, com o token que já está no .env; o valor nunca é mostrado */
    if (geraChave && !f.testar && VARIAVEIS_DA_CHAVE.some((n) => !env[n])) {
      if (f.dryRun) rel.acao('chave-assinatura', 'Criaria a chave de assinatura do Stream com o seu token (a chave vai direto para o .env, sem aparecer)', 'simulado');
      else if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_TOKEN) {
        rel.acao('chave-assinatura', 'Chave de assinatura: ainda faltam o ID da conta e o token do Stream para criá-la', 'pendente');
        rel.pendencia('chave-assinatura', 'falta criar a chave de assinatura do Stream (depende do token)', 'node scripts/setup.mjs video --criar-chave-assinatura');
      } else {
        const ch = await criarChaveDeAssinatura({ fetch: ctx.fetch, accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_STREAM_TOKEN });
        if (!ch.ok) throw falha('chave-assinatura-recusada', explicarFalhaDaChave(ch.motivo));
        await protegerSegredosLocais(ctx, rel);
        await gravarNoArquivoEnv(path.join(ctx.raiz, '.env'), 'CLOUDFLARE_STREAM_KEY_ID', ch.id);
        await gravarNoArquivoEnv(path.join(ctx.raiz, '.env'), 'CLOUDFLARE_STREAM_KEY_JWK', ch.jwk);
        env.CLOUDFLARE_STREAM_KEY_ID = ch.id; env.CLOUDFLARE_STREAM_KEY_JWK = ch.jwk;
        rel.acao('chave-assinatura', 'Chave de assinatura do Stream criada e guardada em .env (o valor não é mostrado)', 'feito');
      }
    }

    /* teste de conexão */
    const config = (await validarBruto(ctx.raiz, novo)).config;
    if (!f['sem-teste'] && !f.dryRun && config) {
      const adaptador = criarProvedor(config, env, { fetch: ctx.fetch });
      if ((adaptador.faltando || []).length) {
        rel.acao('teste', `Teste de conexão pulado: faltam ${adaptador.faltando.join(', ')}`, 'pendente');
        rel.pendencia('credenciais-do-video', `faltam ${adaptador.faltando.join(', ')}`, 'node scripts/setup.mjs video');
        rel.dado('video', { provedor: id, conexao: 'nao-testada', faltando: adaptador.faltando });
        return 3;
      }
      const t = await adaptador.validarCredenciais();
      if (!t.ok) throw falha('credenciais-recusadas', `o provedor não aceitou as credenciais: ${t.mensagem || t.codigo}`, { dica: 'Confira se copiou a chave certa (no Bunny é a chave da BIBLIOTECA de vídeo, não a da conta) e rode: node scripts/setup.mjs video' });
      rel.acao('teste', `O provedor "${id}" aceitou as credenciais`, 'feito');
    } else if (f.dryRun) rel.acao('teste', 'Testaria a conexão com o provedor', 'simulado');

    if (f['enviar-segredos'] && !f.testar) {
      for (const [, def] of precisa) {
        if (!env[def.env]) continue;
        await guardarSegredo(ctx, rel, def.env, env[def.env], ['worker'], {});
      }
    }
    rel.dado('video', { provedor: id, credenciais: precisa.map(([, d]) => d.env), modo });
    rel.passo(f['enviar-segredos'] ? 'Siga para: node scripts/setup.mjs segredo ADMIN_PASSWORD' : 'Envie as chaves ao Worker: node scripts/setup.mjs video --enviar-segredos  (e depois: segredo ADMIN_PASSWORD)');
    return 0;
  }
};
