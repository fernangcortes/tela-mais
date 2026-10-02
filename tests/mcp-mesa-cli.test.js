/* M10 — a tela "Integrações (MCP)" da mesa (mesa-mcp.js, num DOM falso) e o subcomando `setup.mjs mcp`. Sem rede. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { criarProjeto, rodar, criarMundo, criarPerguntas, lerSiteJson, nadaVazou, RAIZ_REAL } from './setup-falso.js';

const require = createRequire(import.meta.url);
const { abrirOperacao, resposta } = require('./assistente-ambiente.js');

/* ------------------------------------------------------------------ a tela da mesa */

const TOKEN_NOVO = 'mcp_' + 'Z'.repeat(43);
const dados = (extra) => Object.assign({
  ligado: true, somenteLeitura: false, url: 'https://exemplo.test/mcp',
  tokens: [
    { id: 't1', nome: 'Claude da Ana', prefixo: 'mcp_ab12', escopo: 'curate', criadoEm: 1790000000, expiraEm: 1799999999, revogadoEm: null, ultimoUso: null, estado: 'ativo' },
    { id: 't2', nome: 'Antigo', prefixo: 'mcp_cd34', escopo: 'read', criadoEm: 1790000000, expiraEm: 1790000100, revogadoEm: 1790000050, ultimoUso: 1790000040, estado: 'revogado' }
  ],
  auditoria: [{ id: 2, em: 1790000000, tokenId: 't1', tokenNome: 'Claude da Ana', ferramenta: 'editar_titulo', argumentos: '{"id":"aula-2"}', resultado: 'conflito', detalhe: 'conflito' }]
}, extra || {});

test('a tela mostra o estado, os tokens (só o início), a auditoria e o aviso quando o MCP está desligado', async () => {
  const t = abrirOperacao({ rotas: { '/api/mcp-tokens': () => dados() } });
  t.tela('mcp');
  await t.esperar();
  const texto = t.texto();
  assert.match(texto, /Integrações com agentes de IA/);
  assert.match(texto, /Ligado/);
  assert.match(texto, /Leitura e escrita/);
  assert.match(texto, /https:\/\/exemplo\.test\/mcp/);
  assert.match(texto, /Claude da Ana/);
  assert.match(texto, /mcp_ab12…/);
  assert.match(texto, /Revogado/);
  assert.match(texto, /editar_titulo/);
  assert.match(texto, /conflito/);
  assert.equal(t.todos('[data-acao="mcp-revogar"]').length, 1, 'só o token ativo tem botão de revogar');
  assert.ok(!/mcp\.mesa|mcp\.e\./.test(texto), 'nunca a chave crua na tela');

  const off = abrirOperacao({ rotas: { '/api/mcp-tokens': () => dados({ ligado: false, somenteLeitura: true }) } });
  off.tela('mcp');
  await off.esperar();
  assert.match(off.texto(), /Desligado/);
  assert.match(off.texto(), /"ligado": true/);
  assert.match(off.texto(), /Só leitura/);
});

test('criar token: manda nome, escopo e validade; mostra o token UMA vez com o comando do Claude Code; fechar o apaga da tela', async () => {
  let lista = dados({ tokens: [], auditoria: [] });
  const t = abrirOperacao({ rotas: {
    '/api/mcp-tokens': (u, o) => {
      if (o && o.method === 'POST') {
        lista = dados({ tokens: [{ id: 'n1', nome: 'Cursor', prefixo: 'mcp_ZZZZ', escopo: 'read', criadoEm: 1, expiraEm: 99999999999, revogadoEm: null, ultimoUso: null, estado: 'ativo' }], auditoria: [] });
        return { ok: true, token: { id: 'n1', token: TOKEN_NOVO, prefixo: 'mcp_ZZZZ', nome: 'Cursor', escopo: 'read', expiraEm: 99999999999 } };
      }
      return lista;
    }
  } });
  t.tela('mcp');
  await t.esperar();
  t.digitar('#mcp-nome', 'Cursor');
  t.mudar('#mcp-escopo', 'read');
  t.digitar('#mcp-dias', '30');
  t.clicar('[data-acao="mcp-criar"]');
  await t.esperar();
  const post = t.pedidosDe('/api/mcp-tokens', 'POST')[0];
  assert.deepEqual(t.corpoDe(post), { nome: 'Cursor', escopo: 'read', dias: 30 });
  assert.ok(t.texto().includes(TOKEN_NOVO), 'o token aparece logo depois de criado');
  assert.match(t.texto(), /claude mcp add --transport http streaming https:\/\/exemplo\.test\/mcp --header "Authorization: Bearer mcp_Z{43}"/);
  assert.match(t.texto(), /única vez/);

  t.clicar('[data-acao="mcp-copiar-comando"]');
  await t.esperar();
  assert.match(t.copiados[0], /^claude mcp add --transport http/);
  t.clicar('[data-acao="mcp-fechar"]');
  await t.esperar();
  assert.ok(!t.texto().includes(TOKEN_NOVO), 'depois de fechar, o token some e não volta');
  assert.match(t.texto(), /mcp_ZZZZ…/, 'só o início fica na lista');
});

test('criar token sem nome não chama o servidor; revogar pede confirmação e manda o DELETE', async () => {
  const t = abrirOperacao({ rotas: { '/api/mcp-tokens': () => dados() } });
  t.tela('mcp');
  await t.esperar();
  t.clicar('[data-acao="mcp-criar"]');
  await t.esperar();
  assert.equal(t.pedidosDe('/api/mcp-tokens', 'POST').length, 0);
  assert.match(t.texto(), /Dê um nome ao token/);

  t.clicar('[data-acao="mcp-revogar"]');
  await t.esperar();
  assert.match(t.confirmacoes[0], /Claude da Ana/);
  assert.equal(t.pedidosDe('/api/mcp-tokens?id=t1', 'DELETE').length, 1);

  const nao = abrirOperacao({ confirmar: false, rotas: { '/api/mcp-tokens': () => dados() } });
  nao.tela('mcp');
  await nao.esperar();
  nao.clicar('[data-acao="mcp-revogar"]');
  await nao.esperar();
  assert.equal(nao.pedidosDe('/api/mcp-tokens?id=t1', 'DELETE').length, 0, 'sem o "sim" nada é revogado');
});

test('a tela em inglês e em espanhol sai traduzida', async () => {
  for (const [idioma, esperado] of [['en', /Integrations with AI agents/], ['es', /Integraciones con agentes de IA/]]) {
    const t = abrirOperacao({ idioma, rotas: { '/api/mcp-tokens': () => dados() } });
    t.tela('mcp');
    await t.esperar();
    assert.match(t.texto(), esperado, idioma);
  }
});

test('o menu e a trilha da mesa conhecem a tela, só para o superadmin', () => {
  const mesa = readFileSync(path.join(RAIZ_REAL, 'core/site/mesa.js'), 'utf8');
  assert.match(mesa, /M\.sessao\.super \? itemMenu\('mcp'/);
  assert.match(mesa, /st\.tela === 'mcp' \? M\.telaMcp\(\)/);
  assert.match(readFileSync(path.join(RAIZ_REAL, 'core/site/mesa-painel.js'), 'utf8'), /M\.painelMcp/);
});

/* ------------------------------------------------------------------ setup.mjs mcp */

/* O D1 simulado: guarda os arquivos .sql e os comandos que o wrangler recebeu. O arquivo é lido na hora (o CLI o apaga depois). */
function mundoComD1(opcoes) {
  const m = criarMundo({ d1: [{ uuid: '00000000-0000-4000-8000-000000000001', name: 'plataforma-exemplo' }], ...opcoes });
  m.sql = [];
  m.linhas = [];
  const base = m.exec;
  m.exec = async (cmd, args = [], o = {}) => {
    const i = args.indexOf('wrangler@4');
    const w = i >= 0 ? args.slice(i + 1) : args;
    if (w[0] === 'd1' && w[1] === 'execute') {
      m.chamadas.push({ cmd, args: [...args], input: o.input });
      const f = w.indexOf('--file');
      m.sql.push(f >= 0 ? readFileSync(w[f + 1], 'utf8') : w[w.indexOf('--command') + 1]);
      return { codigo: 0, saida: JSON.stringify([{ results: m.linhas, success: true }]), erro: '' };
    }
    return base(cmd, args, o);
  };
  return m;
}
const projetoComD1 = () => criarProjeto();

test('mcp status: mostra o que o config diz e lista os tokens sem nenhum segredo', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  mundo.linhas = [{ id: 'a1', nome: 'Claude', prefixo: 'mcp_ab12', escopo: 'read', expira_em: 4102444800, revogado_em: null }, { id: 'b2', nome: 'Velho', prefixo: 'mcp_cd34', escopo: 'admin', expira_em: 4102444800, revogado_em: 1790000000 }];
  const r = await rodar(['mcp', 'status', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual([r.json.dados.mcp.ligado, r.json.dados.mcp.somenteLeitura], [false, true]);
  assert.deepEqual(r.json.dados.mcp.tokens.map((t) => [t.nome, t.estado]), [['Claude', 'ativo'], ['Velho', 'revogado']]);
  assert.ok(!/token_hash/i.test(r.tudo + mundo.sql.join('\n')), 'o status nem pede o hash');
});

test('mcp ligar: pede o "sim", grava mcp.ligado (só leitura por padrão; --escrita solta a escrita) e desligar volta', async () => {
  const raiz = projetoComD1();
  const sem = await rodar(['mcp', 'ligar', '--json'], { raiz });
  assert.equal(sem.codigo, 3);
  assert.equal(sem.json.pendencias[0].quem, 'agente');
  assert.equal(lerSiteJson(raiz).mcp.ligado, false, 'sem o sim nada muda');

  const ok = await rodar(['mcp', 'ligar', '--yes'], { raiz });
  assert.equal(ok.codigo, 0, ok.tudo);
  assert.deepEqual(lerSiteJson(raiz).mcp, { ligado: true, somenteLeitura: true });
  const escrita = await rodar(['mcp', 'ligar', '--escrita', '--yes'], { raiz });
  assert.equal(escrita.codigo, 0);
  assert.deepEqual([lerSiteJson(raiz).mcp.ligado, lerSiteJson(raiz).mcp.somenteLeitura], [true, false]);
  assert.equal((await rodar(['mcp', 'desligar'], { raiz })).codigo, 0);
  assert.equal(lerSiteJson(raiz).mcp.ligado, false);
});

test('mcp criar-token sem terminal (agente): sai 3 para a PESSOA, não cria nada e não imprime token', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  const r = await rodar(['mcp', 'criar-token', '--nome', 'Claude', '--escopo', 'read', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 3);
  assert.equal(r.json.pendencias[0].codigo, 'mcp-token-precisa-terminal');
  assert.equal(r.json.pendencias[0].quem, 'pessoa');
  assert.match(r.json.pendencias[0].comando, /mcp criar-token --nome "Claude" --escopo read --dias 90/);
  assert.equal(mundo.sql.length, 0, 'nada foi ao banco');
  assert.ok(!/mcp_[A-Za-z0-9_-]{43}/.test(r.tudo));
});

test('mcp criar-token no terminal da pessoa: o token aparece uma vez, no banco vai só o hash, e nada vaza para saída, comando ou arquivo', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  let mostrado = '';
  const r = await rodar(['mcp', 'criar-token', '--nome', "Ana's Claude", '--escopo', 'curate', '--dias', '30'], { raiz, mundo, perguntas: criarPerguntas(), extra: { mostrarSegredo: (t) => { mostrado += t; } } });
  assert.equal(r.codigo, 0, r.tudo);
  const token = /mcp_[A-Za-z0-9_-]{43}/.exec(mostrado)[0];
  assert.match(mostrado, /aparece só agora/);
  /* o token só foi ao canal do terminal da pessoa: nunca à saída normal, aos argumentos do wrangler ou ao relatório */
  assert.ok(nadaVazou(r, token), 'token fora da saída e dos argumentos');
  assert.ok(!JSON.stringify(r.relatorio.dados).includes(token));
  assert.equal(r.relatorio.dados['mcp-token'].valor, null);

  const sql = mundo.sql.join('\n');
  assert.ok(!sql.includes(token), 'o banco recebe só o hash');
  const { hashDoToken } = await import('../core/worker/_lib/mcp-tokens.js');
  assert.ok(sql.includes(await hashDoToken(token)));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mcp_tokens/, 'cria as tabelas se faltarem (o banco pode nunca ter visto o Worker novo)');
  assert.match(sql, /'Ana''s Claude'/, 'aspas do nome escapadas');
  assert.match(sql, /'curate'/);
  const chamada = mundo.chamadas.find((c) => c.args.includes('execute'));
  assert.ok(chamada.args.includes('--remote') && chamada.args.includes('plataforma-exemplo'));
  /* e o arquivo temporário não ficou para trás */
  const arquivo = chamada.args[chamada.args.indexOf('--file') + 1];
  assert.ok(!(await import('node:fs')).existsSync(arquivo));
});

test('mcp criar-token: o que o banco recebe autentica de verdade no Worker (mesmo formato do /api/mcp-tokens)', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  let mostrado = '';
  await rodar(['mcp', 'criar-token', '--nome', 'Via CLI', '--escopo', 'read'], { raiz, mundo, perguntas: criarPerguntas(), extra: { mostrarSegredo: (t) => { mostrado += t; } } });
  const token = /mcp_[A-Za-z0-9_-]{43}/.exec(mostrado)[0];
  const { criarD1Falso } = require('./fixtures/d1-falso.js');
  const db = criarD1Falso();
  const { garantirBanco } = await import('../core/worker/_lib/contas-banco.js');
  const env = { DB: db };
  await garantirBanco(env);
  db.bruto.exec(mundo.sql[mundo.sql.length - 1].split('\n').filter((l) => !/^--/.test(l)).join('\n'));
  const { autenticar } = await import('../core/worker/_lib/mcp-tokens.js');
  const r = await autenticar(env, new Request('https://x.test/mcp', { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(r.ok, true);
  assert.deepEqual([r.token.nome, r.token.escopo], ['Via CLI', 'read']);
});

test('mcp criar-token: valida nome, escopo e dias (saída 2), avisa se o MCP está desligado, --dry-run não cria nada, admin pede "sim"', async () => {
  const raiz = projetoComD1();
  for (const args of [[], ['--nome', 'x'], ['--nome', 'x', '--escopo', 'root'], ['--nome', 'x', '--escopo', 'read', '--dias', '999'], ['--escopo', 'read']]) {
    assert.equal((await rodar(['mcp', 'criar-token', ...args], { raiz, perguntas: criarPerguntas() })).codigo, 2, args.join(' '));
  }
  const mundo = mundoComD1();
  const seco = await rodar(['mcp', 'criar-token', '--nome', 'x', '--escopo', 'read', '--dry-run'], { raiz, mundo, perguntas: criarPerguntas() });
  assert.equal(seco.codigo, 0);
  assert.equal(mundo.sql.length, 0);
  assert.match(seco.tudo, /desligado/);

  let mostrado = '';
  const recusa = await rodar(['mcp', 'criar-token', '--nome', 'x', '--escopo', 'admin'], { raiz, mundo, perguntas: criarPerguntas({ confirmar: [false] }), extra: { mostrarSegredo: (t) => { mostrado += t; } } });
  assert.equal(recusa.codigo, 3);
  assert.equal(mostrado, '');
  assert.equal(mundo.sql.length, 0);
});

test('mcp criar-token sem login na Cloudflare: pede o login e não gera token', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1({ logado: false });
  let mostrado = '';
  const r = await rodar(['mcp', 'criar-token', '--nome', 'x', '--escopo', 'read', '--json'], { raiz, mundo, perguntas: criarPerguntas(), extra: { mostrarSegredo: (t) => { mostrado += t; } } });
  assert.equal(r.codigo, 3);
  assert.equal(mostrado, '');
});

test('mcp revogar: pede o "sim", rejeita id com cara de SQL e manda o UPDATE só com o id escapado', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  assert.equal((await rodar(['mcp', 'revogar', "x'; DROP TABLE usuarios; --", '--yes'], { raiz, mundo })).codigo, 2);
  assert.equal((await rodar(['mcp', 'revogar'], { raiz, mundo })).codigo, 2);
  assert.equal(mundo.sql.length, 0);
  const sem = await rodar(['mcp', 'revogar', 'a1b2c3d4', '--json'], { raiz, mundo });
  assert.equal(sem.codigo, 3);
  assert.equal(mundo.sql.length, 0);
  const ok = await rodar(['mcp', 'revogar', 'a1b2c3d4', '--yes'], { raiz, mundo });
  assert.equal(ok.codigo, 0, ok.tudo);
  assert.match(mundo.sql[0], /UPDATE mcp_tokens SET revogado_em = .* WHERE \(id = 'a1b2c3d4' OR prefixo = 'a1b2c3d4'\) AND revogado_em IS NULL/);
  assert.equal((await rodar(['mcp', 'nada'], { raiz, mundo })).codigo, 2);
});

test('--local manda o comando para o D1 local do wrangler dev', async () => {
  const raiz = projetoComD1();
  const mundo = mundoComD1();
  await rodar(['mcp', 'status', '--local'], { raiz, mundo });
  const c = mundo.chamadas.find((x) => x.args.includes('execute'));
  assert.ok(c.args.includes('--local') && !c.args.includes('--remote'));
});
