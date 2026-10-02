/* scripts/lib/setup/cmd-segredo.mjs — `setup.mjs segredo NOME`: guarda um segredo sem que ele passe pelo chat, pela
 * linha de comando ou pela tela. O valor vem de prompt oculto, de --gerar, de --stdin ou de --do-ambiente. */
import path from 'node:path';
import { erroUso, pendente, falha } from './erros.mjs';
import { NOME_DE_SEGREDO, SEGREDOS_CONHECIDOS, gerarSegredo, mascarar, validarValorDeSegredo, gravarNoArquivoEnv } from './segredos.mjs';
import { criarWrangler, exigirLogin } from './cloudflare.mjs';
import { protegerSegredosLocais } from './comum.mjs';
import { avisarTokenGlobal } from './cmd-cloudflare.mjs';
import { REGRAS_DO_SEGREDO, NAO_SECRETAS, ONDE_ACHAR } from './credenciais.mjs';

const DESTINOS = ['worker', 'env', 'dev-vars'];

/* Nome que pode ser repetido na tela. Quem cola a chave no lugar do NOME faz um "nome" que passa no padrão
 * (maiúsculas e números), então só repetimos o que o produto conhece. O resto vira um rótulo genérico. */
export function rotuloDoNome(nome) {
  return SEGREDOS_CONHECIDOS.includes(nome) ? nome : 'esse segredo';
}

export async function obterValor(ctx, nome, { gerar, stdin, doAmbiente, confirmar = false }) {
  const rot = rotuloDoNome(nome);
  const conhecido = rot === nome;
  if (gerar) return { valor: gerarSegredo(36), origem: 'gerado' };
  if (stdin) return { valor: await ctx.lerStdin(), origem: 'stdin' };
  if (doAmbiente) {
    const v = ctx.env[nome];
    if (!v) throw pendente('variavel-ausente', `a variável de ambiente ${rot} não está definida.`);
    return { valor: v, origem: 'ambiente' };
  }
  if (!ctx.interativo) {
    throw pendente('segredo-precisa-terminal', `o valor de ${rot} só pode ser digitado pela própria pessoa, num terminal (a digitação fica escondida). Ele não pode passar pela conversa.`, {
      comando: `node scripts/setup.mjs segredo ${conhecido ? nome : 'NOME'}`,
      dados: { regra: REGRAS_DO_SEGREDO[nome] || null, ondeAchar: ONDE_ACHAR[nome] || null },
      dica: `Agente: peça que a pessoa abra um segundo terminal na pasta do projeto (COMECE-AQUI.md, "Como abrir um terminal"), rode o comando acima e cole o valor quando o campo escondido aparecer.${REGRAS_DO_SEGREDO[nome] ? ' Antes, avise: ' + REGRAS_DO_SEGREDO[nome] : ''} Quando ela disser que terminou, confirme com: node scripts/setup.mjs doctor (só mostra os nomes, nunca os valores).`
    });
  }
  if (REGRAS_DO_SEGREDO[nome]) ctx.rel.info(REGRAS_DO_SEGREDO[nome]);
  if (ONDE_ACHAR[nome]) ctx.rel.info(ONDE_ACHAR[nome]);
  const v = NAO_SECRETAS.has(nome) ? await ctx.perguntar.texto(`Digite o valor de ${rot}`) : await ctx.perguntar.senha(`Cole o valor de ${rot}`);
  if (confirmar) {
    const v2 = await ctx.perguntar.senha(`Repita o valor de ${rot}`);
    if (v !== v2) throw falha('valores-diferentes', 'os dois valores digitados não são iguais. Nada foi guardado.');
  }
  return { valor: v, origem: 'prompt' };
}

export async function guardarSegredo(ctx, rel, nome, valor, destinos, { forcar = false, gerado = false } = {}) {
  const marcado = gerado ? '(gerado, não exibido)' : mascarar(valor);
  const nomeReal = nome;
  nome = rotuloDoNome(nome);
  for (const d of destinos) {
    if (ctx.flags.dryRun) {
      if (d === 'worker') {
        /* não finge: guardar no Worker exige login (e o Worker só existe depois da primeira publicação) */
        const wr = criarWrangler(ctx);
        await exigirLogin(ctx, wr, { contaId: ctx.flags.conta });
        const s = await wr.listarSegredos();
        rel.acao(`segredo:${nome}:worker`, s.existeWorker ? `Guardaria ${nome} no Worker (a pessoa digitaria o valor num campo escondido)` : `Ainda não dá para guardar ${nome} no Worker: ele só existe depois da primeira publicação (deploy)`, s.existeWorker ? 'simulado' : 'pendente');
      } else rel.acao(`segredo:${nome}:${d}`, `Guardaria ${nome} em ${d === 'env' ? '.env' : '.dev.vars'}`, 'simulado');
      continue;
    }
    if (d === 'worker') {
      const wr = criarWrangler(ctx);
      avisarTokenGlobal(ctx, rel);
      await exigirLogin(ctx, wr, { contaId: ctx.flags.conta });
      if (gerado && !forcar) {
        const s = await wr.listarSegredos();
        if (s.nomes.includes(nomeReal)) { rel.acao(`segredo:${nome}:worker`, `${nome} já está no Worker (use --forcar para trocar)`, 'ja-estava'); continue; }
      }
      await wr.colocarSegredo(nomeReal, valor);
      rel.acao(`segredo:${nome}:worker`, `${nome} cadastrado no Worker ${marcado}`, 'feito');
    } else {
      await protegerSegredosLocais(ctx, rel);
      const arquivo = path.join(ctx.raiz, d === 'env' ? '.env' : '.dev.vars');
      const estado = await gravarNoArquivoEnv(arquivo, nomeReal, valor);
      rel.acao(`segredo:${nome}:${d}`, `${nome} em ${d === 'env' ? '.env' : '.dev.vars'} (ignorado pelo git) ${marcado}`, estado === 'igual' ? 'ja-estava' : 'feito');
    }
  }
  return marcado;
}

export const segredo = {
  nome: 'segredo',
  resumo: 'Guarda um segredo (senha, chave de API) por prompt oculto, sem mostrar nem gravar em arquivo versionado.',
  uso: 'segredo NOME [--gerar] [--stdin] [--do-ambiente] [--destino worker,env,dev-vars] [--forcar] [--conta ID]',
  flags: { gerar: 'bool', stdin: 'bool', 'do-ambiente': 'bool', destino: 'lista', forcar: 'bool', conta: 'valor' },
  async executar(ctx, rel, posicionais) {
    const f = ctx.flags;
    if (posicionais.length > 1) throw erroUso('o segredo não vai na linha de comando. Use só o NOME: node scripts/setup.mjs segredo NOME', 'O valor é pedido num prompt oculto (ou use --gerar, --stdin, --do-ambiente).');
    const nome = posicionais[0];
    if (!nome) throw erroUso('faltou o NOME do segredo (por exemplo ADMIN_PASSWORD).', 'Exemplo: node scripts/setup.mjs segredo ADMIN_PASSWORD');
    if (!NOME_DE_SEGREDO.test(nome)) throw erroUso('isso não parece um nome de segredo (maiúsculas, números e _; por exemplo BUNNY_API_KEY). Se era uma chave, não a use: revogue-a no site do provedor e crie outra.');
    const destinos = f.destino && f.destino.length ? f.destino : ['worker'];
    for (const d of destinos) if (!DESTINOS.includes(d)) throw erroUso(`--destino "${d}" inválido. Use: ${DESTINOS.join(', ')}.`);
    if ([f.gerar, f.stdin, f['do-ambiente']].filter(Boolean).length > 1) throw erroUso('escolha só uma origem: --gerar, --stdin ou --do-ambiente.');
    if (!SEGREDOS_CONHECIDOS.includes(nome)) rel.aviso('esse não é um nome de segredo que o produto usa. Se você colou uma chave aqui no lugar do nome, revogue-a e crie outra. Se era mesmo um nome, confira se escreveu certo.');
    if (nome === 'ADMIN_PASSWORD' && f.gerar) throw erroUso('a senha do administrador não é gerada: ela precisa ser uma que você saiba. Digite-a no prompt oculto.');

    if (f.dryRun) {
      await guardarSegredo(ctx, rel, nome, '', destinos, { gerado: true });
      rel.dado('segredo', { nome: rotuloDoNome(nome), destinos, valor: null });
      return 0;
    }
    const { valor, origem } = await obterValor(ctx, nome, { gerar: f.gerar, stdin: f.stdin, doAmbiente: f['do-ambiente'], confirmar: nome === 'ADMIN_PASSWORD' });
    const problema = validarValorDeSegredo(nome, valor);
    if (problema) throw falha('valor-invalido', `${rotuloDoNome(nome)}: ${problema}`, { dica: 'Nada foi guardado.' });
    const marcado = await guardarSegredo(ctx, rel, nome, valor, destinos, { forcar: f.forcar, gerado: origem === 'gerado' });
    rel.dado('segredo', { nome: rotuloDoNome(nome), destinos, origem, valor: marcado });
    return 0;
  }
};
