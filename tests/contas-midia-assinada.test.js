/* Integração M5: contas (cookie de espectador) + mídia assinada. No modo público nada muda;
 * em cadastro/privado só sessão válida recebe `midia` assinada, de validade curta. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper, tokenDoLink, ACEITE } = require('./fixtures/contas-ambiente.js');

const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const catalogo = () => JSON.stringify({ rev: 1, itens: [{ id: 'a', titulo: 'A', publicar: true, fonte: { provedor: 'bunny', id: GUID } }] });
const amb = (extra) => { const e = ambiente(Object.assign({ BUNNY_PULLZONE: 'vz-teste.b-cdn.net' }, extra || {})); e.CATALOGO.dados.catalogo = catalogo(); return e; };

async function entrar(worker, env) {
  const sup = await tokenDoSuper(worker, env);
  const c = cliente(worker, env, { ip: '203.0.113.31' });
  const conv = await c.post('/api/convites', { email: 'ana@exemplo.com', enviar: false }, { token: sup });
  const r = await c.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()));
  assert.equal(r.status, 200, r.texto);
  return c;
}

test('publico: a midia sai sem token, como sempre', async () => {
  const worker = await criarWorker(configDe({ modo: 'publico' }));
  const r = await cliente(worker, amb({ BUNNY_TOKEN_KEY: 'chave-de-token' })).get('/api/catalogo');
  assert.equal(r.status, 200);
  assert.ok(!/bcdn_token|token=/.test(JSON.stringify(r.json.itens[0].midia)), 'modo público não assina');
  assert.ok(r.json.itens[0].midia.hls);
});

test('privado: anônimo não recebe midia; com sessão a midia sai assinada e com validade curta', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado', privado: { assinarMidia: true, validadeDaAssinaturaSeg: 300 } }));
  const env = amb({ BUNNY_TOKEN_KEY: 'chave-de-token' });
  const anon = await cliente(worker, env).get('/api/catalogo');
  assert.equal(anon.status, 401);
  assert.ok(!anon.texto.includes(GUID));
  const c = await entrar(worker, env);
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 200);
  const m = r.json.itens[0].midia;
  assert.match(m.hls, /bcdn_token=/);
  const exp = Number(/expires=(\d+)/.exec(m.hls)[1]);
  const resta = exp - Date.now() / 1000;
  assert.ok(resta > 0 && resta <= 305, 'validade curta: ' + resta);
  assert.ok(!r.texto.includes('chave-de-token'), 'a chave nunca sai');
});

test('privado sem chave do provedor: falha fechada (501), nunca URL aberta', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado', privado: { assinarMidia: true } }));
  const env = amb();
  const c = await entrar(worker, env);
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 501);
  assert.ok(!r.texto.includes('b-cdn.net'));
});

test('privado com assinarMidia=false: sem assinatura (escolha explícita do cliente)', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado', privado: { assinarMidia: false } }));
  const env = amb({ BUNNY_TOKEN_KEY: 'chave-de-token' });
  const c = await entrar(worker, env);
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 200);
  assert.ok(!/bcdn_token/.test(r.json.itens[0].midia.hls));
});
