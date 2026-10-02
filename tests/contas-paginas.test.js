/* O JavaScript das páginas do espectador (core/site/acesso.js) rodando de verdade, num DOM de
 * mentira (sem jsdom: o projeto não tem dependências) e com `fetch` roteado para respostas
 * combinadas. Confere o que o navegador faria: o fluxo de entrar, do link, do cadastro, da conta e
 * dos textos legais, e que nada é gasto sem o clique da pessoa. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = path.join(__dirname, '..', 'core', 'site');
const lerSite = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');

class No {
  constructor(tag, attrs) {
    this.tag = tag; this.attrs = Object.assign({}, attrs || {}); this.children = []; this._texto = '';
    this.hidden = 'hidden' in this.attrs; this.value = ''; this.checked = false; this.disabled = false;
    this.className = this.attrs.class || ''; this.ouvintes = {}; this.style = {}; this.href = ''; this.focado = false;
  }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._texto; }
  set textContent(v) { this.children = []; this._texto = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  addEventListener(t, f) { (this.ouvintes[t] = this.ouvintes[t] || []).push(f); }
  focus() { this.focado = true; }
  click() { return this.disparar('click'); }
  async disparar(tipo) {
    const ev = { preventDefault() { this.padrao = true; }, target: this };
    for (const f of this.ouvintes[tipo] || []) await f(ev);
    if (typeof this['on' + tipo] === 'function') await this['on' + tipo](ev);
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    return ev;
  }
}

/* Lê o HTML da página e cria um nó por tag com id. */
function montarPagina(arquivo, { hash = '', search = '', respostas = {} } = {}) {
  const html = lerSite(arquivo);
  const nos = {};
  for (const m of html.matchAll(/<([a-z0-9]+)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    if (attrs.id) nos[attrs.id] = new No(m[1], attrs);
  }
  const corpo = html.match(/<body\b([^>]*)>/)[1];
  const bodyAttrs = {};
  for (const a of corpo.matchAll(/([\w-]+)="([^"]*)"/g)) bodyAttrs[a[1]] = a[2];
  const body = new No('body', bodyAttrs);
  const scripts = [];
  const head = new No('head');
  head.appendChild = (c) => { scripts.push(c); return c; };
  const trocas = [];
  const documento = {
    getElementById: (id) => nos[id] || null,
    createElement: (tag) => new No(tag),
    createTextNode: (t) => ({ textContent: t }),
    querySelectorAll: () => [],
    body, head, documentElement: { lang: '' }, title: ''
  };
  const chamadas = [];
  const fetch = async (url, init) => {
    const caminho = String(url).replace(/^https?:\/\/[^/]+/, '');
    const metodo = (init && init.method) || 'GET';
    const corpoEnviado = init && init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, caminho, corpo: corpoEnviado });
    const resp = respostas[metodo + ' ' + caminho] || respostas[caminho];
    if (resp === undefined) {
      if (/\.json$/.test(caminho)) {
        const arq = caminho.replace(/^\//, '');
        return { ok: true, status: 200, json: async () => JSON.parse(lerSite(arq)) };
      }
      throw new Error('fetch sem resposta combinada: ' + metodo + ' ' + caminho);
    }
    const r = typeof resp === 'function' ? resp(corpoEnviado) : resp;
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo || {} };
  };
  const sandbox = {
    document: documento, fetch, URL, URLSearchParams, Blob, setTimeout, clearTimeout, console, Intl, Date, JSON, Promise, Math,
    navigator: { languages: ['pt-BR'], language: 'pt-BR' },
    history: { replaceState(a, b, url) { sandbox.location.hash = ''; trocas.push(['replaceState', url]); } },
    location: { search, hash, pathname: '/' + arquivo, replace: (u) => trocas.push(['replace', u]), reload: () => trocas.push(['reload']), href: 'https://exemplo.test/' + arquivo },
    localStorage: { getItem: () => null, setItem() {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(lerSite('i18n.js'), sandbox);
  return { nos, chamadas, trocas, scripts, sandbox, executar: async () => { vm.runInContext(lerSite('acesso.js'), sandbox); for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); } };
}

const ESTADO = (extra) => ({ status: 200, corpo: Object.assign({ modo: 'privado', contas: true, metodo: 'link-magico', cadastroAberto: false, emailAtivo: true, senha: false, senhaNoCadastro: false, turnstile: { siteKey: '' }, versoes: { privacidade: 1, termos: 1 }, sessao: { papel: 'anonimo' } }, extra || {}) });

test('entrar: pede o link (anti-enumeração na tela: a mesma frase sempre) e mostra só o que o modo permite', async () => {
  const p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO(), 'POST /api/auth/entrar': { status: 200, corpo: { ok: true } } } });
  await p.executar();
  assert.equal(p.nos['form-entrar'].hidden, false);
  assert.equal(p.nos['form-senha'].hidden, true);
  assert.equal(p.nos['bloco-cadastro'].hidden, true);
  assert.equal(p.nos['bloco-sem-email'].hidden, true);
  assert.equal(p.nos.carregando.hidden, true);
  assert.match(p.sandbox.document.title, /Entrar/);
  p.nos.email.value = 'ana@exemplo.com';
  const ev = await p.nos['form-entrar'].disparar('submit');
  assert.equal(ev.padrao, true, 'o formulário não recarrega a página');
  const envio = p.chamadas.find((c) => c.caminho === '/api/auth/entrar');
  assert.deepEqual(envio.corpo, { email: 'ana@exemplo.com' });
  assert.match(p.nos['entrar-estado'].textContent, /Se este e-mail puder entrar/);
});

test('entrar sem adaptador de e-mail: explica que o link vem do administrador e não mostra o formulário de link', async () => {
  const p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO({ emailAtivo: false }) } });
  await p.executar();
  assert.equal(p.nos['form-entrar'].hidden, true);
  assert.equal(p.nos['bloco-sem-email'].hidden, false);
});

test('entrar nos outros estados: público, já dentro, banco ausente, cadastro aberto, senha', async () => {
  let p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO({ modo: 'publico', contas: false }) } });
  await p.executar();
  assert.equal(p.nos['bloco-publico'].hidden, false);
  assert.equal(p.nos['form-entrar'].hidden, true);

  p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO({ sessao: { papel: 'espectador' } }), 'POST /api/auth/sair': { status: 200, corpo: { ok: true } } } });
  await p.executar();
  assert.equal(p.nos['bloco-dentro'].hidden, false);
  await p.nos['sair-botao'].click();
  assert.ok(p.chamadas.some((c) => c.caminho === '/api/auth/sair'));

  p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO({ contas: false }) } });
  await p.executar();
  assert.equal(p.nos['bloco-indisponivel'].hidden, false);

  p = montarPagina('entrar.html', { respostas: { '/api/auth/estado': ESTADO({ modo: 'cadastro', cadastroAberto: true, senha: true, metodo: 'email-e-senha' }) } });
  await p.executar();
  assert.equal(p.nos['bloco-cadastro'].hidden, false);
  assert.equal(p.nos['form-senha'].hidden, false);
  assert.equal(p.nos['form-entrar'].hidden, false);
});

test('o link do e-mail: o token sai da barra, abrir a página não gasta nada, o POST só sai no clique', async () => {
  const p = montarPagina('entrar.html', {
    hash: '#t=ml_' + 'a'.repeat(43), search: '?voltar=%2Findex.html%23%2Fserie%2Fx',
    respostas: { '/api/auth/estado': ESTADO(), 'POST /api/auth/link': { status: 200, corpo: { ok: true } } }
  });
  await p.executar();
  assert.equal(p.nos['form-confirmar'].hidden, false);
  assert.equal(p.nos['form-entrar'].hidden, true, 'no modo confirmar não se pede outro link');
  assert.ok(p.trocas.some((t) => t[0] === 'replaceState'), 'o token saiu da barra de endereço');
  assert.ok(!p.chamadas.some((c) => /auth\/(link|convite)/.test(c.caminho)), 'abrir a página não gastou o link');
  await p.nos['form-confirmar'].disparar('submit');
  const envio = p.chamadas.find((c) => c.caminho === '/api/auth/link');
  assert.deepEqual(envio.corpo, { token: 'ml_' + 'a'.repeat(43) }, 'link mágico: sem aceite de saída; o servidor pede se faltar');
  const troca = p.trocas.find((t) => t[0] === 'replace');
  assert.equal(troca[1], '/index.html#/serie/x', 'volta para onde a pessoa estava');
});

test('"voltar" de outro site é ignorado (nada de redirecionamento aberto)', async () => {
  for (const voltar of ['https://atacante.example/', '//atacante.example', 'javascript:alert(1)', '\\\\atacante']) {
    const p = montarPagina('entrar.html', {
      hash: '#t=ml_' + 'b'.repeat(43), search: '?voltar=' + encodeURIComponent(voltar),
      respostas: { '/api/auth/estado': ESTADO(), 'POST /api/auth/link': { status: 200, corpo: { ok: true } } }
    });
    await p.executar();
    await p.nos['form-confirmar'].disparar('submit');
    assert.equal(p.trocas.find((t) => t[0] === 'replace')[1], 'index.html', voltar);
  }
});

test('convite: mostra o aceite desde o início e só envia com a caixa marcada, com as versões vistas', async () => {
  const p = montarPagina('entrar.html', {
    hash: '#t=cv_' + 'c'.repeat(43),
    respostas: { '/api/auth/estado': ESTADO({ versoes: { privacidade: 3, termos: 2 } }), 'POST /api/auth/convite': { status: 200, corpo: { ok: true } } }
  });
  await p.executar();
  assert.equal(p.nos['bloco-aceite'].hidden, false);
  assert.match(p.nos['aceite-rotulo'].textContent, /^Li e aceito os Termos de uso e a Política de privacidade\.$/);
  await p.nos['form-confirmar'].disparar('submit');
  assert.ok(!p.chamadas.some((c) => c.caminho === '/api/auth/convite'), 'sem aceite, nada é enviado');
  assert.match(p.nos['confirmar-estado'].textContent, /Marque a caixa/);
  p.nos.aceite.checked = true;
  await p.nos['form-confirmar'].disparar('submit');
  const envio = p.chamadas.find((c) => c.caminho === '/api/auth/convite');
  assert.deepEqual(envio.corpo, { token: 'cv_' + 'c'.repeat(43), aceite: true, versoes: { privacidade: 3, termos: 2 } });
});

test('link com texto novo a aceitar e com senha a definir: a página reage ao 409 sem gastar o link', async () => {
  let n = 0;
  const p = montarPagina('entrar.html', {
    hash: '#t=ml_' + 'd'.repeat(43),
    respostas: {
      '/api/auth/estado': ESTADO({ modo: 'cadastro' }),
      'POST /api/auth/link': (corpo) => {
        n++;
        if (!corpo.aceite) return { status: 409, corpo: { codigo: 'consentimento-necessario', versoes: { privacidade: 2, termos: 1 } } };
        if (!corpo.senha) return { status: 409, corpo: { codigo: 'senha-necessaria', params: { minimo: 12 } } };
        return { status: 200, corpo: { ok: true } };
      }
    }
  });
  await p.executar();
  assert.equal(p.nos['bloco-aceite'].hidden, true);
  await p.nos['form-confirmar'].disparar('submit');
  assert.equal(p.nos['bloco-aceite'].hidden, false, 'o 409 abre a caixa de aceite');
  assert.match(p.nos['confirmar-estado'].textContent, /Aceite a política de privacidade/);
  p.nos.aceite.checked = true;
  await p.nos['form-confirmar'].disparar('submit');
  assert.equal(p.nos['bloco-nova-senha'].hidden, false, 'o 409 abre o campo de senha');
  assert.match(p.nos['nova-senha-dica'].textContent, /12 caracteres/);
  p.nos['nova-senha'].value = 'a-senha-do-dono-do-email';
  await p.nos['form-confirmar'].disparar('submit');
  const ultimo = p.chamadas.filter((c) => c.caminho === '/api/auth/link').pop();
  assert.deepEqual(ultimo.corpo, { token: 'ml_' + 'd'.repeat(43), aceite: true, versoes: { privacidade: 2, termos: 1 }, senha: 'a-senha-do-dono-do-email' });
  assert.ok(p.trocas.some((t) => t[0] === 'replace'));
  assert.equal(n, 3);
});

test('cadastro: exige o aceite e o desafio anti-robô antes de enviar; o resultado é a mesma frase', async () => {
  const p = montarPagina('cadastro.html', {
    respostas: { '/api/auth/estado': ESTADO({ modo: 'cadastro', cadastroAberto: true, turnstile: { siteKey: '0x4AAAAAAAteste' } }), 'POST /api/auth/cadastro': { status: 200, corpo: { ok: true } } }
  });
  await p.executar();
  assert.equal(p.nos['form-cadastro'].hidden, false);
  assert.equal(p.nos.turnstile.hidden, false);
  assert.ok(p.scripts.some((s) => /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/.test(s.src)), 'o script do Turnstile é pedido');
  /* O widget chama de volta com o token. */
  let callback = null;
  p.sandbox.turnstile = { render: (el, o) => { callback = o.callback; return 'w1'; }, reset() { callback = callback; } };
  p.sandbox.__tmTurnstilePronto();
  p.nos.email.value = 'nova@exemplo.com';
  await p.nos['form-cadastro'].disparar('submit');
  assert.match(p.nos['cadastro-estado'].textContent, /Marque a caixa/);
  p.nos.aceite.checked = true;
  await p.nos['form-cadastro'].disparar('submit');
  assert.match(p.nos['cadastro-estado'].textContent, /verificação anti-robô/, 'sem o desafio resolvido, não envia');
  assert.ok(!p.chamadas.some((c) => c.caminho === '/api/auth/cadastro'));
  callback('token-do-widget-123');
  await p.nos['form-cadastro'].disparar('submit');
  const envio = p.chamadas.find((c) => c.caminho === '/api/auth/cadastro');
  assert.deepEqual(envio.corpo, { email: 'nova@exemplo.com', nome: '', aceite: true, versoes: { privacidade: 1, termos: 1 }, turnstile: 'token-do-widget-123' });
  assert.equal(p.nos['form-cadastro'].hidden, true);
  assert.equal(p.nos['bloco-feito'].hidden, false);
  assert.match(p.nos['cadastro-feito'].textContent, /Se o e-mail puder ser usado/);
});

test('cadastro fechado (sem Turnstile no servidor, ou fora do modo cadastro): só o aviso, sem formulário', async () => {
  for (const extra of [{ modo: 'cadastro', cadastroAberto: false }, { modo: 'privado', cadastroAberto: false }]) {
    const p = montarPagina('cadastro.html', { respostas: { '/api/auth/estado': ESTADO(extra) } });
    await p.executar();
    assert.equal(p.nos['bloco-fechado'].hidden, false);
    assert.equal(p.nos['form-cadastro'].hidden, true);
  }
});

test('Minha conta: mostra os dados, aceita a nova versão, exporta e exclui com confirmação do e-mail', async () => {
  const eu = { papel: 'espectador', email: 'ana@exemplo.com', nome: 'Ana', status: 'ativo', criadoEm: 1790000000,
    consentimentos: [{ tipo: 'termos', versao: 1, aceitoEm: 1790000100 }], pendentes: ['privacidade'], versoes: { privacidade: 2, termos: 1 }, sessoesAtivas: 2 };
  const p = montarPagina('conta.html', {
    respostas: {
      'GET /api/conta/eu': { status: 200, corpo: eu },
      'PUT /api/conta/eu': { status: 200, corpo: { ok: true } },
      'GET /api/conta/exportar': { status: 200, corpo: { conta: { email: 'ana@exemplo.com' } } },
      'POST /api/conta/excluir': (c) => (c.email === 'ana@exemplo.com' ? { status: 200, corpo: { ok: true } } : { status: 400, corpo: { codigo: 'confirmacao-invalida' } }),
      'POST /api/auth/sair': { status: 200, corpo: { ok: true } }
    }
  });
  p.sandbox.URL = Object.assign(function () {}, URL, { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  await p.executar();
  assert.equal(p.nos['conta-tudo'].hidden, false);
  assert.equal(p.nos['dado-email'].textContent, 'ana@exemplo.com');
  assert.equal(p.nos.nome.value, 'Ana');
  assert.match(p.nos['sessoes-n'].textContent, /2 sessões ativas/);
  assert.equal(p.nos['bloco-pendente'].hidden, false, 'texto novo a aceitar');
  assert.equal(p.nos['textos-lista'].children.length, 1);
  await p.nos['pendente-botao'].click();
  assert.deepEqual(p.chamadas.find((c) => c.metodo === 'PUT').corpo, { aceite: true, versoes: { privacidade: 2, termos: 1 } });

  p.nos.nome.value = 'Ana Maria';
  await p.nos['form-nome'].disparar('submit');
  assert.match(p.nos['nome-estado'].textContent, /Salvo/);

  await p.nos['sair-todos-botao'].click();
  assert.deepEqual(p.chamadas.filter((c) => c.caminho === '/api/auth/sair').pop().corpo, { todas: true });

  p.nos['excluir-email'].value = 'outro@exemplo.com';
  await p.nos['form-excluir'].disparar('submit');
  assert.match(p.nos['excluir-estado'].textContent, /confirmação não confere/);
  assert.equal(p.nos['conta-tudo'].hidden, false);
  p.nos['excluir-email'].value = 'ana@exemplo.com';
  await p.nos['form-excluir'].disparar('submit');
  assert.equal(p.nos['conta-tudo'].hidden, true);
  assert.equal(p.nos['bloco-excluida'].hidden, false);
  assert.match(p.nos['excluida-aviso'].textContent, /Conta excluída/);
});

test('Minha conta sem sessão manda para a entrada; conta de equipe vê o aviso da mesa', async () => {
  let p = montarPagina('conta.html', { respostas: { 'GET /api/conta/eu': { status: 401, corpo: { codigo: 'nao-autorizado' } } } });
  await p.executar();
  assert.equal(p.trocas.find((t) => t[0] === 'replace')[1], 'entrar.html?voltar=conta.html');
  p = montarPagina('conta.html', { respostas: { 'GET /api/conta/eu': { status: 200, corpo: { papel: 'equipe', usuario: 'maria' } } } });
  await p.executar();
  assert.equal(p.nos['bloco-equipe'].hidden, false);
  assert.equal(p.nos['conta-tudo'].hidden, true);
});

test('privacidade e termos: o modelo preenchido com os campos do cliente, ou o texto próprio dele', async () => {
  const doc = (campos, textos) => ({ status: 200, corpo: { documentos: { privacidade: { versao: 3, campos, textos }, termos: { versao: 1, campos: {}, textos: {} } }, padroes: { controlador: 'Organização Exemplo' } } });
  let p = montarPagina('privacidade.html', { respostas: { '/api/legal': doc({ controlador: 'Escola Exemplo Ltda', contato: 'privacidade@escola.example' }, {}) } });
  await p.executar();
  const texto = p.nos['legal-corpo'].textContent;
  assert.match(texto, /Escola Exemplo Ltda é o controlador dos dados pessoais/);
  assert.match(texto, /privacidade@escola\.example/);
  assert.equal(p.nos['legal-corpo'].children.length, 18, '9 seções, título e parágrafo');
  assert.ok(!/\{controlador\}|\{contato\}|\{retencao\}/.test(texto), 'nenhum buraco sem preencher');
  assert.match(texto, /enquanto a sua conta existir/, 'retenção padrão');
  assert.equal(p.nos['legal-versao'].textContent, 'Versão 3');

  p = montarPagina('privacidade.html', { respostas: { '/api/legal': doc({}, { 'pt-BR': 'Meu texto.\n\nSegundo parágrafo.' }) } });
  await p.executar();
  assert.equal(p.nos['legal-corpo'].children.length, 2);
  assert.equal(p.nos['legal-corpo'].textContent, 'Meu texto.Segundo parágrafo.');

  /* Sem a API (rede), o modelo aparece do mesmo jeito. */
  p = montarPagina('termos.html', { respostas: { '/api/legal': { status: 500, corpo: {} } } });
  await p.executar();
  assert.equal(p.nos['legal-corpo'].children.length, 14, '7 seções do modelo de termos');
  assert.match(p.nos['legal-corpo'].textContent, /Organização Exemplo|o canal de contato informado/);
});

/* ------------------------------------------------------- a tela Acesso da mesa */

function montarMesa(respostasApi) {
  const nos = {};
  const clicks = [];
  const documento = {
    createElement: (tag) => { const n = new No(tag); n.closest = function (sel) { return /acesso-/.test(sel) && /^acesso-/.test(this.attrs['data-acao'] || '') ? this : null; }; return n; },
    createTextNode: (t) => ({ textContent: t }),
    getElementById: (id) => nos[id] || null,
    querySelectorAll: () => Object.values(nos).filter((n) => n.tag === 'textarea'),
    addEventListener: (t, f) => { if (t === 'click') clicks.push(f); },
    body: new No('body')
  };
  const sandbox = { document: documento, console, Intl, Date, JSON, Promise, Math, Object, Array, String, Number, Error, navigator: {}, window: null };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(lerSite('i18n.js'), sandbox);
  const I18n = sandbox.AppI18n;
  I18n.iniciar({ idioma: 'pt-BR', padrao: 'pt-BR', catalogos: { 'pt-BR': JSON.parse(fs.readFileSync(path.join(SITE, 'locales', 'pt-BR.json'), 'utf8')) } });
  const chamadas = [];
  const toasts = [];
  let redesenhos = 0;
  function h(tag, props) {
    const el = documento.createElement(tag);
    if (props) Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
      if (k === 'id') nos[v] = el;
    });
    const anexar = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) { c.forEach(anexar); return; } el.appendChild(typeof c === 'object' ? c : documento.createTextNode(String(c))); };
    for (let i = 2; i < arguments.length; i++) anexar(arguments[i]);
    return el;
  }
  const M = {
    h, tr: (c, p) => I18n.t(c, p), I18n, $: (id) => nos[id] || null,
    api: async (caminho, opcoes) => {
      const metodo = (opcoes && opcoes.method) || 'GET';
      chamadas.push({ metodo, caminho, corpo: opcoes && opcoes.body ? JSON.parse(opcoes.body) : undefined });
      const r = respostasApi[metodo + ' ' + caminho.split('?')[0]];
      if (r === undefined) throw new Error('api sem resposta: ' + metodo + ' ' + caminho);
      return typeof r === 'function' ? r(opcoes && opcoes.body ? JSON.parse(opcoes.body) : undefined) : r;
    },
    toast: (m) => toasts.push(m), redesenhar: () => { redesenhos++; }
  };
  sandbox.window.MESA = M;
  sandbox.window.MESA_IDIOMA = { disponiveis: ['pt-BR', 'en'] };
  sandbox.MESA = M;
  vm.runInContext(lerSite('mesa-acesso.js'), sandbox);
  const clicar = async (no) => { for (const f of clicks) await f({ target: no }); for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  return { M, nos, chamadas, toasts, clicar, redesenhos: () => redesenhos };
}

const DIAG = (extra) => Object.assign({
  modo: 'privado', banco: true, email: { adaptador: 'nenhum', disponivel: false }, turnstile: { configurado: false, chavePublica: false },
  cadastro: { metodo: 'link-magico', disponivel: false, motivo: null }, limiteDeTentativas: 'banco', sessoesMaximas: 5
}, extra || {});

const achar = (no, pred, saida = []) => { if (pred(no)) saida.push(no); for (const f of no.children || []) achar(f, pred, saida); return saida; };

test('mesa, tela Acesso: diagnóstico, convite com link copiável, aprovar e salvar os textos legais', async () => {
  const esp = [{ id: 'u1', email: 'ana@exemplo.com', nome: 'Ana', status: 'pendente', criadoEm: 1790000000, ultimoAcesso: null }, { id: 'u2', email: 'bia@exemplo.com', nome: '', status: 'ativo', criadoEm: 1789000000, ultimoAcesso: 1790000500 }];
  const m = montarMesa({
    'GET /api/espectadores': { espectadores: esp, diagnostico: DIAG() },
    'GET /api/convites': { convites: [{ email: 'caio@exemplo.com', criadoEm: 1790000000, expiraEm: 1790600000 }] },
    'GET /api/legal': { documentos: { privacidade: { tipo: 'privacidade', versao: 1, campos: {}, textos: {} }, termos: { tipo: 'termos', versao: 1, campos: {}, textos: {} } }, padroes: { controlador: 'Organização Exemplo' } },
    'POST /api/convites': (c) => ({ ok: true, link: 'https://exemplo.test/entrar.html#t=cv_' + 'x'.repeat(43), expiraEm: 1790600000, enviado: false, motivo: 'sem-email' }),
    'PUT /api/espectadores': { ok: true },
    'PUT /api/legal': (c) => ({ ok: true, documento: { tipo: c.tipo, versao: 2, campos: c.campos, textos: c.textos, mudou: true } })
  });
  const A = m.M.acesso;
  let tela = m.M.telaAcesso();            /* dispara a carga */
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  tela = m.M.telaAcesso();
  const texto = tela.textContent;
  assert.match(texto, /Como está o acesso/);
  assert.match(texto, /privado: só entra quem foi convidado/);
  assert.match(texto, /Banco de dados \(D1\):.*ligado/);
  assert.match(texto, /sem envio de e-mail: você copia o link e o manda por WhatsApp/);
  assert.match(texto, /ana@exemplo\.com/);
  assert.match(texto, /aguardando aprovação/);
  assert.match(texto, /caio@exemplo\.com.*vence em/);
  assert.match(texto, /Texto modelo, não parecer jurídico/);

  /* Convidar: o link aparece para copiar. */
  m.nos['ac-email'].value = ' nova@exemplo.com ';
  const botaoConvidar = achar(tela, (n) => n.attrs && n.attrs['data-acao'] === 'acesso-convidar')[0];
  await m.clicar(botaoConvidar);
  const post = m.chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/api/convites');
  assert.deepEqual(post.corpo, { email: 'nova@exemplo.com', enviar: false });
  assert.match(A.link.link, /#t=cv_/);
  const depois = m.M.telaAcesso();
  assert.match(depois.textContent, /Link de acesso de nova@exemplo\.com/);
  assert.match(depois.textContent, /O e-mail não foi enviado: copie o link/);

  /* Aprovar quem está pendente. */
  const aprovar = achar(depois, (n) => n.attrs && n.attrs['data-acao'] === 'acesso-aprovar')[0];
  assert.equal(aprovar.attrs['data-id'], 'u1');
  await m.clicar(aprovar);
  assert.deepEqual(m.chamadas.find((c) => c.metodo === 'PUT' && c.caminho === '/api/espectadores').corpo, { id: 'u1', acao: 'aprovar' });
  /* Quem já está ativo não tem botão de aprovar. */
  assert.equal(achar(depois, (n) => n.attrs && n.attrs['data-acao'] === 'acesso-aprovar').length, 1);

  /* Textos legais: salvar sobe a versão. */
  const telaLegal = m.M.telaAcesso();   /* desenha de novo: os campos são os desta tela */
  m.nos['ac-ctrl'].value = 'Escola Exemplo Ltda';
  m.nos['ac-contato'].value = 'privacidade@escola.example';
  m.nos['ac-ret'].value = '';
  const salvar = achar(telaLegal, (n) => n.attrs && n.attrs['data-acao'] === 'acesso-salvar-doc')[0];
  await m.clicar(salvar);
  const put = m.chamadas.find((c) => c.metodo === 'PUT' && c.caminho === '/api/legal');
  assert.equal(put.corpo.tipo, 'privacidade');
  assert.equal(put.corpo.campos.controlador, 'Escola Exemplo Ltda');
  assert.ok(m.toasts.some((t) => /Versão 2/.test(t)));
});

test('mesa, tela Acesso: no modo cadastro sem Turnstile mostra por que o cadastro está fechado; no público, só a nota', async () => {
  const base = { 'GET /api/convites': { convites: [] }, 'GET /api/legal': { documentos: { privacidade: { versao: 1, campos: {}, textos: {} }, termos: { versao: 1, campos: {}, textos: {} } }, padroes: {} } };
  let m = montarMesa(Object.assign({ 'GET /api/espectadores': { espectadores: [], diagnostico: DIAG({ modo: 'cadastro', cadastro: { metodo: 'link-magico', disponivel: false, motivo: 'turnstile-nao-configurado' } }) } }, base));
  m.M.telaAcesso();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  let texto = m.M.telaAcesso().textContent;
  assert.match(texto, /Cadastro aberto:.*O cadastro está fechado: falta configurar a verificação anti-robô/);
  assert.match(texto, /Anti-robô \(Turnstile\):.*não configurado/);

  m = montarMesa(Object.assign({ 'GET /api/espectadores': { espectadores: [], indisponivel: true, diagnostico: DIAG({ modo: 'publico' }) } }, base));
  m.M.telaAcesso();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  texto = m.M.telaAcesso().textContent;
  assert.match(texto, /No modo público não há contas de espectador/);
  assert.ok(!/Gerar o link/.test(texto), 'sem convite no modo público');
});
