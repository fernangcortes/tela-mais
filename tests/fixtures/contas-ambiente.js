/* tests/fixtures/contas-ambiente.js — o Worker de contas montado para teste: D1 em memória,
 * KV e ASSETS de mentira, `fetch` global trocado (Turnstile, Resend) e um cliente HTTP com
 * "jarra de cookies". Sem rede. */
'use strict';
const { criarD1Falso } = require('./d1-falso.js');

const SEGREDO = 'segredo-de-sessao-com-mais-de-32-caracteres';

const kvEmMemoria = (inicial) => {
  const dados = Object.assign({}, inicial);
  const ler = (chave, tipo) => (dados[chave] == null ? null : (tipo === 'json' || (tipo && tipo.type === 'json') ? JSON.parse(dados[chave]) : dados[chave]));
  return {
    dados,
    get: async (chave, tipo) => ler(chave, tipo),
    put: async (chave, valor) => { dados[chave] = String(valor); },
    delete: async (chave) => { delete dados[chave]; },
    list: async ({ prefix = '' } = {}) => ({ keys: Object.keys(dados).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true })
  };
};

const HTML = '<html><head><link rel="stylesheet" href="style.css"></head><body>ok</body></html>';

function ambiente(extra) {
  return Object.assign({
    ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: SEGREDO,
    DB: criarD1Falso(),
    CATALOGO: kvEmMemoria({ catalogo: JSON.stringify({ rev: 1, itens: [{ id: 'a', titulo: 'A', publicar: true, fonte: { videoId: 'v1' } }] }) }),
    ASSETS: { fetch: async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }) },
    BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'x'
  }, extra || {});
}

/* A config que o Worker enxerga, com `acesso` completo por cima do mínimo. */
function configDe(acesso, resto) {
  return Object.assign({ marca: { nome: 'Plataforma Exemplo', nomeCurto: 'Exemplo', organizacao: 'Organização Exemplo' }, acesso }, resto || {});
}

async function criarWorker(config) {
  const { criarWorker: criar } = await import('../../core/worker/index.js');
  return criar({ obterConfig: async () => config });
}

/* Troca o `fetch` global por um roteador de mentira. `rotas` é { prefixo: (corpo, opcoes) => Response|obj }.
 * Devolve { chamadas, restaurar }. */
function fetchFalso(rotas) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opcoes) => {
    const u = String(url);
    chamadas.push({ url: u, opcoes: opcoes || {} });
    for (const prefixo of Object.keys(rotas)) {
      if (u.startsWith(prefixo)) {
        const r = await rotas[prefixo](u, opcoes || {});
        if (r instanceof Response) return r;
        return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error('fetch inesperado nos testes: ' + u);
  };
  return { chamadas, restaurar() { globalThis.fetch = original; } };
}

/* Cliente com jarra de cookies. `ip` vai em cf-connecting-ip. */
function cliente(worker, env, { ip = '203.0.113.7', origem = 'https://exemplo.test' } = {}) {
  const jarra = {};
  async function chamar(metodo, caminho, { corpo, token, cabecalhos, semOrigem, ipDaVez } = {}) {
    const cab = Object.assign({ 'cf-connecting-ip': ipDaVez || ip, 'user-agent': 'teste/1.0' }, cabecalhos || {});
    if (corpo !== undefined) cab['content-type'] = 'application/json';
    if (token) cab.authorization = 'Bearer ' + token;
    const cookies = Object.keys(jarra).map((k) => k + '=' + jarra[k]).join('; ');
    if (cookies) cab.cookie = cookies;
    if (metodo !== 'GET' && !semOrigem && !('origin' in cab)) cab.origin = origem;
    if (cab.origin === '') delete cab.origin;
    const req = new Request('https://exemplo.test' + caminho, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const ctx = { esperando: [], waitUntil(p) { this.esperando.push(p); } };
    const r = await worker.fetch(req, env, ctx);
    await Promise.all(ctx.esperando);
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* html */ }
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) {
      const [par] = setCookie.split(';');
      const i = par.indexOf('=');
      const nome = par.slice(0, i);
      const valor = par.slice(i + 1);
      if (valor) jarra[nome] = valor; else delete jarra[nome];
    }
    return { status: r.status, json, texto, cabecalhos: r.headers, setCookie };
  }
  return {
    jarra,
    get: (c, o) => chamar('GET', c, o),
    post: (c, corpo, o) => chamar('POST', c, Object.assign({ corpo: corpo === undefined ? {} : corpo }, o || {})),
    put: (c, corpo, o) => chamar('PUT', c, Object.assign({ corpo: corpo === undefined ? {} : corpo }, o || {})),
    delete: (c, o) => chamar('DELETE', c, o)
  };
}

/* Entra como superadmin e devolve o token Bearer. */
async function tokenDoSuper(worker, env) {
  const c = cliente(worker, env, { ip: '198.51.100.250' });
  const r = await c.post('/api/login', { senha: 'senha-do-super' });
  if (r.status !== 200) throw new Error('login do super falhou: ' + r.texto);
  return r.json.token;
}

/* Tira o token do link `.../entrar.html#t=<token>`. */
function tokenDoLink(link) {
  const m = /#t=([^&\s]+)/.exec(String(link));
  return m ? decodeURIComponent(m[1]) : null;
}

const ACEITE = (versoes) => ({ aceite: true, versoes: versoes || { privacidade: 1, termos: 1 } });

module.exports = { SEGREDO, kvEmMemoria, ambiente, configDe, criarWorker, fetchFalso, cliente, tokenDoSuper, tokenDoLink, ACEITE, criarD1Falso };
