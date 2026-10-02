/* Correções da revisão do M5. Cada teste reproduz uma falha achada na revisão:
 *   1. o GET do catálogo gravava no KV a URL de capa ASSINADA (escrita por visita + credencial em repouso)
 *   2. console com erro (401 + preload não usado) nos modos restritos
 *   3. tempo de resposta distinguindo e-mail com conta de e-mail sem conta
 *   4. a URL assinada não acompanhava a sessão (sessao.expiraEm nunca vinha preenchido)
 *   5. login CSRF: POST de outro site em /api/auth/* abria a sessão do atacante
 *   6. senha sem teto por conta: vários IPs tentavam senhas contra uma conta sem limite */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, fetchFalso, cliente, tokenDoSuper, tokenDoLink, ACEITE } = require('./fixtures/contas-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const catalogo = () => JSON.stringify({ rev: 1, itens: [{ id: 'a', titulo: 'A', publicar: true, destaque: true, fonte: { provedor: 'bunny', id: GUID } }] });
const amb = (extra) => { const e = ambiente(Object.assign({ BUNNY_PULLZONE: 'vz-teste.b-cdn.net', BUNNY_TOKEN_KEY: 'chave-de-token' }, extra || {})); e.CATALOGO.dados.catalogo = catalogo(); return e; };

async function convidarEEntrar(worker, env, email = 'ana@exemplo.com', ip = '203.0.113.31') {
  const sup = await tokenDoSuper(worker, env);
  const c = cliente(worker, env, { ip });
  const conv = await c.post('/api/convites', { email, enviar: false }, { token: sup });
  const r = await c.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()));
  assert.equal(r.status, 200, r.texto);
  return c;
}

/* ------------------------------------------------------------------ 1 */

test('1. modos restritos: o GET do catálogo NÃO grava capa assinada no KV', async () => {
  for (const modo of ['privado', 'cadastro']) {
    const worker = await criarWorker(configDe({ modo, privado: { assinarMidia: true } }));
    const env = amb();
    let escritas = 0;
    const put = env.CATALOGO.put;
    env.CATALOGO.put = async (...a) => { if (a[0] === 'capa-destaque') escritas++; return put(...a); };
    const c = await convidarEEntrar(worker, env);
    for (let i = 0; i < 3; i++) {
      const r = await c.get('/api/catalogo');
      assert.equal(r.status, 200, r.texto);
      assert.match(r.json.itens[0].midia.capa, /bcdn_token=/, 'a capa sai assinada para quem tem sessão');
    }
    assert.equal(escritas, 0, modo + ': uma escrita de KV por visita');
    assert.equal(env.CATALOGO.dados['capa-destaque'], undefined, modo + ': credencial vigente em repouso no KV');
    assert.ok(!JSON.stringify(env.CATALOGO.dados).includes('bcdn_token'), 'nenhum token no KV');
  }
});

test('1. modo público continua guardando a capa (o preload da home depende dela)', async () => {
  const worker = await criarWorker(configDe({ modo: 'publico' }));
  const env = amb();
  const r = await cliente(worker, env).get('/api/catalogo');
  assert.equal(r.status, 200);
  assert.match(env.CATALOGO.dados['capa-destaque'] || '', /^https:\/\/vz-teste\.b-cdn\.net\//);
});

/* ------------------------------------------------------------------ 2 */

const HTML_COM_PRELOAD = '<html><head>\n<link rel="preload" href="/api/catalogo" as="fetch" crossorigin>\n<link rel="stylesheet" href="style.css"></head><body>ok</body></html>';

test('2. index.html real tem o preload que o Worker precisa saber tirar', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'core/site/index.html'), 'utf8');
  assert.equal(html.split('<link rel="preload" href="/api/catalogo" as="fetch" crossorigin>').length, 2);
  return import('../core/worker/home.js').then(({ semPreloadDoCatalogo }) => {
    assert.ok(!semPreloadDoCatalogo(html).includes('href="/api/catalogo"'));
  });
});

test('2. a home só leva o preload de /api/catalogo no modo público e fora da mesa', async () => {
  const quando = async (modo, caminho) => {
    const worker = await criarWorker(configDe({ modo }));
    const env = amb({ ASSETS: { fetch: async () => new Response(HTML_COM_PRELOAD, { status: 200, headers: { 'content-type': 'text/html' } }) } });
    return (await cliente(worker, env).get(caminho)).texto;
  };
  assert.ok((await quando('publico', '/')).includes('href="/api/catalogo"'));
  assert.ok(!(await quando('publico', '/?mesa=1')).includes('href="/api/catalogo"'), 'na mesa o catálogo vem por postMessage');
  assert.ok(!(await quando('privado', '/')).includes('href="/api/catalogo"'));
  assert.ok(!(await quando('cadastro', '/')).includes('href="/api/catalogo"'));
});

test('2. app.js, nos modos restritos, pergunta /api/auth/estado antes e não pede o catálogo sem sessão', async () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'core/site/app.js'), 'utf8');
  const pega = (nome) => {
    const i = fonte.indexOf('  function ' + nome + '(');
    assert.ok(i >= 0, nome);
    const f = fonte.indexOf('\n  }\n', i);
    return fonte.slice(i, f + 4);
  };
  const montar = (modo, papel) => {
    const pedidos = [];
    const loc = { pathname: '/', search: '', hash: '', replace: (u) => pedidos.push('ir:' + u) };
    const fabrica = new Function('mesa', 'CONFIG_PUBLICA', 'fetch', 'location', 'tr', 'receberDados',
      pega('irParaEntrar') + pega('carregar') + '; return carregar;');
    const fetchFalso2 = async (u) => {
      pedidos.push(u);
      if (u === '/api/auth/estado') return { ok: true, json: async () => ({ sessao: { papel } }) };
      return { ok: true, status: 200, json: async () => ({ itens: [] }) };
    };
    return { pedidos, carregar: fabrica({ ligada: false }, { acesso: { modo } }, fetchFalso2, loc, (k) => k, () => {}) };
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));

  const anonimo = montar('privado', 'anonimo');
  anonimo.carregar();
  await tick();
  assert.ok(!anonimo.pedidos.includes('/api/catalogo'), 'sem sessão não há pedido que volte 401: ' + anonimo.pedidos);
  assert.ok(anonimo.pedidos.some((p) => p.startsWith('ir:entrar.html')));

  const logado = montar('cadastro', 'espectador');
  await logado.carregar();
  assert.deepEqual(logado.pedidos, ['/api/auth/estado', '/api/catalogo']);

  const publico = montar('publico', 'anonimo');
  await publico.carregar();
  assert.deepEqual(publico.pedidos, ['/api/catalogo'], 'no modo público nada muda');
});

/* ------------------------------------------------------------------ 3 */

/* O D1 trava a escrita que `casa` até o portão abrir: se a resposta sai com o portão fechado,
 * a escrita NÃO está no caminho síncrono. */
function travarEscritas(env, casa) {
  let abrir;
  const portao = new Promise((r) => { abrir = r; });
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const st = prepare(sql);
    if (!casa.test(sql)) return st;
    const trava = (s) => Object.assign({}, s, {
      bind: (...p) => trava(s.bind(...p)),
      run: async () => { await portao; return s.run(); }
    });
    return trava(st);
  };
  return { abrir };
}

async function respostaSemEsperarSegundoPlano(worker, env, caminho, corpo, ip) {
  const esperando = [];
  const req = new Request('https://exemplo.test' + caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://exemplo.test', 'cf-connecting-ip': ip },
    body: JSON.stringify(corpo)
  });
  const r = await Promise.race([
    worker.fetch(req, env, { waitUntil: (p) => esperando.push(p) }),
    new Promise((resolve) => setTimeout(() => resolve(null), 3000))
  ]);
  return { r, esperando };
}

test('2. app.js: carregar() espera o idioma/config pública antes de decidir o pré-check (ordem real de iniciar)', async () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'core/site/app.js'), 'utf8');
  assert.match(fonte, /carregar\(idiomaPronto\)/, 'iniciar passa o idioma pronto para carregar');
  const pega = (nome) => { const i = fonte.indexOf('  function ' + nome + '(');
    assert.ok(i >= 0, nome); return fonte.slice(i, fonte.indexOf('\n  }\n', i) + 4); };
  const pedidos = [];
  const loc = { pathname: '/', search: '', hash: '', replace: (u) => pedidos.push('ir:' + u) };
  const fetchF = async (u) => { pedidos.push(u);
    if (u === '/api/auth/estado') return { ok: true, json: async () => ({ sessao: { papel: 'anonimo' } }) };
    return { ok: true, status: 200, json: async () => ({ itens: [] }) }; };
  const fabrica = new Function('mesa', 'fetch', 'location', 'tr', 'receberDados',
    'var CONFIG_PUBLICA = null;' + pega('irParaEntrar') + pega('carregar') + '; return { carregar: carregar, definir: function (v) { CONFIG_PUBLICA = v; } };');
  const m = fabrica({ ligada: false }, fetchF, loc, (k) => k, () => {});
  /* o idioma resolve DEPOIS de carregar() ser chamada, como em iniciar() */
  let liberar; const idiomaPronto = new Promise((r) => { liberar = () => { m.definir({ acesso: { modo: 'privado' } }); r(); }; });
  m.carregar(idiomaPronto);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(pedidos, [], 'nada é pedido antes da config pública chegar');
  liberar();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!pedidos.includes('/api/catalogo'), 'anônimo em modo restrito nunca pede o catálogo: ' + pedidos);
  assert.equal(pedidos[0], '/api/auth/estado');
});
test('3. /api/auth/entrar: criar o link e entregar ficam fora da resposta (e-mail com conta = sem conta)', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const env = ambiente();
  await convidarEEntrar(worker, env, 'ana@exemplo.com', '203.0.113.40');
  const trava = travarEscritas(env, /INSERT INTO links_magicos/);
  const existente = await respostaSemEsperarSegundoPlano(worker, env, '/api/auth/entrar', { email: 'ana@exemplo.com' }, '203.0.113.41');
  assert.ok(existente.r, 'a resposta ficou presa na escrita do link: o tempo revela que a conta existe');
  assert.equal(existente.r.status, 200);
  const inexistente = await respostaSemEsperarSegundoPlano(worker, env, '/api/auth/entrar', { email: 'ninguem@exemplo.com' }, '203.0.113.42');
  assert.equal(inexistente.r.status, 200);
  assert.deepEqual(await existente.r.json(), await inexistente.r.json());
  trava.abrir();
  await Promise.all(existente.esperando.concat(inexistente.esperando));
  const n = env.DB.consultar("SELECT email FROM links_magicos WHERE email = 'ana@exemplo.com'").length;
  assert.equal(n >= 1, true, 'o link foi criado em segundo plano');
  assert.equal(env.DB.consultar("SELECT 1 FROM links_magicos WHERE email = 'ninguem@exemplo.com'").length, 0);
});

test('3. /api/auth/cadastro: conta nova e conta existente têm o mesmo caminho síncrono', async () => {
  const servicos = fetchFalso({
    'https://challenges.cloudflare.com/turnstile/v0/siteverify': async () => ({ success: true }),
    'https://api.resend.com/emails': async () => ({ id: 'em_1' })
  });
  try {
    const worker = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'link-magico', verificarEmail: true }, email: { adaptador: 'resend' } }));
    const env = ambiente({ TURNSTILE_SECRET: 'segredo-do-turnstile-123', TURNSTILE_SITE_KEY: '0x4AAAAAAAteste', RESEND_API_KEY: 're_x', EMAIL_REMETENTE: 'Exemplo <aviso@exemplo.com>' });
    const corpo = (email) => Object.assign({ email, turnstile: 'tok-bom-0123456789abcdef' }, ACEITE());
    const aquecer = await respostaSemEsperarSegundoPlano(worker, env, '/api/auth/cadastro', corpo('aquece@exemplo.com'), '203.0.113.50');
    assert.equal(aquecer.r.status, 200);
    await Promise.all(aquecer.esperando);
    const trava = travarEscritas(env, /INSERT INTO (links_magicos|consentimentos)/);
    const nova = await respostaSemEsperarSegundoPlano(worker, env, '/api/auth/cadastro', corpo('nova@exemplo.com'), '203.0.113.51');
    assert.ok(nova.r, 'conta nova: a resposta esperou as escritas extras (aceite e link)');
    assert.equal(nova.r.status, 200);
    trava.abrir();
    await Promise.all(nova.esperando);
    assert.equal(env.DB.consultar("SELECT 1 FROM links_magicos WHERE email = 'nova@exemplo.com'").length, 1);
    assert.ok(env.DB.consultar('SELECT 1 FROM consentimentos').length >= 1, 'o aceite foi gravado em segundo plano');
  } finally { servicos.restaurar(); }
});

/* ------------------------------------------------------------------ 4 */

test('4. a sessão devolve expiraEm, e a URL assinada nunca vive mais que a sessão', async () => {
  const { sessaoDaRequisicao } = await import('../core/worker/_lib/sessoes.js');
  const worker = await criarWorker(configDe({ modo: 'privado', privado: { assinarMidia: true, validadeDaAssinaturaSeg: 3600 } }));
  const env = amb();
  const c = await convidarEEntrar(worker, env);
  const cookie = Object.keys(c.jarra).map((k) => k + '=' + c.jarra[k]).join('; ');
  const s = await sessaoDaRequisicao(new Request('https://exemplo.test/api/catalogo', { headers: { cookie } }), env);
  assert.equal(s.papel, 'espectador');
  assert.ok(Number.isInteger(s.expiraEm) && s.expiraEm > Date.now() / 1000, 'sessao.expiraEm ausente');

  /* A sessão acaba em 90 s: a URL assinada tem de acabar junto. */
  env.DB.bruto.exec('UPDATE sessoes SET expira_em = ' + (Math.floor(Date.now() / 1000) + 90));
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 200, r.texto);
  const exp = Number(/expires=(\d+)/.exec(r.json.itens[0].midia.hls)[1]);
  assert.ok(exp - Date.now() / 1000 <= 95, 'a URL sobrevive à sessão: ' + (exp - Date.now() / 1000));
});

test('4. o padrão da validade da assinatura é de 1 hora (schema e código)', async () => {
  const { politicaDeAcesso } = await import('../core/worker/_lib/contas.js');
  assert.equal(politicaDeAcesso({ acesso: { modo: 'privado' } }).validadeDaAssinaturaSeg, 3600);
  const esquema = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config/site.schema.json'), 'utf8'));
  const a = JSON.stringify(esquema);
  assert.ok(/"validadeDaAssinaturaSeg":\{[^}]*"default":3600/.test(a));
});

/* ------------------------------------------------------------------ 5 */

test('5. login CSRF: POST de outro site em /api/auth/* é recusado, com ou sem cookie', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  const conv = await cliente(worker, env).post('/api/convites', { email: 'ana@exemplo.com', enviar: false }, { token: sup });
  const token = tokenDoLink(conv.json.link);
  const c = cliente(worker, env, { ip: '203.0.113.60' });
  for (const rota of ['/api/auth/convite', '/api/auth/link', '/api/auth/entrar', '/api/auth/cadastro', '/api/auth/sair']) {
    for (const cab of [{ origin: 'https://atacante.example' }, { 'sec-fetch-site': 'cross-site', origin: '' }]) {
      const r = await c.post(rota, Object.assign({ token }, ACEITE()), { cabecalhos: cab });
      assert.equal(r.status, 403, rota + ' ' + JSON.stringify(cab) + ' -> ' + r.status);
      assert.equal(r.json.codigo, 'origem-invalida');
    }
  }
  assert.deepEqual(c.jarra, {}, 'nenhuma sessão aberta no navegador da vítima');
  /* O token do atacante não foi gasto: o mesmo site ainda o usa. */
  const ok = await c.post('/api/auth/convite', Object.assign({ token }, ACEITE()));
  assert.equal(ok.status, 200, ok.texto);
});

/* ------------------------------------------------------------------ 6 */

test('6. senha: teto de 50 falhas por hora por CONTA, mesmo trocando de IP; o link mágico segue aberto', async () => {
  const worker = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'email-e-senha', verificarEmail: false } }));
  const env = ambiente({ TURNSTILE_SECRET: 'segredo-do-turnstile-123', TURNSTILE_SITE_KEY: '0x4AAAAAAAteste', SENHA_ITERACOES: '1000' });
  const servicos = fetchFalso({ 'https://challenges.cloudflare.com/turnstile/v0/siteverify': async () => ({ success: true }) });
  try {
    const dono = cliente(worker, env, { ip: '203.0.113.70' });
    const cad = await dono.post('/api/auth/cadastro', Object.assign({ email: 'dona@exemplo.com', senha: 'a-senha-correta-da-dona', turnstile: 'tok-bom-0123456789abcdef' }, ACEITE()));
    assert.equal(cad.status, 200, cad.texto);
    const tenta = (i, senha) => cliente(worker, env, { ip: '198.51.100.' + (i % 250) + (i >= 250 ? '' : '') }).post('/api/auth/entrar', { email: 'dona@exemplo.com', senha, turnstile: 'tok-bom-0123456789abcdef' }, { ipDaVez: '10.' + Math.floor(i / 250) + '.' + (i % 250) + '.1' });
    for (let i = 0; i < 50; i++) assert.equal((await tenta(i, 'chute-errado-' + i)).status, 401, 'tentativa ' + i);
    const barrada = await tenta(51, 'chute-errado-51');
    assert.equal(barrada.status, 429, 'a 51ª falha, de um IP novo, passou');
    assert.ok(barrada.cabecalhos.get('retry-after'));
    /* Outra conta não sofre. */
    const outra = await tenta(52, 'qualquer-senha-longa');
    assert.equal((await cliente(worker, env, { ip: '10.9.9.9' }).post('/api/auth/entrar', { email: 'outra@exemplo.com', senha: 'qualquer-senha-longa', turnstile: 'tok-bom-0123456789abcdef' })).status, 401);
    assert.ok(outra);
  } finally { servicos.restaurar(); }
});

test('6. o dono que erra poucas vezes não esbarra no teto da conta, e acertar funciona', async () => {
  const worker = await criarWorker(configDe({ modo: 'cadastro', cadastro: { metodo: 'email-e-senha', verificarEmail: false } }));
  const env = ambiente({ TURNSTILE_SECRET: 'segredo-do-turnstile-123', TURNSTILE_SITE_KEY: '0x4AAAAAAAteste', SENHA_ITERACOES: '1000' });
  const servicos = fetchFalso({ 'https://challenges.cloudflare.com/turnstile/v0/siteverify': async () => ({ success: true }) });
  try {
    const c = cliente(worker, env, { ip: '203.0.113.71' });
    await c.post('/api/auth/cadastro', Object.assign({ email: 'dona@exemplo.com', senha: 'a-senha-correta-da-dona', turnstile: 'tok-bom-0123456789abcdef' }, ACEITE()));
    assert.equal((await c.post('/api/auth/entrar', { email: 'dona@exemplo.com', senha: 'errada-errada-errada', turnstile: 'tok-bom-0123456789abcdef' })).status, 401);
    const r = await c.post('/api/auth/entrar', { email: 'dona@exemplo.com', senha: 'a-senha-correta-da-dona', turnstile: 'tok-bom-0123456789abcdef' });
    assert.equal(r.status, 200, r.texto);
  } finally { servicos.restaurar(); }
});
