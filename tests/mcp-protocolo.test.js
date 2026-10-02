/* M10 — o endpoint /mcp como protocolo: JSON-RPC 2.0 sobre Streamable HTTP, stateless.
 * Cobre: desligado por padrão, autenticação, initialize e negociação de versão, tools/list por escopo, tools/call sem aperto de
 * mão, erros JSON-RPC corretos, Origin, GET/DELETE, lote, cabeçalho de versão e idioma das descrições. Sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mundoMcp, ambienteMcp } = require('./fixtures/mcp-ambiente.js');

const LEITURA = ['listar_titulos', 'ver_titulo', 'buscar', 'estatisticas_basicas', 'ver_saude'];
const CURADORIA = ['editar_titulo', 'publicar_rascunho', 'organizar_home', 'criar_colecao'];
const ADMIN = ['gerar_convite', 'trocar_textos'];

test('o MCP nasce desligado: 404 para todos os métodos, mesmo com token válido', async () => {
  for (const mcp of [null, { ligado: false }, { ligado: false, somenteLeitura: false }]) {
    const m = await mundoMcp({ mcp });
    const t = await m.criar('admin');
    for (const metodo of ['POST', 'GET', 'DELETE']) {
      const r = await m.bruto({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: t.token, metodo });
      assert.equal(r.status, 404, metodo + ' com mcp ' + JSON.stringify(mcp));
      assert.ok(r.json.error, 'responde em JSON-RPC, sem pista do que existe');
    }
  }
});

test('sem token, com token torto, da equipe ou de espectador: 401 com WWW-Authenticate', async () => {
  const m = await mundoMcp();
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const semToken = await m.bruto(ping);
  assert.equal(semToken.status, 401);
  assert.match(semToken.cabecalhos.get('www-authenticate'), /^Bearer realm="mcp"/);
  assert.equal(semToken.json.error.code, -32001);
  for (const t of ['lixo', 'mcp_curto', 'mcp_' + 'A'.repeat(43), m.tokenSuper]) {
    const r = await m.bruto(ping, { token: t });
    assert.equal(r.status, 401, 'token: ' + t.slice(0, 12));
    assert.match(r.cabecalhos.get('www-authenticate'), /invalid_token/);
  }
  /* o inverso: o token do MCP não abre a API da mesa */
  const ok = await m.criar('admin');
  for (const caminho of ['/api/catalogo?completo=1', '/api/contas', '/api/saude']) {
    const r = await m.c.get(caminho, { token: ok.token });
    assert.equal(r.status, 401, caminho + ' não pode aceitar token do MCP');
  }
});

test('initialize: negocia a versão, anuncia só tools, não abre sessão e traz as instruções', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const r = await m.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }, { token: t });
  assert.equal(r.status, 200);
  assert.equal(r.json.jsonrpc, '2.0');
  assert.equal(r.json.result.protocolVersion, '2025-06-18');
  assert.deepEqual(Object.keys(r.json.result.capabilities), ['tools']);
  assert.equal(r.json.result.serverInfo.name, 'Plataforma Exemplo');
  assert.ok(r.json.result.serverInfo.version);
  assert.match(r.json.result.instructions, /conteudoNaoConfiavel/);
  assert.equal(r.cabecalhos.get('mcp-session-id'), null, 'stateless: nenhum Mcp-Session-Id');
  assert.match(r.cabecalhos.get('content-type'), /application\/json/);
  /* versões antigas que os clientes ainda usam */
  for (const v of ['2025-03-26', '2024-11-05']) {
    assert.equal((await m.rpc('initialize', { protocolVersion: v }, { token: t })).json.result.protocolVersion, v);
  }
  /* versão que não conhecemos: respondemos com a nossa mais nova (o cliente decide se segue) */
  assert.equal((await m.rpc('initialize', { protocolVersion: '2099-01-01' }, { token: t })).json.result.protocolVersion, '2025-06-18');
  assert.equal((await m.rpc('initialize', {}, { token: t })).json.result.protocolVersion, '2025-06-18');
});

test('notificação e resposta do cliente: 202 sem corpo; ping devolve {}', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const n = await m.bruto({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token: t });
  assert.equal(n.status, 202);
  assert.equal(n.texto, '');
  const resp = await m.bruto({ jsonrpc: '2.0', id: 9, result: {} }, { token: t });
  assert.equal(resp.status, 202);
  const p = await m.rpc('ping', undefined, { token: t });
  assert.deepEqual(p.json, { jsonrpc: '2.0', id: p.json.id, result: {} });
});

test('tools/list mostra só o que o escopo efetivo permite', async () => {
  const m = await mundoMcp();
  const nomes = async (escopo) => (await m.rpc('tools/list', {}, { token: (await m.criar(escopo)).token })).json.result.tools.map((x) => x.name);
  assert.deepEqual(await nomes('read'), LEITURA);
  assert.deepEqual(await nomes('curate'), LEITURA.concat(CURADORIA));
  assert.deepEqual(await nomes('admin'), LEITURA.concat(CURADORIA, ADMIN));

  /* `mcp.somenteLeitura` (o padrão) rebaixa QUALQUER token a leitura */
  const so = await mundoMcp({ mcp: { ligado: true, somenteLeitura: true } });
  assert.deepEqual((await so.rpc('tools/list', {}, { token: (await so.criar('admin')).token })).json.result.tools.map((x) => x.name), LEITURA);
  /* somenteLeitura ausente também vale como só leitura (falha fechada) */
  const sem = await mundoMcp({ mcp: { ligado: true } });
  assert.deepEqual((await sem.rpc('tools/list', {}, { token: (await sem.criar('admin')).token })).json.result.tools.map((x) => x.name), LEITURA);
});

test('cada ferramenta tem descrição de verdade, esquema e anotações coerentes', async () => {
  const m = await mundoMcp();
  const tools = (await m.rpc('tools/list', {}, { token: (await m.criar('admin')).token })).json.result.tools;
  for (const f of tools) {
    assert.ok(f.description && f.description.length > 40 && !f.description.startsWith('mcp.'), f.name + ': descrição é a chave crua');
    assert.equal(f.inputSchema.type, 'object', f.name);
    assert.equal(typeof f.annotations.readOnlyHint, 'boolean');
    assert.equal(f.annotations.openWorldHint, false);
  }
  const por = Object.fromEntries(tools.map((f) => [f.name, f.annotations]));
  for (const n of LEITURA) assert.deepEqual([por[n].readOnlyHint, por[n].destructiveHint], [true, false], n);
  for (const n of ['publicar_rascunho', 'organizar_home', 'gerar_convite', 'trocar_textos', 'editar_titulo']) assert.deepEqual([por[n].readOnlyHint, por[n].destructiveHint], [false, true], n);
  assert.equal(por.criar_colecao.destructiveHint, false, 'criar coleção só acrescenta');
});

test('a descrição acompanha o Accept-Language (en e es de fábrica)', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const desc = async (idioma) => (await m.rpc('tools/list', {}, { token: t, cabecalhos: { 'accept-language': idioma } })).json.result.tools[0].description;
  assert.match(await desc('pt-BR'), /Lista os títulos/);
  const cfg = require('./fixtures/contas-ambiente.js').configDe({ modo: 'privado' }, { mcp: { ligado: true }, idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en', 'es'] } });
  const m3 = await mundoMcp({ config: cfg });
  const t3 = (await m3.criar('read')).token;
  const d3 = async (idioma) => (await m3.rpc('tools/list', {}, { token: t3, cabecalhos: { 'accept-language': idioma } })).json.result.tools[0].description;
  assert.match(await d3('en'), /Lists the catalog titles/);
  assert.match(await d3('es'), /Lista los títulos/);
});

test('stateless: tools/list e tools/call funcionam sem initialize antes, e o mesmo pedido repetido dá o mesmo resultado', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const a = await m.chamar(t, 'estatisticas_basicas');
  const b = await m.chamar(t, 'estatisticas_basicas');
  assert.equal(a.erro, false);
  assert.deepEqual(a.dados.catalogo, b.dados.catalogo);
  assert.equal(a.dados.catalogo.titulos, 4);
});

test('erros JSON-RPC: parse (-32700), pedido inválido (-32600), método (-32601) e parâmetros (-32602)', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const parse = await m.bruto('{isto não é json', { token: t });
  assert.equal(parse.status, 400);
  assert.equal(parse.json.error.code, -32700);
  assert.equal(parse.json.id, null);

  for (const corpo of [{ id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: {}, method: 'ping' }, 42, 'texto']) {
    const r = await m.bruto(JSON.stringify(corpo), { token: t });
    assert.equal(r.json.error.code, -32600, JSON.stringify(corpo));
  }

  const metodo = await m.rpc('resources/list', {}, { token: t });
  assert.equal(metodo.json.error.code, -32601);
  assert.equal((await m.rpc('prompts/list', {}, { token: t })).json.error.code, -32601, 'só anunciamos tools');

  const semNome = await m.rpc('tools/call', {}, { token: t });
  assert.equal(semNome.json.error.code, -32602);
  const desconhecida = await m.rpc('tools/call', { name: 'apagar_tudo', arguments: {} }, { token: t });
  assert.equal(desconhecida.json.error.code, -32602);
  assert.match(desconhecida.json.error.message, /Unknown tool/);
  const argsRuins = await m.rpc('tools/call', { name: 'buscar', arguments: [1, 2] }, { token: t });
  assert.equal(argsRuins.json.error.code, -32602);
  /* o id volta igual (texto e número) */
  const comTexto = await m.bruto({ jsonrpc: '2.0', id: 'abc-1', method: 'ping' }, { token: t });
  assert.equal(comTexto.json.id, 'abc-1');
});

test('argumento ruim de ferramenta é erro DA FERRAMENTA (isError), não do protocolo', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const r = await m.chamar(t, 'listar_titulos', { limite: 9999 });
  assert.equal(r.http, 200);
  assert.equal(r.erro, true);
  assert.equal(r.dados.erro, 'argumento-invalido');
  assert.match(r.dados.mensagem, /limite/);
  assert.equal(r.resultado.content[0].type, 'text');
  assert.equal(JSON.parse(r.resultado.content[0].text).erro, 'argumento-invalido', 'o texto e o structuredContent dizem o mesmo');
});

test('GET e DELETE: 405 com Allow: POST (sem SSE, sem sessão para encerrar)', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  for (const metodo of ['GET', 'DELETE']) {
    const r = await m.bruto(null, { token: t, metodo });
    assert.equal(r.status, 405, metodo);
    assert.equal(r.cabecalhos.get('allow'), 'POST');
  }
});

test('Origin: de outro site é recusado (DNS rebinding); sem Origin ou do próprio site passa', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assert.equal((await m.bruto(ping, { token: t, cabecalhos: { origin: 'https://malvado.example' } })).status, 403);
  assert.equal((await m.bruto(ping, { token: t, cabecalhos: { origin: 'null' } })).status, 403);
  assert.equal((await m.bruto(ping, { token: t, cabecalhos: { origin: 'https://exemplo.test' } })).status, 200);
  assert.equal((await m.bruto(ping, { token: t })).status, 200);
});

test('MCP-Protocol-Version: aceita as conhecidas, recusa a desconhecida com 400', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const v of ['2025-06-18', '2025-03-26', '2024-11-05']) assert.equal((await m.bruto(ping, { token: t, cabecalhos: { 'mcp-protocol-version': v } })).status, 200, v);
  assert.equal((await m.bruto(ping, { token: t, cabecalhos: { 'mcp-protocol-version': '1999-01-01' } })).status, 400);
});

test('lote: responde na ordem, omite notificações; lote vazio, enorme ou só de notificações', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const r = await m.bruto([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'nada' }], { token: t });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 2);
  assert.deepEqual(r.json[0].result, {});
  assert.equal(r.json[1].error.code, -32601);
  assert.equal((await m.bruto([], { token: t })).status, 400);
  assert.equal((await m.bruto(Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })), { token: t })).status, 400);
  assert.equal((await m.bruto([{ jsonrpc: '2.0', method: 'notifications/initialized' }], { token: t })).status, 202);
});

test('corpo grande demais: 413', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const r = await m.bruto(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(300 * 1024) } }), { token: t });
  assert.equal(r.status, 413);
});

test('sem banco D1 não há token: 503, e nunca acesso', async () => {
  const m = await mundoMcp({ env: ambienteMcp({ DB: undefined }) });
  const r = await m.bruto({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: 'mcp_' + 'A'.repeat(43) });
  assert.equal(r.status, 503);
});

test('o /mcp passa pelo funil do Worker: cabeçalhos de segurança, no-store e sem CSP de página', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read')).token;
  const r = await m.rpc('ping', {}, { token: t });
  assert.equal(r.cabecalhos.get('cache-control'), 'no-store');
  assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.equal(r.cabecalhos.get('x-frame-options'), 'DENY');
});
