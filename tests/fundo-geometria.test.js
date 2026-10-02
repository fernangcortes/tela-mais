/* Geometria REAL do fundo do destaque, num Chromium de verdade (os testes com
 * DOM falso não enxergam layout). Reproduz o bug em que o <img> do poster
 * ocupava a camada inteira e empurrava o <video> irmão para fora do quadro
 * (camada em y=82 com 376 px, vídeo em y=458, cortado por overflow:hidden).
 * Sem Playwright ou sem Chromium instalados, o teste é pulado (ferramenta de
 * desenvolvimento, não dependência do projeto). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'core', 'site');
let chromium = null;
for (const alvo of ['playwright', '/opt/node-tools/node_modules/playwright']) {
  try { chromium = require(alvo).chromium; break; } catch (e) { /* tenta o próximo */ }
}
const ler = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');

test('video-mudo no desktop: poster e <video> ocupam a MESMA área da camada', async (t) => {
  if (!chromium) return t.skip('Playwright indisponível');
  let navegador;
  try { navegador = await chromium.launch(); } catch (e) { return t.skip('Chromium indisponível'); }
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    const css = ['tokens-fixos.css', 'style.css', 'theme.css'].map(ler).join('\n');
    await pagina.route('https://exemplo.test/**', (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
    await pagina.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
      '<main><section class="destaque" id="d"><div class="destaque-capa"></div><div class="destaque-texto"><h1>Título</h1><p>Sinopse</p></div></section></main></body></html>');
    await pagina.addScriptTag({ content: ler('guardiao.js') });
    await pagina.addScriptTag({ content: ler('destaque-fundo.js') });
    const m = await pagina.evaluate(async () => {
      const el = document.getElementById('d');
      const item = { id: 'x', midia: { capa: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', previa: 'https://exemplo.test/p.mp4' } };
      const cfg = { home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 0 } } } };
      const f = window.montarFundoDoDestaque(el, item, cfg);
      if (!f) return { semFundo: true };
      await new Promise((r) => setTimeout(r, 200));
      const camada = el.querySelector('.destaque-fundo');
      const poster = camada.querySelector('img.destaque-fundo-midia');
      const video = camada.querySelector('video.destaque-fundo-midia');
      if (!video) return { semVideo: true };
      const opacidadeInicial = getComputedStyle(camada).opacity;   /* LCP: invisível não é candidato */
      video.style.display = '';   /* como fica quando toca */
      const c = camada.getBoundingClientRect(), p = poster.getBoundingClientRect(), v = video.getBoundingClientRect();
      return { opacidadeInicial, c: [c.top, c.height], p: [p.top, p.height], v: [v.top, v.height] };
    });
    assert.ok(!m.semFundo && !m.semVideo, 'o fundo e o <video> deviam existir: ' + JSON.stringify(m));
    assert.equal(m.opacidadeInicial, '0', 'a camada tem de nascer invisível, senão o poster vira o LCP da home');
    assert.ok(m.c[1] > 100, 'a camada tem altura');
    assert.deepEqual(m.v, m.c, '<video> exatamente sobre a camada: ' + JSON.stringify(m));
    assert.deepEqual(m.p, m.c, 'poster exatamente sobre a camada: ' + JSON.stringify(m));
  } finally { await navegador.close(); }
});
