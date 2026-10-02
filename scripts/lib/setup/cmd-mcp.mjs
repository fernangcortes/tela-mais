/* scripts/lib/setup/cmd-mcp.mjs — `setup.mjs mcp`: liga o MCP (o servidor para assistentes de IA) e cuida dos tokens.
 *
 *   mcp status                                     o que a config diz e quais tokens existem (só nome, escopo, validade)
 *   mcp ligar [--escrita]                          mcp.ligado = true (e, com --escrita, mcp.somenteLeitura = false). Pede "sim".
 *   mcp desligar                                   mcp.ligado = false
 *   mcp criar-token --nome N --escopo read|curate|admin [--dias 90] [--local]
 *   mcp revogar ID_OU_PREFIXO [--local]
 *
 * O TOKEN NUNCA PASSA PELO AGENTE: `criar-token` só mostra o valor num terminal de verdade (da pessoa), uma vez, e nunca no
 * --json nem em arquivo. Sem terminal, vira pendência da pessoa (como o `segredo`). No banco vai só o SHA-256 dele.
 * O banco é o D1 do Cloudflare (`wrangler d1 execute --remote`); `--local` usa o D1 local do `wrangler dev`. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { erroUso, pendente, falha } from './erros.mjs';
import { criarWrangler, exigirLogin } from './cloudflare.mjs';
import { criarEstado } from './estado.mjs';
import { autorizar, salvarConfig, siteAtual } from './comum.mjs';
import { definirCaminho, lerCaminho } from './config-io.mjs';
import { MIGRACOES } from '../../../core/migrations/indice.mjs';
import { ESCOPOS, PREFIXO_DO_TOKEN, hashDoToken, validarCriacao } from '../../../core/worker/_lib/mcp-tokens.js';
import { sortearToken, idAleatorio } from '../../../core/worker/_lib/contas-cripto.js';

const SQL_DAS_TABELAS = (MIGRACOES.find((m) => m.nome === '0003_mcp.sql') || {}).sql || '';
const SUBCOMANDOS = ['status', 'ligar', 'desligar', 'criar-token', 'revogar'];
const FORMA_DO_ID = /^[A-Za-z0-9_]{4,64}$/;
const aspas = (t) => "'" + String(t).replace(/'/g, "''") + "'";

const ESCOPO_EM_PALAVRAS = {
  read: 'só consulta (títulos, busca, números, saúde)',
  curate: 'consulta e edita rascunhos, publica rascunhos, organiza a home e cria coleções',
  admin: 'tudo isso mais gerar convites e trocar textos do site'
};

/* Roda SQL no D1 pelo wrangler. `arquivo` é um .sql temporário (sem segredo: só hash). Devolve as linhas do último SELECT. */
async function sqlNoD1(ctx, wr, nomeDoBanco, { comando, arquivo }) {
  const alvo = ctx.flags.local ? '--local' : '--remote';
  const args = ['d1', 'execute', nomeDoBanco, alvo, '--json', ...(arquivo ? ['--file', arquivo] : ['--command', comando])];
  const r = await wr.rodar(args);
  if (r.codigo !== 0) throw falha('mcp-d1', 'o wrangler não conseguiu falar com o banco (D1).', { dica: (r.erro || r.saida).slice(0, 300) });
  try {
    const j = JSON.parse(r.saida.slice(r.saida.indexOf('[')));
    const ultimo = Array.isArray(j) ? j[j.length - 1] : null;
    return (ultimo && ultimo.results) || [];
  } catch { return []; }
}

async function bancoDoProjeto(ctx, rel) {
  const estado = criarEstado(ctx);
  const w = await estado.wrangler();
  const d1 = w.recursos.d1;
  if (!d1 || !d1.database_name) throw pendente('mcp-sem-d1', 'o wrangler.jsonc não tem o banco de contas (D1). Rode antes: node scripts/setup.mjs cloudflare provisionar', { quem: 'agente' });
  if (!ctx.flags.local) await exigirLogin(ctx, estado.wr, { contaId: ctx.flags.conta });
  return { wr: estado.wr, nome: d1.database_name, estado };
}

async function lerConfigMcp(ctx) {
  const { bruto } = await siteAtual(ctx);
  return { bruto, ligado: lerCaminho(bruto, 'mcp.ligado') === true, somenteLeitura: lerCaminho(bruto, 'mcp.somenteLeitura') !== false };
}

export const mcp = {
  nome: 'mcp',
  resumo: 'Liga o MCP (assistentes de IA consultam e organizam o catálogo) e cria ou revoga os tokens deles.',
  uso: 'mcp status | ligar [--escrita] | desligar | criar-token --nome NOME --escopo read|curate|admin [--dias 90] | revogar ID [--local]',
  flags: { nome: 'valor', escopo: 'valor', dias: 'valor', escrita: 'bool', local: 'bool', conta: 'valor' },
  async executar(ctx, rel, posicionais) {
    const sub = posicionais[0] || 'status';
    if (!SUBCOMANDOS.includes(sub)) throw erroUso(`não existe "mcp ${sub}". Use: ${SUBCOMANDOS.join(', ')}.`);
    const f = ctx.flags;

    if (sub === 'ligar' || sub === 'desligar') {
      const { bruto, ligado, somenteLeitura } = await lerConfigMcp(ctx);
      if (sub === 'ligar') {
        await autorizar(ctx, 'confirmar-mcp', f.escrita
          ? 'Ligar o MCP COM escrita deixa um assistente de IA com token mudar o catálogo (sempre com histórico e confirmação). Confirma?'
          : 'Ligar o MCP deixa assistentes de IA com um token seu CONSULTAR o catálogo (só leitura). Confirma?', `node scripts/setup.mjs mcp ligar${f.escrita ? ' --escrita' : ''} --yes`);
        definirCaminho(bruto, 'mcp.ligado', true);
        definirCaminho(bruto, 'mcp.somenteLeitura', !f.escrita);
      } else {
        definirCaminho(bruto, 'mcp.ligado', false);
      }
      await salvarConfig(ctx, rel, bruto, sub === 'ligar' ? 'MCP ligado em config/site.json' : 'MCP desligado em config/site.json');
      rel.dado('mcp', { ligado: sub === 'ligar', somenteLeitura: sub === 'ligar' ? !f.escrita : somenteLeitura, eraLigado: ligado });
      rel.passo('Publique para valer: node scripts/setup.mjs deploy. Depois crie um token: node scripts/setup.mjs mcp criar-token --nome NOME --escopo read');
      return 0;
    }

    if (sub === 'status') {
      const { ligado, somenteLeitura } = await lerConfigMcp(ctx);
      rel.info(`MCP: ${ligado ? 'ligado' : 'desligado'} (${somenteLeitura ? 'só leitura' : 'leitura e escrita'}) no config/site.json.`);
      if (!ligado) rel.info('  Para ligar: node scripts/setup.mjs mcp ligar (e depois deploy).');
      let tokens = null;
      try {
        const { wr, nome } = await bancoDoProjeto(ctx, rel);
        tokens = (await sqlNoD1(ctx, wr, nome, { comando: 'SELECT id, nome, prefixo, escopo, expira_em, revogado_em FROM mcp_tokens ORDER BY criado_em DESC LIMIT 50' }))
          .map((t) => ({ id: t.id, nome: t.nome, prefixo: t.prefixo, escopo: t.escopo, expiraEm: t.expira_em, estado: t.revogado_em ? 'revogado' : (t.expira_em <= Math.floor(ctx.agora().getTime() / 1000) ? 'vencido' : 'ativo') }));
      } catch (e) {
        if (e && e.saida === 3) throw e;
        tokens = [];   /* tabela ainda não existe: nenhum token foi criado */
      }
      rel.dado('mcp', { ligado, somenteLeitura, tokens });
      if (!tokens.length) rel.info('Nenhum token criado ainda.');
      for (const t of tokens) rel.info(`  ${t.estado.padEnd(8)} ${t.escopo.padEnd(7)} ${t.prefixo}…  ${t.nome}  (id ${t.id})`);
      return 0;
    }

    if (sub === 'revogar') {
      const alvo = posicionais[1];
      if (!alvo || !FORMA_DO_ID.test(alvo)) throw erroUso('diga qual token revogar: node scripts/setup.mjs mcp revogar ID  (o id ou o início "mcp_xxxx" que o `mcp status` mostra).');
      await autorizar(ctx, 'confirmar-revogar-mcp', `Revogar o token ${alvo}? Quem o usa perde o acesso na hora.`, `node scripts/setup.mjs mcp revogar ${alvo} --yes`);
      if (f.dryRun) { rel.acao('mcp-revogar', `Revogaria o token ${alvo}`, 'simulado'); return 0; }
      const { wr, nome } = await bancoDoProjeto(ctx, rel);
      const sql = `UPDATE mcp_tokens SET revogado_em = CAST(strftime('%s','now') AS INTEGER) WHERE (id = ${aspas(alvo)} OR prefixo = ${aspas(alvo)}) AND revogado_em IS NULL`;
      await sqlNoD1(ctx, wr, nome, { comando: sql });
      rel.acao('mcp-revogar', `Token ${alvo} revogado (se existia e estava ativo)`, 'feito');
      return 0;
    }

    /* criar-token */
    const v = validarCriacao({ nome: f.nome, escopo: f.escopo, dias: f.dias });
    if (!v.ok) throw erroUso(`falta ou está errado: ${v.codigo === 'mcp-nome-invalido' ? '--nome (até 60 caracteres)' : v.codigo === 'mcp-escopo-invalido' ? `--escopo (${ESCOPOS.join(', ')})` : '--dias (de 1 a 365)'}.`,
      `Escopos: ${ESCOPOS.map((e) => `${e} = ${ESCOPO_EM_PALAVRAS[e]}`).join('; ')}.`);
    const { ligado, somenteLeitura } = await lerConfigMcp(ctx);
    if (!ligado) rel.aviso('o MCP está desligado no config/site.json: o token só vai funcionar depois de `mcp ligar` e do deploy.');
    if (somenteLeitura && v.escopo !== 'read') rel.aviso(`o config está em só leitura: mesmo com escopo ${v.escopo}, o assistente só vai consultar até você rodar \`mcp ligar --escrita\`.`);
    rel.info(`Token "${v.nome}": ${ESCOPO_EM_PALAVRAS[v.escopo]}. Vale ${v.dias} dias.`);

    if (f.dryRun) { rel.acao('mcp-token', `Criaria o token "${v.nome}" (escopo ${v.escopo}, ${v.dias} dias) no banco`, 'simulado'); return 0; }
    if (!ctx.interativo || f.json) {
      throw pendente('mcp-token-precisa-terminal', 'o valor do token só pode aparecer no terminal da própria pessoa, uma vez. Ele não pode passar pela conversa.', {
        comando: `node scripts/setup.mjs mcp criar-token --nome "${v.nome}" --escopo ${v.escopo} --dias ${v.dias}`,
        dica: 'Agente: peça que a pessoa abra um segundo terminal na pasta do projeto (COMECE-AQUI.md, "Como abrir um terminal") e rode o comando acima. O token aparece só ali; ela o guarda num gerenciador de senhas e o cola no assistente (docs/mcp.md). Nunca peça o valor de volta.'
      });
    }
    if (v.escopo === 'admin') {
      await autorizar(ctx, 'confirmar-token-admin', 'Um token "admin" também gera convites de acesso e troca textos do site. Confirma?', null);
    }
    const { wr, nome } = await bancoDoProjeto(ctx, rel);
    const token = sortearToken(PREFIXO_DO_TOKEN);
    const id = idAleatorio();
    const agora = Math.floor(ctx.agora().getTime() / 1000);
    const sql = SQL_DAS_TABELAS.trim() + '\n' +
      `INSERT INTO mcp_tokens (id, nome, prefixo, token_hash, escopo, criado_em, criado_por, expira_em) VALUES (${aspas(id)}, ${aspas(v.nome)}, ${aspas(token.slice(0, PREFIXO_DO_TOKEN.length + 4))}, ${aspas(await hashDoToken(token))}, ${aspas(v.escopo)}, ${agora}, 'setup', ${agora + v.dias * 86400});\n`;
    const pasta = await mkdtemp(path.join(tmpdir(), 'tela-mcp-'));
    const arquivo = path.join(pasta, 'token.sql');   /* só hash: o token em si nunca vai a arquivo */
    try {
      await writeFile(arquivo, sql, 'utf8');
      await sqlNoD1(ctx, wr, nome, { arquivo });
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
    rel.acao('mcp-token', `Token "${v.nome}" criado no banco (escopo ${v.escopo}, vale até ${new Date((agora + v.dias * 86400) * 1000).toISOString().slice(0, 10)})`, 'feito');
    rel.dado('mcp-token', { id, nome: v.nome, escopo: v.escopo, prefixo: token.slice(0, PREFIXO_DO_TOKEN.length + 4), valor: null });
    const mostrar = ctx.mostrarSegredo || ((t) => process.stdout.write(t));
    mostrar(`\nSeu token (aparece só agora, guarde num gerenciador de senhas):\n\n  ${token}\n\n`);
    rel.info('Para conectar o Claude Code, ver docs/mcp.md. Perdeu o token? Revogue (mcp revogar) e crie outro.');
    return 0;
  }
};
