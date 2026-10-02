/* Testes do adaptador Cloudflare Stream que a suíte de contrato não cobre: assinatura local (RS256, chave gerada
 * no teste: nenhum segredo em arquivo), webhook assinado, metadados TUS, conversão SRT, extensões. Sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const registro = () => import('../core/worker/_lib/provedores/index.js');
const modulo = () => import('../core/worker/_lib/provedores/cloudflare-stream.js');

const UID = 'ea95132c15732412d22c1476fa83f27a';
const ENV = { CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_STREAM_TOKEN: 'chave-de-teste-nao-vaza', CLOUDFLARE_STREAM_SUBDOMINIO: 'customer-m033z5x00ks6nunl' };
const AGORA = 1750000000000;

async function criar(env, { config, respostas } = {}) {
  const { criarProvedor } = await registro();
  const chamadas = [];
  const fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), metodo: (init.method || 'GET').toUpperCase(), cab: Object.fromEntries(new Headers(init.headers || {})), corpo: init.body });
    const r = respostas && respostas.shift();
    if (!r) throw new Error('chamada não prevista: ' + url);
    return new Response(r.texto !== undefined ? r.texto : JSON.stringify(r.corpo), { status: r.status || 200, headers: r.cab || {} });
  };
  return { p: criarProvedor(config || { video: { provedor: 'cloudflare-stream' } }, Object.assign({}, ENV, env), { provedor: 'cloudflare-stream', fetch, agora: () => AGORA }), chamadas };
}

function chaveDeTeste() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { jwk: privateKey.export({ format: 'jwk' }), pub: publicKey };
}

test('[cloudflare-stream] assinatura local: JWT RS256 com sub/kid/exp, na URL no lugar do uid; sem chave, assinar é recusado', async () => {
  const { jwk, pub } = chaveDeTeste();
  const { p, chamadas } = await criar({
    CLOUDFLARE_STREAM_KEY_ID: 'kid-de-teste-1234',
    CLOUDFLARE_STREAM_KEY_JWK: Buffer.from(JSON.stringify(jwk)).toString('base64')
  });
  assert.equal(p.capacidades().assinatura, true);
  const r = await p.urlReproducao(UID, { assinar: true, validadeSeg: 600 });
  assert.equal(r.expiraEm, AGORA / 1000 + 600);
  const m = r.hls.match(/^https:\/\/customer-m033z5x00ks6nunl\.cloudflarestream\.com\/([\w-]+\.[\w-]+\.[\w-]+)\/manifest\/video\.m3u8$/);
  assert.ok(m, 'hls: ' + r.hls);
  assert.ok(!r.hls.includes(UID), 'o uid aberto ficou na URL assinada');
  const [h, c, s] = m[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', kid: 'kid-de-teste-1234' });
  const corpo = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(corpo.sub, UID); assert.equal(corpo.kid, 'kid-de-teste-1234'); assert.equal(corpo.exp, r.expiraEm); assert.ok(corpo.nbf <= AGORA / 1000);
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + c), pub, Buffer.from(s, 'base64url')), 'assinatura RS256 inválida');
  assert.match(r.embed.url, new RegExp('/' + m[1].replace(/\./g, '\\.') + '/iframe\\?'));
  assert.match(await p.urlCapa(UID, { assinar: true, validadeSeg: 60, tempoSeg: 5 }), /\/[\w-]+\.[\w-]+\.[\w-]+\/thumbnails\/thumbnail\.jpg\?time=5s$/);
  assert.equal(chamadas.length, 0, 'assinar foi à rede');
  /* O JWK aceita JSON cru. */
  const cru = await criar({ CLOUDFLARE_STREAM_KEY_ID: 'kid-de-teste-1234', CLOUDFLARE_STREAM_KEY_JWK: JSON.stringify(jwk) });
  assert.ok((await cru.p.urlReproducao(UID, { assinar: true })).expiraEm);
  /* Sem chave: recusa. */
  const sem = await criar({});
  assert.equal(sem.p.capacidades().assinatura, false);
  await assert.rejects(() => sem.p.urlReproducao(UID, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  await assert.rejects(() => sem.p.urlCapa(UID, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  /* Chave ilegível: erro tipado, sem vazar a chave. */
  const ruim = await criar({ CLOUDFLARE_STREAM_KEY_ID: 'kid-de-teste-1234', CLOUDFLARE_STREAM_KEY_JWK: 'isto-nao-e-jwk' });
  await assert.rejects(() => ruim.p.urlReproducao(UID, { assinar: true }), (e) => e.codigo === 'provedor-nao-configurado' && !(e.detalhe + e.message).includes('isto-nao-e-jwk'));
});

test('[cloudflare-stream] criarUpload: metadados TUS (nome, expiry, requiresignedurls só no modo privado), tamanho obrigatório, Location só do Stream', async () => {
  const resp = (loc) => ({ status: 201, texto: '', cab: Object.assign({ 'stream-media-id': UID }, loc === null ? {} : { location: loc || 'https://upload.cloudflarestream.com/abc' }) });
  const decod = (cab) => Object.fromEntries(cab['upload-metadata'].split(',').map(x => { const [k, v] = x.split(' '); return [k, v === undefined ? true : Buffer.from(v, 'base64').toString('utf8')]; }));

  const aberto = await criar({}, { respostas: [resp()] });
  const plano = await aberto.p.criarUpload({ titulo: 'Olá, ação', tamanhoBytes: 5e6, validadeSeg: 1800 });
  const m = decod(aberto.chamadas[0].cab);
  assert.equal(m.name, 'Olá, ação');
  assert.equal(m.expiry, '2025-06-15T15:36:40Z');
  assert.equal(m.expiry, new Date(plano.expiraEm * 1000).toISOString().replace('.000Z', 'Z'));
  assert.ok(!('requiresignedurls' in m));
  assert.equal(aberto.chamadas[0].cab['upload-length'], '5000000');
  assert.equal(aberto.chamadas[0].cab['tus-resumable'], '1.0.0');
  assert.equal(plano.pedacoBytes % (256 * 1024), 0);

  const privado = await criar({}, { config: { video: { provedor: 'cloudflare-stream', cloudflareStream: { exigirAssinatura: true } } }, respostas: [resp()] });
  await privado.p.criarUpload({ titulo: 'x', tamanhoBytes: 10 });
  assert.equal(decod(privado.chamadas[0].cab).requiresignedurls, true);

  const { ErroProvedor } = await registro();
  for (const ruim of [{ titulo: 'x' }, { titulo: 'x', tamanhoBytes: 0 }, { titulo: 'x', tamanhoBytes: 'abc' }]) {
    const a = await criar({}, { respostas: [] });
    await assert.rejects(() => a.p.criarUpload(ruim), (e) => e instanceof ErroProvedor && e.codigo === 'parametro-invalido');
    assert.equal(a.chamadas.length, 0);
  }
  for (const loc of ['https://evil.example.com/x', 'http://upload.cloudflarestream.com/x', null]) {
    const a = await criar({}, { respostas: [resp(loc)] });
    await assert.rejects(() => a.p.criarUpload({ titulo: 'x', tamanhoBytes: 10 }), (e) => e instanceof ErroProvedor && ['provedor-recusou-criacao', 'provedor-sem-guid'].includes(e.codigo));
  }
});

test('[cloudflare-stream] pedaço do TUS respeita 5 a 200 MiB e múltiplo de 256 KiB', async () => {
  for (const [mb, esperado] of [[1, 5 * 1048576], [50, 50 * 1048576], [500, 200 * 1048576]]) {
    const a = await criar({}, { config: { video: { provedor: 'cloudflare-stream', envio: { tamanhoDoPedacoMb: mb } } }, respostas: [{ status: 201, texto: '', cab: { 'stream-media-id': UID, location: 'https://upload.cloudflarestream.com/a' } }] });
    assert.equal((await a.p.criarUpload({ titulo: 'x', tamanhoBytes: 1 })).pedacoBytes, esperado);
  }
});

test('[cloudflare-stream] webhook: só com segredo; assinatura HMAC-SHA256 de "<time>.<corpo>", janela de tempo, evento normalizado', async () => {
  const segredo = 'segredo-de-webhook-de-teste';
  const sem = await criar({});
  assert.equal(sem.p.receberWebhook, undefined);
  assert.equal(sem.p.capacidades().webhooks, false);
  const { p } = await criar({ CLOUDFLARE_STREAM_WEBHOOK_SECRET: segredo });
  assert.equal(p.capacidades().webhooks, true);
  const pedido = (corpo, { tempo = AGORA / 1000, segredoUsado = segredo, cab } = {}) => {
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const sig = crypto.createHmac('sha256', segredoUsado).update(tempo + '.' + texto).digest('hex');
    return new Request('https://exemplo.test/api/webhook', { method: 'POST', body: texto, headers: cab || { 'Webhook-Signature': 'time=' + tempo + ',sig1=' + sig } });
  };
  assert.deepEqual(await p.receberWebhook(pedido({ uid: UID, readyToStream: true, status: { state: 'ready' } })), { id: UID, evento: 'pronto' });
  assert.deepEqual(await p.receberWebhook(pedido({ uid: UID, readyToStream: false, status: { state: 'error' } })), { id: UID, evento: 'erro' });
  assert.deepEqual(await p.receberWebhook(pedido({ uid: UID, readyToStream: false, status: { state: 'inprogress' } })), { id: UID, evento: 'processando' });
  assert.deepEqual(await p.receberWebhook(pedido({ uid: UID, readyToStream: false, status: { state: 'ready' } })), { id: UID, evento: 'processando' });
  const ok = { uid: UID, status: { state: 'ready' } };
  assert.equal(await p.receberWebhook(pedido(ok, { segredoUsado: 'outro-segredo' })), null, 'assinatura de outro segredo');
  assert.equal(await p.receberWebhook(pedido(ok, { tempo: AGORA / 1000 - 3600 })), null, 'requisição velha');
  assert.equal(await p.receberWebhook(pedido(ok, { cab: {} })), null, 'sem cabeçalho');
  assert.equal(await p.receberWebhook(pedido(ok, { cab: { 'Webhook-Signature': 'time=' + AGORA / 1000 + ',sig1=' + 'a'.repeat(64) } })), null);
  assert.equal(await p.receberWebhook(pedido('não é json')), null);
  assert.equal(await p.receberWebhook(pedido({ uid: '../x', status: { state: 'ready' } })), null);
});

test('[cloudflare-stream] SRT vira WebVTT; legenda é enviada como multipart com o campo file', async () => {
  const { srtParaVtt } = await modulo();
  assert.equal(srtParaVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\nOlá\r\n'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nOlá\n');
  assert.equal(srtParaVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n');
  const a = await criar({}, { respostas: [{ corpo: { success: true, errors: [], messages: [], result: { language: 'pt', label: 'Português', generated: false, status: 'ready' } } }] });
  await a.p.enviarLegenda(UID, { idioma: 'pt', srt: '1\n00:00:01,000 --> 00:00:02,000\nx' });
  assert.ok(a.chamadas[0].corpo instanceof FormData);
  const arquivo = a.chamadas[0].corpo.get('file');
  assert.match(await arquivo.text(), /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:02\.000/);
  assert.equal(a.chamadas[0].cab['content-type'], undefined, 'o content-type do multipart é do fetch (boundary)');
});

test('[cloudflare-stream] extensões: legenda por IA, capa por instante, uso do plano', async () => {
  const ok = (result) => ({ corpo: { success: true, errors: [], messages: [], result } });
  const ia = await criar({}, { respostas: [ok({ language: 'en', label: 'English', generated: true, status: 'inprogress' })] });
  assert.deepEqual(await ia.p.gerarLegendaIA(UID, { idioma: 'en' }), { iniciado: true });
  assert.equal(ia.chamadas[0].metodo, 'POST');
  assert.match(ia.chamadas[0].url, new RegExp('/stream/' + UID + '/captions/en/generate$'));
  await assert.rejects(() => ia.p.gerarLegendaIA(UID, { idioma: '../x' }), (e) => e.codigo === 'parametro-invalido');

  const capa = await criar({}, { respostas: [ok({ uid: UID, duration: 200, status: { state: 'ready' }, readyToStream: true }), ok({ uid: UID })] });
  const r = await capa.p.definirTempoDaCapa(UID, 50);
  assert.equal(r.pct, 0.25);
  assert.deepEqual(JSON.parse(capa.chamadas[1].corpo), { thumbnailTimestampPct: 0.25 });
  assert.match(r.urlCapa, /thumbnail\.jpg\?time=50s$/);
  await assert.rejects(() => capa.p.definirCapa(UID, new Uint8Array([1]), 'image/jpeg'), (e) => e.codigo === 'recurso-indisponivel');

  const uso = await criar({}, { respostas: [ok({ totalStorageMinutes: 12.5, totalStorageMinutesLimit: 1000, videoCount: 3 })] });
  assert.deepEqual(await uso.p.uso(), { minutosArmazenados: 12.5 });

  const ca = await criar({}, { respostas: [] });
  assert.match(await ca.p.urlCapa(UID, { tempoSeg: 12.9, largura: 640 }), /thumbnail\.jpg\?time=12s&width=640$/);
});

test('[cloudflare-stream] o código de cliente aceita "customer-x", "x" e o host; lixo não vira host; success:false com HTTP 200 é falha', async () => {
  for (const v of ['customer-m033z5x00ks6nunl', 'm033z5x00ks6nunl', 'https://customer-m033z5x00ks6nunl.cloudflarestream.com/']) {
    const { p } = await criar({ CLOUDFLARE_STREAM_SUBDOMINIO: v });
    assert.match((await p.urlReproducao(UID)).hls, /^https:\/\/customer-m033z5x00ks6nunl\.cloudflarestream\.com\/ea95/);
  }
  const lixo = await criar({ CLOUDFLARE_STREAM_SUBDOMINIO: 'x; script-src *' });
  assert.equal(lixo.p.configurado, false);
  assert.equal((await lixo.p.urlReproducao(UID)).hls, null);
  const falha = await criar({}, { respostas: [{ corpo: { success: false, errors: [{ code: 1000, message: 'boom' }], messages: [], result: null } }] });
  await assert.rejects(() => falha.p.statusEncoding(UID), (e) => e.codigo === 'provedor-recusou-consulta');
});

test('[cloudflare-stream] CSP: hosts do Stream e do upload nas quatro diretivas; nada de script', async () => {
  const { p } = await criar({});
  const h = p.hostsMidia();
  for (const d of ['img', 'media', 'connect', 'frame']) {
    assert.ok(h[d].includes('https://*.cloudflarestream.com'), d);
    assert.ok(h[d].includes('https://*.videodelivery.net'), d);
  }
  assert.deepEqual(h.script, []);
});
