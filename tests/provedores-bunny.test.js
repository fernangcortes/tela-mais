/* O que é DO Bunny (e por isso não cabe na suíte de contrato, que vale para todos):
 * a tabela de status, a de eventos do webhook, a normalização da pull zone, o
 * padrão de id e o stub da assinatura. Sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const registro = () => import('../core/worker/_lib/provedores/index.js');

async function bunny(env, respostas) {
  const { criarProvedor } = await registro();
  const chamadas = [];
  const fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), metodo: init.method || 'GET' });
    const r = respostas ? respostas(String(url), init) : null;
    if (!r) throw new Error('sem rede: ' + url);
    return new Response(JSON.stringify(r), { status: 200 });
  };
  return { provedor: criarProvedor(null, Object.assign({ BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k-12345678', BUNNY_PULLZONE: 'vz-a.b-cdn.net' }, env), { fetch }), chamadas };
}

test('a tabela de status do Bunny vira os quatro estados; só o 4 é "pronto" e só o 5 e o 6 são erro', async () => {
  const esperado = { 0: 'enviando', 1: 'processando', 2: 'processando', 3: 'processando', 4: 'pronto', 5: 'erro', 6: 'erro', 7: 'processando', 8: 'processando' };
  for (const [status, estado] of Object.entries(esperado)) {
    const { provedor } = await bunny({}, () => ({ guid: ID, status: Number(status), encodeProgress: 10 }));
    assert.equal((await provedor.statusEncoding(ID)).estado, estado, 'status ' + status);
  }
  /* Status que a API ainda não tinha: segue como processando, nunca como pronto. */
  const { provedor } = await bunny({}, () => ({ guid: ID, status: 99 }));
  assert.equal((await provedor.statusEncoding(ID)).estado, 'processando');
});

test('webhook: 3 e 4 são pronto, 5 e 8 são erro; o resto é processando', async () => {
  const { provedor } = await bunny({});
  const evento = async (Status) => (await provedor.receberWebhook(new Request('https://x.test/', { method: 'POST', body: JSON.stringify({ VideoLibraryId: 1, VideoGuid: ID, Status }) }))).evento;
  assert.deepEqual([await evento(3), await evento(4), await evento(5), await evento(8), await evento(0), await evento(1), await evento(2), await evento(6)],
    ['pronto', 'pronto', 'erro', 'erro', 'processando', 'processando', 'processando', 'processando']);
});

test('a pull zone aceita https:// e barra finais (erro comum no .env), e valor que não é host é ignorado', async () => {
  for (const digitado of ['vz-a.b-cdn.net', 'https://vz-a.b-cdn.net/', 'HTTPS://VZ-A.B-CDN.NET//', '  vz-a.b-cdn.net  ']) {
    const { provedor } = await bunny({ BUNNY_PULLZONE: digitado });
    assert.equal((await provedor.urlReproducao(ID)).hls, 'https://vz-a.b-cdn.net/' + ID + '/playlist.m3u8', JSON.stringify(digitado));
  }
  for (const lixo of ['x"><script>', 'sem ponto', 'a.b/c?d', '']) {
    const { provedor } = await bunny({ BUNNY_PULLZONE: lixo });
    assert.equal((await provedor.urlReproducao(ID)).hls, null, JSON.stringify(lixo));
    assert.equal(await provedor.urlCapa(ID, {}), null);
  }
});

test('o id do Bunny: guid (8 a 64, letras, números e hífen); nada que mude o caminho', async () => {
  const { provedor } = await bunny({});
  for (const bom of [ID, 'video-aaaa-1111', 'AbCdEfGh']) assert.ok(provedor.padraoId.test(bom), bom);
  for (const ruim of ['', 'curto', 'a/b-12345678', 'a b c d e f g h', ID + '?x=1', '../' + ID]) assert.ok(!provedor.padraoId.test(ruim), ruim);
});

test('sem BUNNY_TOKEN_KEY (ou sem pull zone) o Bunny não assina: assinar é recusado, nunca devolve URL aberta (a assinatura de verdade está em provedores-assinatura.test.js)', async () => {
  const { ErroProvedor } = await registro();
  for (const env of [{}, { BUNNY_TOKEN_KEY: 'chave-de-token-123', BUNNY_PULLZONE: '' }]) {
    const { provedor, chamadas } = await bunny(env);
    assert.equal(provedor.capacidades().assinatura, false);
    await assert.rejects(() => provedor.urlReproducao(ID, { assinar: true, validadeSeg: 7200 }), (e) => e instanceof ErroProvedor && e.codigo === 'assinatura-indisponivel' && e.status === 501);
    assert.ok(!JSON.stringify(await provedor.urlReproducao(ID, { assinar: false })).includes('chave-de-token-123'));
    assert.equal(chamadas.length, 0);
  }
});

test('o embed do Bunny leva os quatro parâmetros que desligam autoplay, loop, preload e rememberPosition — o padrão do player é autoplay=true', async () => {
  const { provedor } = await bunny({});
  const { embed } = await provedor.urlReproducao(ID);
  const p = new URL(embed.url).searchParams;
  assert.deepEqual([p.get('autoplay'), p.get('loop'), p.get('preload'), p.get('rememberPosition')], ['false', 'false', 'false', 'false']);
  assert.equal(embed.controle, 'playerjs');
  assert.match(embed.scriptUrl, /^https:\/\/assets\.mediadelivery\.net\/playerjs\//);
});

test('listar e capa: a página pedida e o tamanho são limitados (nada de itemsPerPage=1000000)', async () => {
  const { provedor, chamadas } = await bunny({}, () => ({ totalItems: 0, items: [] }));
  await provedor.listar({ cursor: '-5', limite: 1000000 });
  assert.match(chamadas[0].url, /page=1&itemsPerPage=100&/);
  await provedor.listar({ cursor: 'abc', limite: 0 });
  assert.match(chamadas[1].url, /page=1&itemsPerPage=50&/);
});
