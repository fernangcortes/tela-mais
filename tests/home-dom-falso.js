/* DOM falso para rodar o app.js INTEIRO (a chegada, as fileiras, os blocos, a ficha) dentro de um `vm`, sem navegador.
 *
 * Não é um DOM completo: é o que o app.js toca. O que importa para estes testes é que a árvore seja de verdade (filhos,
 * classes, atributos, textContent, seletores simples) para o teste olhar o que foi desenhado, e que o `<video>` conte as
 * chamadas de `play()` — a chegada por blocos NUNCA pode produzir uma. `fetch` é um roteador de mentira: o teste diz o
 * que cada endereço responde (o catálogo, a lista da pessoa...) e vê o que foi pedido. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = path.join(__dirname, '..', 'core', 'site');

class Classes {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, forca) { const q = forca === undefined ? !this.set.has(c) : !!forca; q ? this.set.add(c) : this.set.delete(c); return q; }
  contains(c) { return this.set.has(c); }
}

/* Seletor simples: lista separada por vírgula de `tag`, `.classe`, `#id`, `[attr]`, `[attr="valor"]`, `[attr^="valor"]`,
 * combináveis (a.card.novo[href]). Sem descendentes nem filhos diretos. */
function casa(no, seletor) {
  return String(seletor).split(',').some((parte) => {
    const s = parte.trim();
    if (!s) return false;
    const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([\^$*]?=)"([^"]*)")?\]/g;
    let m;
    let algum = false;
    while ((m = re.exec(s))) {
      algum = true;
      if (m[1] && no.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && !no.classList.contains(m[2])) return false;
      if (m[3] && no.id !== m[3]) return false;
      if (m[4]) {
        if (!no.hasAttribute(m[4])) return false;
        const v = no.getAttribute(m[4]);
        if (m[5] === '=' && v !== m[6]) return false;
        if (m[5] === '^=' && !v.startsWith(m[6])) return false;
        if (m[5] === '$=' && !v.endsWith(m[6])) return false;
        if (m[5] === '*=' && !v.includes(m[6])) return false;
      }
    }
    return algum;
  });
}

class No {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.ouvintes = {};
    this.attrs = {};
    this.classList = new Classes();
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.hidden = false;
    this.id = '';
    this._texto = '';
    this.scrollLeft = 0; this.scrollWidth = 0; this.clientWidth = 0;
    this.value = '';
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(' '); }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set href(v) { this.attrs.href = String(v); }
  get href() { return this.attrs.href || ''; }
  set src(v) { this.attrs.src = String(v); }
  get src() { return this.attrs.src || ''; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  replaceChild(novo, velho) { const i = this.children.indexOf(velho); if (i < 0) return velho; if (novo.parentNode) novo.parentNode.removeChild(novo); this.children[this.children.indexOf(velho)] = novo; novo.parentNode = this; velho.parentNode = null; return velho; }
  replaceChildren(...c) { this.children.forEach((x) => { x.parentNode = null; }); this.children = []; c.forEach((x) => this.appendChild(x)); }
  append(...c) { c.forEach((x) => this.appendChild(x)); }
  addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
  removeEventListener(t, f) { this.ouvintes[t] = (this.ouvintes[t] || []).filter((x) => x !== f); }
  disparar(tipo, extra) {
    let parou = false;
    const ev = Object.assign({ type: tipo, target: this, currentTarget: this, isTrusted: true, button: 0, preventDefault() { ev.padraoEvitado = true; }, stopPropagation() { parou = true; } }, extra);
    /* Sobe pela árvore, como no navegador (menos nos eventos que não sobem). */
    const sobe = !['focus', 'blur', 'mouseenter', 'mouseleave', 'scroll', 'load', 'error'].includes(tipo);
    for (let no = this; no && !parou; no = sobe ? no.parentNode : null) {
      ev.currentTarget = no;
      (no.ouvintes[tipo] || []).slice().forEach((f) => f.call(no, ev));
    }
    return ev;
  }
  click() { return this.disparar('click'); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  contains(c) { for (let x = c; x; x = x.parentNode) if (x === this) return true; return false; }
  todos() { return this.children.flatMap((c) => [c, ...c.todos()]); }
  querySelectorAll(sel) { return this.todos().filter((n) => casa(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let x = this; x; x = x.parentNode) if (x.tagName && casa(x, sel)) return x; return null; }
  matches(sel) { return casa(this, sel); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {}
  scrollIntoView() {}
  scrollTo() {}
  getElementsByTagName(t) { return this.querySelectorAll(t); }
}

/* Propriedades que o navegador espelha em atributos: o app.js escreve `a.rel = ...` e o teste lê com getAttribute. */
['rel', 'type', 'placeholder', 'autocomplete', 'loading', 'decoding', 'title', 'alt', 'width', 'height', 'target', 'name', 'role'].forEach((p) => {
  Object.defineProperty(No.prototype, p, {
    get() { return p in this.attrs ? this.attrs[p] : (p === 'type' ? '' : undefined); },
    set(v) { this.attrs[p] = String(v); },
    configurable: true
  });
});

class Video extends No {
  constructor(doc) {
    super('video', doc);
    this.paused = true; this.muted = false; this.currentTime = 0; this.chamadasDePlay = [];
  }
  play() { this.chamadasDePlay.push({ muted: this.muted }); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  canPlayType() { return ''; }
}

const IDS_DA_PAGINA = ['topo', 'topo-sentinela', 'pular', 'conteudo', 'busca', 'busca-abrir', 'busca-fechar', 'avisos',
  'conteudo-grade', 'conteudo-ficha', 'idioma-caixa', 'idioma', 'rodape-conta', 'rodape-conta-ponto', 'rodape', 'abertura'];

/* `opcoes`: { rotas: { '/api/catalogo': corpo | (url, init) => corpo }, hash, search, armazenamento, antes(janela) }. */
function criarSite(opcoes = {}) {
  const o = Object.assign({ rotas: {}, hash: '', search: '', armazenamento: {} }, opcoes);
  const doc = {
    readyState: 'complete', ouvintes: {}, activeElement: null, title: '', visibilityState: 'visible', fullscreenElement: null,
    createElement(tag) { return tag === 'video' ? new Video(doc) : new No(tag, doc); },
    createElementNS(_ns, tag) { return new No(tag, doc); },
    createTextNode(t) { const n = new No('#text', doc); n._texto = t; return n; },
    addEventListener(t, f) { (doc.ouvintes[t] = doc.ouvintes[t] || []).push(f); },
    removeEventListener(t, f) { doc.ouvintes[t] = (doc.ouvintes[t] || []).filter((x) => x !== f); },
    hasFocus: () => true
  };
  doc.body = new No('body', doc);
  doc.head = new No('head', doc);
  doc.documentElement = new No('html', doc);
  const porId = {};
  doc.getElementById = (id) => porId[id] || null;
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  for (const id of IDS_DA_PAGINA) {
    const no = new No(id === 'busca' ? 'input' : id === 'idioma' ? 'select' : 'div', doc);
    no.id = id; no.attrs.id = id; porId[id] = no;
    doc.body.appendChild(no);
  }
  /* Os dois links do cabeçalho que o app.js procura por seletor. */
  const inicio = new No('a', doc); inicio.className = 'topo-link'; inicio.attrs['data-inicio'] = ''; inicio.attrs.href = '#/';
  const series = new No('a', doc); series.className = 'topo-link'; series.attrs.href = '#/series';
  porId.topo.appendChild(inicio); porId.topo.appendChild(series);

  const pedidos = [];
  const temporizadores = [];
  const guardado = o.armazenamento;
  const janela = {
    document: doc, parent: null, innerWidth: 1400, innerHeight: 900, isSecureContext: true,
    navigator: { languages: ['pt-BR'], language: 'pt-BR', connection: { saveData: false } },
    location: { hash: o.hash, search: o.search, origin: 'https://exemplo.test', pathname: '/', reload() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = String(v); }, removeItem: (k) => { delete guardado[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener(t, f) { (janela.ouvintes[t] = janela.ouvintes[t] || []).push(f); },
    removeEventListener() {},
    ouvintes: {},
    setTimeout: (fn, ms) => { temporizadores.push({ fn, ms }); return temporizadores.length; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { temporizadores.push({ fn, ms: 0 }); return 0; }, cancelAnimationFrame() {},
    requestIdleCallback: (fn) => { temporizadores.push({ fn, ms: 0 }); return 0; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    scrollTo() {}, scrollBy() {}, performance: { now: () => 0 },
    console, Promise, Math, Date, JSON, Number, String, Array, Object, Set, Map, RegExp, Error, URLSearchParams, URL, Intl, encodeURIComponent, decodeURIComponent,
    Image: class { set src(v) { this._s = v; } get src() { return this._s; } },
    CSS: { escape: (x) => x },
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, d) { this.type = t; this.detail = d && d.detail; } }
  };
  janela.parent = janela;
  janela.window = janela;
  if (typeof o.antes === 'function') o.antes(janela);
  janela.globalThis = janela;
  doc.defaultView = janela;
  /* O roteador: as rotas de base (config pública e textos, lidos do disco) e as do teste por cima. */
  const locale = (id) => JSON.parse(fs.readFileSync(path.join(SITE, 'locales', id + '.json'), 'utf8'));
  const rotas = Object.assign({
    '/config.public.json': () => JSON.parse(fs.readFileSync(path.join(SITE, 'config.public.json'), 'utf8')),
    '/locales/pt-BR.json': () => locale('pt-BR'),
    '/locales/en.json': () => locale('en')
  }, o.rotas);
  janela.fetch = async (url, init) => {
    const u = String(url);
    pedidos.push({ url: u, metodo: (init && init.method) || 'GET', corpo: init && init.body });
    const limpo = u.split('?')[0].replace(/^\//, '');
    const chave = Object.keys(rotas).find((k) => limpo.endsWith(k.replace(/^\//, '')));
    let r = chave ? rotas[chave] : null;
    if (typeof r === 'function') r = await r(u, init || {});
    if (r === null || r === undefined) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  janela.Response = Response;
  janela.Headers = Headers;
  janela.__pedidos = pedidos;
  janela.__correr = () => { const lote = temporizadores.splice(0); lote.forEach((t) => t.fn()); return lote.length; };
  return { janela, doc, pedidos, porId };
}

/* Carrega os scripts do site, na ordem do index.html, e espera a primeira tela. */
async function abrirSite(opcoes = {}) {
  const amb = criarSite(opcoes);
  const ctx = vm.createContext(amb.janela);
  for (const arquivo of ['i18n.js', 'home-blocos.js', 'catalogo-core.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(SITE, arquivo), 'utf8'), ctx, { filename: arquivo });
  }
  /* Deixa as promessas e os temporizadores andarem até a tela parar de mudar. */
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setImmediate(r));
    amb.janela.__correr();
  }
  return Object.assign(amb, { ctx });
}

const texto = (no) => no.textContent;
const achar = (no, sel) => no.querySelectorAll(sel);

module.exports = { abrirSite, criarSite, No, Video, SITE, texto, achar };
