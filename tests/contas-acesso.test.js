/* Contas e acesso (M5): os critérios de aceite do plano, contra o Worker de verdade com D1
 * em memória (node:sqlite), sem rede. Cada `test` é um critério ou uma regra de segurança.
 *
 *   modo privado: anônimo não vê catálogo, busca nem a capa da home
 *   convite e link mágico: uso único, validade, confirmação por POST, anti-enumeração
 *   sessão: cookie HttpOnly/Secure/SameSite=Lax, só o hash no banco, revogação imediata
 *   freios: 11ª tentativa em 10 s, bloqueio progressivo, Turnstile (falha fechada)
 *   LGPD: consentimento versionado, exportar, excluir, retenção */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, fetchFalso, cliente, tokenDoSuper, tokenDoLink, ACEITE } = require('./fixtures/contas-ambiente.js');

const mod = (nome) => import('../core/worker/' + nome);
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

const PRIVADO = configDe({ modo: 'privado' });
const SECRETO_TURNSTILE = 'segredo-do-turnstile-123';
const TOKEN_BOM = 'tok-bom-0123456789abcdef';
const CADASTRO = (extra) => configDe(Object.assign({ modo: 'cadastro', cadastro: { metodo: 'link-magico', verificarEmail: true }, email: { adaptador: 'resend' } }, extra || {}));
const ENV_CADASTRO = (extra) => ambiente(Object.assign({ TURNSTILE_SECRET: SECRETO_TURNSTILE, TURNSTILE_SITE_KEY: '0x4AAAAAAAteste', RESEND_API_KEY: 're_chave_de_teste', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' }, extra || {}));

/* O siteverify e o Resend de mentira. O Turnstile aceita só o TOKEN_BOM. */
function servicosDeMentira({ turnstile = 'ok', resend = 'ok' } = {}) {
  const emails = [];
  const f = fetchFalso({
    'https://challenges.cloudflare.com/turnstile/v0/siteverify': async (u, o) => {
      if (turnstile === 'cai') throw new Error('rede caiu');
      if (turnstile === '500') return new Response('erro', { status: 500 });
      if (turnstile === 'lixo') return new Response('<html>', { status: 200 });
      const p = new URLSearchParams(String(o.body));
      assert.equal(p.get('secret'), SECRETO_TURNSTILE, 'o secret vai ao siteverify');
      return { success: p.get('response') === TOKEN_BOM };
    },
    'https://api.resend.com/emails': async (u, o) => {
      if (resend === 'cai') throw new Error('sem rede');
      if (resend === 'recusa') return new Response('{}', { status: 422 });
      const corpo = JSON.parse(o.body);
      emails.push({ cabecalhos: o.headers, corpo });
      return { id: 'em_1' };
    }
  });
  return Object.assign(f, { emails });
}

const linkDoUltimoEmail = (emails) => tokenDoLink(emails[emails.length - 1].corpo.text);

async function prepararPrivado(extraEnv) {
  const worker = await criarWorker(PRIVADO);
  const env = ambiente(extraEnv);
  const sup = await tokenDoSuper(worker, env);
  return { worker, env, sup };
}

/* Convida e aceita: devolve o cliente já logado. */
async function convidarEEntrar(worker, env, sup, email, ip) {
  const c = cliente(worker, env, { ip: ip || '203.0.113.' + (10 + Math.floor(Math.random() * 200)) });
  const conv = await c.post('/api/convites', { email, enviar: false }, { token: sup });
  assert.equal(conv.status, 200, conv.texto);
  const r = await c.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()));
  assert.equal(r.status, 200, r.texto);
  return c;
}

/* ------------------------------------------------- modo privado: o gate */

test('privado: anônimo em /api/catalogo, /api/busca/* e na home não recebe dado nenhum', async () => {
  const { worker, env } = await prepararPrivado();
  const capa = 'https://vz-teste.b-cdn.net/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/thumbnail_ab12cd34.jpg?v=1';
  env.CATALOGO.dados['capa-destaque'] = capa;
  const c = cliente(worker, env);
  for (const caminho of ['/api/catalogo', '/api/busca/fala', '/api/busca/sentido?q=a']) {
    const r = await c.get(caminho);
    assert.equal(r.status, 401, caminho);
    assert.ok(!r.texto.includes('"titulo"'), caminho + ' vazou catálogo');
  }
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.ok(!home.texto.includes('rel="preload" as="image"') && !home.texto.includes(capa), 'a capa vazou na home');
  /* E cookie inventado, vencido ou de forma errada não vale. */
  for (const valor of ['x', 'ss_' + 'A'.repeat(43), 'ss_' + 'A'.repeat(42)]) {
    const r = await c.get('/api/catalogo', { cabecalhos: { cookie: '__Host-sessao=' + valor } });
    assert.equal(r.status, 401);
  }
});

test('privado: com convite aceito o espectador vê o catálogo; o cookie é HttpOnly; Secure; SameSite=Lax', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const c = await convidarEEntrar(worker, env, sup, 'ana@exemplo.com');
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 200);
  assert.equal(r.json.itens.length, 1);
  assert.equal((await c.get('/api/busca/fala')).status, 200);

  /* O cookie, pelo Set-Cookie do aceite. */
  const c2 = cliente(worker, env, { ip: '203.0.113.99' });
  const conv = await c2.post('/api/convites', { email: 'bia@exemplo.com', enviar: false }, { token: sup });
  const aceito = await c2.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()));
  const cookie = aceito.setCookie;
  assert.match(cookie, /^__Host-sessao=ss_[A-Za-z0-9_-]{43};/);
  for (const parte of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=']) assert.ok(cookie.includes(parte), 'falta ' + parte + ' em ' + cookie);
  assert.ok(!/Domain=/i.test(cookie), '__Host- não admite Domain');
});

test('o banco guarda só o HASH da sessão (e do convite): vazar o banco não vale sessão', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const c = cliente(worker, env, { ip: '203.0.113.60' });
  const conv = await c.post('/api/convites', { email: 'caio@exemplo.com', enviar: false }, { token: sup });
  const tokenConvite = tokenDoLink(conv.json.link);
  const aceito = await c.post('/api/auth/convite', Object.assign({ token: tokenConvite }, ACEITE()));
  const tokenSessao = /__Host-sessao=([^;]+)/.exec(aceito.setCookie)[1];
  const tudo = JSON.stringify({
    s: env.DB.consultar('SELECT * FROM sessoes'), c: env.DB.consultar('SELECT * FROM convites'), u: env.DB.consultar('SELECT * FROM usuarios'), l: env.DB.consultar('SELECT * FROM consentimentos')
  });
  assert.ok(!tudo.includes(tokenSessao), 'o token de sessão está no banco em claro');
  assert.ok(!tudo.includes(tokenConvite), 'o token do convite está no banco em claro');
  assert.ok(tudo.includes(sha256(tokenSessao)), 'o hash SHA-256 da sessão deveria estar lá');
  /* O IP também não: só o hash, no consentimento. */
  assert.ok(!tudo.includes('203.0.113.60'));
  assert.equal(env.DB.consultar('SELECT ip_hash FROM consentimentos')[0].ip_hash.length, 32);
});

test('sessão revogada deixa de valer no pedido seguinte (sair, bloquear, revogar, excluir)', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const adm = cliente(worker, env, { ip: '198.51.100.9' });

  const a = await convidarEEntrar(worker, env, sup, 'a@exemplo.com');
  assert.equal((await a.get('/api/catalogo')).status, 200);
  assert.equal((await a.post('/api/auth/sair')).status, 200);
  assert.equal((await a.get('/api/catalogo')).status, 401, 'sair');
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM sessoes')[0].n, 0, 'a linha da sessão sumiu');

  const b = await convidarEEntrar(worker, env, sup, 'b@exemplo.com');
  const idB = (await adm.get('/api/espectadores', { token: sup })).json.espectadores.find((x) => x.email === 'b@exemplo.com').id;
  assert.equal((await adm.put('/api/espectadores', { id: idB, acao: 'bloquear' }, { token: sup })).status, 200);
  assert.equal((await b.get('/api/catalogo')).status, 401, 'bloqueio do admin derruba na hora');
  await adm.put('/api/espectadores', { id: idB, acao: 'desbloquear' }, { token: sup });
  assert.equal((await b.get('/api/catalogo')).status, 401, 'desbloquear não ressuscita a sessão apagada');

  const d = await convidarEEntrar(worker, env, sup, 'd@exemplo.com');
  const idD = (await adm.get('/api/espectadores', { token: sup })).json.espectadores.find((x) => x.email === 'd@exemplo.com').id;
  await adm.put('/api/espectadores', { id: idD, acao: 'revogar-sessoes' }, { token: sup });
  assert.equal((await d.get('/api/catalogo')).status, 401, 'revogar sessões');

  /* "Sair de todos os aparelhos": duas sessões, uma derruba as duas. */
  const e1 = await convidarEEntrar(worker, env, sup, 'e@exemplo.com');
  const conv = await adm.post('/api/convites', { email: 'e@exemplo.com', enviar: false }, { token: sup });
  const e2 = cliente(worker, env, { ip: '203.0.113.77' });
  assert.equal((await e2.post('/api/auth/convite', { token: tokenDoLink(conv.json.link) })).status, 200);
  assert.equal((await e1.get('/api/catalogo')).status, 200);
  await e2.post('/api/auth/sair', { todas: true });
  assert.equal((await e1.get('/api/catalogo')).status, 401);
});

test('sessão vencida não vale; sessão com mais de um dia é renovada (deslizante) sem escrita a cada pedido', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const c = await convidarEEntrar(worker, env, sup, 'v@exemplo.com');
  const agora = Math.floor(Date.now() / 1000);
  const linha = () => env.DB.consultar('SELECT * FROM sessoes')[0];
  const antes = linha();
  assert.equal(antes.expira_em - antes.criado_em, 720 * 3600, '30 dias por padrão');

  env.DB.bruto.prepare('UPDATE sessoes SET renovada_em = ?').run(agora - 2 * 86400);
  assert.equal((await c.get('/api/catalogo')).status, 200);
  assert.ok(linha().renovada_em >= agora - 1, 'renovou (uma escrita)');
  env.DB.chamadas.length = 0;
  await c.get('/api/catalogo');
  assert.equal(env.DB.chamadas.filter((x) => !/^\s*SELECT/i.test(x.sql)).length, 0, 'sem escrita no pedido seguinte');

  env.DB.bruto.prepare('UPDATE sessoes SET expira_em = ?').run(agora - 5);
  assert.equal((await c.get('/api/catalogo')).status, 401, 'vencida');
});

test('limite de sessões simultâneas: a mais antiga cai quando passa do teto', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado', sessao: { maximoSimultaneas: 2 } }));
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  const adm = cliente(worker, env, { ip: '198.51.100.9' });
  const abrir = async (n) => {
    const conv = await adm.post('/api/convites', { email: 'm@exemplo.com', enviar: false }, { token: sup });
    const c = cliente(worker, env, { ip: '203.0.113.' + (100 + n) });
    assert.equal((await c.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()))).status, 200);
    return c;
  };
  const um = await abrir(1);
  await new Promise((r) => setTimeout(r, 1100));   /* `criado_em` é em segundos: a ordem precisa ser inequívoca */
  const dois = await abrir(2);
  await new Promise((r) => setTimeout(r, 1100));
  const tres = await abrir(3);
  assert.equal((await um.get('/api/catalogo')).status, 401, 'a mais antiga caiu');
  assert.equal((await dois.get('/api/catalogo')).status, 200);
  assert.equal((await tres.get('/api/catalogo')).status, 200);
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM sessoes')[0].n, 2);
});

test('CSRF: cookie de espectador num POST vindo de outro site vale como anônimo', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const c = await convidarEEntrar(worker, env, sup, 'f@exemplo.com');
  const de = (cab) => c.post('/api/conta/excluir', { email: 'f@exemplo.com' }, { cabecalhos: cab });
  assert.equal((await de({ origin: 'https://atacante.example' })).status, 401);
  assert.equal((await de({ 'sec-fetch-site': 'cross-site', origin: '' })).status, 401);
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 1, 'nada foi apagado');
});

/* ------------------------------------------------- convite e link mágico */

test('convite: link copiável (token no fragmento), uso único, 7 dias; revogável', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const adm = cliente(worker, env, { ip: '198.51.100.9' });
  const conv = await adm.post('/api/convites', { email: 'Gi@Exemplo.com', enviar: false }, { token: sup });
  assert.equal(conv.status, 200);
  assert.match(conv.json.link, /^https:\/\/exemplo\.test\/entrar\.html#t=cv_[A-Za-z0-9_-]{43}$/);
  const agora = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(conv.json.expiraEm - (agora + 7 * 86400)) < 5);
  assert.equal(conv.json.enviado, false);
  const token = tokenDoLink(conv.json.link);

  /* Sem aceitar os textos, o convite NÃO é gasto. */
  const c = cliente(worker, env, { ip: '203.0.113.31' });
  const sem = await c.post('/api/auth/convite', { token });
  assert.equal(sem.status, 409);
  assert.equal(sem.json.codigo, 'consentimento-necessario');
  assert.deepEqual(sem.json.pendentes.sort(), ['privacidade', 'termos']);
  /* Versão errada dos textos: pede de novo. */
  assert.equal((await c.post('/api/auth/convite', { token, aceite: true, versoes: { privacidade: 9, termos: 1 } })).json.codigo, 'termos-mudaram');
  assert.equal(env.DB.consultar('SELECT usado_em FROM convites')[0].usado_em, null);

  assert.equal((await c.post('/api/auth/convite', Object.assign({ token }, ACEITE()))).status, 200);
  assert.equal(env.DB.consultar("SELECT status FROM usuarios WHERE email = 'gi@exemplo.com'")[0].status, 'ativo');
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM consentimentos')[0].n, 2, 'privacidade e termos, com versão');
  /* Reuso: recusado. */
  const outro = cliente(worker, env, { ip: '203.0.113.32' });
  assert.equal((await outro.post('/api/auth/convite', Object.assign({ token }, ACEITE()))).json.codigo, 'link-invalido');

  /* Revogar. */
  const conv2 = await adm.post('/api/convites', { email: 'hh@exemplo.com', enviar: false }, { token: sup });
  assert.equal((await adm.get('/api/convites', { token: sup })).json.convites.length, 1);
  await adm.delete('/api/convites?email=hh@exemplo.com', { token: sup });
  assert.equal((await outro.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv2.json.link) }, ACEITE()))).json.codigo, 'link-invalido');
  /* Só o superadmin convida. */
  assert.equal((await adm.post('/api/convites', { email: 'z@exemplo.com' })).status, 401);
});

test('o e-mail do convite sai pelo adaptador resend quando configurado; o endereço não é logado', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(configDe({ modo: 'privado', email: { adaptador: 'resend' } }));
    const env = ambiente({ RESEND_API_KEY: 're_chave', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' });
    const sup = await tokenDoSuper(worker, env);
    const adm = cliente(worker, env);
    const r = await adm.post('/api/convites', { email: 'ines@exemplo.com' }, { token: sup });
    assert.equal(r.json.enviado, true, r.texto);
    assert.equal(servicos.emails.length, 1);
    const e = servicos.emails[0];
    assert.equal(e.cabecalhos.authorization, 'Bearer re_chave');
    assert.deepEqual(e.corpo.to, ['ines@exemplo.com']);
    assert.equal(e.corpo.from, 'Exemplo <aviso@exemplo.com>');
    assert.ok(e.corpo.text.includes(r.json.link), 'o link vai no corpo');
    assert.ok(e.corpo.subject.includes('Plataforma Exemplo'));
    /* Resend fora do ar: o convite continua criado e o admin recebe o link para copiar. */
    servicos.restaurar();
    const f2 = servicosDeMentira({ resend: 'cai' });
    const r2 = await adm.post('/api/convites', { email: 'jose@exemplo.com' }, { token: sup });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.enviado, false);
    assert.equal(r2.json.motivo, 'resend-inacessivel');
    assert.match(r2.json.link, /#t=cv_/);
    f2.restaurar();
  } finally { servicos.restaurar(); }
});

test('adaptador `nenhum` (padrão): nada é enviado, o admin copia o link; `cloudflare-email` ainda não envia', async () => {
  const servicos = servicosDeMentira();
  try {
    for (const adaptador of [undefined, 'nenhum', 'cloudflare-email']) {
      const worker = await criarWorker(configDe({ modo: 'privado', email: adaptador ? { adaptador } : undefined }));
      const env = ambiente();
      const sup = await tokenDoSuper(worker, env);
      const r = await cliente(worker, env).post('/api/convites', { email: 'k@exemplo.com' }, { token: sup });
      assert.equal(r.json.enviado, false);
      assert.ok(r.json.link);
    }
    assert.equal(servicos.emails.length, 0);
    assert.equal(servicos.chamadas.length, 0, 'nenhuma chamada de rede');
  } finally { servicos.restaurar(); }
});

test('link mágico: pedir, abrir (GET não gasta), confirmar por POST; uso único; vencido recusado', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(configDe({ modo: 'privado', email: { adaptador: 'resend' }, privado: { listaDeEmails: ['lista@exemplo.com'] } }));
    const env = ambiente({ RESEND_API_KEY: 're_chave', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' });
    const sup = await tokenDoSuper(worker, env);
    await convidarEEntrar(worker, env, sup, 'lia@exemplo.com');

    const c = cliente(worker, env, { ip: '203.0.113.41' });
    assert.equal((await c.post('/api/auth/entrar', { email: 'lia@exemplo.com' })).status, 200);
    assert.equal(servicos.emails.length, 1);
    const email = servicos.emails[0].corpo;
    assert.ok(email.text.includes('15'), 'diz que vale 15 minutos');
    const token = linkDoUltimoEmail(servicos.emails);
    assert.match(token, /^ml_/);
    const link = /https:\/\/\S+/.exec(email.text)[0];
    assert.match(link, /\/entrar\.html#t=ml_/, 'o token vai no fragmento: não chega ao servidor');

    /* "Abrir o link" (GET de um pré-visualizador) não gasta nada. */
    const get = await c.get('/api/auth/link?t=' + encodeURIComponent(token));
    assert.notEqual(get.status, 200);
    assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM links_magicos WHERE usado_em IS NOT NULL")[0].n, 0);

    const ok = await c.post('/api/auth/link', { token });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await c.get('/api/catalogo')).status, 200);
    /* Reutilizado: recusado. */
    const outro = cliente(worker, env, { ip: '203.0.113.42' });
    assert.equal((await outro.post('/api/auth/link', { token })).json.codigo, 'link-invalido');
    assert.equal((await outro.get('/api/catalogo')).status, 401);

    /* Expirado: recusado. */
    await c.post('/api/auth/entrar', { email: 'lia@exemplo.com' });
    const velho = linkDoUltimoEmail(servicos.emails);
    env.DB.bruto.prepare('UPDATE links_magicos SET expira_em = ? WHERE token_hash = ?').run(Math.floor(Date.now() / 1000) - 1, sha256(velho));
    assert.equal((await outro.post('/api/auth/link', { token: velho })).json.codigo, 'link-invalido');

    /* Validade de 15 min. */
    await c.post('/api/auth/entrar', { email: 'lia@exemplo.com' });
    const novo = env.DB.consultar('SELECT criado_em, expira_em FROM links_magicos WHERE token_hash = ?', sha256(linkDoUltimoEmail(servicos.emails)))[0];
    assert.equal(novo.expira_em - novo.criado_em, 900);

    /* Tipo trocado: convite não vale como link, link não vale como convite; lixo é lixo. */
    assert.equal((await outro.post('/api/auth/convite', { token: linkDoUltimoEmail(servicos.emails) })).json.codigo, 'link-invalido');
    for (const lixo of ['', 'ml_', 'ml_' + 'a'.repeat(43), 12, null, { a: 1 }]) {
      assert.equal((await outro.post('/api/auth/link', { token: lixo })).json.codigo, 'link-invalido');
    }

    /* A lista de e-mails do modo privado vale como convite: vira convidado e recebe o link. */
    await c.post('/api/auth/entrar', { email: 'lista@exemplo.com' });
    assert.equal(env.DB.consultar("SELECT status FROM usuarios WHERE email = 'lista@exemplo.com'")[0].status, 'convidado');
    assert.equal(servicos.emails[servicos.emails.length - 1].corpo.to[0], 'lista@exemplo.com');
  } finally { servicos.restaurar(); }
});

test('anti-enumeração: e-mail existente, inexistente, bloqueado ou sem adaptador respondem IGUAL', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(configDe({ modo: 'privado', email: { adaptador: 'resend' } }));
    const env = ambiente({ RESEND_API_KEY: 're_chave', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' });
    const sup = await tokenDoSuper(worker, env);
    const adm = cliente(worker, env, { ip: '198.51.100.9' });
    await convidarEEntrar(worker, env, sup, 'existe@exemplo.com');
    await convidarEEntrar(worker, env, sup, 'barrado@exemplo.com');
    const id = (await adm.get('/api/espectadores', { token: sup })).json.espectadores.find((x) => x.email === 'barrado@exemplo.com').id;
    await adm.put('/api/espectadores', { id, acao: 'bloquear' }, { token: sup });

    const respostas = [];
    let n = 0;
    for (const email of ['existe@exemplo.com', 'nao-existe@exemplo.com', 'barrado@exemplo.com', 'EXISTE@exemplo.com ']) {
      const c = cliente(worker, env, { ip: '203.0.113.' + (150 + n++) });
      const r = await c.post('/api/auth/entrar', { email });
      respostas.push({ status: r.status, corpo: r.texto, cookie: r.setCookie });
    }
    for (const r of respostas) assert.deepEqual(r, respostas[0], 'respostas diferentes denunciam a conta');
    assert.equal(servicos.emails.length, 2, 'só quem existe e está ativo recebeu e-mail');
    assert.ok(servicos.emails.every((e) => e.corpo.to[0] === 'existe@exemplo.com'));
    /* E a mesma resposta com o adaptador `nenhum`, onde nada é enviado. */
    const w2 = await criarWorker(PRIVADO);
    const env2 = ambiente();
    const sup2 = await tokenDoSuper(w2, env2);
    await convidarEEntrar(w2, env2, sup2, 'existe@exemplo.com');
    const a = await cliente(w2, env2, { ip: '203.0.113.201' }).post('/api/auth/entrar', { email: 'existe@exemplo.com' });
    const b = await cliente(w2, env2, { ip: '203.0.113.202' }).post('/api/auth/entrar', { email: 'ninguem@exemplo.com' });
    assert.deepEqual([a.status, a.texto], [b.status, b.texto]);
    /* E o formato inválido é o único que se distingue (não revela nada de contas). */
    assert.equal((await cliente(w2, env2, { ip: '203.0.113.203' }).post('/api/auth/entrar', { email: 'isto-nao-e-email' })).json.codigo, 'email-invalido');
  } finally { servicos.restaurar(); }
});

/* ---------------------------------------------------------------- freios */

test('11ª tentativa de login em 10 s é recusada (429), no login da equipe e na entrada do espectador', async () => {
  const worker = await criarWorker(PRIVADO);
  const env = ambiente();
  const c = cliente(worker, env, { ip: '203.0.113.88' });
  /* Em paralelo: as 10 primeiras passam pelo freio (e tomam 401 pela senha errada), a 11ª, 429. */
  const rs = await Promise.all(Array.from({ length: 11 }, (_, i) => c.post('/api/login', { usuario: 'u' + i, senha: 'errada-' + i })));
  const status = rs.map((r) => r.status).sort();
  assert.equal(status.filter((s) => s === 401).length, 10, JSON.stringify(status));
  assert.equal(status.filter((s) => s === 429).length, 1, JSON.stringify(status));
  const barrada = rs.find((r) => r.status === 429);
  assert.equal(barrada.json.codigo, 'muitas-tentativas');
  assert.ok(Number(barrada.cabecalhos.get('retry-after')) >= 1);
  /* Outro IP não é afetado. */
  assert.equal((await cliente(worker, env, { ip: '203.0.113.89' }).post('/api/login', { senha: 'errada' })).status, 401);

  const e = cliente(worker, env, { ip: '203.0.113.90' });
  const es = await Promise.all(Array.from({ length: 11 }, (_, i) => e.post('/api/auth/entrar', { email: 'x' + i + '@exemplo.com' })));
  assert.equal(es.filter((r) => r.status === 429).length, 1);
  assert.equal(es.filter((r) => r.status === 200).length, 10);
});

test('bloqueio progressivo: da 5ª senha errada em diante o IP fica bloqueado, e acertar zera; outro IP não sofre', async () => {
  const worker = await criarWorker(PRIVADO);
  const env = ambiente();
  const c = cliente(worker, env, { ip: '203.0.113.91' });
  const cod = [];
  for (let i = 0; i < 7; i++) {
    const r = await c.post('/api/login', { senha: 'errada' });   /* superadmin, 400-700 ms de atraso cada */
    cod.push(r.status);
  }
  assert.deepEqual(cod.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.deepEqual(cod.slice(5), [429, 429], 'bloqueado a partir da 5ª falha: nem a senha certa entra');
  assert.equal((await c.post('/api/login', { senha: 'senha-do-super' })).status, 429, 'nem com a senha certa durante o bloqueio');
  /* O superadmin entra de outro lugar (o bloqueio é por IP + conta: não é negação de serviço). */
  assert.equal((await cliente(worker, env, { ip: '203.0.113.92' }).post('/api/login', { senha: 'senha-do-super' })).status, 200);
  const linha = env.DB.consultar("SELECT falhas, bloqueado_ate FROM limites WHERE chave LIKE 'login-falhas:%'")[0];
  assert.ok(linha.falhas >= 5 && linha.bloqueado_ate > Math.floor(Date.now() / 1000));
  assert.ok(!JSON.stringify(env.DB.consultar('SELECT chave FROM limites')).includes('203.0.113'), 'o IP não vai em claro para a chave');
});

test('bloqueio progressivo cresce: 1 min na 5ª falha, 2 min na 6ª, ... no máximo 1 h', async () => {
  const { falhar, bloqueioAtivo, limparFalhas } = await mod('_lib/limite.js');
  const env = ambiente();
  const { garantirBanco } = await mod('_lib/contas-banco.js');
  await garantirBanco(env);
  const esperas = [];
  for (let i = 1; i <= 12; i++) {
    const r = await falhar(env, 'k');
    esperas.push(r.bloqueadoPorS || 0);
  }
  assert.deepEqual(esperas.slice(0, 7), [0, 0, 0, 0, 60, 120, 240]);
  assert.equal(esperas[11], 3600, 'teto de 1 h');
  assert.equal((await bloqueioAtivo(env, 'k')).bloqueado, true);
  await limparFalhas(env, 'k');
  assert.equal((await bloqueioAtivo(env, 'k')).bloqueado, false);
});

test('com o binding de Rate Limiting do Cloudflare, ele manda no limite (e o D1 não é tocado para isso)', async () => {
  const worker = await criarWorker(PRIVADO);
  let chamadas = 0;
  /* cada pedido consulta o binding duas vezes (IP e e-mail): o terceiro pedido estoura */
  const env = ambiente({ LIMITE_ENTRADA: { limit: async () => { chamadas++; return { success: chamadas <= 4 }; } } });
  const c = cliente(worker, env, { ip: '203.0.113.93' });
  const st = [];
  for (let i = 0; i < 5; i++) st.push((await c.post('/api/auth/entrar', { email: 'q' + i + '@exemplo.com' })).status);
  assert.deepEqual(st.slice(0, 2), [200, 200]);
  assert.equal(st[2], 429);
  assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM limites WHERE chave LIKE 'entrar:%'")[0].n, 0, 'a janela não foi para o D1');
});

/* ------------------------------------------------- cadastro e Turnstile */

async function cadastrar(c, corpo, extra) {
  return c.post('/api/auth/cadastro', Object.assign({ email: 'nova@exemplo.com', turnstile: TOKEN_BOM }, ACEITE(), corpo || {}), extra);
}

test('cadastro sem Turnstile válido é recusado; o cadastro só abre se o TURNSTILE_SECRET existe', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(CADASTRO());
    /* Sem o secret: fechado, e NADA é criado. */
    const semSecret = ENV_CADASTRO({ TURNSTILE_SECRET: undefined });
    const r0 = await cadastrar(cliente(worker, semSecret, { ip: '203.0.113.110' }));
    assert.equal(r0.status, 503);
    assert.equal(r0.json.codigo, 'turnstile-nao-configurado');
    assert.equal(semSecret.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0);
    assert.equal(servicos.chamadas.length, 0, 'sem secret nem chama o siteverify');

    const env = ENV_CADASTRO();
    for (const [rotulo, corpo] of [['token errado', { turnstile: 'tok-ruim-0123456789abcdef' }], ['sem token', { turnstile: undefined }], ['token vazio', { turnstile: '' }], ['token não-texto', { turnstile: { a: 1 } }]]) {
      const r = await cadastrar(cliente(worker, env, { ip: '203.0.113.111' }), corpo);
      assert.equal(r.status, 400, rotulo + ': ' + r.texto);
      assert.equal(r.json.codigo, 'turnstile-falhou');
    }
    assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0, 'nada foi criado sem Turnstile');
    const ok = await cadastrar(cliente(worker, env, { ip: '203.0.113.112' }));
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 1);
  } finally { servicos.restaurar(); }
});

test('FALHA FECHADA: se o siteverify não responde (cai, 500, lixo, lento), o cadastro é recusado', async () => {
  const worker = await criarWorker(CADASTRO());
  for (const modoDeFalha of ['cai', '500', 'lixo']) {
    const servicos = servicosDeMentira({ turnstile: modoDeFalha });
    try {
      const env = ENV_CADASTRO();
      const r = await cadastrar(cliente(worker, env, { ip: '203.0.113.120' }));
      assert.equal(r.status, 503, modoDeFalha + ': ' + r.texto);
      assert.equal(r.json.codigo, 'turnstile-indisponivel');
      assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0, modoDeFalha + ': criou conta mesmo sem verificar');
    } finally { servicos.restaurar(); }
  }
  /* Resposta que demora mais que o limite: o AbortController corta (4 s) e fecha. */
  const original = globalThis.fetch;
  globalThis.fetch = (url, o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(new Error('abortado'))); });
  try {
    const { verificarTurnstile } = await mod('_lib/turnstile.js');
    const t0 = Date.now();
    const r = await verificarTurnstile({ TURNSTILE_SECRET: SECRETO_TURNSTILE }, 'tok-bom-qualquer-0123456789', '1.2.3.4');
    assert.deepEqual(r, { ok: false, motivo: 'indisponivel' });
    assert.ok(Date.now() - t0 < 6000);
  } finally { globalThis.fetch = original; }
});

test('o Turnstile só liga com o secret: sem ele o login por link segue só com limite; com ele, o login também exige', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(configDe({ modo: 'privado' }));
    const sem = ambiente();
    assert.equal((await cliente(worker, sem, { ip: '203.0.113.130' }).post('/api/auth/entrar', { email: 'a@exemplo.com' })).status, 200);
    const com = ambiente({ TURNSTILE_SECRET: SECRETO_TURNSTILE, TURNSTILE_SITE_KEY: '0x4AAAAAAAteste' });
    const r = await cliente(worker, com, { ip: '203.0.113.131' }).post('/api/auth/entrar', { email: 'a@exemplo.com' });
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, 'turnstile-falhou');
    assert.equal((await cliente(worker, com, { ip: '203.0.113.132' }).post('/api/auth/entrar', { email: 'a@exemplo.com', turnstile: TOKEN_BOM })).status, 200);
  } finally { servicos.restaurar(); }
});

test('cadastro (link mágico): consentimento obrigatório, e-mail verificado por link, conta ativa só depois', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(CADASTRO());
    const env = ENV_CADASTRO();
    const c = cliente(worker, env, { ip: '203.0.113.140' });

    /* Sem aceitar os textos, nada é criado. */
    const sem = await c.post('/api/auth/cadastro', { email: 'nova@exemplo.com', turnstile: TOKEN_BOM });
    assert.equal(sem.json.codigo, 'consentimento-necessario');
    assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0);

    const ok = await cadastrar(c);
    assert.deepEqual(ok.json, { ok: true });
    assert.equal(ok.setCookie, null, 'cadastro nunca abre sessão');
    assert.equal(env.DB.consultar("SELECT status FROM usuarios WHERE email = 'nova@exemplo.com'")[0].status, 'convidado');
    assert.equal((await c.get('/api/catalogo')).status, 401, 'sem confirmar o e-mail, sem catálogo');
    assert.equal(servicos.emails.length, 1);

    const token = linkDoUltimoEmail(servicos.emails);
    const entrou = await c.post('/api/auth/link', { token });   /* o aceite já foi dado no cadastro */
    assert.equal(entrou.status, 200, entrou.texto);
    assert.equal(env.DB.consultar("SELECT status FROM usuarios WHERE email = 'nova@exemplo.com'")[0].status, 'ativo');
    assert.equal((await c.get('/api/catalogo')).status, 200);
    assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM consentimentos')[0].n, 2);
  } finally { servicos.restaurar(); }
});

test('cadastro anti-enumeração: e-mail novo e e-mail que já tem conta respondem igual', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(CADASTRO());
    const env = ENV_CADASTRO();
    const a = await cadastrar(cliente(worker, env, { ip: '203.0.113.141' }), { email: 'dup@exemplo.com' });
    const b = await cadastrar(cliente(worker, env, { ip: '203.0.113.142' }), { email: 'dup@exemplo.com' });
    const c = await cadastrar(cliente(worker, env, { ip: '203.0.113.143' }), { email: 'outro@exemplo.com' });
    assert.deepEqual([a.status, a.texto, a.setCookie], [b.status, b.texto, b.setCookie]);
    assert.deepEqual([a.status, a.texto, a.setCookie], [c.status, c.texto, c.setCookie]);
    assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'dup@exemplo.com'")[0].n, 1, 'não duplica');
  } finally { servicos.restaurar(); }
});

test('cadastro: domínios permitidos, aprovação manual, falta de e-mail e modo errado', async () => {
  const servicos = servicosDeMentira();
  try {
    /* domínio */
    const wDom = await criarWorker(CADASTRO({ cadastro: { metodo: 'link-magico', dominiosPermitidos: ['escola.edu.br'] } }));
    const eDom = ENV_CADASTRO();
    assert.equal((await cadastrar(cliente(wDom, eDom, { ip: '203.0.113.150' }), { email: 'x@gmail.com' })).json.codigo, 'dominio-nao-permitido');
    assert.equal((await cadastrar(cliente(wDom, eDom, { ip: '203.0.113.151' }), { email: 'x@escola.edu.br' })).status, 200);

    /* aprovação manual: fica pendente, ninguém recebe link, o admin aprova */
    const wAp = await criarWorker(CADASTRO({ cadastro: { metodo: 'link-magico', aprovacaoManual: true } }));
    const eAp = ENV_CADASTRO();
    const antes = servicos.emails.length;
    assert.equal((await cadastrar(cliente(wAp, eAp, { ip: '203.0.113.152' }))).status, 200);
    assert.equal(eAp.DB.consultar("SELECT status FROM usuarios WHERE email = 'nova@exemplo.com'")[0].status, 'pendente');
    assert.equal(servicos.emails.length, antes, 'pendente não recebe link');
    const sup = await tokenDoSuper(wAp, eAp);
    const adm = cliente(wAp, eAp, { ip: '198.51.100.9' });
    const lista = (await adm.get('/api/espectadores', { token: sup })).json.espectadores;
    await adm.put('/api/espectadores', { id: lista[0].id, acao: 'aprovar' }, { token: sup });
    assert.equal(eAp.DB.consultar("SELECT status FROM usuarios WHERE email = 'nova@exemplo.com'")[0].status, 'ativo');

    /* link mágico sem adaptador de e-mail: o cadastro não abre */
    const wSem = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'link-magico' } }));
    assert.equal((await cadastrar(cliente(wSem, ENV_CADASTRO(), { ip: '203.0.113.153' }))).json.codigo, 'cadastro-sem-email');

    /* fora do modo cadastro */
    for (const modo of ['privado', 'publico']) {
      const w = await criarWorker(configDe({ modo }));
      const r = await cadastrar(cliente(w, ENV_CADASTRO(), { ip: '203.0.113.154' }));
      assert.ok(r.status === 403 || r.status === 404, modo + ': ' + r.status);
    }
  } finally { servicos.restaurar(); }
});

test('cadastro com e-mail e senha: sem verificação a senha vem no cadastro; com verificação, o dono do e-mail a define no link', async () => {
  const servicos = servicosDeMentira();
  try {
    /* Sem adaptador de e-mail: senha no cadastro, conta ativa, login por senha. */
    const w1 = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'email-e-senha' } }));
    const e1 = ENV_CADASTRO();
    const c1 = cliente(w1, e1, { ip: '203.0.113.160' });
    assert.equal((await cadastrar(c1, { senha: 'curta' })).json.codigo, 'senha-curta');
    assert.equal((await cadastrar(c1, { senha: 'uma-senha-bem-comprida' })).status, 200);
    assert.equal((await c1.get('/api/catalogo')).status, 401, 'o cadastro não abre sessão');
    const em = (s) => c1.post('/api/auth/entrar', { email: 'nova@exemplo.com', senha: s, turnstile: TOKEN_BOM });
    assert.equal((await em('errada-errada-errada')).status, 401);
    const entrou = await em('uma-senha-bem-comprida');
    assert.equal(entrou.status, 200, entrou.texto);
    assert.equal((await c1.get('/api/catalogo')).status, 200);
    /* senha de e-mail que não existe: a mesma resposta */
    const naoExiste = await cliente(w1, e1, { ip: '203.0.113.161' }).post('/api/auth/entrar', { email: 'ninguem@exemplo.com', senha: 'qualquer-senha-longa', turnstile: TOKEN_BOM });
    assert.deepEqual([naoExiste.status, naoExiste.json.codigo], [401, 'credenciais-incorretas']);
    const hashes = JSON.stringify(e1.DB.consultar('SELECT senha FROM usuarios'));
    assert.ok(!hashes.includes('uma-senha-bem-comprida'), 'a senha não vai em claro');

    /* Com verificação: o cadastro não pede senha; ela é definida na confirmação do link. */
    const w2 = await criarWorker(CADASTRO({ cadastro: { metodo: 'email-e-senha', verificarEmail: true } }));
    const e2 = ENV_CADASTRO();
    const c2 = cliente(w2, e2, { ip: '203.0.113.162' });
    assert.equal((await cadastrar(c2, { senha: 'sequestradora-de-conta' })).status, 200);
    assert.equal(e2.DB.consultar("SELECT senha FROM usuarios WHERE email = 'nova@exemplo.com'")[0].senha, null, 'a senha de quem cadastra o e-mail alheio NÃO é guardada');
    const token = linkDoUltimoEmail(servicos.emails);
    const sem = await c2.post('/api/auth/link', { token });
    assert.equal(sem.json.codigo, 'senha-necessaria');
    assert.equal((await c2.post('/api/auth/link', { token, senha: 'curta' })).json.codigo, 'senha-curta');
    const fim = await c2.post('/api/auth/link', { token, senha: 'a-senha-do-dono-do-email' });
    assert.equal(fim.status, 200, fim.texto);
    const c3 = cliente(w2, e2, { ip: '203.0.113.163' });
    assert.equal((await c3.post('/api/auth/entrar', { email: 'nova@exemplo.com', senha: 'sequestradora-de-conta', turnstile: TOKEN_BOM })).status, 401);
    assert.equal((await c3.post('/api/auth/entrar', { email: 'nova@exemplo.com', senha: 'a-senha-do-dono-do-email', turnstile: TOKEN_BOM })).status, 200);
  } finally { servicos.restaurar(); }
});

/* ------------------------------------------------- LGPD: texto, aceite, exportar, excluir */

test('privacidade e termos: público, editável só pelo superadmin; mudar o texto sobe a versão e pede novo aceite', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const anon = cliente(worker, env, { ip: '203.0.113.170' });
  const g = await anon.get('/api/legal');
  assert.equal(g.status, 200, 'o texto é público (a pessoa lê antes de aceitar)');
  assert.equal(g.json.documentos.privacidade.versao, 1);
  assert.equal(g.json.documentos.termos.versao, 1);
  assert.equal(g.json.padroes.controlador, 'Organização Exemplo');
  assert.equal((await anon.put('/api/legal', { tipo: 'termos', campos: { controlador: 'X' } })).status, 401);

  const c = await convidarEEntrar(worker, env, sup, 'lei@exemplo.com');
  let eu = (await c.get('/api/conta/eu')).json;
  assert.deepEqual(eu.pendentes, []);
  assert.deepEqual(eu.versoes, { privacidade: 1, termos: 1 });

  const adm = cliente(worker, env, { ip: '198.51.100.9' });
  const p = await adm.put('/api/legal', { tipo: 'privacidade', campos: { controlador: 'Escola Exemplo Ltda', contato: 'privacidade@escola.example' }, textos: { 'pt-BR': 'Primeiro parágrafo.\n\nSegundo.' } }, { token: sup });
  assert.equal(p.status, 200, p.texto);
  assert.equal(p.json.documento.versao, 2);
  /* Salvar igual não sobe a versão. */
  assert.equal((await adm.put('/api/legal', { tipo: 'privacidade', campos: { controlador: 'Escola Exemplo Ltda', contato: 'privacidade@escola.example' }, textos: { 'pt-BR': 'Primeiro parágrafo.\n\nSegundo.' } }, { token: sup })).json.documento.versao, 2);
  assert.equal((await adm.put('/api/legal', { tipo: 'rascunho', campos: {} }, { token: sup })).json.codigo, 'documento-invalido');

  eu = (await c.get('/api/conta/eu')).json;
  assert.deepEqual(eu.pendentes, ['privacidade'], 'mudou o texto: precisa aceitar de novo');
  assert.equal((await c.put('/api/conta/eu', { aceite: true, versoes: { privacidade: 1 } })).json.codigo, 'termos-mudaram');
  assert.equal((await c.put('/api/conta/eu', { aceite: true, versoes: { privacidade: 2 } })).status, 200);
  assert.deepEqual((await c.get('/api/conta/eu')).json.pendentes, []);
  assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM consentimentos WHERE tipo = 'privacidade'")[0].n, 2, 'as duas versões ficam registradas');

  /* No login seguinte, quem não aceitou a versão nova precisa aceitar antes de entrar (e o link não é gasto). */
  await adm.put('/api/legal', { tipo: 'termos', campos: { contato: 'x@escola.example' } }, { token: sup });
  const conv = await adm.post('/api/convites', { email: 'lei@exemplo.com', enviar: false }, { token: sup });
  const t = tokenDoLink(conv.json.link);
  const outro = cliente(worker, env, { ip: '203.0.113.171' });
  assert.equal((await outro.post('/api/auth/convite', { token: t })).json.codigo, 'consentimento-necessario');
  assert.equal((await outro.post('/api/auth/convite', { token: t, aceite: true, versoes: { termos: 2 } })).status, 200);
});

test('Minha conta: exportar em JSON (sem hash de nada) e excluir apaga usuarios, sessoes, convites, links_magicos', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(configDe({ modo: 'privado', email: { adaptador: 'resend' } }));
    const env = ambiente({ RESEND_API_KEY: 're_chave', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' });
    const sup = await tokenDoSuper(worker, env);
    const c = await convidarEEntrar(worker, env, sup, 'del@exemplo.com');
    const outra = await convidarEEntrar(worker, env, sup, 'fica@exemplo.com');
    await c.post('/api/auth/entrar', { email: 'del@exemplo.com' });   /* gera um link mágico */

    const eu = await c.get('/api/conta/eu');
    assert.equal(eu.json.email, 'del@exemplo.com');
    assert.equal((await c.put('/api/conta/eu', { nome: '  Dê Ele  ' })).status, 200);

    const exp = await c.get('/api/conta/exportar');
    assert.equal(exp.status, 200);
    assert.match(exp.cabecalhos.get('content-disposition'), /attachment; filename="meus-dados\.json"/);
    assert.equal(exp.json.conta.email, 'del@exemplo.com');
    assert.equal(exp.json.conta.nome, 'Dê Ele');
    assert.equal(exp.json.consentimentos.length, 2);
    assert.equal(exp.json.sessoes.length, 1);
    assert.ok(exp.json.convites.length >= 1 && exp.json.linksMagicos.length >= 1);
    assert.ok(!/token|hash|senha"/i.test(exp.texto.replace(/"temSenha"/g, '')), 'o export não leva hash: ' + exp.texto);

    /* Confirmação obrigatória e do próprio e-mail. */
    assert.equal((await c.post('/api/conta/excluir', {})).json.codigo, 'confirmacao-invalida');
    assert.equal((await c.post('/api/conta/excluir', { email: 'fica@exemplo.com' })).json.codigo, 'confirmacao-invalida');
    const uid = env.DB.consultar("SELECT id FROM usuarios WHERE email = 'del@exemplo.com'")[0].id;
    const del = await c.post('/api/conta/excluir', { email: 'DEL@exemplo.com' });
    assert.equal(del.status, 200, del.texto);
    assert.match(del.setCookie, /Max-Age=0/, 'o cookie é apagado');

    const n = (sql, ...p) => env.DB.consultar(sql, ...p)[0].n;
    assert.equal(n('SELECT COUNT(*) AS n FROM usuarios WHERE id = ?', uid), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?', uid), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM convites WHERE email = 'del@exemplo.com'"), 0);
    assert.equal(n("SELECT COUNT(*) AS n FROM links_magicos WHERE email = 'del@exemplo.com'"), 0);
    assert.equal(n('SELECT COUNT(*) AS n FROM consentimentos WHERE usuario_id = ?', uid), 0);
    assert.equal((await c.get('/api/catalogo')).status, 401);
    /* Nada da outra pessoa foi tocado. */
    assert.equal((await outra.get('/api/catalogo')).status, 200);
    assert.equal(n("SELECT COUNT(*) AS n FROM convites WHERE email = 'fica@exemplo.com'"), 1);
    /* O e-mail pode ser usado de novo (nova conta, sem herança). */
    await convidarEEntrar(worker, env, sup, 'del@exemplo.com');
  } finally { servicos.restaurar(); }
});

test('equipe e superadmin: /api/conta/eu e exportar respondem; excluir não é por aqui', async () => {
  const { worker, env, sup } = await prepararPrivado();
  const c = cliente(worker, env);
  assert.equal((await c.get('/api/conta/eu', { token: sup })).json.papel, 'super');
  assert.equal((await c.get('/api/conta/exportar', { token: sup })).status, 200);
  assert.equal((await c.post('/api/conta/excluir', { email: 'a@exemplo.com' }, { token: sup })).json.codigo, 'conta-de-equipe');
  assert.equal((await c.get('/api/conta/eu')).status, 401, 'anônimo: sessão necessária');
});

/* ------------------------------------------------- o que o público vê da configuração */

test('/api/auth/estado: o que a página de entrada precisa, sem segredo', async () => {
  const worker = await criarWorker(CADASTRO());
  const env = ENV_CADASTRO();
  const r = await cliente(worker, env).get('/api/auth/estado');
  assert.equal(r.status, 200);
  assert.equal(r.json.modo, 'cadastro');
  assert.equal(r.json.cadastroAberto, true);
  assert.equal(r.json.emailAtivo, true);
  assert.equal(r.json.turnstile.siteKey, '0x4AAAAAAAteste');
  assert.deepEqual(r.json.sessao, { papel: 'anonimo' });
  for (const segredo of [SECRETO_TURNSTILE, 're_chave_de_teste', 'senha-do-super', env.SESSION_SECRET]) assert.ok(!r.texto.includes(segredo), 'vazou ' + segredo);
  /* Sem o secret do Turnstile, o cadastro aparece fechado. */
  const sem = await cliente(worker, ENV_CADASTRO({ TURNSTILE_SECRET: undefined })).get('/api/auth/estado');
  assert.equal(sem.json.cadastroAberto, false);
  assert.equal(sem.json.turnstile.siteKey, '');
  /* Público: sem contas. */
  const pub = await cliente(await criarWorker(configDe({ modo: 'publico' })), ambiente()).get('/api/auth/estado');
  assert.equal(pub.json.contas, false);
  assert.equal((await cliente(await criarWorker(configDe({ modo: 'publico' })), ambiente()).post('/api/auth/entrar', { email: 'a@exemplo.com' })).json.codigo, 'sem-contas');
});

test('diagnóstico do admin: diz o que falta para o modo funcionar, sem entregar segredo', async () => {
  const worker = await criarWorker(CADASTRO());
  const env = ENV_CADASTRO({ TURNSTILE_SECRET: undefined });
  const sup = await tokenDoSuper(worker, env);
  const r = await cliente(worker, env).get('/api/espectadores', { token: sup });
  assert.equal(r.json.diagnostico.cadastro.disponivel, false);
  assert.equal(r.json.diagnostico.cadastro.motivo, 'turnstile-nao-configurado');
  assert.equal(r.json.diagnostico.email.adaptador, 'resend');
  assert.equal(r.json.diagnostico.banco, true);
  assert.ok(!r.texto.includes('re_chave_de_teste'));
});

/* ------------------------------------------------- robustez e varredura */

test('nenhuma rota de conta responde 500 (corpo inválido, vazio, métodos errados), em nenhum modo, com banco', async () => {
  const { rotasRegistradas } = await mod('rotas.js');
  const minhas = rotasRegistradas().filter((r) => /^\/api\/(auth|conta\/|legal|convites|espectadores)/.test(r.caminho));
  assert.ok(minhas.length >= 12);
  const servicos = servicosDeMentira();
  try {
    for (const modo of ['publico', 'cadastro', 'privado']) {
      const worker = await criarWorker(modo === 'cadastro' ? CADASTRO() : configDe({ modo }));
      const env = ENV_CADASTRO();
      const sup = await tokenDoSuper(worker, env);
      const logado = modo === 'publico' ? null : await convidarEEntrar(worker, env, sup, 'r@exemplo.com', '203.0.113.180');
      for (const { caminho, metodo } of minhas) {
        for (const corpo of [undefined, {}, { email: 5, token: [], aceite: 'sim', id: {}, tipo: 3, senha: 7 }]) {
          for (const quem of ['anon', 'super', 'espectador']) {
            if (quem === 'espectador' && !logado) continue;
            const ator = quem === 'espectador' ? logado : cliente(worker, env, { ip: '203.0.113.' + (181 + Math.floor(Math.random() * 60)) });
            const opcoes = { token: quem === 'super' ? sup : undefined };
            const r = metodo === 'GET' || metodo === 'DELETE' ? await (metodo === 'GET' ? ator.get(caminho, opcoes) : ator.delete(caminho, opcoes))
              : await (metodo === 'POST' ? ator.post(caminho, corpo, opcoes) : ator.put(caminho, corpo, opcoes));
            assert.ok(r.status < 500 || r.status === 503, metodo + ' ' + caminho + ' [' + modo + '/' + quem + ']: ' + r.status + ' ' + r.texto.slice(0, 120));
          }
        }
      }
    }
  } finally { servicos.restaurar(); }
});

test('nenhuma resposta das rotas de conta carrega segredo de ambiente, hash de senha ou hash de token', async () => {
  const servicos = servicosDeMentira();
  try {
    const worker = await criarWorker(CADASTRO());
    const env = ENV_CADASTRO();
    const sup = await tokenDoSuper(worker, env);
    const adm = cliente(worker, env, { ip: '198.51.100.9' });
    const c = await convidarEEntrar(worker, env, sup, 'seg@exemplo.com');
    const respostas = [
      await adm.get('/api/espectadores', { token: sup }), await adm.get('/api/convites', { token: sup }), await adm.get('/api/legal'),
      await c.get('/api/conta/eu'), await c.get('/api/conta/exportar'), await c.get('/api/auth/estado'),
      await adm.get('/api/contas', { token: sup })
    ];
    const hashDaSessao = env.DB.consultar('SELECT token_hash FROM sessoes')[0].token_hash;
    for (const r of respostas) {
      for (const segredo of [SECRETO_TURNSTILE, 're_chave_de_teste', 'senha-do-super', env.SESSION_SECRET, hashDaSessao, env.BUNNY_API_KEY === 'x' ? 'nao-aplicavel' : '']) {
        if (segredo) assert.ok(!r.texto.includes(segredo), 'vazou ' + segredo + ' em ' + r.texto.slice(0, 80));
      }
      assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|\bsk-[A-Za-z0-9]{20,}/.test(r.texto));
    }
  } finally { servicos.restaurar(); }
});

test('o código das rotas de conta não escreve segredo nem marca; e só o SHA-256 vai para o banco', () => {
  const RAIZ = path.join(__dirname, '..');
  const arquivos = [];
  const andar = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) andar(p); else arquivos.push(p); } };
  andar(path.join(RAIZ, 'core', 'worker', 'api', 'auth'));
  andar(path.join(RAIZ, 'core', 'worker', 'api', 'conta'));
  for (const f of fs.readdirSync(path.join(RAIZ, 'core', 'worker', '_lib'))) if (/^(contas|sessoes|email|turnstile|limite)/.test(f)) arquivos.push(path.join(RAIZ, 'core', 'worker', '_lib', f));
  for (const f of arquivos) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!/(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|re_[A-Za-z0-9]{20,})/.test(t), 'segredo escrito em ' + f);
    assert.ok(!/localStorage|sessionStorage/.test(t), 'o servidor não guarda sessão no navegador: ' + f);
  }
  const sessoes = fs.readFileSync(path.join(RAIZ, 'core', 'worker', '_lib', 'sessoes.js'), 'utf8');
  assert.ok(/sha256Hex\(token\)/.test(sessoes), 'a sessão vai ao banco por SHA-256');
  assert.ok(/HttpOnly; Secure; SameSite=/.test(sessoes), 'flags do cookie');
});
