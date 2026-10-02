/* A matriz rota × método × modo × papel do Worker (M2).
 *
 * Aceite do plano: "rota sem entrada na matriz falha o teste". Aqui o teste
 * enumera tudo o que o roteador registra (e todo arquivo de core/worker/api) e
 * confere contra core/worker/permissoes.js; depois EXECUTA cada célula da
 * matriz pelo `fetch` do Worker, com KV e ASSETS de mentira. Sem rede.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const API = path.join(RAIZ, 'core', 'worker', 'api');
const SEGREDO = 'segredo-de-sessao-com-mais-de-32-caracteres';
const MODOS = ['publico', 'cadastro', 'privado'];

const mod = (nome) => import('../core/worker/' + nome);

const kvEmMemoria = (inicial) => {
  const dados = Object.assign({}, inicial);
  const metas = Object.create(null);
  const ler = (chave, tipo) => (dados[chave] == null ? null : (tipo === 'json' || (tipo && tipo.type === 'json') ? JSON.parse(dados[chave]) : dados[chave]));
  return {
    dados,
    get: async (chave, tipo) => ler(chave, tipo),
    getWithMetadata: async (chave, tipo) => ({ value: ler(chave, tipo), metadata: metas[chave] || null }),
    put: async (chave, valor, opcoes) => { dados[chave] = String(valor); if (opcoes && opcoes.metadata) metas[chave] = opcoes.metadata; },
    delete: async (chave) => { delete dados[chave]; delete metas[chave]; },
    list: async ({ prefix = '' } = {}) => ({ keys: Object.keys(dados).filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  };
};

const HTML = '<html><head><link rel="stylesheet" href="style.css"></head><body>ok</body></html>';
const assetsFalso = () => ({ fetch: async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }) });

const ambiente = (extra) => Object.assign({
  ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: SEGREDO,
  CATALOGO: kvEmMemoria({ catalogo: JSON.stringify({ rev: 1, itens: [{ id: 'a', titulo: 'A', publicar: true, fonte: { videoId: 'v1' } }] }) }),
  ASSETS: assetsFalso(), BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'x'
}, extra || {});

const workerNoModo = async (modo) => (await mod('index.js')).criarWorker({ obterConfig: async () => ({ acesso: { modo } }) });

async function chamar(worker, env, metodo, caminho, token, corpo) {
  const req = new Request('https://exemplo.test' + caminho, {
    method: metodo,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const r = await worker.fetch(req, env, { waitUntil: () => {} });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* html */ }
  return { status: r.status, texto, json, cabecalhos: r.headers };
}

/* Sessões de verdade, emitidas pelo próprio login. */
async function sessoes(worker, env) {
  const sup = (await chamar(worker, env, 'POST', '/api/login', null, { senha: 'senha-do-super' })).json;
  const App = require('../core/site/catalogo-core.js');
  const criada = await chamar(worker, env, 'POST', '/api/contas', sup.token,
    { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: App.PERMISSOES.slice() });
  assert.equal(criada.status, 200, criada.texto);
  const maria = (await chamar(worker, env, 'POST', '/api/login', null, { usuario: 'maria', senha: 'senha-bem-comprida' })).json;
  return { super: sup.token, equipe: maria.token };
}

/* ------------------------------------------------------------ enumeração */

function arquivosDeApi(dir) {
  const saida = [];
  for (const nome of fs.readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (fs.statSync(cheio).isDirectory()) saida.push(...arquivosDeApi(cheio));
    else if (nome.endsWith('.js')) saida.push(cheio);
  }
  return saida;
}

test('toda rota registrada tem entrada na tabela de permissões, e só elas', async () => {
  const { rotasRegistradas } = await mod('rotas.js');
  const { PERMISSOES } = await mod('permissoes.js');

  const registradas = rotasRegistradas();
  assert.ok(registradas.length >= 20, 'o roteador registrou pouca coisa — o import quebrou?');
  for (const { caminho, metodo } of registradas) {
    assert.ok(PERMISSOES[caminho] && PERMISSOES[caminho][metodo],
      'rota registrada SEM entrada na matriz de permissões: ' + metodo + ' ' + caminho);
  }

  /* E ao contrário: entrada sem handler é rota fantasma (ou a home). */
  const chaves = new Set(registradas.map(r => r.metodo + ' ' + r.caminho));
  for (const caminho of Object.keys(PERMISSOES)) {
    for (const metodo of Object.keys(PERMISSOES[caminho])) {
      if (caminho === '/') continue;
      assert.ok(chaves.has(metodo + ' ' + caminho), 'entrada da matriz sem handler: ' + metodo + ' ' + caminho);
    }
  }
});

test('todo arquivo de core/worker/api está no roteador: handler novo não fica esquecido', async () => {
  const { rotasRegistradas } = await mod('rotas.js');
  const registrados = new Set(rotasRegistradas().map(r => r.caminho));
  for (const arquivo of arquivosDeApi(API)) {
    const rel = path.relative(API, arquivo).split(path.sep).join('/').replace(/\.js$/, '');
    assert.ok(registrados.has('/api/' + rel),
      'core/worker/api/' + rel + '.js existe mas não está em rotas.js — ' +
      'sem registro ele é inalcançável; com registro e sem permissão, o teste acima falha');
  }
  /* Todo método exportado precisa estar na tabela (handler novo num arquivo velho). */
  const { PERMISSOES } = await mod('permissoes.js');
  for (const arquivo of arquivosDeApi(API)) {
    const rel = '/api/' + path.relative(API, arquivo).split(path.sep).join('/').replace(/\.js$/, '');
    const fonte = fs.readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/export (?:async )?function onRequest(Get|Post|Put|Delete)\b/g)) {
      const metodo = m[1].toUpperCase();
      /* catálogo e midia reexportam/importam `onRequestPut as ...`: só conta `export`. */
      if (!PERMISSOES[rel] || !PERMISSOES[rel][metodo]) assert.fail(metodo + ' ' + rel + ' exportado e fora da matriz');
    }
  }
});

test('a tabela só usa níveis e métodos conhecidos', async () => {
  const { PERMISSOES } = await mod('permissoes.js');
  for (const [caminho, linha] of Object.entries(PERMISSOES)) {
    assert.ok(caminho === '/' || caminho.startsWith('/api/'), caminho);
    for (const [metodo, nivel] of Object.entries(linha)) {
      assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(metodo), metodo);
      assert.ok(['aberto', 'modo', 'equipe', 'super'].includes(nivel), caminho + ' ' + metodo + ': nível ' + nivel);
    }
  }
});

/* ------------------------------------------------------------ a matriz */

test('matriz executada: cada rota × método × modo × papel responde como a tabela manda', async () => {
  const { PERMISSOES, papelMinimo } = await mod('permissoes.js');
  const { rotasRegistradas } = await mod('rotas.js');
  const FECHADO = ['não autorizado', 'sem permissão para esta rota', 'só o superadmin faz isso', 'não encontrado', 'método não permitido'];

  for (const modo of MODOS) {
    const worker = await workerNoModo(modo);
    const env = ambiente();
    const { super: tSuper, equipe: tEquipe } = await sessoes(worker, env);

    for (const { caminho, metodo } of rotasRegistradas()) {
      const nivel = PERMISSOES[caminho][metodo];
      const minimo = papelMinimo(nivel, modo);
      const rotulo = metodo + ' ' + caminho + ' [' + modo + ']';
      const corpo = metodo === 'GET' || metodo === 'DELETE' ? undefined : {};

      const anonimo = await chamar(worker, env, metodo, caminho, null, corpo);
      if (minimo === 'anonimo') {
        assert.ok(!FECHADO.includes(anonimo.json && anonimo.json.erro),
          rotulo + ': deveria estar aberta ao anônimo, mas o middleware barrou (' + anonimo.status + ')');
      } else {
        assert.equal(anonimo.status, 401, rotulo + ': o anônimo precisa tomar 401, tomou ' + anonimo.status);
      }

      const equipe = await chamar(worker, env, metodo, caminho, tEquipe, corpo);
      if (minimo === 'super') {
        assert.equal(equipe.status, 403, rotulo + ': conta de equipe numa rota do superadmin');
      } else {
        assert.ok(!FECHADO.includes(equipe.json && equipe.json.erro),
          rotulo + ': a equipe deveria passar pelo middleware (' + equipe.status + ')');
      }

      const sup = await chamar(worker, env, metodo, caminho, tSuper, corpo);
      assert.ok(!FECHADO.includes(sup.json && sup.json.erro),
        rotulo + ': o superadmin deveria passar pelo middleware (' + sup.status + ')');
    }
  }
});

test('caminho ou método fora da tabela: 401 sem sessão, 404/405 com sessão', async () => {
  const worker = await workerNoModo('publico');
  const env = ambiente();
  const { super: tSuper } = await sessoes(worker, env);
  const casos = [
    ['GET', '/api'], ['GET', '/api/nao-existe'], ['GET', '/api/busca/outra'], ['GET', '/api/catalogo/extra'],
    ['POST', '/api/busca/fala'], ['DELETE', '/api/catalogo'], ['PUT', '/api/login'], ['GET', '/api/login'],
    ['GET', '/api/_middleware'], ['GET', '/api/..%2Fcatalogo']
  ];
  for (const [metodo, caminho] of casos) {
    const sem = await chamar(worker, env, metodo, caminho, null, metodo === 'GET' ? undefined : {});
    assert.equal(sem.status, 401, metodo + ' ' + caminho + ' sem sessão');
    const com = await chamar(worker, env, metodo, caminho, tSuper, metodo === 'GET' ? undefined : {});
    assert.ok(com.status === 404 || com.status === 405, metodo + ' ' + caminho + ' com sessão: ' + com.status);
  }
  /* A barra no fim é a mesma rota. */
  assert.equal((await chamar(worker, env, 'GET', '/api/catalogo/', null)).status, 200);
});

/* ---------------------------------------------------- modos e falha fechada */

test('config ausente, quebrada ou com modo inventado => modo privado', async () => {
  const { criarWorker } = await mod('index.js');
  const casos = {
    'obterConfig lança': async () => { throw new Error('KV fora'); },
    'config nula': async () => null,
    'config vazia': async () => ({}),
    'sem modo': async () => ({ acesso: {} }),
    'modo inventado': async () => ({ acesso: { modo: 'aberto-demais' } }),
    'modo em maiúsculas': async () => ({ acesso: { modo: 'PUBLICO' } })
  };
  for (const [nome, obterConfig] of Object.entries(casos)) {
    const worker = criarWorker({ obterConfig });
    const env = ambiente();
    for (const caminho of ['/api/catalogo', '/api/busca/fala', '/api/busca/sentido']) {
      assert.equal((await chamar(worker, env, 'GET', caminho, null)).status, 401, nome + ': ' + caminho + ' abriu');
    }
  }
});

test('o Worker de verdade obedece ao modo que o obterConfig real devolve', async () => {
  /* Usa o `obterConfig` empacotado (config/site.json + KV). Não fixa qual é o
   * modo do arquivo de exemplo: confere que o Worker o segue, e que qualquer
   * coisa que não seja `publico` fecha o catálogo. */
  const worker = (await mod('index.js')).default;
  assert.equal(typeof worker.fetch, 'function');
  const { obterConfig } = await mod('_lib/config.js');
  const env = ambiente({ CATALOGO: kvEmMemoria({}) });
  const modo = (await obterConfig(env)).acesso.modo;
  assert.ok(['publico', 'cadastro', 'privado'].includes(modo), 'modo fora do vocabulário: ' + modo);
  assert.equal((await chamar(worker, env, 'GET', '/api/catalogo', null)).status, modo === 'publico' ? 200 : 401);
});

test('catálogo e busca: abertos no público, com sessão nos outros modos (D-4)', async () => {
  for (const modo of MODOS) {
    const worker = await workerNoModo(modo);
    const env = ambiente();
    const { equipe } = await sessoes(worker, env);
    for (const caminho of ['/api/catalogo', '/api/busca/fala']) {
      const sem = await chamar(worker, env, 'GET', caminho, null);
      assert.equal(sem.status, modo === 'publico' ? 200 : 401, caminho + ' [' + modo + '] sem sessão');
      assert.equal((await chamar(worker, env, 'GET', caminho, equipe)).status, 200, caminho + ' [' + modo + '] com sessão');
    }
  }
});

test('o preload da capa na home só existe no modo público', async () => {
  const capa = 'https://vz-teste.b-cdn.net/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/thumbnail_ab12cd34.jpg?v=1';
  const marca = '<link rel="stylesheet" href="style.css">';
  const html = '<html><head>' + marca + '</head></html>';
  for (const modo of MODOS) {
    const worker = await workerNoModo(modo);
    const env = ambiente({
      CATALOGO: kvEmMemoria({ 'capa-destaque': capa }),
      ASSETS: { fetch: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) }
    });
    const r = await chamar(worker, env, 'GET', '/', null);
    assert.equal(r.status, 200);
    assert.equal(r.texto.includes('rel="preload" as="image"'), modo === 'publico', 'preload em modo ' + modo);
    assert.ok(!r.texto.includes(capa) || modo === 'publico', 'a capa vazou na home do modo ' + modo);
  }
});

test('sem SESSION_SECRET (ou curta) ninguém tem sessão, nem o superadmin', async () => {
  const worker = await workerNoModo('privado');
  const env = ambiente();
  const { super: tSuper } = await sessoes(worker, env);
  for (const segredo of [undefined, '', 'curta']) {
    const sem = Object.assign({}, env, { SESSION_SECRET: segredo });
    assert.equal((await chamar(worker, sem, 'GET', '/api/conta', tSuper)).status, 401);
    assert.equal((await chamar(worker, sem, 'POST', '/api/login', null, { senha: 'senha-do-super' })).status, 503);
  }
  /* Segredo trocado: o token de antes cai. */
  const outro = Object.assign({}, env, { SESSION_SECRET: 'outro-segredo-tambem-com-mais-de-32-caracteres' });
  assert.equal((await chamar(worker, outro, 'GET', '/api/conta', tSuper)).status, 401);
  /* Sem ADMIN_PASSWORD o superadmin não existe, e "undefined" não é senha. */
  const semSenha = Object.assign({}, env, { ADMIN_PASSWORD: undefined });
  assert.equal((await chamar(worker, semSenha, 'POST', '/api/login', null, { senha: 'undefined' })).status, 401);
});

/* ---------------------------------------------------------------- custo */

test('o middleware custa pouco: mediana abaixo de 5 ms por requisição (HMAC + tabela)', async (t) => {
  const worker = await workerNoModo('privado');
  const env = ambiente();
  const { super: tSuper, equipe } = await sessoes(worker, env);
  const { autorizar } = await mod('middleware.js');

  const medir = async (token) => {
    const tempos = [];
    for (let i = 0; i < 200; i++) {
      const request = new Request('https://exemplo.test/api/catalogo', { headers: token ? { authorization: 'Bearer ' + token } : {} });
      const ini = performance.now();
      await autorizar({ request, env, caminho: '/api/catalogo', metodo: 'GET', modo: 'privado' });
      tempos.push(performance.now() - ini);
    }
    tempos.sort((a, b) => a - b);
    return tempos[Math.floor(tempos.length / 2)];
  };
  const anonimo = await medir(null);
  const sup = await medir(tSuper);
  const comum = await medir(equipe);   /* HMAC + leitura de KV (em memória aqui) */
  t.diagnostic('mediana do middleware (ms): anônimo ' + anonimo.toFixed(3) + ', super ' + sup.toFixed(3) + ', equipe ' + comum.toFixed(3));
  for (const ms of [anonimo, sup, comum]) assert.ok(ms < 5, 'o middleware passou de 5 ms: ' + ms);
});
