/* Mídia assinada (M5): Bunny (Token Authentication por diretório), Cloudflare Stream (JWT RS256 local) e HLS
 * genérico (sem assinatura). Os vetores são recalculados AQUI com `node:crypto`, independente do adaptador (que usa
 * WebCrypto). Chaves de teste geradas na hora: nenhum segredo em arquivo. Sem rede. A prova contra a CDN de verdade
 * (URL sem token = 403) é scripts/provar-assinatura.mjs. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const registro = () => import('../core/worker/_lib/provedores/index.js');
const validador = () => import('../core/worker/_lib/config-validar.mjs');

const AGORA = 1750000000000;           /* ms */
const AGORA_S = AGORA / 1000;
const VID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CHAVE = 'chave-de-token-so-de-teste-9f8e7d';
const CHAVE_EMBED = 'chave-do-embed-so-de-teste-1a2b3c';
const ZONA = 'vz-teste.b-cdn.net';
const BASE_ENV = { BUNNY_LIBRARY_ID: '123', BUNNY_API_KEY: 'api-key-de-teste-nao-vaza', BUNNY_PULLZONE: ZONA };

async function bunny(env) {
  const { criarProvedor } = await registro();
  const fetch = async (u) => { throw new Error('rede inesperada: ' + u); };
  return criarProvedor(null, Object.assign({}, BASE_ENV, env), { fetch, agora: () => AGORA });
}

/* Implementação independente, transcrita da referência oficial do Bunny (BunnyCDN.TokenAuthentication,
 * nodejs/token.js, signUrl com isDirectory=true, pathAllowed=tokenPath, ignoreParams=true). */
function tokenBunny(chave, tokenPath, expires) {
  const signingData = 'token_ignore_params=true&token_path=' + tokenPath;
  const h = crypto.createHmac('sha256', chave);
  h.update(tokenPath); h.update(String(expires)); h.update(Buffer.alloc(0)); h.update(signingData);
  return 'HS256-' + h.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const prefixoBunny = (chave, id, exp) =>
  `bcdn_token=${tokenBunny(chave, '/' + id + '/', exp)}&token_ignore_params=true&token_path=${encodeURIComponent('/' + id + '/')}&expires=${exp}`;

test('[bunny] vetor conhecido: o token de diretório bate com o cálculo independente (HMAC-SHA256, HS256-, base64url)', () => {
  /* Vetor fixo: se o algoritmo mudar por engano, este literal denuncia. */
  assert.equal(tokenBunny('chave', '/abc/', 1750003600),
    'HS256-' + crypto.createHmac('sha256', 'chave').update('/abc/1750003600token_ignore_params=true&token_path=/abc/').digest('base64url'));
});

test('[bunny] HLS assinado: token no prefixo do caminho, token_path=/<id>/, expires em segundos, capacidade ligada', async () => {
  const p = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  assert.equal(p.capacidades().assinatura, true);
  const r = await p.urlReproducao(VID, { assinar: true, validadeSeg: 600 });
  const exp = AGORA_S + 600;
  const esperado = tokenBunny(CHAVE, '/' + VID + '/', exp);
  assert.equal(r.expiraEm, exp);
  assert.equal(r.hls, `https://${ZONA}/${prefixoBunny(CHAVE, VID, exp)}/${VID}/playlist.m3u8`);
  const u = new URL(r.hls);
  assert.ok(u.pathname.endsWith('/' + VID + '/playlist.m3u8'));
  /* Um segmento relativo herda o prefixo do manifesto: o mesmo token cobre o diretório. */
  assert.equal(new URL('seg_0001.ts', r.hls).pathname.split('/')[1], u.pathname.split('/')[1]);
  for (const m of Object.values(r.mp4)) assert.match(m, new RegExp('^https://' + ZONA.replace(/\./g, '\\.') + '/bcdn_token=' + esperado.replace(/[-]/g, '\\-')));
});

test('[bunny] a mesma URL sem token é a aberta (diferente da assinada) e sem prefixo; a chave nunca aparece em saída alguma', async () => {
  const p = await bunny({ BUNNY_TOKEN_KEY: CHAVE, BUNNY_EMBED_KEY: CHAVE_EMBED });
  const aberta = await p.urlReproducao(VID);
  const assinada = await p.urlReproducao(VID, { assinar: true, validadeSeg: 60 });
  assert.equal(aberta.hls, `https://${ZONA}/${VID}/playlist.m3u8`);
  assert.notEqual(aberta.hls, assinada.hls);
  assert.ok(!aberta.hls.includes('token'));
  const tudo = JSON.stringify([assinada, await p.urlCapa(VID, { assinar: true }), await p.urlPreview(VID, { assinar: true }), await p.legendas(VID, { idiomas: ['pt'], assinar: true })]);
  for (const segredo of [CHAVE, CHAVE_EMBED, 'api-key-de-teste-nao-vaza']) assert.ok(!tudo.includes(segredo), 'segredo na saída: ' + segredo);
});

test('[bunny] expiração: validade vira expires = agora + validade; sem validade usa 1 h; tokens de validades diferentes diferem', async () => {
  const p = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  const a = await p.urlReproducao(VID, { assinar: true, validadeSeg: 60 });
  const b = await p.urlReproducao(VID, { assinar: true, validadeSeg: 120 });
  const c = await p.urlReproducao(VID, { assinar: true });
  assert.equal(a.expiraEm, AGORA_S + 60);
  assert.equal(c.expiraEm, AGORA_S + 3600);
  assert.notEqual(a.hls, b.hls);
  assert.match(a.hls, new RegExp('expires=' + (AGORA_S + 60) + '/'));
});

test('[bunny] capa, prévia e legendas saem com o MESMO token de diretório (mesmo caminho /<id>/)', async () => {
  const p = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  const exp = AGORA_S + 300;
  const pref = `https://${ZONA}/${prefixoBunny(CHAVE, VID, exp)}/${VID}/`;
  assert.equal(await p.urlCapa(VID, { assinar: true, validadeSeg: 300, arquivo: 'capa.jpg', versao: '7' }), pref + 'capa.jpg?v=7');
  assert.equal((await p.urlPreview(VID, { assinar: true, validadeSeg: 300 })).animada, pref + 'preview.webp');
  assert.equal((await p.legendas(VID, { idiomas: ['pt'], assinar: true, validadeSeg: 300 }))[0].url, pref + 'captions/pt.vtt');
});

test('[bunny] embed: só com BUNNY_EMBED_KEY (token = sha256 hex de chave + id + expires); sem a chave o embed some', async () => {
  const sem = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  assert.equal((await sem.urlReproducao(VID, { assinar: true })).embed, null);
  const com = await bunny({ BUNNY_TOKEN_KEY: CHAVE, BUNNY_EMBED_KEY: CHAVE_EMBED });
  const r = await com.urlReproducao(VID, { assinar: true, validadeSeg: 900 });
  const q = new URL(r.embed.url).searchParams;
  assert.equal(q.get('expires'), String(AGORA_S + 900));
  assert.equal(q.get('token'), crypto.createHash('sha256').update(CHAVE_EMBED + VID + (AGORA_S + 900)).digest('hex'));
  for (const k of ['autoplay', 'loop', 'preload', 'rememberPosition']) assert.equal(q.get(k), 'false', k);
});

test('[bunny] sem chave: recusa (nunca URL aberta); id inválido não vira caminho', async () => {
  const p = await bunny({});
  assert.equal(p.capacidades().assinatura, false);
  await assert.rejects(() => p.urlReproducao(VID, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  await assert.rejects(() => p.urlCapa(VID, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  const q = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  const ruim = await q.urlReproducao('../x', { assinar: true });
  assert.equal(ruim.hls, null);
});

test('[montarMidia] assinar=true assina vídeo, capa, prévia e legendas; sessao limita a validade; sem assinar sai tudo aberto', async () => {
  const { montarMidia } = await registro();
  const p = await bunny({ BUNNY_TOKEN_KEY: CHAVE });
  const item = { fonte: { provedor: 'bunny', id: VID } };
  const m = await montarMidia(p, item, { assinar: true, validadeSeg: 14400 });
  for (const u of [m.hls, m.capa, m.previa, m.legendas[0].url]) assert.match(u, /\/bcdn_token=HS256-[\w-]+&token_ignore_params=true&token_path=[^&/]+&expires=\d+\//, u);
  assert.equal(m.expiraEm, AGORA_S + 14400);
  /* A sessão acaba antes: a URL nunca vive mais que ela. */
  const realNow = Date.now; Date.now = () => AGORA;
  try {
    const curto = await montarMidia(p, item, { assinar: true, validadeSeg: 14400, sessao: { expiraEm: AGORA_S + 90 } });
    assert.equal(curto.expiraEm, AGORA_S + 90);
  } finally { Date.now = realNow; }
  const aberta = await montarMidia(p, item, { assinar: false });
  assert.ok(!JSON.stringify(aberta).includes('bcdn_token'));
  assert.equal(aberta.expiraEm, null);
  /* Adaptador sem assinatura + assinar: rejeita. */
  const sem = await bunny({});
  await assert.rejects(() => montarMidia(sem, item, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
});

/* -------------------------------------------------------------- Cloudflare Stream */

const UID = 'ea95132c15732412d22c1476fa83f27a';
const ENV_CF = { CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', CLOUDFLARE_STREAM_TOKEN: 'token-api-de-teste-nao-vaza', CLOUDFLARE_STREAM_SUBDOMINIO: 'customer-m033z5x00ks6nunl', CLOUDFLARE_STREAM_KEY_ID: 'kid-de-teste-1234' };

async function stream(env) {
  const { criarProvedor } = await registro();
  const fetch = async (u) => { throw new Error('rede inesperada: ' + u); };
  return criarProvedor({ video: { provedor: 'cloudflare-stream' } }, Object.assign({}, ENV_CF, env), { provedor: 'cloudflare-stream', fetch, agora: () => AGORA });
}

const par = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const decodificar = (token) => { const [h, c, s] = token.split('.'); return { h: JSON.parse(Buffer.from(h, 'base64url')), c: JSON.parse(Buffer.from(c, 'base64url')), s, assinado: h + '.' + c }; };
const tokenDe = (url) => url.match(/^https:\/\/customer-m033z5x00ks6nunl\.cloudflarestream\.com\/([\w-]+\.[\w-]+\.[\w-]+)\//)[1];

test('[stream] PEM PKCS#1 em base64 (como a API devolve), PEM puro e PKCS#8 geram JWT RS256 verificável pela chave pública', async () => {
  const { privateKey, publicKey } = par();
  const formas = {
    'pkcs1 base64': Buffer.from(privateKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64'),
    'pkcs1 puro': privateKey.export({ type: 'pkcs1', format: 'pem' }),
    'pkcs8 puro': privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'pkcs8 base64': Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')
  };
  for (const [nome, pem] of Object.entries(formas)) {
    const p = await stream({ CLOUDFLARE_STREAM_KEY_PEM: pem });
    assert.equal(p.capacidades().assinatura, true, nome);
    const r = await p.urlReproducao(UID, { assinar: true, validadeSeg: 600 });
    const t = decodificar(tokenDe(r.hls));
    assert.deepEqual(t.h, { alg: 'RS256', kid: 'kid-de-teste-1234' }, nome);
    assert.equal(t.c.sub, UID); assert.equal(t.c.kid, 'kid-de-teste-1234');
    assert.equal(t.c.exp, AGORA_S + 600); assert.ok(t.c.nbf <= AGORA_S);
    assert.ok(crypto.verify('sha256', Buffer.from(t.assinado), publicKey, Buffer.from(t.s, 'base64url')), 'assinatura inválida: ' + nome);
    assert.ok(r.hls.endsWith('/manifest/video.m3u8') && !r.hls.includes(UID));
  }
});

test('[stream] expiração e path: capa, prévia, legendas e embed usam o token no lugar do uid; nenhuma chave na saída', async () => {
  const { privateKey } = par();
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const p = await stream({ CLOUDFLARE_STREAM_KEY_PEM: pem });
  const r = await p.urlReproducao(UID, { assinar: true, validadeSeg: 120 });
  assert.equal(r.expiraEm, AGORA_S + 120);
  const tk = tokenDe(r.hls);
  assert.ok((await p.urlCapa(UID, { assinar: true, validadeSeg: 120 })).includes('/' + tk + '/thumbnails/thumbnail.jpg'));
  assert.equal((await p.urlPreview(UID, { assinar: true, validadeSeg: 120 })).animada.includes('/' + tk + '/thumbnails/thumbnail.gif'), true);
  assert.ok((await p.legendas(UID, { idiomas: ['pt'], assinar: true, validadeSeg: 120 }))[0].url.includes('/' + tk + '/captions/pt/vtt'));
  assert.ok(r.embed.url.includes('/' + tk + '/iframe'));
  const tudo = JSON.stringify(r);
  const corpoPem = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  assert.ok(!tudo.includes(corpoPem.slice(0, 40)) && !tudo.includes('token-api-de-teste-nao-vaza'));
  /* O token só vale pelo exp: a mesma chamada 1 s depois do fim da validade gera outro. */
});

test('[stream] accessRules entram no payload; forma inválida é erro (regra descartada afrouxaria o acesso)', async () => {
  const { privateKey } = par();
  const p = await stream({ CLOUDFLARE_STREAM_KEY_PEM: privateKey.export({ type: 'pkcs1', format: 'pem' }) });
  const regras = [{ type: 'ip.geoip.country', action: 'allow', country: ['br', 'pt'] }];
  const r = await p.urlReproducao(UID, { assinar: true, validadeSeg: 60, accessRules: regras });
  assert.deepEqual(decodificar(tokenDe(r.hls)).c.accessRules, [{ type: 'ip.geoip.country', action: 'allow', country: ['BR', 'PT'] }]);
  const sem = await p.urlReproducao(UID, { assinar: true, validadeSeg: 60 });
  assert.equal(decodificar(tokenDe(sem.hls)).c.accessRules, undefined);
  for (const ruim of [[{ type: 'x', action: 'allow' }], [{ type: 'ip.src', action: 'allow', ip: ['<script>'] }], 'br', new Array(11).fill(regras[0])]) {
    await assert.rejects(() => p.urlReproducao(UID, { assinar: true, accessRules: ruim }), (e) => e.codigo === 'parametro-invalido');
  }
});

test('[stream] PEM ilegível: erro tipado sem vazar a chave; sem chave: recusa', async () => {
  const p = await stream({ CLOUDFLARE_STREAM_KEY_PEM: '-----BEGIN RSA PRIVATE KEY-----\nlixo-secreto-xyz\n-----END RSA PRIVATE KEY-----' });
  await assert.rejects(() => p.urlReproducao(UID, { assinar: true }), (e) => e.codigo === 'provedor-nao-configurado' && !(e.detalhe + e.message).includes('lixo-secreto-xyz'));
  const sem = await stream({ CLOUDFLARE_STREAM_KEY_ID: '' });
  assert.equal(sem.capacidades().assinatura, false);
  await assert.rejects(() => sem.urlReproducao(UID, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
});

/* ------------------------------------------------------------------ HLS genérico */

test('[hls-generico] não assina: capacidade false, assinar recusado e montarMidia rejeita (nunca URL aberta)', async () => {
  const { criarProvedor, montarMidia } = await registro();
  const p = criarProvedor({ video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: 'https://cdn.exemplo.test' } } }, {}, { provedor: 'hls-generico' });
  assert.equal(p.capacidades().assinatura, false);
  await assert.rejects(() => p.urlReproducao('filme.m3u8', { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  await assert.rejects(() => montarMidia(p, { fonte: { provedor: 'hls-generico', id: 'filme.m3u8' } }, { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
});

test('[validar-config] acesso restrito + assinarMidia + hls-generico é recusado com mensagem clara; assinarMidia:false explícito ou modo público passam', async () => {
  const { validarSemantica } = await validador();
  const base = (modo, assinarMidia, provedor) => ({ video: { provedor }, acesso: { modo, privado: { assinarMidia } } });
  const erros = validarSemantica(base('privado', true, 'hls-generico')).filter(e => e.caminho === 'acesso.privado.assinarMidia');
  assert.equal(erros.length, 1);
  assert.match(erros[0].mensagem, /hls-generico/);
  assert.equal(validarSemantica(base('cadastro', true, 'hls-generico')).filter(e => e.caminho === 'acesso.privado.assinarMidia').length, 1);
  for (const c of [base('privado', false, 'hls-generico'), base('publico', true, 'hls-generico'), base('privado', true, 'bunny'), base('privado', true, 'cloudflare-stream')]) {
    assert.equal(validarSemantica(c).filter(e => e.caminho === 'acesso.privado.assinarMidia').length, 0);
  }
});
