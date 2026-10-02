#!/usr/bin/env node
/* Mede o LCP da home (padrão e com fundo de vídeo) num Chromium de verdade.
 *
 *   node scripts/medir-lcp.mjs [--rodadas 9]
 *
 * Ferramenta de DESENVOLVIMENTO (não entra no site nem no Worker): precisa do
 * `playwright` e de um Chromium instalados na máquina de quem mede. Serve
 * `core/site` localmente, responde `/api/catalogo` com um catálogo de
 * exemplo, e simula um celular de CPU 4x mais lenta em rede "4G rápido"
 * (1,6 Mbps, 150 ms) e também o desktop sem limite. Imprime a mediana.
 * Orçamento e regressão máxima: docs/player.md, "Orçamento de LCP". */
import http from 'node:http';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'site');
const require = createRequire(import.meta.url);
let chromium;
for (const alvo of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { chromium = require(alvo).chromium; break; } catch { /* próximo */ }
}
if (!chromium) { console.error('playwright não encontrado.'); process.exit(2); }
const rodadas = Number(process.argv[process.argv.indexOf('--rodadas') + 1]) || 9;

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
// Capa de 640x360 gerada na hora (um PNG liso), como as capas reais do R2.
// (o PNG de exemplo do site, com sobra de bytes ao final, que o navegador ignora, para pesar ~80 KB).
const capa = Buffer.concat([fs.readFileSync(path.join(raiz, 'og-image.png')), Buffer.alloc(75 * 1024)]);
// Clipe de verdade (WebM, 640x360, 4 s), gerado com o ffmpeg se houver; sem ele, bytes soltos
// (o <video> falha e o fundo volta à capa: mede só o custo de pedir, não o de tocar).
let clipe = Buffer.alloc(2 * 1024 * 1024);
try {
  const tmp = path.join(os.tmpdir(), 'medir-lcp-clipe.webm');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '4', '-c:v', 'libvpx', '-b:v', '400k', tmp]);
  clipe = fs.readFileSync(tmp);
} catch { console.error('sem ffmpeg: o clipe de teste não é um vídeo válido.'); }
const itens = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, titulo: 'Título ' + id, serie: 'Série X', temporada: 1, episodio: i + 1, duracao_seg: 900, publicar: true, midia: { capa: '/capa-' + id + '.png', previa: '/previa-' + id + '.webm' } }));
const catalogoCom = (comportamento) => JSON.stringify({ rev: 1, itens, site: {}, quem: {}, comportamento });

function servidor(comportamento) {
  const catalogo = catalogoCom(comportamento);
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/api/catalogo') { res.setHeader('content-type', 'application/json'); return res.end(catalogo); }
    if (/^\/capa-/.test(url)) { res.setHeader('content-type', 'image/png'); return res.end(capa); }
    if (/^\/previa-/.test(url)) { res.setHeader('content-type', 'video/webm'); return res.end(clipe); }
    const arq = path.join(raiz, url === '/' ? 'index.html' : url);
    if (!arq.startsWith(raiz) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TIPOS[path.extname(arq)] || 'application/octet-stream');
    res.end(fs.readFileSync(arq));
  });
}

const mediana = (v) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];

async function medir(navegador, porta, perfil) {
  const ctx = await navegador.newContext({ viewport: perfil.viewport, reducedMotion: 'no-preference', hasTouch: perfil.celular, isMobile: perfil.celular });
  const pag = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pag);
  if (perfil.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
  if (perfil.rede) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: perfil.rede.latencia, downloadThroughput: perfil.rede.bps / 8, uploadThroughput: perfil.rede.bps / 8 });
  await pag.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await pag.goto('http://localhost:' + porta + '/', { waitUntil: 'load' });
  await pag.waitForSelector('.destaque', { timeout: 20000 });
  await pag.waitForTimeout(3500);   // passa o atraso do fundo, para ele poder tentar atrapalhar
  const v = await pag.evaluate(() => ({ lcp: window.__lcp, video: document.querySelectorAll('.destaque-fundo video').length, tocando: [...document.querySelectorAll('.destaque-fundo video')].filter((x) => !x.paused).length }));
  await ctx.close();
  return v;
}

const perfis = [
  { nome: 'desktop, sem limite', viewport: { width: 1280, height: 800 }, cpu: 1, celular: false, rede: null },
  { nome: 'desktop, CPU 4x e 4G rápido', viewport: { width: 1280, height: 800 }, cpu: 4, celular: false, rede: { latencia: 150, bps: 1.6e6 } }
];
const cenas = [
  { nome: 'padrão (capa)', config: {} },
  { nome: 'com fundo video-mudo', config: { home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 1200 } } } } }
];

const navegador = await chromium.launch();
const resultado = {};
for (const cena of cenas) {
  const srv = servidor(cena.config);
  await new Promise((r) => srv.listen(0, r));
  for (const perfil of perfis) {
    const lcp = [];
    let videos = 0, tocando = 0;
    for (let i = 0; i < rodadas; i++) { const m = await medir(navegador, srv.address().port, perfil); lcp.push(m.lcp); videos = Math.max(videos, m.video); tocando = Math.max(tocando, m.tocando); }
    resultado[cena.nome + ' | ' + perfil.nome] = { medianaMs: Math.round(mediana(lcp)), min: Math.round(Math.min(...lcp)), max: Math.round(Math.max(...lcp)), videosNoDom: videos, tocando };
  }
  srv.close();
}
await navegador.close();
console.log(JSON.stringify(resultado, null, 2));
