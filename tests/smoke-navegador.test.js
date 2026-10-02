/* O teste de fumaça no navegador (scripts/smoke-navegador.mjs): aqui só as partes que NÃO precisam de navegador. A execução
 * de verdade é `npm run smoke` (precisa de Playwright global, do Chromium e do wrangler). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const lib = () => import('../scripts/lib/smoke.mjs');
const smoke = () => import('../scripts/smoke-navegador.mjs');
const ORIGEM = 'http://127.0.0.1:8799';

test('sem Playwright o teste AVISA e pula (saída 0); com --exigir, falha (saída 1); uso incorreto é 2', async () => {
  const { principal } = await smoke();
  const semPlaywright = { caminhoDoPlaywright: () => null };
  const r = await principal([], semPlaywright);
  assert.equal(r.codigo, 0);
  assert.equal(r.pulado, true);
  assert.match(r.texto, /AVISO.*Playwright.*PULADO/);
  assert.equal((await principal(['--exigir'], semPlaywright)).codigo, 1);
  assert.equal((await principal(['--porta', '80'], semPlaywright)).codigo, 2);
  assert.equal((await principal(['--porta', 'abc'], semPlaywright)).codigo, 2);
  assert.equal((await principal(['--nada'], semPlaywright)).codigo, 2);
});

test('caminhoDoPlaywright: PLAYWRIGHT_IMPORT primeiro, depois npm root -g; nada achado dá null', async () => {
  const { caminhoDoPlaywright } = await lib();
  assert.equal(caminhoDoPlaywright({ env: {}, raizGlobal: '/x/lib/node_modules', existe: () => false }), null);
  const g = caminhoDoPlaywright({ env: {}, raizGlobal: '/x/lib/node_modules', existe: (c) => c === path.join('/x/lib/node_modules', 'playwright', 'index.mjs') });
  assert.match(g, /^file:\/\/\/x\/lib\/node_modules\/playwright\/index\.mjs$/);
  const env = caminhoDoPlaywright({ env: { PLAYWRIGHT_IMPORT: '/y/pw/index.mjs' }, raizGlobal: '/x/lib/node_modules', existe: () => true });
  assert.match(env, /\/y\/pw\/index\.mjs$/);
  assert.equal(caminhoDoPlaywright({ env: {}, raizGlobal: '', existe: () => true }), null);
});

test('o wrangler dev sobe LOCAL, em 127.0.0.1, com estado fora do projeto e segredos descartáveis só por --var', async () => {
  const { argumentosDoWrangler } = await lib();
  const a = argumentosDoWrangler({ porta: 8799, persistirEm: '/tmp/estado', senha: 'S3NH4', segredoDeSessao: 'SEGREDO' });
  assert.deepEqual(a.slice(0, 4), ['--yes', 'wrangler@4', 'dev', '--local']);
  assert.ok(a.includes('--persist-to') && a[a.indexOf('--persist-to') + 1] === '/tmp/estado');
  assert.equal(a[a.indexOf('--ip') + 1], '127.0.0.1');
  assert.ok(!a.includes('--remote'));
  assert.ok(a.includes('ADMIN_PASSWORD:S3NH4') && a.includes('SESSION_SECRET:SEGREDO'));
});

test('o que conta como erro: exceção da página sempre; erro do próprio site sim; falha de host de fora não', async () => {
  const { importa, IGNORAR_PADRAO } = await lib();
  assert.equal(importa({ tipo: 'pageerror', texto: 'x is not defined' }, ORIGEM, IGNORAR_PADRAO), true);
  assert.equal(importa({ tipo: 'console', url: ORIGEM + '/app.js', texto: 'Uncaught TypeError' }, ORIGEM, IGNORAR_PADRAO), true);
  assert.equal(importa({ tipo: 'requisicao', url: ORIGEM + '/mesa-saude.js', texto: 'net::ERR_ABORTED' }, ORIGEM, IGNORAR_PADRAO), true);
  assert.equal(importa({ tipo: 'resposta', status: 500, url: ORIGEM + '/api/saude' }, ORIGEM, IGNORAR_PADRAO), true);
  assert.equal(importa({ tipo: 'resposta', status: 404, url: ORIGEM + '/nao-existe.js' }, ORIGEM, IGNORAR_PADRAO), true);
  assert.equal(importa({ tipo: 'resposta', status: 200, url: ORIGEM + '/ok' }, ORIGEM, IGNORAR_PADRAO), false);
  assert.equal(importa({ tipo: 'console', url: 'https://vz-abc.b-cdn.net/capa.jpg', texto: 'Failed to load resource' }, ORIGEM, IGNORAR_PADRAO), false);
  assert.equal(importa({ tipo: 'requisicao', url: 'https://fonts.example/x.woff2', texto: 'net::ERR_NAME_NOT_RESOLVED' }, ORIGEM, IGNORAR_PADRAO), false);
  assert.equal(importa({ tipo: 'resposta', status: 401, url: ORIGEM + '/api/me' }, ORIGEM, IGNORAR_PADRAO), false, '401 antes do login é esperado');
  assert.equal(importa({ tipo: 'resposta', status: 401, url: ORIGEM + '/api/backup' }, ORIGEM, IGNORAR_PADRAO), true);
});

test('resumirProblemas corta a lista e não vaza mais que o necessário', async () => {
  const { resumirProblemas } = await lib();
  const muitos = Array.from({ length: 15 }, (_, i) => ({ tipo: 'console', url: ORIGEM + '/a' + i, texto: 'erro '.repeat(100) }));
  const t = resumirProblemas(muitos, 3);
  assert.equal(t.split('\n').length, 4);
  assert.match(t, /e mais 12/);
});

test('o script nunca imprime a senha nem o segredo de sessão, e o npm script "smoke" existe', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'scripts', 'smoke-navegador.mjs'), 'utf8');
  assert.doesNotMatch(src, /(console\.log|stdout\.write|passo)\([^)]*(senha|segredoDeSessao)/);
  assert.match(src, /replace\(new RegExp\(senha/, 'a senha é mascarada nas mensagens de erro');
  assert.match(src, /127\.0\.0\.1/);
  assert.doesNotMatch(src, /\.dev\.vars|writeFile\([^)]*senha/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).scripts.smoke, 'node scripts/smoke-navegador.mjs');
});

test('os seletores do teste de fumaça existem na marcação do site (guarda contra mudança de tela sem avisar)', async () => {
  const { SELETORES } = await smoke();
  const admin = fs.readFileSync(path.join(RAIZ, 'core', 'site', 'admin.html'), 'utf8');
  assert.match(admin, /id="senha"/);
  assert.match(admin, /id="form-entrar"/);
  assert.match(admin, /id="mesa"/);
  const index = fs.readFileSync(path.join(RAIZ, 'core', 'site', 'index.html'), 'utf8');
  assert.match(index, /id="conteudo-ficha"/);
  const app = fs.readFileSync(path.join(RAIZ, 'core', 'site', 'app.js'), 'utf8');
  assert.match(app, /criar\('a', 'card'\)/);
  assert.ok(SELETORES.assistente.includes('asst-previa'));
  assert.match(fs.readFileSync(path.join(RAIZ, 'core', 'site', 'mesa-assistente.js'), 'utf8'), /asst-previa/);
});

test('o prazo medido no navegador usa o mesmo limite que o player promete, e os servidores de ensaio travam o segmento', async () => {
  const { LIMITE_DO_PRAZO_MS, CENARIOS, criarServidorDeEnsaio } = await import('../scripts/lib/prazo-player.mjs');
  const Nucleo = require('../core/site/player-core.js');
  assert.equal(LIMITE_DO_PRAZO_MS, Nucleo.LIMITE_FALHA_MS);
  assert.deepEqual([...CENARIOS], ['travado', 'gotejando']);
  const e = criarServidorDeEnsaio({ raizSite: path.join(RAIZ, 'core', 'site'), cenario: 'travado' });
  const porta = await e.ouvir();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${porta}/v/master.m3u8`)).status, 200);
    assert.match(await (await fetch(`http://127.0.0.1:${porta}/v/baixa.m3u8`)).text(), /s0\.ts/);
    assert.equal((await fetch(`http://127.0.0.1:${porta}/player-core.js`)).status, 200);
    const trava = await Promise.race([fetch(`http://127.0.0.1:${porta}/v/s0.ts`).then(() => 'respondeu'), new Promise((r) => setTimeout(() => r('travado'), 400))]);
    assert.equal(trava, 'travado', 'o segmento nunca responde');
  } finally { await e.fechar(); }
});
