/* Cabeçalhos de segurança, wrangler.jsonc e o que não pode ser servido como
 * arquivo (M2). Sem rede: o Worker roda no Node com KV e ASSETS de mentira. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'core', 'site');
const lerTexto = (c) => fs.readFileSync(c, 'utf8').split('\r\n').join('\n');
const mod = (nome) => import('../core/worker/' + nome);

const ambiente = (extra) => Object.assign({
  ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
  ASSETS: { fetch: async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }) }
}, extra || {});

const pedir = async (caminho, env, opcoes = {}) => {
  const { criarWorker } = await mod('index.js');
  const worker = criarWorker({ obterConfig: async () => ({ acesso: { modo: opcoes.modo || 'privado' } }) });
  return worker.fetch(new Request('https://exemplo.test' + caminho, { method: opcoes.metodo || 'GET' }), env || ambiente(), { waitUntil: () => {} });
};

const EXIGIDOS = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];

test('toda resposta do Worker leva os cabeçalhos de segurança, também as de erro', async () => {
  const casos = [
    ['/', {}], ['/api/catalogo', {}], ['/api/nao-existe', {}], ['/api/contas', { metodo: 'DELETE' }],
    ['/estatico.js', {}], ['/', { modo: 'publico' }]
  ];
  for (const [caminho, opcoes] of casos) {
    const r = await pedir(caminho, ambiente(), opcoes);
    for (const h of EXIGIDOS) assert.ok(r.headers.get(h), caminho + ' sem ' + h);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  /* Handler que estoura: 500 genérico, também com cabeçalhos, sem vazar a causa. */
  const quebrado = ambiente({ CATALOGO: { get: async () => { throw new Error('segredo-interno-xyz'); } } });
  const r = await pedir('/api/catalogo', quebrado, { modo: 'publico' });
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes('segredo-interno-xyz'));
  assert.ok(r.headers.get('content-security-policy'));
});

test('frame-ancestors: a API nunca é enquadrada; as páginas só pela própria origem (modo mesa do /admin)', async () => {
  const api = await pedir('/api/catalogo');
  assert.match(api.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(api.headers.get('x-frame-options'), 'DENY');
  const home = await pedir('/');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('a CSP não afrouxa o que não precisa: sem eval, sem script inline solto, sem curinga', async () => {
  const { politicaDeConteudo } = await mod('_lib/seguranca.js');
  const csp = politicaDeConteudo({}, "'self'");
  const script = csp.split('; ').find(d => d.startsWith('script-src'));
  assert.ok(!/unsafe-eval|unsafe-inline/.test(script), 'script-src afrouxado: ' + script);
  assert.ok(!/ \*( |$)/.test(csp), 'curinga solto na CSP');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  /* O que o site usa de verdade: os hosts vêm do ADAPTADOR (padrão: bunny). */
  assert.match(csp, /media-src[^;]*https:\/\/\*\.b-cdn\.net/);
  assert.match(csp, /frame-src 'self' https:\/\/player\.mediadelivery\.net/);
  assert.match(csp, /connect-src[^;]*https:\/\/video\.bunnycdn\.com/);   /* o envio TUS do /admin */
  assert.match(csp, /worker-src 'self' blob:/);   /* hls.js */
});

test('o hash do script inline da CSP é o do index.html — editar a abertura sem atualizar reprova', async () => {
  const { HASH_SCRIPT_INLINE } = await mod('_lib/seguranca.js');
  const html = lerTexto(path.join(SITE, 'index.html'));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, 'o index.html deveria ter exatamente um <script> inline');
  const hash = 'sha256-' + crypto.createHash('sha256').update(inline[0][1]).digest('base64');
  assert.equal(HASH_SCRIPT_INLINE, hash, 'atualize HASH_SCRIPT_INLINE em core/worker/_lib/seguranca.js (e core/site/_headers) para ' + hash);
  /* O /admin não tem script inline: nada a liberar. */
  assert.ok(!/<script>/.test(lerTexto(path.join(SITE, 'admin.html'))), 'admin.html ganhou script inline: a CSP o bloquearia');
});

test('core/site/_headers é a política NEUTRA do Worker: estáticos não carregam mídia, e nenhum host de provedor mora ali', async () => {
  const { cabecalhosDeSeguranca } = await mod('_lib/seguranca.js');
  const arquivo = lerTexto(path.join(SITE, '_headers'));
  const bloco = arquivo.split('\n').filter(l => /^\s{2}\S/.test(l)).map(l => l.trim());
  const esperado = Object.entries(cabecalhosDeSeguranca({}, { api: false, semProvedor: true })).map(([k, v]) => k + ': ' + v);
  assert.deepEqual(bloco, esperado, 'regenere core/site/_headers com: node scripts/gerar-headers.mjs');
  assert.ok(!/b-cdn|bunnycdn|mediadelivery|cloudflarestream/.test(arquivo), 'host de provedor no _headers estático');
});

test('as páginas que carregam mídia passam pelo Worker, que é quem sabe os hosts do provedor', () => {
  const w = lerJsonc(path.join(RAIZ, 'wrangler.jsonc'));
  for (const rota of ['/', '/index.html', '/admin', '/admin.html']) {
    assert.ok(w.assets.run_worker_first.includes(rota), rota + ' serviria a página com a CSP neutra, sem os hosts do vídeo');
  }
});

test('a CSP segue o provedor da config: trocar `video.provedor` troca os hosts, sem editar código', async () => {
  const { politicaDeConteudo } = await mod('_lib/seguranca.js');
  const bunny = politicaDeConteudo({}, "'self'", { config: { video: { provedor: 'bunny' } } });
  assert.match(bunny, /img-src[^;]*\*\.b-cdn\.net/);
  const outro = politicaDeConteudo({}, "'self'", { config: { video: { provedor: 'cloudflare-stream' } } });
  assert.ok(!/b-cdn|bunnycdn|mediadelivery/.test(outro), 'a CSP de outro provedor ainda libera o Bunny');
  /* Config nula (falha de configuração) cai no padrão, e a política nunca fica sem 'self'. */
  assert.match(politicaDeConteudo({}, "'self'", { config: null }), /default-src 'self'/);
});

test('o host próprio do provedor (pull zone) entra na CSP; valor que não parece host é ignorado', async () => {
  const { politicaDeConteudo } = await mod('_lib/seguranca.js');
  assert.match(politicaDeConteudo({ BUNNY_PULLZONE: 'videos.exemplo.com.br' }, "'self'"), /img-src[^;]*https:\/\/videos\.exemplo\.com\.br/);
  assert.match(politicaDeConteudo({ BUNNY_PULLZONE: 'https://videos.exemplo.com.br/' }, "'self'"), /connect-src[^;]*https:\/\/videos\.exemplo\.com\.br/);
  const ruim = politicaDeConteudo({ BUNNY_PULLZONE: 'x; script-src *' }, "'self'");
  assert.ok(!ruim.includes('script-src *'));
  /* O nome da variável vem da config: {"$env":"MINHA_PULLZONE"}. */
  const cfg = { video: { provedor: 'bunny', bunny: { hostDaPullZone: { $env: 'MINHA_PULLZONE' } } } };
  assert.match(politicaDeConteudo({ MINHA_PULLZONE: 'cdn.exemplo.org' }, "'self'", { config: cfg }), /media-src[^;]*https:\/\/cdn\.exemplo\.org/);
});

test('a API responde no-store', async () => {
  const r = await pedir('/api/login', ambiente(), { metodo: 'POST' });
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

/* ------------------------------------------------------------ wrangler.jsonc */

function lerJsonc(caminho) {
  // Tira comentários de linha e de bloco fora de strings, e vírgula final.
  const t = lerTexto(caminho);
  let saida = ''; let i = 0; let dentro = false;
  while (i < t.length) {
    const c = t[i];
    if (dentro) { saida += c; if (c === '\\') { saida += t[++i]; } else if (c === '"') dentro = false; i++; continue; }
    if (c === '"') { dentro = true; saida += c; i++; continue; }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; continue; }
    saida += c; i++;
  }
  return JSON.parse(saida.replace(/,(\s*[}\]])/g, '$1'));
}

test('wrangler.jsonc: Worker + Static Assets, API e home primeiro no Worker, KV CATALOGO, observabilidade', () => {
  const w = lerJsonc(path.join(RAIZ, 'wrangler.jsonc'));
  assert.equal(w.main, 'core/worker/index.js');
  assert.ok(fs.existsSync(path.join(RAIZ, w.main)));
  assert.equal(w.assets.directory, 'core/site');
  assert.equal(w.assets.binding, 'ASSETS');
  assert.ok(w.assets.run_worker_first.includes('/api/*'), 'a API tem que passar pelo Worker antes dos estáticos');
  assert.ok(w.assets.run_worker_first.includes('/'), 'a home precisa do Worker (injeção + modo de acesso)');
  assert.ok(w.kv_namespaces.some(k => k.binding === 'CATALOGO'));
  assert.equal(w.observability.enabled, true);
  assert.match(w.compatibility_date, /^20\d\d-\d\d-\d\d$/);
  assert.ok(w.compatibility_date >= '2026-01-01', 'compatibility_date velha');
  /* D1, AI e Vectorize são opcionais: só entram quando alguém descomenta. */
  for (const k of ['d1_databases', 'ai', 'vectorize']) assert.ok(!(k in w), k + ' ligado por padrão');
});

test('wrangler.jsonc não carrega segredo nem ID de conta; o código do Worker fica fora dos assets', () => {
  const texto = lerTexto(path.join(RAIZ, 'wrangler.jsonc'));
  assert.ok(!/account_id|api[_-]?key|token|password|secret\s*:/i.test(texto.replace(/\/\/.*$/gm, '')), 'campo suspeito no wrangler.jsonc');
  assert.ok(!/[0-9a-f]{32}/.test(texto), 'ID de recurso no wrangler.jsonc');
  const w = lerJsonc(path.join(RAIZ, 'wrangler.jsonc'));
  const relativo = path.relative(path.join(RAIZ, w.assets.directory), path.join(RAIZ, w.main));
  assert.ok(relativo.startsWith('..'), 'o main do Worker está dentro do diretório de assets: seria servido como arquivo');
  assert.ok(!fs.existsSync(path.join(SITE, 'functions')), 'sobrou core/site/functions');
  /* Nada de módulo do Worker copiado para os assets. */
  for (const nome of fs.readdirSync(SITE)) {
    assert.ok(!/^(middleware|rotas|permissoes|sessao)\.js$/.test(nome), nome + ' em core/site seria público');
  }
});
