/* M6 — PWA: manifest e ícones do site.json (já existiam) e o service worker MÍNIMO e OPCIONAL.
 *
 * O risco que isto cobre: um service worker guarda coisas no aparelho. Este só pode guardar a CASCA do site (página
 * inicial, estilo, script, fonte, textos por idioma, manifest, ícones) e NUNCA API, conta, mesa, mídia ou pedido que
 * leve credencial. O teste roda o sw.js gerado dentro de um `vm` com eventos de mentira, e confere decisão por decisão.
 * Desligado (o padrão), o arquivo é o "de desligar": apaga os caches e se desinstala. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'core', 'site');
const gerar = () => import('../scripts/lib/config-gerar.mjs');
const validar = () => import('../core/worker/_lib/config-validar.mjs');
const lerSchema = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'site.schema.json'), 'utf8'));
const lerSite = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'site.json'), 'utf8'));

async function configCom(recursos) {
  const { validarConfig } = await validar();
  const c = lerSite();
  c.recursos = Object.assign({}, c.recursos, recursos);
  const r = validarConfig(lerSchema(), c);
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  return r.config;
}

/* Um navegador de mentira para o sw.js: eventos, caches em memória, Response de verdade. */
function navegador(js, { origem = 'https://exemplo.test', rede } = {}) {
  const ouvintes = {};
  const armazem = new Map();    /* nome -> Map(url -> Response) */
  const chamadasDeRede = [];
  const log = { desinstalou: 0, apagou: [], reivindicou: 0, pulou: 0 };
  const caches = {
    async open(nome) {
      if (!armazem.has(nome)) armazem.set(nome, new Map());
      const m = armazem.get(nome);
      return { put: async (req, resp) => { m.set(req.url, resp); }, match: async (req) => { const r = m.get(req.url); return r ? r.clone() : undefined; } };
    },
    async match(req) { for (const m of armazem.values()) if (m.has(req.url)) return m.get(req.url).clone(); return undefined; },
    async keys() { return [...armazem.keys()]; },
    async delete(nome) { log.apagou.push(nome); return armazem.delete(nome); }
  };
  const self = {
    location: { origin: origem },
    addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; },
    skipWaiting: () => { log.pulou++; },
    clients: { claim: async () => { log.reivindicou++; } },
    registration: { unregister: async () => { log.desinstalou++; return true; } }
  };
  const fetchDeMentira = async (req) => {
    chamadasDeRede.push(req.url);
    if (!rede) throw new Error('sem rede');
    return rede(req);
  };
  vm.runInNewContext(js, { self, caches, fetch: fetchDeMentira, URL, Response, Headers, console });

  /* Dispara um fetch: devolve { respondeu, resposta } (a Promise que o sw entregou ao respondWith). */
  async function pedir({ url, metodo = 'GET', destino = '', modo = 'cors', cabecalhos = {} }) {
    const req = { url: origem + url, method: metodo, destination: destino, mode: modo, headers: new Headers(cabecalhos) };
    if (/^https?:\/\//.test(url)) req.url = url;
    let promessa = null;
    ouvintes.fetch({ request: req, respondWith: (p) => { promessa = p; } });
    return { respondeu: promessa !== null, resposta: promessa ? await promessa : null, req };
  }
  return { ouvintes, armazem, caches, chamadasDeRede, log, pedir };
}

/* O `Response` que o navegador devolve para um pedido do próprio site tem tipo "basic"; o construtor dá "default". */
const comTipo = (r, tipo) => { Object.defineProperty(r, 'type', { value: tipo }); return r; };
const ok = (corpo, cab) => comTipo(new Response(corpo || 'ok', { status: 200, headers: cab || {} }), 'basic');

/* ------------------------------------------------------------------ o gerador */

test('o padrão é DESLIGADO: o sw.js gerado é o "de desligar", e o arquivo do repositório é esse', async () => {
  const { gerarServiceWorker } = await gerar();
  const padrao = await configCom({});
  assert.equal(padrao.recursos.pwaCacheDoShell, false, 'o service worker nasce desligado');
  const js = gerarServiceWorker(padrao);
  assert.ok(!/addEventListener\('fetch'/.test(js), 'o sw.js de desligar escuta fetch');
  assert.equal(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), js, 'core/site/sw.js está velho em relação ao config (rode aplicar-config)');
  const pub = JSON.parse(fs.readFileSync(path.join(SITE, 'config.public.json'), 'utf8'));
  assert.equal(pub.recursos.pwaCacheDoShell, false);
});

test('o sw.js de desligar apaga SÓ os caches dele e se desinstala, sem tocar em nenhum pedido', async () => {
  const { gerarServiceWorker } = await gerar();
  const nav = navegador(gerarServiceWorker(await configCom({})));
  nav.armazem.set('tm-casca-v1', new Map());
  nav.armazem.set('tm-casca-v0', new Map());
  nav.armazem.set('outro-app-v1', new Map());
  assert.equal(nav.ouvintes.fetch, undefined, 'o sw.js de desligar não pode interceptar nada');
  assert.equal(nav.log.pulou, 0);
  nav.ouvintes.install();
  assert.equal(nav.log.pulou, 1);
  let pronta;
  nav.ouvintes.activate({ waitUntil: (p) => { pronta = p; } });
  await pronta;
  assert.deepEqual(nav.log.apagou.sort(), ['tm-casca-v0', 'tm-casca-v1']);
  assert.ok(nav.armazem.has('outro-app-v1'), 'apagou o cache de outro app da mesma origem');
  assert.equal(nav.log.desinstalou, 1);
});

test('o cache tem o prefixo da instalação, para duas instalações no mesmo domínio não se pisarem', async () => {
  const { gerarServiceWorker } = await gerar();
  const c = await configCom({ pwaCacheDoShell: true });
  c.marca.prefixoDeArmazenamento = 'abc';
  assert.match(gerarServiceWorker(c), /var PREFIXO_DO_CACHE = 'abc-casca-';/);
  c.marca.prefixoDeArmazenamento = "x';alert(1);//";
  assert.match(gerarServiceWorker(c), /var PREFIXO_DO_CACHE = 'xalert1-casca-';/, 'o prefixo entrou no código sem ser limpo');
});

/* ------------------------------------------------------- o que o ligado decide */

async function ligado(opcoes) {
  const { gerarServiceWorker } = await gerar();
  return navegador(gerarServiceWorker(await configCom({ pwaCacheDoShell: true })), opcoes);
}

test('ligado: NUNCA intercepta API, conta, mesa, mídia, pedido de outro site, não-GET, Range ou credencial', async () => {
  const nav = await ligado({ rede: () => ok() });
  const nao = [
    { url: '/api/catalogo', destino: '' },
    { url: '/api/catalogo?completo=1', destino: 'script' },        /* destino de script não abre a porta da API */
    { url: '/api/minha-lista', destino: '' },
    { url: '/api/midia', destino: 'image' },
    { url: '/api/auth/estado', destino: '' },
    { url: '/api', destino: 'script' },
    { url: '/mcp', destino: '' },
    { url: '/admin', destino: 'document', modo: 'navigate' },
    { url: '/admin.html', destino: 'document', modo: 'navigate' },
    { url: '/mesa.js', destino: 'script' },
    { url: '/mesa-home.js', destino: 'script' },
    { url: '/mesa.css', destino: 'style' },
    { url: '/entrar.html', destino: 'document', modo: 'navigate' },
    { url: '/entrar', destino: 'document', modo: 'navigate' },
    { url: '/cadastro.html', destino: 'document', modo: 'navigate' },
    { url: '/conta.html', destino: 'document', modo: 'navigate' },
    { url: '/conta', destino: 'document', modo: 'navigate' },
    { url: '/privacidade.html', destino: 'document', modo: 'navigate' },
    { url: '/video/aula.mp4', destino: 'video' },
    { url: '/video/aula.m3u8', destino: '' },
    { url: '/video/seg-1.ts', destino: '' },
    { url: '/audio/a.mp3', destino: 'audio' },
    { url: '/capas/c.jpg', destino: 'image' },
    { url: '/legendas/pt.vtt', destino: 'track' },
    { url: 'https://cdn.exemplo-de-video.test/aula/playlist.m3u8', destino: '' },
    { url: 'https://cdn.exemplo-de-video.test/app.js', destino: 'script' },
    { url: 'https://outro-site.test/style.css', destino: 'style' },
    { url: '/style.css', destino: 'style', metodo: 'POST' },
    { url: '/style.css', destino: 'style', metodo: 'PUT' },
    { url: '/style.css', destino: 'style', cabecalhos: { range: 'bytes=0-99' } },
    { url: '/app.js', destino: 'script', cabecalhos: { authorization: 'Bearer abc' } }
  ];
  for (const p of nao) {
    const r = await nav.pedir(p);
    assert.equal(r.respondeu, false, 'o service worker interceptou ' + (p.metodo || 'GET') + ' ' + p.url);
  }
  assert.deepEqual(nav.chamadasDeRede, [], 'o service worker fez pedido de rede por conta própria');
  assert.equal([...nav.armazem.values()].reduce((n, m) => n + m.size, 0), 0, 'guardou algo que não é casca');
});

test('ligado: a casca (estilo, script, fonte, textos, manifest, ícones) é guardada e servida na próxima vez', async () => {
  let versao = 'v1';
  const nav = await ligado({ rede: () => ok('conteudo-' + versao) });
  const casca = [
    { url: '/style.css', destino: 'style' }, { url: '/theme.css', destino: 'style' }, { url: '/app.js', destino: 'script' },
    { url: '/home-blocos.js', destino: 'script' }, { url: '/fontes/Inter.woff2', destino: 'font' },
    { url: '/locales/pt-BR.json', destino: '' }, { url: '/config.public.json', destino: '' },
    { url: '/manifest.webmanifest', destino: 'manifest' }, { url: '/icone-192.png', destino: 'image' }, { url: '/favicon.svg', destino: 'image' }
  ];
  for (const p of casca) {
    const r = await nav.pedir(p);
    assert.equal(r.respondeu, true, p.url + ' não foi atendido pelo service worker');
    assert.equal(await r.resposta.text(), 'conteudo-v1');
  }
  /* A segunda vez: o guardado já, e o novo vai para a próxima (stale-while-revalidate). */
  versao = 'v2';
  const segunda = await nav.pedir({ url: '/style.css', destino: 'style' });
  assert.equal(await segunda.resposta.text(), 'conteudo-v1', 'não serviu o guardado');
  await new Promise((r) => setTimeout(r, 5));
  const terceira = await nav.pedir({ url: '/style.css', destino: 'style' });
  assert.equal(await terceira.resposta.text(), 'conteudo-v2', 'a versão nova não entrou para a vez seguinte');
  assert.ok([...nav.armazem.keys()].every((n) => n.startsWith('tm-casca-')));
});

test('ligado: a página inicial é rede primeiro, e sem rede abre a última que deu certo; outras páginas nunca', async () => {
  let temRede = true;
  const nav = await ligado({ rede: () => { if (!temRede) throw new Error('offline'); return ok('<html>inicio</html>'); } });
  const nova = await nav.pedir({ url: '/', destino: 'document', modo: 'navigate' });
  assert.equal(await nova.resposta.text(), '<html>inicio</html>');
  await new Promise((r) => setTimeout(r, 5));
  temRede = false;
  const offline = await nav.pedir({ url: '/', destino: 'document', modo: 'navigate' });
  assert.equal(await offline.resposta.text(), '<html>inicio</html>', 'sem rede a casca não abriu');
  /* Uma ficha por endereço de verdade (/index.html) vale como a inicial; qualquer outra página, não. */
  assert.equal((await nav.pedir({ url: '/index.html', destino: 'document', modo: 'navigate' })).respondeu, true);
  assert.equal((await nav.pedir({ url: '/outra.html', destino: 'document', modo: 'navigate' })).respondeu, false);
});

test('ligado: resposta com no-store, private, cookie, erro, ou que não é do próprio site, não vai para o cache', async () => {
  const respostas = {
    '/a.css': () => ok('x', { 'cache-control': 'no-store' }),
    '/b.css': () => ok('x', { 'cache-control': 'private, max-age=60' }),
    '/c.css': () => comTipo(new Response('x', { status: 200, headers: { 'set-cookie': 'a=b' } }), 'basic'),
    '/d.css': () => comTipo(new Response('x', { status: 404 }), 'basic'),
    '/e.css': () => comTipo(new Response('x', { status: 500 }), 'basic'),
    '/g.css': () => comTipo(new Response('x', { status: 200 }), 'opaque'),
    '/h.css': () => comTipo(new Response('x', { status: 200 }), 'cors'),
    '/f.css': () => ok('x', { 'cache-control': 'public, max-age=60' })
  };
  const nav = await ligado({ rede: (req) => respostas[new URL(req.url).pathname]() });
  for (const caminho of Object.keys(respostas)) await nav.pedir({ url: caminho, destino: 'style' });
  await new Promise((r) => setTimeout(r, 5));
  const guardados = [...nav.armazem.values()].flatMap((m) => [...m.keys()]).map((u) => new URL(u).pathname);
  assert.deepEqual(guardados, ['/f.css'], 'guardou resposta que não devia');
});

test('ligado: o sw.js nunca chama play(), não lê cookie nem guarda nada em localStorage', async () => {
  const { gerarServiceWorker } = await gerar();
  const js = gerarServiceWorker(await configCom({ pwaCacheDoShell: true })).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const proibido of ['.play(', 'localStorage', 'document.cookie', 'indexedDB', 'importScripts', 'eval(', 'postMessage']) {
    assert.ok(!js.includes(proibido), 'o sw.js usa ' + proibido);
  }
});

/* -------------------------------------------------------- o registro no site */

test('o app.js pede o service worker só quando o config liga, e na mesa nunca', () => {
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const corpo = app.match(/function cuidarDoServiceWorker\(\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(corpo, /mesa\.ligada/, 'registra dentro da mesa');
  assert.match(corpo, /isSecureContext/, 'tenta registrar fora de HTTPS');
  assert.match(corpo, /register\('\/sw\.js', \{ scope: '\/' \}\)/);
  assert.match(corpo, /r\.update\(\)/, 'o desligado não pede ao navegador que releia o sw.js (e então ele nunca se desinstala)');
  assert.match(app, /carregarMinhaLista\(\);\s*cuidarDoServiceWorker\(\);/, 'o app não cuida do service worker depois do primeiro desenho');
});

test('manifest: gerado do site.json, instalável (nome, início, escopo, modo e ícones que existem em disco)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SITE, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), 'faltam os ícones de 192 e 512');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(SITE, i.src.replace(/^\//, ''))), 'o ícone ' + i.src + ' não existe');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
});

test('o documento do cliente explica o service worker e o que fica fora dele', () => {
  const doc = fs.readFileSync(path.join(RAIZ, 'docs', 'home-e-colecoes.md'), 'utf8');
  assert.match(doc, /pwaCacheDoShell/);
  assert.match(doc, /desligado por padrão/i);
  for (const nunca of ['/api', 'vídeo', 'conta']) assert.ok(doc.includes(nunca), 'o documento não diz que o service worker não toca em ' + nunca);
});
