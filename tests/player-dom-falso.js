/* DOM falso e pequeno para rodar o player.js e o destaque-fundo.js de verdade,
 * dentro de um `vm`, sem navegador (M6: "teste com vm/DOM falso").
 *
 * Não é um DOM completo: é o que os dois arquivos tocam. Cada elemento guarda
 * seus ouvintes, filhos e atributos; o <video> conta as chamadas de `play()`,
 * que é o que os testes de guardião conferem. */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const SITE = path.join(__dirname, '..', 'core', 'site');

class Lista {
  constructor(no) { this.no = no; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, forca) {
    const quer = forca === undefined ? !this.set.has(c) : !!forca;
    quer ? this.set.add(c) : this.set.delete(c);
    return quer;
  }
  contains(c) { return this.set.has(c); }
}

class No {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.ouvintes = {};
    this.attrs = {};
    this.classList = new Lista(this);
    this.style = { setProperty() {}, removeProperty() {} };
    this.hidden = false;
    this._texto = '';
    this.dataset = {};
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(' '); }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.children.push(c); return c;
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null; return c;
  }
  addEventListener(tipo, fn) { (this.ouvintes[tipo] = this.ouvintes[tipo] || []).push(fn); }
  removeEventListener(tipo, fn) {
    this.ouvintes[tipo] = (this.ouvintes[tipo] || []).filter((f) => f !== fn);
  }
  disparar(tipo, extra) {
    const ev = Object.assign({ type: tipo, target: this, isTrusted: true, preventDefault() {}, stopPropagation() {} }, extra);
    (this.ouvintes[tipo] || []).slice().forEach((f) => f.call(this, ev));
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  contains(c) { for (let x = c; x; x = x.parentNode) if (x === this) return true; return false; }
  todos() { return this.children.flatMap((c) => [c, ...c.todos()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const alvo = sel.replace(/^\./, '');
    return this.todos().filter((n) => (/^[a-z]+$/i.test(alvo) ? n.tagName === alvo.toUpperCase() : n.classList.contains(alvo)));
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.disparar('click'); }
  get offsetWidth() { return 640; }
}

class Video extends No {
  constructor(doc) {
    super('video', doc);
    this.paused = true; this.ended = false; this.muted = false; this.volume = 1;
    this.currentTime = 0; this.duration = NaN; this.playbackRate = 1; this.readyState = 0;
    this.error = null; this.buffered = { length: 0, end() { return 0; } };
    this.chamadasDePlay = [];
    this.src = '';
  }
  play() {
    this.chamadasDePlay.push({ muted: this.muted, t: this.currentTime });
    this.paused = false;
    this.disparar('play');
    return Promise.resolve();
  }
  pause() { if (!this.paused) { this.paused = true; this.disparar('pause'); } }
  load() {}
  canPlayType() { return ''; }
}

/* `opcoes`: matchMedia (consulta -> boolean), saveData, visivel, localStorage (objeto). */
function criarAmbiente(opcoes = {}) {
  const o = Object.assign({ matchMedia: () => false, saveData: false, visivel: true, armazenamento: {} }, opcoes);
  const doc = {
    visibilityState: o.visivel ? 'visible' : 'hidden',
    ouvintes: {}, activeElement: null, readyState: 'complete',
    fullscreenElement: null,
    createElement(tag) { return tag === 'video' ? new Video(doc) : new No(tag, doc); },
    createElementNS(_ns, tag) { return new No(tag, doc); },
    createTextNode(t) { const n = new No('#text', doc); n._texto = t; return n; },
    getElementById() { return null; },
    addEventListener(tipo, fn) { (doc.ouvintes[tipo] = doc.ouvintes[tipo] || []).push(fn); },
    removeEventListener(tipo, fn) { doc.ouvintes[tipo] = (doc.ouvintes[tipo] || []).filter((f) => f !== fn); },
    disparar(tipo, extra) {
      const ev = Object.assign({ type: tipo, isTrusted: true, target: doc.body }, extra);
      (doc.ouvintes[tipo] || []).slice().forEach((f) => f.call(doc, ev));
    }
  };
  doc.body = new No('body', doc);
  doc.head = new No('head', doc);
  doc.documentElement = new No('html', doc);
  const temporizadores = [];
  const guardado = o.armazenamento;
  const janela = {
    document: doc,
    navigator: o.saveData ? { connection: { saveData: true, effectiveType: '4g' } } : { connection: { saveData: false, effectiveType: '4g' } },
    location: { search: o.busca || '', hash: '' },
    localStorage: {
      getItem: (k) => { janela.__leituras.push(k); return k in guardado ? guardado[k] : null; },
      setItem: (k, v) => { guardado[k] = String(v); },
      removeItem: (k) => { delete guardado[k]; }
    },
    matchMedia: (q) => ({ matches: !!o.matchMedia(q), addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    setTimeout: (fn, ms) => { temporizadores.push({ fn, ms }); return temporizadores.length; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (fn) => { fn(); return 0; }, cancelAnimationFrame() {},
    console, Promise, Math, Date, JSON, Number, String, Array, Object, Set, Map, Float32Array, RegExp, Error,
    fetch: () => Promise.reject(new Error('sem rede nos testes')),
    URLSearchParams
  };
  /* A imagem "carrega" no próximo temporizador do teste (e não no do Node). */
  janela.Image = class { set src(v) { this._s = v; janela.setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } };
  /* Globais extras do teste (Hls falso, MediaSource...), antes de qualquer script. */
  Object.assign(janela, o.globais || {});
  janela.parent = janela;
  janela.window = janela;
  janela.globalThis = janela;
  /* Os temporizadores só andam quando o teste manda. */
  janela.__correr = () => { const lote = temporizadores.splice(0); lote.forEach((t) => t.fn()); return lote.length; };
  janela.__armazenamento = guardado;
  janela.__leituras = [];
  return { janela, doc };
}

/* Carrega os arquivos do site, na ordem, dentro de um contexto novo. */
function carregar(arquivos, opcoes = {}) {
  const amb = criarAmbiente(opcoes);
  const ctx = vm.createContext(amb.janela);
  /* Os scripts do site enxergam `AppI18n` e `App` como globais (vêm de i18n.js e do core). */
  /* O core de catálogo usa `AppHome` (home-blocos.js) quando ele existe. */
  const base = ['i18n.js'];
  if (fs.existsSync(path.join(SITE, 'home-blocos.js'))) base.push('home-blocos.js');
  for (const arquivo of [...base, 'catalogo-core.js', ...arquivos]) {
    const codigo = fs.readFileSync(path.join(SITE, arquivo), 'utf8');
    vm.runInContext(codigo, ctx, { filename: arquivo });
  }
  /* Sem `require` dentro do vm, o catálogo pt-BR entra à mão (como o navegador baixa o JSON). */
  const catalogo = JSON.parse(fs.readFileSync(path.join(SITE, '..', 'locales', 'pt-BR.json'), 'utf8'));
  ctx.__catalogo = catalogo;
  vm.runInContext("AppI18n.instancia().definirCatalogo('pt-BR', __catalogo);", ctx);
  vm.runInContext("AppI18n.definirGlobais && AppI18n.definirGlobais({ marca: 'Plataforma Exemplo', marcaCurta: 'Exemplo', organizacao: 'Organização Exemplo' });", ctx);
  return { ...amb, ctx };
}

module.exports = { carregar, criarAmbiente, No, Video, SITE };
