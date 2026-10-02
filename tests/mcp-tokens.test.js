/* M10 — tokens do MCP: criação (uma vez, só hash no banco), escopos, expiração, revogação, auditoria, limite de taxa e retenção. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mundoMcp } = require('./fixtures/mcp-ambiente.js');
const { criarWorker, cliente } = require('./fixtures/contas-ambiente.js');

const mod = (nome) => import('../core/worker/' + nome);
const PING = { jsonrpc: '2.0', id: 1, method: 'ping' };

test('criar: o token aparece uma vez; o banco guarda só o SHA-256; a lista nunca o devolve', async () => {
  const m = await mundoMcp();
  const t = await m.criar('curate', 'Claude da Ana', 30);
  assert.match(t.token, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(t.escopo, 'curate');
  assert.ok(t.expiraEm > Math.floor(Date.now() / 1000) + 29 * 86400 && t.expiraEm < Math.floor(Date.now() / 1000) + 31 * 86400);

  const { hashDoToken } = await mod('_lib/mcp-tokens.js');
  const linhas = m.env.DB.consultar('SELECT * FROM mcp_tokens');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].token_hash, await hashDoToken(t.token));
  assert.ok(!JSON.stringify(linhas).includes(t.token), 'o token em claro não está em coluna nenhuma');
  assert.equal(linhas[0].prefixo, t.token.slice(0, 8));

  const lista = await m.c.get('/api/mcp-tokens', { token: m.tokenSuper });
  assert.equal(lista.status, 200);
  assert.equal(lista.json.tokens.length, 1);
  assert.equal(lista.json.tokens[0].estado, 'ativo');
  assert.ok(!lista.texto.includes(t.token) && !lista.texto.includes(linhas[0].token_hash), 'nem token nem hash na lista');
  assert.equal(lista.json.url, 'https://exemplo.test/mcp');
  assert.equal(lista.json.ligado, true);
  assert.equal(lista.json.somenteLeitura, false);
});

test('criar e revogar são só do superadmin; a equipe e o anônimo não chegam', async () => {
  const m = await mundoMcp();
  const App = require('../core/site/catalogo-core.js');
  const conta = await m.c.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: App.PERMISSOES.slice() }, { token: m.tokenSuper });
  assert.equal(conta.status, 200, conta.texto);
  const equipe = (await m.c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).json.token;
  for (const [metodo, token] of [['post', equipe], ['post', null], ['get', equipe], ['get', null]]) {
    const r = metodo === 'post' ? await m.c.post('/api/mcp-tokens', { nome: 'x', escopo: 'read' }, { token }) : await m.c.get('/api/mcp-tokens', { token });
    assert.equal(r.status, token ? 403 : 401, metodo + ' ' + (token ? 'equipe' : 'anônimo'));
  }
  const del = await m.c.delete('/api/mcp-tokens?id=qualquer', { token: equipe });
  assert.equal(del.status, 403);
  assert.equal(m.env.DB.consultar('SELECT COUNT(*) AS n FROM mcp_tokens')[0].n, 0);
});

test('criar valida nome, escopo e validade (padrão 90 dias, máximo 365)', async () => {
  const m = await mundoMcp();
  const tenta = (corpo) => m.c.post('/api/mcp-tokens', corpo, { token: m.tokenSuper });
  assert.equal((await tenta({ escopo: 'read' })).json.codigo, 'mcp-nome-invalido');
  assert.equal((await tenta({ nome: ' ', escopo: 'read' })).status, 400);
  assert.equal((await tenta({ nome: 'x'.repeat(61), escopo: 'read' })).status, 400);
  assert.equal((await tenta({ nome: 'x', escopo: 'super' })).json.codigo, 'mcp-escopo-invalido');
  assert.equal((await tenta({ nome: 'x' })).status, 400);
  for (const dias of [0, -1, 366, 1.5, 'abc']) assert.equal((await tenta({ nome: 'x', escopo: 'read', dias })).json.codigo, 'mcp-validade-invalida', String(dias));
  const padrao = await tenta({ nome: 'x', escopo: 'read' });
  assert.equal(padrao.status, 200);
  assert.ok(Math.abs(padrao.json.token.expiraEm - (Math.floor(Date.now() / 1000) + 90 * 86400)) < 5);
  assert.equal((await tenta({ nome: 'y', escopo: 'read', dias: 365 })).status, 200);
  assert.equal((await m.c.post('/api/mcp-tokens', 'não-é-objeto', { token: m.tokenSuper })).status, 400);
});

test('revogar vale no pedido seguinte; revogar duas vezes ou id que não existe dá 404; os outros tokens seguem', async () => {
  const m = await mundoMcp();
  const a = await m.criar('read', 'a');
  const b = await m.criar('read', 'b');
  assert.equal((await m.bruto(PING, { token: a.token })).status, 200);
  const r = await m.c.delete('/api/mcp-tokens?id=' + a.id, { token: m.tokenSuper });
  assert.equal(r.status, 200);
  const depois = await m.bruto(PING, { token: a.token });
  assert.equal(depois.status, 401);
  assert.match(depois.json.error.message, /token-revogado/);
  assert.equal((await m.bruto(PING, { token: b.token })).status, 200, 'o outro token continua valendo');
  assert.equal((await m.c.delete('/api/mcp-tokens?id=' + a.id, { token: m.tokenSuper })).status, 404);
  assert.equal((await m.c.delete('/api/mcp-tokens?id=nao-existe', { token: m.tokenSuper })).status, 404);
  assert.equal((await m.c.delete('/api/mcp-tokens', { token: m.tokenSuper })).status, 400);
  const lista = (await m.c.get('/api/mcp-tokens', { token: m.tokenSuper })).json.tokens;
  assert.equal(lista.find((x) => x.id === a.id).estado, 'revogado');
  assert.equal(lista.find((x) => x.id === b.id).estado, 'ativo');
});

test('token vencido não autentica (e a lista o mostra como vencido)', async () => {
  const m = await mundoMcp();
  const t = await m.criar('read');
  m.env.DB.bruto.prepare('UPDATE mcp_tokens SET expira_em = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 5, t.id);
  const r = await m.bruto(PING, { token: t.token });
  assert.equal(r.status, 401);
  assert.match(r.json.error.message, /token-vencido/);
  assert.equal((await m.c.get('/api/mcp-tokens', { token: m.tokenSuper })).json.tokens[0].estado, 'vencido');
});

test('token que o banco não conhece (outra instalação) não entra, e um token não vira outro por prefixo', async () => {
  const m = await mundoMcp();
  const t = await m.criar('admin');
  const quase = t.token.slice(0, -1) + (t.token.endsWith('A') ? 'B' : 'A');
  assert.equal((await m.bruto(PING, { token: quase })).status, 401);
  assert.equal((await m.bruto(PING, { token: t.token.slice(0, 8) })).status, 401);
});

test('escopo: ferramenta acima do escopo é recusada e registrada como negada', async () => {
  const m = await mundoMcp();
  const leitor = (await m.criar('read', 'leitor')).token;
  const curador = (await m.criar('curate', 'curador')).token;
  const antes = JSON.stringify(m.catalogo());

  const a = await m.chamar(leitor, 'editar_titulo', { id: 'aula-2', campos: { titulo: 'Hackeado' } });
  assert.equal(a.erro, true);
  assert.equal(a.dados.erro, 'escopo-insuficiente');
  const b = await m.chamar(curador, 'trocar_textos', { textos: { rodape: 'x' }, confirmar: true });
  assert.equal(b.dados.erro, 'escopo-insuficiente');
  const c = await m.chamar(curador, 'gerar_convite', { email: 'a@exemplo.com', confirmar: true });
  assert.equal(c.dados.erro, 'escopo-insuficiente');
  assert.equal(JSON.stringify(m.catalogo()), antes, 'nada foi gravado');
  assert.deepEqual(m.auditoria().map((l) => [l.token_nome, l.ferramenta, l.resultado, l.detalhe]), [
    ['leitor', 'editar_titulo', 'negado', 'escopo-insuficiente'],
    ['curador', 'trocar_textos', 'negado', 'escopo-insuficiente'],
    ['curador', 'gerar_convite', 'negado', 'escopo-insuficiente']
  ]);
});

test('mcp.somenteLeitura: token admin só consulta, e a recusa diz que é a configuração', async () => {
  const m = await mundoMcp({ mcp: { ligado: true, somenteLeitura: true } });
  const t = (await m.criar('admin')).token;
  const antes = JSON.stringify(m.catalogo());
  const r = await m.chamar(t, 'publicar_rascunho', { id: 'aula-2', confirmar: true });
  assert.equal(r.erro, true);
  assert.equal(r.dados.erro, 'somente-leitura');
  assert.match(r.dados.mensagem, /somente leitura/);
  assert.equal(JSON.stringify(m.catalogo()), antes);
  assert.equal(m.auditoria()[0].resultado, 'negado');
  assert.equal((await m.chamar(t, 'estatisticas_basicas')).erro, false, 'ler continua valendo');
});

test('auditoria: quem, qual ferramenta, argumentos resumidos e resultado; e a mesa a mostra ao superadmin', async () => {
  const m = await mundoMcp();
  const t = await m.criar('curate', 'Cursor do Beto');
  await m.chamar(t.token, 'buscar', { consulta: 'aula' });
  await m.chamar(t.token, 'ver_titulo', { id: 'nao-existe' });
  await m.chamar(t.token, 'editar_titulo', { id: 'aula-2', campos: { sinopse: 'x'.repeat(2500) } });
  const linhas = m.auditoria();
  assert.deepEqual(linhas.map((l) => [l.ferramenta, l.resultado, l.detalhe]), [['buscar', 'ok', null], ['ver_titulo', 'erro', 'titulo-inexistente'], ['editar_titulo', 'erro', 'argumento-invalido']]);
  assert.ok(linhas.every((l) => l.token_id === t.id && l.token_nome === 'Cursor do Beto' && l.em > 0));
  assert.equal(linhas[0].argumentos, '{"consulta":"aula"}');
  assert.ok(linhas[2].argumentos.length < 400, 'texto longo é cortado no registro');
  assert.match(linhas[2].argumentos, /…/);

  const tela = await m.c.get('/api/mcp-tokens', { token: m.tokenSuper });
  assert.equal(tela.json.auditoria.length, 3);
  assert.equal(tela.json.auditoria[0].ferramenta, 'editar_titulo', 'do mais novo para o mais velho');
  const antes = await m.c.get('/api/mcp-tokens?antes=' + tela.json.auditoria[0].id, { token: m.tokenSuper });
  assert.equal(antes.json.auditoria.length, 2);
});

test('auditoria: argumentos que parecem segredo, e-mail ou link nunca são gravados', async () => {
  const { resumirArgumentos } = await mod('_lib/mcp-tokens.js');
  const r = JSON.parse(resumirArgumentos({
    email: 'pessoa@exemplo.com', senha: 'hunter2', token: 'mcp_' + 'A'.repeat(43), chaveApi: 'k', authorization: 'Bearer abc',
    consulta: 'ola', nota: 'fale com fulano@exemplo.com', link: 'https://x.test/entrar.html#t=abc', ok: true, n: 3,
    ninho: { profundo: { demais: { fundo: { x: 1 } } } }, lista: Array.from({ length: 15 }, (_, i) => i), colar: 'Bearer segredo-longo-demais'
  }));
  assert.equal(r.email, '[oculto]');
  assert.equal(r.senha, '[oculto]');
  assert.equal(r.token, '[oculto]');
  assert.equal(r.chaveApi, '[oculto]');
  assert.equal(r.authorization, '[oculto]');
  assert.equal(r.nota, '[oculto]', 'e-mail no meio do texto');
  assert.equal(r.link, '[oculto]');
  assert.equal(r.colar, '[oculto]');
  assert.equal(r.consulta, 'ola');
  assert.equal(r.ok, true);
  assert.equal(r.lista.length, 11);
  assert.equal(r.lista[10], '+5');
  assert.equal(r.ninho.profundo.demais, '[…]');
  const tudo = resumirArgumentos({ x: 'a'.repeat(5000) });
  assert.ok(tudo.length <= 1010);
});

test('limite de taxa por token: a 61ª chamada no minuto toma 429 com Retry-After; outro token não é afetado', async () => {
  const m = await mundoMcp();
  const a = (await m.criar('read', 'a')).token;
  const b = (await m.criar('read', 'b')).token;
  for (let i = 0; i < 60; i++) assert.equal((await m.bruto(PING, { token: a })).status, 200, 'chamada ' + (i + 1));
  const barrada = await m.bruto(PING, { token: a });
  assert.equal(barrada.status, 429);
  assert.ok(Number(barrada.cabecalhos.get('retry-after')) >= 1);
  assert.equal(barrada.json.error.code, -32002);
  assert.equal((await m.bruto(PING, { token: a, ip: '192.0.2.77' })).status, 429, 'trocar de IP não escapa: o limite é do token');
  assert.equal((await m.bruto(PING, { token: b })).status, 200);
  /* a chamada barrada não gera linha de auditoria nem executa ferramenta */
  const t = await m.chamar(a, 'estatisticas_basicas');
  assert.equal(t.http, 429);
  assert.equal(m.auditoria().length, 0);
});

test('o limite usa o binding de Rate Limiting quando existe', async () => {
  const chamadas = [];
  const env = require('./fixtures/mcp-ambiente.js').ambienteMcp({ LIMITE_ENTRADA: { limit: async ({ key }) => { if (!key.startsWith('mcp:')) return { success: true }; chamadas.push(key); return { success: chamadas.length <= 2 }; } } });
  const m = await mundoMcp({ env });
  const t = (await m.criar('read')).token;
  assert.equal((await m.bruto(PING, { token: t })).status, 200);
  assert.equal((await m.bruto(PING, { token: t })).status, 200);
  assert.equal((await m.bruto(PING, { token: t })).status, 429);
  assert.ok(chamadas.every((k) => /^mcp:[0-9a-f]{32}$/.test(k)), 'a chave é um hash do id do token, nunca o token');
});

test('o cron de retenção apaga a auditoria com mais de 180 dias e só ela', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  await m.chamar(t, 'estatisticas_basicas');
  const velho = Math.floor(Date.now() / 1000) - 181 * 86400;
  m.env.DB.bruto.prepare("INSERT INTO mcp_auditoria (em, token_id, token_nome, ferramenta, resultado) VALUES (?, 'x', 'velho', 'buscar', 'ok')").run(velho);
  const { limparExpirados } = await mod('_lib/contas.js');
  const r = await limparExpirados(m.env);
  assert.equal(r.auditoriaMcp, 1);
  assert.deepEqual(m.auditoria().map((l) => l.token_nome).filter((n) => n === 'velho'), []);
  assert.equal(m.auditoria().length, 1);
});

test('custo: achar o token usa o índice do hash (D1 cobra por linha lida), e `ultimo_uso` é gravado no máximo a cada hora', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const plano = m.env.DB.consultar("EXPLAIN QUERY PLAN SELECT id, nome, escopo, expira_em, revogado_em, ultimo_uso FROM mcp_tokens WHERE token_hash = 'x'").map((l) => l.detail).join(' ');
  assert.match(plano, /USING (COVERING )?INDEX/i);
  assert.doesNotMatch(plano, /SCAN/);
  const escritasDeUso = () => m.env.DB.chamadas.filter((c) => /UPDATE mcp_tokens SET ultimo_uso/.test(c.sql)).length;
  await m.bruto(PING, { token: t });
  await m.bruto(PING, { token: t });
  await m.bruto(PING, { token: t });
  assert.equal(escritasDeUso(), 1);
  assert.ok(m.env.DB.consultar('SELECT ultimo_uso FROM mcp_tokens')[0].ultimo_uso > 0);
});

test('a migração 0003 convive com bancos antigos: tabelas novas, nada das antigas muda', async () => {
  const m = await mundoMcp();
  const tabelas = m.env.DB.consultar("SELECT name FROM sqlite_master WHERE type = 'table'").map((l) => l.name);
  for (const t of ['mcp_tokens', 'mcp_auditoria', 'usuarios', 'sessoes', 'minha_lista']) assert.ok(tabelas.includes(t), t);
  assert.throws(() => m.env.DB.bruto.prepare("INSERT INTO mcp_tokens (id, nome, prefixo, token_hash, escopo, criado_em, expira_em) VALUES ('1','n','p','h','root',1,2)").run(), /CHECK/);
});

test('escopo-insuficiente: a mensagem mostra o escopo do token e o exigido', async () => {
  const m = await mundoMcp();
  const curador = (await m.criar('curate', 'curador')).token;
  const r = await m.chamar(curador, 'trocar_textos', { textos: { rodape: 'x' }, confirmar: true });
  assert.match(JSON.stringify(r), /\(curate\)/);
  assert.match(JSON.stringify(r), /admin/);
  assert.ok(!/\{(escopo|exigido)\}/.test(JSON.stringify(r)));
});
