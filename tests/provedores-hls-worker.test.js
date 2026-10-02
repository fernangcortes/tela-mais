/* O HLS genérico visto de fora (M4): o que o Worker entrega com um provedor que não tem upload nem API,
 * a CSP derivada só da config, a rota que cadastra título por endereço e as capacidades que a mesa lê.
 * Sem rede: o servidor de vídeo é um `fetch` de mentira no global. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const BASE = 'https://videos.exemplo.test/acervo';
const CONFIG = { video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: BASE, hostsPermitidos: ['cdn.exemplo.net'] } } };

const kv = (inicial) => {
  const dados = Object.assign({}, inicial);
  return {
    dados,
    get: async (k, tipo) => (k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null),
    getWithMetadata: async (k, tipo) => ({ value: k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null, metadata: null }),
    put: async (k, v) => { dados[k] = String(v); },
    delete: async (k) => { delete dados[k]; },
    list: async ({ prefix = '' } = {}) => ({ keys: Object.keys(dados).filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  };
};
const ambiente = (catalogo) => ({
  ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
  CATALOGO: kv(catalogo ? { catalogo: JSON.stringify(catalogo) } : {}),
  ASSETS: { fetch: async () => new Response('<html></html>', { status: 200 }) }
});

async function pedir(env, { metodo = 'GET', caminho, corpo, token, config = CONFIG }) {
  const { criarWorker } = await import('../core/worker/index.js');
  const worker = criarWorker({ obterConfig: async () => Object.assign({ acesso: { modo: 'publico' } }, config) });
  const r = await worker.fetch(new Request('https://exemplo.test' + caminho, {
    method: metodo,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  }), env, { waitUntil: () => {} });
  const texto = await r.clone().text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* sem JSON */ }
  return { status: r.status, corpo: json, texto, cabecalhos: r.headers };
}
const entrar = async (env) => (await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { senha: 'senha-do-super' } })).corpo.token;

function servidorDeVideo(respostas) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), metodo: String(init.method || 'GET') });
    const r = respostas[String(url)];
    if (!r) throw new Error('chamada não prevista: ' + url);
    return new Response(r.texto, { status: r.status || 200, headers: r.cabecalhos || {} });
  };
  return { chamadas, desfazer: () => { globalThis.fetch = original; } };
}

const catalogo = () => ({
  rev: 1, versao: 1,
  itens: [
    { id: 'a', titulo: 'A', publicar: true, fonte: { provedor: 'hls-generico', id: 'serie/a/master.m3u8', extras: { capa: BASE + '/serie/a/capa.jpg', legendas: [{ idioma: 'pt', url: BASE + '/serie/a/pt.vtt' }] } } },
    { id: 'b', titulo: 'B', publicar: true, fonte: { provedor: 'hls-generico', id: 'hls-12345678', extras: { hls: 'https://cdn.exemplo.net/v/b.m3u8', mp4: { '720p': 'https://cdn.exemplo.net/v/b.mp4' } } } },
    { id: 'c', titulo: 'C (host fora da lista)', publicar: true, fonte: { provedor: 'hls-generico', id: 'hls-87654321', extras: { hls: 'https://estranho.test/c.m3u8' } } },
    { id: 'd', titulo: 'D (de outro provedor)', publicar: true, fonte: { provedor: 'bunny', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', extras: {} } }
  ]
});

test('o catálogo público entrega midia do HLS genérico; extras e endereços de cadastro não saem na projeção pública', async () => {
  const env = ambiente(catalogo());
  const r = await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(r.status, 200);
  const [a, b, c, d] = r.corpo.itens;
  assert.equal(a.midia.hls, BASE + '/serie/a/master.m3u8');
  assert.equal(a.midia.capa, BASE + '/serie/a/capa.jpg');
  assert.deepEqual(a.midia.legendas, [{ idioma: 'pt', rotulo: 'Português', url: BASE + '/serie/a/pt.vtt' }]);
  assert.equal(a.midia.embed, null);
  assert.equal(b.midia.hls, 'https://cdn.exemplo.net/v/b.m3u8');
  assert.deepEqual(b.midia.mp4, { '720p': 'https://cdn.exemplo.net/v/b.mp4' });
  assert.equal(c.midia.hls, null, 'host fora da lista não vira URL de reprodução');
  assert.equal(d.midia, null, 'fonte de outro provedor não vira mídia');
  assert.deepEqual(a.fonte, { provedor: 'hls-generico', id: 'serie/a/master.m3u8' });
  assert.ok(!r.texto.includes('estranho.test'), 'o endereço de um título fora da lista vazou na resposta pública');
  assert.ok(!('extras' in a.fonte));
});

test('a CSP libera só a base e os hostsPermitidos da config; endereço de título nunca amplia a política', async () => {
  const env = ambiente(catalogo());
  const r = await pedir(env, { caminho: '/api/catalogo' });
  const csp = r.cabecalhos.get('content-security-policy');
  const diretiva = (nome) => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(nome + ' ')) || '');
  for (const d of ['media-src', 'img-src', 'connect-src']) {
    assert.ok(diretiva(d).includes('https://videos.exemplo.test'), d + ' sem a base');
    assert.ok(diretiva(d).includes('https://cdn.exemplo.net'), d + ' sem o host permitido');
    assert.ok(!diretiva(d).includes('estranho.test'), d + ' liberou o host de um título');
  }
  assert.ok(!diretiva('script-src').includes('exemplo.test') && !diretiva('script-src').includes('cdn.exemplo.net'));
  assert.ok(!/b-cdn|bunnycdn|mediadelivery|cloudflarestream/.test(csp));
});

test('GET /api/midia?capacidades=1 diz o que o provedor faz: HLS cadastra por endereço e não envia arquivo', async () => {
  const env = ambiente(catalogo());
  const token = await entrar(env);
  const r = await pedir(env, { caminho: '/api/midia?capacidades=1', token });
  assert.equal(r.status, 200);
  assert.deepEqual([r.corpo.provedor, r.corpo.configurado, r.corpo.envio, r.corpo.fontePorUrl, r.corpo.uploadProtocolo], ['hls-generico', true, false, true, 'nenhum']);
  const bunny = await pedir(Object.assign(ambiente(catalogo()), { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'chave-1234' }), { caminho: '/api/midia?capacidades=1', token, config: { video: { provedor: 'bunny' } } });
  assert.deepEqual([bunny.corpo.envio, bunny.corpo.fontePorUrl], [true, false]);
  const semLogin = await pedir(env, { caminho: '/api/midia?capacidades=1' });
  assert.ok([401, 403].includes(semLogin.status));
});

test('POST /api/midia?tipo=fonte confere os endereços, lê o playlist e devolve a fonte pronta com a midia', async () => {
  const env = ambiente(catalogo());
  const token = await entrar(env);
  const srv = servidorDeVideo({ [BASE + '/novo/master.m3u8']: { texto: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8\n', cabecalhos: { 'content-type': 'application/vnd.apple.mpegurl' } } });
  try {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=fonte', token, corpo: { hls: BASE + '/novo/master.m3u8', capa: BASE + '/novo/capa.webp' } });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.corpo.fonte.id, 'novo/master.m3u8');
    assert.equal(r.corpo.fonte.provedor, 'hls-generico');
    assert.equal(r.corpo.pronto, true);
    assert.equal(r.corpo.midia.hls, BASE + '/novo/master.m3u8');
    assert.equal(r.corpo.midia.capa, BASE + '/novo/capa.webp');
    assert.equal(srv.chamadas.length, 1);

    /* Host fora da lista: 400, com campo e motivo, e nenhuma ida à rede. */
    const ruim = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=fonte', token, corpo: { hls: 'https://estranho.test/x.m3u8' } });
    assert.equal(ruim.status, 400);
    assert.equal(ruim.corpo.codigo, 'parametro-invalido');
    assert.equal(ruim.corpo.detalhe, 'hls:host-nao-permitido');
    assert.equal(srv.chamadas.length, 1);

  } finally { srv.desfazer(); }
  /* Resposta que não é playlist: o servidor devolve `falhou`. */
  const html = servidorDeVideo({ [BASE + '/pagina.m3u8']: { texto: '<html>', cabecalhos: { 'content-type': 'text/html' } } });
  try {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=fonte', token, corpo: { hls: BASE + '/pagina.m3u8' } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.corpo.falhou, r.corpo.pronto], [true, false]);
  } finally { html.desfazer(); }
  const f404 = servidorDeVideo({ [BASE + '/some.m3u8']: { texto: 'nada', status: 404 } });
  try {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=fonte', token, corpo: { hls: BASE + '/some.m3u8' } });
    assert.equal(r.status, 502);
    assert.equal(r.corpo.status, 404);
  } finally { f404.desfazer(); }
});

test('POST /api/midia?tipo=fonte num provedor que recebe arquivo é 501; upload-token do HLS genérico também', async () => {
  const env = Object.assign(ambiente(catalogo()), { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'chave-1234' });
  const token = await entrar(env);
  const bunny = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=fonte', token, config: { video: { provedor: 'bunny' } }, corpo: { hls: BASE + '/a.m3u8' } });
  assert.equal(bunny.status, 501);
  const up = await pedir(ambiente(catalogo()), { metodo: 'POST', caminho: '/api/upload-token', token: await entrar(ambiente(catalogo())), corpo: { titulo: 'X' } });
  assert.equal(up.status, 501);
});

test('o PUT do catálogo guarda a fonte do HLS com os extras, e o GET completo (a mesa) os devolve', async () => {
  const env = ambiente(catalogo());
  const token = await entrar(env);
  const lido = await pedir(env, { caminho: '/api/catalogo?completo=1', token });
  assert.deepEqual(lido.corpo.itens[0].fonte.extras.legendas, [{ idioma: 'pt', url: BASE + '/serie/a/pt.vtt' }]);
  const doc = lido.corpo;
  doc.itens.push({ id: 'e', titulo: 'E', publicar: false, fonte: { provedor: 'hls-generico', id: 'e/master.m3u8', extras: { capa: BASE + '/e/capa.jpg' } } });
  const put = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token, corpo: doc });
  assert.equal(put.status, 200, put.texto);
  const guardado = JSON.parse(env.CATALOGO.dados.catalogo);
  assert.deepEqual(guardado.itens[4].fonte, { provedor: 'hls-generico', id: 'e/master.m3u8', extras: { capa: BASE + '/e/capa.jpg' } });
  assert.ok(guardado.itens.every(i => !('midia' in i)));
});
