/* Testes do vídeo de fundo do destaque (M6): core/site/destaque-fundo.js.
 *
 * Corre o arquivo de verdade num `vm` com DOM falso (tests/player-dom-falso.js).
 * O que se garante: nada carrega com "reduzir movimento" ou economia de dados;
 * celular desligado por padrão; só toca com o destaque à vista; botão de pausa
 * sempre visível; poster como fallback; sempre mudo; não conta como reprodução;
 * o único play() começa pelo guardião. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { carregar, No, SITE } = require('./player-dom-falso.js');
const lerTexto = (c) => fs.readFileSync(c, 'utf8').split('\r\n').join('\n');

const DESKTOP = () => false;
const CONFIG_VIDEO = { home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 500 } } } };
const ITEM = {
  id: 'dest1',
  midia: { capa: 'https://exemplo.test/capa.jpg', previa: 'https://exemplo.test/previa.mp4', hls: 'https://exemplo.test/principal.m3u8', mp4: { '360p': 'https://exemplo.test/principal.mp4' } }
};

function esvaziar(janela) { while (janela.__correr()) { /* roda tudo o que estiver agendado */ } }

class ObservadorFalso {
  constructor(cb) { this.cb = cb; ObservadorFalso.vivos.push(this); this.desligado = false; }
  observe() {}
  disconnect() { this.desligado = true; }
  ver(sim) { this.cb([{ isIntersecting: sim, intersectionRatio: sim ? 1 : 0 }]); }
}
ObservadorFalso.vivos = [];

function cena(opcoes = {}, config = CONFIG_VIDEO, item = ITEM, extra = {}) {
  ObservadorFalso.vivos = [];
  const mqs = [];
  const amb = carregar(['guardiao.js', 'destaque-fundo.js'], { matchMedia: DESKTOP, ...opcoes });
  amb.janela.IntersectionObserver = ObservadorFalso;
  Object.assign(amb.janela, extra);
  const el = new No('section', amb.doc);
  amb.doc.body.appendChild(el);
  const fundo = amb.janela.montarFundoDoDestaque(el, item, config);
  const videos = () => el.todos().filter((n) => n.tagName === 'VIDEO');
  return { ...amb, el, fundo, videos, mqs, observador: () => ObservadorFalso.vivos[ObservadorFalso.vivos.length - 1] };
}

/* Põe o fundo para tocar: passa o atraso, o vídeo fica pronto e o destaque aparece. */
function tocar(c) {
  esvaziar(c.janela);
  const v = c.videos()[0];
  v.disparar('canplay');
  c.observador().ver(true);
  return v;
}

test('com o tipo "capa" (o padrão) o fundo não monta nada', () => {
  const c = cena({}, {});
  assert.equal(c.fundo, null);
  assert.equal(c.el.children.length, 0);
  assert.equal(cena({}, { home: { destaque: { fundo: { tipo: 'capa' } } } }).fundo, null);
  assert.equal(cena({}, { home: { destaque: { fundo: { tipo: 'imagem' } } } }).fundo, null, 'nome antigo do esquema = capa');
});

test('video-mudo: espera o atraso e o destaque à vista; toca MUDO, uma vez, pelo guardião', () => {
  const c = cena();
  assert.ok(c.fundo);
  assert.equal(c.videos().length, 0, 'antes do atraso não há <video>');
  esvaziar(c.janela);
  const v = c.videos()[0];
  assert.ok(v, 'depois do atraso o <video> existe');
  assert.equal(v.src, 'https://exemplo.test/previa.mp4', 'usa a prévia, nunca a mídia principal');
  assert.equal(v.chamadasDePlay.length, 0, 'sem estar à vista não toca');
  v.disparar('canplay');
  assert.equal(v.chamadasDePlay.length, 0, 'pronto, mas fora da tela');
  c.observador().ver(true);
  assert.equal(v.chamadasDePlay.length, 1);
  assert.equal(v.chamadasDePlay[0].muted, true);
  assert.equal(v.muted, true);
  assert.equal(v.loop, false, 'não repete para sempre');
  assert.equal(v.autoplay, false);
  assert.ok(c.el.classList.contains('destaque-com-fundo'));
  assert.equal(c.fundo.no.getAttribute('aria-hidden'), 'true', 'decorativo');
  /* O poster é a capa. */
  assert.equal(v.poster, 'https://exemplo.test/capa.jpg');
});

test('"reduzir movimento": nada carrega — nem o <video>, nem a URL', () => {
  const c = cena({ matchMedia: (q) => /reduced-motion/.test(q) });
  assert.equal(c.fundo, null);
  esvaziar(c.janela);
  assert.equal(c.videos().length, 0);
  assert.equal(c.el.children.length, 0);
  assert.equal(c.observador(), undefined, 'nem o observador foi criado');
});

test('economia de dados (saveData): nada carrega', () => {
  const c = cena({ saveData: true });
  assert.equal(c.fundo, null);
  esvaziar(c.janela);
  assert.equal(c.videos().length, 0);
  assert.equal(c.el.children.length, 0);
});

test('conexão 2G também conta como economia de dados', () => {
  const c = cena({}, CONFIG_VIDEO, ITEM, { navigator: { connection: { saveData: false, effectiveType: 'slow-2g' } } });
  assert.equal(c.fundo, null);
});

test('celular: desligado por padrão; ligável com somenteDesktop: false', () => {
  const celular = (q) => /max-width|pointer: coarse/.test(q);
  assert.equal(cena({ matchMedia: celular }).fundo, null);
  const liga = { home: { destaque: { fundo: { tipo: 'video-mudo', somenteDesktop: false, atrasoMs: 0 } } } };
  const c = cena({ matchMedia: celular }, liga);
  assert.ok(c.fundo);
  /* Mas "reduzir movimento" continua valendo no celular. */
  assert.equal(cena({ matchMedia: (q) => /max-width|reduced-motion/.test(q) }, liga).fundo, null);
});

test('aba oculta no começo: não monta; sem matchMedia (navegador velho): fecha', () => {
  assert.equal(cena({ visivel: false }).fundo, null);
  const velho = carregar(['guardiao.js', 'destaque-fundo.js'], {});
  velho.janela.matchMedia = undefined;
  velho.janela.IntersectionObserver = ObservadorFalso;
  const el = new No('section', velho.doc);
  assert.equal(velho.janela.montarFundoDoDestaque(el, ITEM, CONFIG_VIDEO), null);
});

test('sem IntersectionObserver nada começa', () => {
  const c = cena({}, CONFIG_VIDEO, ITEM, { IntersectionObserver: undefined });
  esvaziar(c.janela);
  const v = c.videos()[0];
  if (v) { v.disparar('canplay'); assert.equal(v.chamadasDePlay.length, 0); }
});

test('só toca com o destaque à vista: sair da tela e esconder a aba pausam', () => {
  const c = cena();
  const v = tocar(c);
  assert.equal(v.chamadasDePlay.length, 1);
  c.observador().ver(false);
  assert.equal(v.paused, true, 'saiu da tela');
  c.observador().ver(true);
  assert.equal(v.chamadasDePlay.length, 2, 'voltou à tela');
  c.doc.visibilityState = 'hidden';
  c.doc.disparar('visibilitychange');
  assert.equal(v.paused, true, 'aba escondida');
  c.doc.visibilityState = 'visible';
  c.doc.disparar('visibilitychange');
  assert.equal(v.paused, false);
});

test('botão de pausa: sempre visível, rotulado e traduzido, pausa e retoma', () => {
  const c = cena();
  const botao = c.el.querySelector('.destaque-fundo-pausa');
  assert.ok(botao, 'o botão existe desde o começo, antes de o vídeo tocar');
  assert.equal(botao.tagName, 'BUTTON');
  assert.equal(botao.type, 'button');
  assert.equal(botao.hidden, false);
  assert.equal(botao.getAttribute('aria-label'), 'Pausar o vídeo de fundo');
  const v = tocar(c);
  botao.click();
  assert.equal(v.paused, true);
  assert.equal(botao.getAttribute('aria-pressed'), 'true');
  assert.equal(botao.getAttribute('aria-label'), 'Reproduzir o vídeo de fundo');
  c.observador().ver(true);
  assert.equal(v.chamadasDePlay.length, 1, 'pausado pela pessoa não volta sozinho ao reaparecer');
  botao.click();
  assert.equal(v.chamadasDePlay.length, 2);
  assert.equal(botao.getAttribute('aria-pressed'), 'false');
  /* O botão mora no destaque, fora da camada de trás (que não recebe clique). */
  assert.equal(botao.parentNode, c.el);
});

test('"reduzir movimento" ligado no meio da visita: para, volta ao poster e tira o botão', () => {
  let reduzir = false;
  const ouvintes = [];
  const c = cena({ matchMedia: (q) => /reduced-motion/.test(q) && reduzir });
  c.janela.matchMedia = (q) => ({
    get matches() { return /reduced-motion/.test(q) && reduzir; },
    addEventListener: (_t, fn) => { if (/reduced-motion/.test(q)) ouvintes.push(fn); }, removeEventListener() {}
  });
  /* Remonta com o matchMedia que guarda ouvintes. */
  const el2 = new No('section', c.doc);
  const f = c.janela.montarFundoDoDestaque(el2, ITEM, CONFIG_VIDEO);
  assert.ok(f);
  esvaziar(c.janela);
  const v = el2.todos().find((n) => n.tagName === 'VIDEO');
  v.disparar('canplay');
  ObservadorFalso.vivos[ObservadorFalso.vivos.length - 1].ver(true);
  assert.equal(v.chamadasDePlay.length, 1);
  reduzir = true;
  ouvintes.forEach((fn) => fn());
  assert.equal(v.paused, true);
  assert.equal(el2.querySelectorAll('.destaque-fundo-pausa').length, 0);
});

test('depois de N repetições volta ao poster: não é loop infinito', () => {
  const c = cena({}, { home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 0, repeticoes: 2 } } } });
  const v = tocar(c);
  assert.equal(v.chamadasDePlay.length, 1);
  v.paused = false; v.disparar('ended');
  assert.equal(v.chamadasDePlay.length, 2, 'repete uma vez');
  v.disparar('ended');
  assert.equal(v.chamadasDePlay.length, 2, 'e descansa no poster');
  assert.equal(v.style.display, 'none');
});

test('falha de carga volta ao poster e não lança', () => {
  const c = cena();
  esvaziar(c.janela);
  const v = c.videos()[0];
  v.error = { code: 4 };
  v.disparar('error');
  assert.equal(v.style.display, 'none');
  assert.equal(v.chamadasDePlay.length, 0);
});

test('item sem prévia nem clipe: fica a capa. A mídia principal NUNCA vira fundo', () => {
  const soPrincipal = { id: 'x', midia: { capa: 'c', hls: 'https://exemplo.test/a.m3u8', mp4: { '720p': 'https://exemplo.test/a.mp4' } } };
  assert.equal(cena({}, CONFIG_VIDEO, soPrincipal).fundo, null);
  assert.equal(cena({}, CONFIG_VIDEO, { id: 'y' }).fundo, null);
  const c = cena({}, CONFIG_VIDEO, ITEM);
  esvaziar(c.janela);
  assert.ok(!/principal/.test(c.videos()[0].src));
});

test('clipe HLS do adaptador (midia.clipe): usa o hls.js, mudo, e só toca com o vídeo pronto', async () => {
  const item = { id: 'h', midia: { capa: 'c.jpg', clipe: 'https://exemplo.test/clipe/playlist.m3u8' } };
  const chamadas = [];
  class HlsFalso {
    static isSupported() { return true; }
    constructor(cfg) { chamadas.push(['novo', cfg]); }
    on() {}
    loadSource(u) { chamadas.push(['fonte', u]); }
    attachMedia() { chamadas.push(['anexa']); }
    destroy() { chamadas.push(['destroi']); }
  }
  HlsFalso.Events = { ERROR: 'e' };
  const c = cena({}, CONFIG_VIDEO, item, { Hls: HlsFalso });
  esvaziar(c.janela);
  await new Promise((r) => setImmediate(r));
  const v = c.videos()[0];
  assert.deepEqual(chamadas.map((x) => x[0]), ['novo', 'fonte', 'anexa']);
  assert.equal(chamadas[1][1], 'https://exemplo.test/clipe/playlist.m3u8');
  assert.ok(chamadas[0][1].maxBufferLength <= 15, 'buffer curto: é um clipe de fundo');
  v.disparar('canplay');
  c.observador().ver(true);
  assert.equal(v.chamadasDePlay.length, 1);
  assert.equal(v.chamadasDePlay[0].muted, true);
  c.fundo.destruir();
  assert.ok(chamadas.some((x) => x[0] === 'destroi'));
  /* Com usarTrailer: false o clipe fica de fora (cai na prévia, se houver). */
  const sem = cena({}, { home: { destaque: { fundo: { tipo: 'video-mudo', usarTrailer: false } } } }, item);
  assert.equal(sem.fundo, null);
});

test('previa-animada: troca a capa pela imagem animada à vista, e volta à capa; sem <video>', () => {
  const item = { id: 'p', midia: { capa: 'https://exemplo.test/capa.jpg', previa: 'https://exemplo.test/previa.webp' } };
  const cfg = { home: { destaque: { fundo: { tipo: 'previa-animada', atrasoMs: 0 } } } };
  const c = cena({}, cfg, item);
  assert.ok(c.fundo);
  const poster = c.fundo.no.querySelector('.destaque-fundo-midia');
  assert.equal(poster.src, 'https://exemplo.test/capa.jpg');
  esvaziar(c.janela);
  assert.equal(c.videos().length, 0);
  assert.equal(poster.src, 'https://exemplo.test/capa.jpg', 'fora da tela continua a capa');
  c.observador().ver(true);
  assert.equal(poster.src, 'https://exemplo.test/previa.webp');
  c.el.querySelector('.destaque-fundo-pausa').click();
  assert.equal(poster.src, 'https://exemplo.test/capa.jpg', 'pausar devolve a capa (a imagem animada não tem pausa)');
  /* Os mesmos portões. */
  assert.equal(cena({ matchMedia: (q) => /reduced-motion/.test(q) }, cfg, item).fundo, null);
  assert.equal(cena({ saveData: true }, cfg, item).fundo, null);
});

test('destruir tira tudo: camada, botão, observador, ouvintes e o src do vídeo', () => {
  const c = cena();
  const v = tocar(c);
  c.fundo.destruir();
  assert.equal(c.el.children.length, 0);
  assert.equal(c.el.classList.contains('destaque-com-fundo'), false);
  assert.equal(c.observador().desligado, true);
  assert.equal(v.src === '' || v.getAttribute('src') === null, true);
  assert.equal((c.doc.ouvintes.visibilitychange || []).length, 0);
  /* Idempotente. */
  c.fundo.destruir();
});

/* ============================================================ regras estáticas */

test('destaque-fundo.js: um só play(), em tocarFundo, que começa pelo guardião', () => {
  const codigo = lerTexto(path.join(SITE, 'destaque-fundo.js')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((codigo.match(/\.play\s*\(/g) || []).length, 1);
  const corpo = codigo.match(/function tocarFundo\(\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.match(corpo, /^\s*if \(!G\.podeIniciarSozinho\(contextoDoFundo\(\), config\)\) \{ voltarAoPoster\(\); return false; \}/);
  assert.equal((corpo.match(/\.play\s*\(/g) || []).length, 1);
});

test('o fundo é sempre mudo e nunca conta como reprodução', () => {
  const codigo = lerTexto(path.join(SITE, 'destaque-fundo.js')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/muted\s*=\s*false/.test(codigo), 'o fundo nunca liga o som');
  assert.ok(!/\.volume\s*=/.test(codigo) && !/AudioContext/.test(codigo));
  assert.match(codigo, /video\.muted = true/);
  /* Nada de "onde parou", histórico, player ou armazenamento do navegador. */
  for (const proibido of [/gravarOndeParou/, /lembrarOndeParou/, /ONDE_PAROU/, /localStorage/, /sessionStorage/, /AppPlayer\b/, /historico/i, /fetch\(/]) {
    assert.ok(!proibido.test(codigo), 'destaque-fundo.js usa ' + proibido);
  }
  /* A mídia principal fica de fora: só `clipe` e `previa`. */
  assert.ok(!/midia\.hls|midia\.mp4|\.mp4\[/.test(codigo));
  /* Cor só por token (nada literal) e movimento reduzido sem transição. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  const bloco = css.slice(css.indexOf('vídeo de fundo do destaque (M6)'));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(bloco), 'cor literal no CSS do fundo');
  assert.match(bloco, /prefers-reduced-motion: reduce/);
});

test('app.js: o fundo só baixa depois da capa, e não com o tipo "capa"', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const f = app.match(/function ligarFundoDoDestaque\(elDestaque, item\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(f, 'não achei ligarFundoDoDestaque em app.js');
  assert.match(f[1], /fundo\.tipo === 'capa'\) return null/);
  assert.match(f[1], /depoisDaCapaPrincipal\(function \(\) \{\s*carregarFundo\(\)/);
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/destaque-fundo\.js|guardiao\.js/.test(html), 'o fundo não entra no HTML da chegada (LCP)');
});
