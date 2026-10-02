/* M3 — i18n: o t() compartilhado, os catálogos, as APIs com {codigo, mensagem}, a
 * geração por idioma e o seletor. Sem navegador e sem rede.
 *
 * O que o aceite do plano cobra e este arquivo prova:
 *   - o script que lista chaves faltando em en/es retorna 0;
 *   - os literais em português fora de core/locales ficam abaixo do limite documentado;
 *   - t() faz interpolação e plural, e o override do cliente vence o padrão;
 *   - data e duração saem formatadas pelo idioma (Intl);
 *   - as APIs devolvem { codigo, mensagem } e o idioma segue o Accept-Language. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'core', 'site');
const AppI18n = require('../core/site/i18n.js');
const ptBR = require('../core/locales/pt-BR.json');
const en = require('../core/locales/en.json');
const es = require('../core/locales/es.json');

const imp = (rel) => import(path.join(RAIZ, rel));
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/* --------------------------------------------------------------- t(): resolução */

test('t(): interpolação, buraco sem valor fica visível e parâmetro global preenche', () => {
  const i = AppI18n.criar({ idioma: 'pt-BR', catalogos: { 'pt-BR': { 'a.oi': 'Oi, {nome}!', 'a.dois': '{x} e {y}', 'a.marca': 'Bem-vindo a {marca}' } },
    globais: { marca: 'Casa' } });
  assert.equal(i.t('a.oi', { nome: 'Ana' }), 'Oi, Ana!');
  assert.equal(i.t('a.dois', { x: 1 }), '1 e {y}', 'o buraco sem valor não some em silêncio');
  assert.equal(i.t('a.marca'), 'Bem-vindo a Casa');
  assert.equal(i.t('a.marca', { marca: 'Outra' }), 'Bem-vindo a Outra', 'o parâmetro da chamada vence o global');
});

test('t(): nunca interpreta HTML nem executa nada — é só substituição de texto', () => {
  const i = AppI18n.criar({ catalogos: { 'pt-BR': { 'a.x': 'Título: {t}' } } });
  assert.equal(i.t('a.x', { t: '<img src=x onerror=1>' }), 'Título: <img src=x onerror=1>');
  assert.equal(i.t('a.x', { t: '$& {t}' }), 'Título: $& {t}');
});

test('t(): plural por Intl.PluralRules, e "=N" vence a categoria', () => {
  const cat = { 'a.n': { '=0': 'nenhum título', one: '{n} título', other: '{n} títulos' }, 'a.um': { um: 'um', outro: 'vários' } };
  const pt = AppI18n.criar({ idioma: 'pt-BR', catalogos: { 'pt-BR': cat } });
  assert.equal(pt.t('a.n', { n: 0 }), 'nenhum título');
  assert.equal(pt.t('a.n', { n: 1 }), '1 título');
  assert.equal(pt.t('a.n', { n: 5 }), '5 títulos');
  assert.equal(pt.t('a.um', { n: 1 }), 'um', '"um" é apelido de one');
  assert.equal(pt.t('a.um', { n: 2 }), 'vários');
  /* Em pt, 0 é "one" (regra do CLDR); em en é "other" — cada idioma com a sua regra. */
  const sem0 = { 'a.n': { one: '{n} item', other: '{n} itens' } };
  assert.equal(AppI18n.criar({ idioma: 'pt-BR', catalogos: { 'pt-BR': sem0 } }).t('a.n', { n: 0 }), '0 item');
  assert.equal(AppI18n.criar({ idioma: 'en', catalogos: { en: sem0, 'pt-BR': sem0 } }).t('a.n', { n: 0 }), '0 itens');
});

test('t(): o override do cliente vence o catálogo, e o idioma que falta cai no padrão e no pt-BR', () => {
  const i = AppI18n.criar({
    idioma: 'en', padrao: 'es',
    catalogos: { 'pt-BR': { 'k.a': 'pt a', 'k.b': 'pt b', 'k.c': 'pt c', 'k.d': 'pt d' }, es: { 'k.b': 'es b', 'k.c': 'es c' }, en: { 'k.c': 'en c', 'k.d': 'en d' } },
    overrides: { en: { 'k.d': 'DO CLIENTE en' }, es: { 'k.b': 'DO CLIENTE es' } }
  });
  assert.equal(i.t('k.d'), 'DO CLIENTE en', 'override no idioma atual vence o catálogo dele');
  assert.equal(i.t('k.c'), 'en c');
  assert.equal(i.t('k.b'), 'DO CLIENTE es', 'faltando em en, vale o override do idioma padrão');
  assert.equal(i.t('k.a'), 'pt a', 'faltando em todo lugar, o pt-BR de referência');
  assert.equal(i.t('k.nao-existe'), 'k.nao-existe', 'sem nada, a chave — e ela fica registrada');
  assert.deepEqual(i.faltantes(), ['k.nao-existe']);
});

test('o pt-BR já vem embutido em Node e no Worker (testes e APIs não precisam de preparo)', () => {
  assert.equal(AppI18n.t('api.nao-autorizado'), ptBR['api.nao-autorizado']);
  assert.equal(AppI18n.idioma(), 'pt-BR');
});

/* --------------------------------------------------------------- idioma */

test('normalizarIdioma e combinarIdioma: pt_br, en-US, língua igual', () => {
  assert.equal(AppI18n.normalizarIdioma('pt_br'), 'pt-BR');
  assert.equal(AppI18n.normalizarIdioma('EN'), 'en');
  assert.equal(AppI18n.normalizarIdioma('???'), '');
  assert.equal(AppI18n.combinarIdioma('en-US', ['pt-BR', 'en']), 'en');
  assert.equal(AppI18n.combinarIdioma('pt-PT', ['en', 'pt-BR']), 'pt-BR');
  assert.equal(AppI18n.combinarIdioma('fr', ['pt-BR', 'en']), '');
});

test('detectarDoNavegador: a primeira preferência que o cliente oferece; senão o padrão', () => {
  assert.equal(AppI18n.detectarDoNavegador(['fr-FR', 'es-MX', 'en'], ['pt-BR', 'en', 'es'], 'pt-BR'), 'es');
  assert.equal(AppI18n.detectarDoNavegador(['fr'], ['pt-BR', 'en'], 'pt-BR'), 'pt-BR');
  assert.equal(AppI18n.detectarDoNavegador([], ['en'], 'en'), 'en');
  /* O cabeçalho do servidor: ordenado pelo q, '*' e q=0 ignorados. */
  assert.equal(AppI18n.detectarDoCabecalho('pt;q=0.5, en-US;q=0.9, es;q=0', ['pt-BR', 'en', 'es'], 'pt-BR'), 'en');
  assert.equal(AppI18n.detectarDoCabecalho('', ['pt-BR', 'en'], 'pt-BR'), 'pt-BR');
});

test('escolherIdiomaInicial: ?idioma= > escolha guardada > navegador (se ligado) > padrão', () => {
  const base = { disponiveis: ['pt-BR', 'en', 'es'], padrao: 'pt-BR', navegador: ['es'] };
  assert.equal(AppI18n.escolherIdiomaInicial({ ...base, parametro: 'en', salvo: 'es', detectar: true }), 'en');
  assert.equal(AppI18n.escolherIdiomaInicial({ ...base, parametro: '', salvo: 'es', detectar: false }), 'es');
  assert.equal(AppI18n.escolherIdiomaInicial({ ...base, parametro: '', salvo: '', detectar: true }), 'es');
  assert.equal(AppI18n.escolherIdiomaInicial({ ...base, parametro: '', salvo: '', detectar: false }), 'pt-BR',
    'com detectarDoNavegador desligado o navegador não decide');
  assert.equal(AppI18n.escolherIdiomaInicial({ ...base, parametro: 'fr', salvo: 'de', detectar: false }), 'pt-BR',
    'idioma que o cliente não oferece é ignorado');
});

test('iniciarNoNavegador: lê a config pública, escolhe o idioma e baixa SÓ o catálogo dele', async () => {
  const pedidos = [];
  const publica = { marca: { nome: 'Casa' }, idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en'], detectarDoNavegador: true, seletorVisivel: true } };
  const catalogos = { 'locales/en.json': { 'site.rodape': '{marca} — footer' }, 'locales/pt-BR.json': { 'site.rodape': '{marca}.' } };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    pedidos.push(url);
    const corpo = url === 'config.public.json' ? publica : catalogos[url];
    return { ok: !!corpo, status: corpo ? 200 : 404, json: async () => corpo };
  };
  try {
    const janela = { location: { search: '' }, localStorage: { getItem: () => null }, navigator: { languages: ['en-GB'] }, document: { documentElement: {} } };
    const r = await AppI18n.iniciarNoNavegador({ janela, chaveSalva: 'tm:idioma' });
    assert.equal(r.idioma, 'en');
    assert.deepEqual(pedidos, ['config.public.json', 'locales/en.json'], 'só o catálogo do idioma escolhido desce');
    assert.equal(janela.document.documentElement.lang, 'en');
    assert.equal(AppI18n.t('site.rodape'), 'Casa — footer', '{marca} vem da config pública, sem estar no catálogo');
    /* Se o idioma pedido falha na rede, tenta o padrão antes de desistir. */
    pedidos.length = 0;
    delete catalogos['locales/en.json'];
    const r2 = await AppI18n.iniciarNoNavegador({ janela, chaveSalva: 'tm:idioma' });
    assert.equal(r2.idioma, 'pt-BR');
  } finally {
    globalThis.fetch = fetchOriginal;
    AppI18n.iniciar({});
  }
});

/* --------------------------------------------------------------- data e duração */

test('data e duração saem pelo idioma: ordem do dia, unidades e fuso', () => {
  const quando = '2026-09-23T15:30:00Z';
  assert.equal(AppI18n.formatarData(quando, 'pt-BR', 'curta', 'UTC'), '23/09/2026');
  assert.equal(AppI18n.formatarData(quando, 'en', 'curta', 'UTC'), '09/23/2026');
  assert.equal(AppI18n.formatarData(quando, 'es', 'longa', 'UTC'), '23 de septiembre de 2026');
  assert.match(AppI18n.formatarData(quando, 'pt-BR', 'dataHora', 'UTC'), /^23\/09\/2026,? 15:30$/);
  assert.equal(AppI18n.formatarData('lixo', 'pt-BR'), '', 'data inválida não vira "Invalid Date"');
  assert.equal(AppI18n.formatarDuracao(3900, 'pt-BR'), '1 h 5 min');
  assert.equal(AppI18n.formatarDuracao(3900, 'en'), '1 hr 5 min');
  assert.equal(AppI18n.formatarDuracao(45, 'es'), '45 s');
  assert.equal(AppI18n.formatarDuracao(300, 'pt-BR'), '5 min');
  assert.equal(AppI18n.formatarRelogio(3723, 'en'), '1:02:03');
  assert.equal(AppI18n.formatarRelogio(62, 'pt-BR'), '1:02');
  assert.equal(AppI18n.formatarNumero(1234.5, 'pt-BR'), '1.234,5');
  assert.equal(AppI18n.formatarNumero(1234.5, 'en'), '1,234.5');
  assert.match(AppI18n.formatarBytes(1536 * 1024, 'pt-BR'), /^1,5 MB$/);
  const agora = Date.parse('2026-09-23T12:00:00Z');
  assert.equal(AppI18n.formatarRelativo(agora - 3 * 86400000, 'es', agora), 'hace 3 días');
  assert.equal(AppI18n.formatarRelativo(agora - 3 * 86400000, 'en', agora), '3 days ago');
  assert.equal(AppI18n.comparar('ábaco', 'abacate', 'pt-BR') > 0, true, 'a ordenação é do idioma');
});

test('a duração dos cartões (formatarMinutos) acompanha o idioma', () => {
  const App = require('../core/site/catalogo-core.js');
  AppI18n.iniciar({ idioma: 'en', padrao: 'en', catalogos: { en } });
  try {
    assert.equal(App.formatarMinutos(3900), '1 hr 5 min');
    assert.equal(App.rotuloNumero({ titulo: 'Aula (Parte 3)' }), 'Part 3');
    assert.equal(App.formatarAnos({ de: 2020, ate: 2023 }), '2020 to 2023');
    assert.equal(App.TEXTOS_PADRAO.semCapa, 'No image');
  } finally { AppI18n.iniciar({}); }
});

/* --------------------------------------------------------------- catálogos */

test('aceite: o script de chaves faltando devolve 0 (en e es completos, mesmos parâmetros e plurais)', async () => {
  const { verificar, totalDeProblemas, principal } = await imp('scripts/i18n-faltando.mjs');
  const r = verificar(RAIZ);
  assert.deepEqual(r.idiomas.en, { faltando: [], sobrando: [], parametros: [], plurais: [], vazios: [] });
  assert.deepEqual(r.idiomas.es, { faltando: [], sobrando: [], parametros: [], plurais: [], vazios: [] });
  assert.deepEqual(r.codigo, [], 'o código cita chave que o pt-BR não tem');
  assert.equal(totalDeProblemas(r), 0);
  const linhas = [];
  assert.equal(principal([], { log: (m) => linhas.push(m) }, RAIZ), 0);
  assert.match(linhas.join('\n'), /nenhuma chave faltando/);
});

test('o script de chaves faltando FALHA quando falta, sobra, muda parâmetro ou plural', async () => {
  const { compararComReferencia } = await imp('scripts/i18n-faltando.mjs');
  const ref = { 'a.um': 'Olá, {nome}', 'a.dois': { one: '{n} item', other: '{n} itens' }, 'a.tres': 'tchau' };
  const r = compararComReferencia(ref, { 'a.um': 'Hello, {name}', 'a.dois': 'só texto', 'a.quatro': 'x' });
  assert.deepEqual(r.faltando, ['a.tres']);
  assert.deepEqual(r.sobrando, ['a.quatro']);
  assert.equal(r.parametros.length, 1);
  assert.equal(r.plurais.length, 1);
  const vazio = compararComReferencia(ref, { 'a.um': '  ', 'a.dois': { other: '{n}' }, 'a.tres': 'x' });
  assert.deepEqual(vazio.vazios, ['a.um']);
});

test('as traduções são de verdade: en e es não são cópia do pt-BR (salvo marcas, siglas e símbolos)', () => {
  const iguais = Object.keys(ptBR).filter((k) => typeof ptBR[k] === 'string' && ptBR[k] === en[k] && /[a-záéíóúãõç]{4,}/i.test(ptBR[k].replace(/\{[^}]+\}/g, '')));
  const iguaisEs = Object.keys(ptBR).filter((k) => typeof ptBR[k] === 'string' && ptBR[k] === es[k] && /[a-záéíóúãõç]{4,}/i.test(ptBR[k].replace(/\{[^}]+\}/g, '')));
  /* Palavras que são iguais nos idiomas (Player, Tags, Menu, Site...) e frases curtas
   * de uma palavra: tolera até 8% de iguais em en e 25% em es (que é parente do pt). */
  assert.ok(iguais.length <= Math.ceil(Object.keys(ptBR).length * 0.08), `muita coisa igual ao pt-BR em en: ${iguais.slice(0, 12).join(', ')}`);
  assert.ok(iguaisEs.length <= Math.ceil(Object.keys(ptBR).length * 0.25), `muita coisa igual ao pt-BR em es: ${iguaisEs.slice(0, 12).join(', ')}`);
  assert.equal(en['api.nao-autorizado'], 'not authorized');
  assert.equal(es['api.nao-autorizado'], 'no autorizado');
  assert.equal(en['player.reproduzir'], 'Play');
  assert.equal(es['player.reproduzir'], 'Reproducir');
});

test('toda chamada tr(chave, { ... }) passa os parâmetros que o texto pede', () => {
  const pasta = (p) => fs.readdirSync(p).map((n) => path.join(p, n));
  const arquivos = [];
  const varrer = (d) => { for (const f of pasta(d)) { if (fs.statSync(f).isDirectory()) { if (!/vendor|locales/.test(f)) varrer(f); } else if (/\.(js|mjs)$/.test(f)) arquivos.push(f); } };
  varrer(path.join(RAIZ, 'core', 'site')); varrer(path.join(RAIZ, 'core', 'worker'));
  const globais = new Set(['marca', 'marcaCurta', 'organizacao']);
  const ph = (v) => { const s = new Set(); const somar = (t) => { for (const m of String(t).matchAll(/\{([A-Za-z_]\w*)\}/g)) s.add(m[1]); }; typeof v === 'string' ? somar(v) : Object.values(v).forEach(somar); return s; };
  const problemas = [];
  for (const f of arquivos) {
    const fonte = fs.readFileSync(f, 'utf8');
    for (const m of fonte.matchAll(/\b(?:tr|M\.tr|AppI18n\.t)\(\s*'([\w.-]+)'\s*,\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const chave = m[1];
      if (!(chave in ptBR)) continue;
      const dados = new Set([...m[2].matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*(?::|,|$)/g)].map((x) => x[1]));
      const faltam = [...ph(ptBR[chave])].filter((p) => !globais.has(p) && !dados.has(p));
      if (faltam.length) problemas.push(`${path.relative(RAIZ, f)}: ${chave} sem {${faltam.join('}, {')}}`);
    }
  }
  assert.deepEqual(problemas, []);
});

/* --------------------------------------------------------------- literais em português */

test('aceite: os literais em português fora de core/locales ficam abaixo do limite documentado', async () => {
  const { contarTudo, LIMITE_PADRAO, EXCECOES } = await imp('scripts/i18n-literais.mjs');
  const r = contarTudo(RAIZ);
  const lista = Object.entries(r.porArquivo).flatMap(([a, xs]) => xs.map((x) => `${a}:${x.linha} ${x.valor.slice(0, 50)}`));
  assert.ok(r.total <= LIMITE_PADRAO, `${r.total} literais passam do limite ${LIMITE_PADRAO}:\n${lista.join('\n')}`);
  assert.ok(LIMITE_PADRAO <= 15, 'o limite documentado só desce: subi-lo exige justificativa no PR');
  for (const [arquivo, motivo] of EXCECOES) {
    assert.ok(fs.existsSync(path.join(RAIZ, arquivo)), `a exceção ${arquivo} não existe mais`);
    assert.ok(motivo.length > 15, `a exceção ${arquivo} precisa de motivo`);
  }
});

test('o contador de literais pega texto em português e respeita o marcador e o data-i18n', async () => {
  const { contarArquivo } = await imp('scripts/i18n-literais.mjs');
  const js = [
    "var a = 'Salvar alterações';",
    "var b = tr('mesa.salvar');",
    "var c = 'Nenhum vídeo encontrado'; /* i18n-ignorar: dado */",
    "// comentário: 'Texto em português aqui'",
    "var d = { text: 'sem limite' };",
    "var e = { fase: 'pronto', classe: 'chip chip-erro' };",
    "var f = x.closest('input, label');"
  ].join('\n');
  const achados = contarArquivo('x.js', js).map((x) => x.valor);
  assert.deepEqual(achados, ['Salvar alterações', 'sem limite']);
  const html = ['<p data-i18n="a.b">Texto fixo em português</p>', '<p>Texto solto em português</p>', '<img alt="Logo da marca" data-i18n-attr="alt:a.c">'].join('\n');
  assert.deepEqual(contarArquivo('x.html', html).map((x) => x.valor), ['Texto solto em português']);
});

/* --------------------------------------------------------------- as APIs: { codigo, mensagem } */

const SEGREDO = 'segredo-de-sessao-com-mais-de-32-caracteres';

async function chamar(worker, caminho, { idioma, metodo = 'GET', corpo, token } = {}) {
  const cab = {};
  if (idioma) cab['accept-language'] = idioma;
  if (token) cab.authorization = 'Bearer ' + token;
  if (corpo !== undefined) cab['content-type'] = 'application/json';
  const req = new Request('https://site.exemplo' + caminho, { method: metodo, headers: cab, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const env = { SESSION_SECRET: SEGREDO, ADMIN_PASSWORD: 'senha-do-super-admin', ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  const r = await worker.fetch(req, env, { waitUntil() {} });
  return { status: r.status, cab: r.headers, corpo: await r.json().catch(() => null) };
}

async function worker(config) {
  const { criarWorker } = await imp('core/worker/index.js');
  return criarWorker({ obterConfig: async () => config });
}

const CONFIG_BASE = { acesso: { modo: 'publico' }, idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en', 'es'] }, textos: {} };

test('erro de API: { erro, codigo, mensagem } — o front traduz pelo código, quem não tem front lê a mensagem', async () => {
  const w = await worker(CONFIG_BASE);
  const r = await chamar(w, '/api/contas');   /* sem token, rota de equipe */
  assert.equal(r.status, 401);
  assert.equal(r.corpo.codigo, 'nao-autorizado');
  assert.equal(r.corpo.mensagem, 'não autorizado');
  assert.equal(r.corpo.erro, r.corpo.mensagem, '`erro` continua igual à mensagem: os scripts de carga leem por ele');
  assert.equal(r.cab.get('content-language'), 'pt-BR');
});

test('a mensagem do erro segue o Accept-Language, entre os idiomas do cliente', async () => {
  const w = await worker(CONFIG_BASE);
  const en_ = await chamar(w, '/api/contas', { idioma: 'en-US,en;q=0.9' });
  assert.equal(en_.corpo.mensagem, 'not authorized');
  assert.equal(en_.corpo.codigo, 'nao-autorizado', 'o código não muda com o idioma');
  assert.equal(en_.cab.get('content-language'), 'en');
  const es_ = await chamar(w, '/api/contas', { idioma: 'es-MX' });
  assert.equal(es_.corpo.mensagem, 'no autorizado');
  /* Idioma que o cliente não oferece cai no padrão dele. */
  const so = await worker({ ...CONFIG_BASE, idiomas: { padrao: 'en', disponiveis: ['en'] } });
  const fr = await chamar(so, '/api/contas', { idioma: 'fr' });
  assert.equal(fr.corpo.mensagem, 'not authorized');
  const semCab = await chamar(so, '/api/contas');
  assert.equal(semCab.corpo.mensagem, 'not authorized');
});

test('o texto do cliente (config.textos) vence também na mensagem da API', async () => {
  const w = await worker({ ...CONFIG_BASE, textos: { en: { 'api.nao-autorizado': 'Please sign in first' } } });
  const r = await chamar(w, '/api/contas', { idioma: 'en' });
  assert.equal(r.corpo.mensagem, 'Please sign in first');
  assert.equal(r.corpo.erro, 'Please sign in first');
  const pt = await chamar(w, '/api/contas', { idioma: 'pt-BR' });
  assert.equal(pt.corpo.mensagem, 'não autorizado', 'o override de en não vaza para pt-BR');
});

test('erros com parâmetros e plural: senha curta, campos barrados, login errado', async () => {
  const w = await worker(CONFIG_BASE);
  const { emitirToken } = await imp('core/worker/_lib/sessao.js');
  const { token } = await emitirToken({ SESSION_SECRET: SEGREDO }, { usuario: 'superadmin', super: true });
  const curta = await chamar(w, '/api/contas', { metodo: 'POST', token, corpo: { usuario: 'maria', senha: 'abc', permissoes: [] }, idioma: 'en' });
  assert.equal(curta.status, 400);
  assert.equal(curta.corpo.codigo, 'senha-curta');
  assert.equal(curta.corpo.params.minimo >= 6, true);
  assert.match(curta.corpo.mensagem, /^the password needs at least \d+ characters$/);
  const login = await chamar(w, '/api/login', { metodo: 'POST', corpo: { senha: 'errada' }, idioma: 'es' });
  assert.equal(login.status, 401);
  assert.equal(login.corpo.codigo, 'credenciais-incorretas');
  assert.equal(login.corpo.mensagem, 'usuario o contraseña incorrectos');
});

test('plural do servidor: "este campo" / "estes N campos"', () => {
  assert.equal(AppI18n.criar({ idioma: 'pt-BR', catalogos: { 'pt-BR': ptBR } }).t('api.conta-nao-pode-campos', { n: 1 }), 'esta conta não pode mudar este campo');
  assert.equal(AppI18n.criar({ idioma: 'pt-BR', catalogos: { 'pt-BR': ptBR } }).t('api.conta-nao-pode-campos', { n: 4 }), 'esta conta não pode mudar estes 4 campos');
  assert.equal(AppI18n.criar({ idioma: 'en', catalogos: { en } }).t('api.conta-nao-pode-campos', { n: 4 }), 'this account cannot change these 4 fields');
});

test('nenhuma API devolve texto de erro escrito no handler: toda resposta de erro passa por erro(codigo)', () => {
  const pasta = path.join(RAIZ, 'core', 'worker');
  const arquivos = [];
  const varrer = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) varrer(f); else if (/\.js$/.test(n)) arquivos.push(f); } };
  varrer(pasta);
  const sujos = [];
  for (const f of arquivos) {
    const fonte = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/json\(\s*\d{3}\s*,\s*\{\s*erro:\s*['"`]/.test(fonte)) sujos.push(path.relative(RAIZ, f));
  }
  assert.deepEqual(sujos, [], 'erro escrito à mão em vez de erro(status, codigo)');
});

/* --------------------------------------------------------------- idiomas e textos no config */

const schema = JSON.parse(ler('config/site.schema.json'));
const exemplo = () => JSON.parse(ler('config/site.json'));

test('config: chave de texto desconhecida é recusada, com sugestão', async () => {
  const { validarConfig } = await imp('core/worker/_lib/config-validar.mjs');
  const c = exemplo();
  c.textos = { 'pt-BR': { 'site.rodpae': 'x' } };
  const r = validarConfig(schema, c);
  assert.equal(r.ok, false);
  assert.equal(r.erros[0].caminho, 'textos.pt-BR.site.rodpae');
  assert.match(r.erros[0].mensagem, /não existe nos textos da interface.*Quis dizer "site\.rodape"\?/);
});

test('config: a chave curta do M4 ("rodape") vale; o buraco inexistente e o idioma fora da lista são recusados', async () => {
  const { validarConfig } = await imp('core/worker/_lib/config-validar.mjs');
  const bom = exemplo();
  bom.textos = { 'pt-BR': { rodape: 'Feito com carinho por {marca}' } };
  assert.equal(validarConfig(schema, bom).ok, true);

  const buraco = exemplo();
  buraco.textos = { 'pt-BR': { 'site.semCapa': 'Sem imagem de {titulo}' } };
  const r1 = validarConfig(schema, buraco);
  assert.equal(r1.ok, false);
  assert.match(r1.erros[0].mensagem, /usa \{titulo\}, que esta frase não recebe/);

  const fora = exemplo();
  fora.textos = { fr: { 'site.rodape': 'x' } };
  const r2 = validarConfig(schema, fora);
  assert.equal(r2.ok, false);
  assert.match(r2.erros[0].mensagem, /nunca apareceriam.*idiomas\.disponiveis/);

  /* en e es sempre cabem: a mesa fala os três. */
  const mesa = exemplo();
  mesa.textos = { en: { 'site.rodape': 'Footer' } };
  assert.equal(validarConfig(schema, mesa).ok, true);
});

test('config: idioma padrão na lista, sem repetição, e o seletor aparece por padrão', async () => {
  const { validarConfig } = await imp('core/worker/_lib/config-validar.mjs');
  const c = exemplo();
  c.idiomas = { padrao: 'en', disponiveis: ['pt-BR'] };
  assert.match(validarConfig(schema, c).erros[0].mensagem, /precisa estar na lista/);
  c.idiomas = { padrao: 'pt-BR', disponiveis: ['pt-BR', 'pt-BR'] };
  assert.match(validarConfig(schema, c).erros[0].mensagem, /repetido/);
  const ok = validarConfig(schema, { ...exemplo(), idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en'] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.idiomas.seletorVisivel, true, 'mais de um idioma => seletor, salvo se o cliente esconder');
});

/* --------------------------------------------------------------- geração por idioma */

test('catálogo efetivo: pt-BR < padrão < cliente < idioma < textos, e o que falta cai no padrão', async () => {
  const { catalogoEfetivo } = await imp('scripts/lib/i18n-gerar.mjs');
  const catalogos = {
    fabrica: { 'pt-BR': { 'x.a': 'pt a', 'x.b': 'pt b', 'x.c': 'pt c' }, en: { 'x.a': 'en a', 'x.b': 'en b' } },
    cliente: { en: { 'x.b': 'cliente en b' }, fr: { 'x.a': 'fr a' } }
  };
  const config = { idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en', 'fr'] }, textos: { en: { 'x.a': 'texto en a' }, 'pt-BR': { 'x.c': 'texto pt c' } } };
  assert.deepEqual(catalogoEfetivo(config, catalogos, 'en'), { 'x.a': 'texto en a', 'x.b': 'cliente en b', 'x.c': 'texto pt c' });
  assert.deepEqual(catalogoEfetivo(config, catalogos, 'fr'), { 'x.a': 'fr a', 'x.b': 'pt b', 'x.c': 'texto pt c' }, 'idioma do cliente só traduzido pela metade não deixa buraco');
  assert.deepEqual(catalogoEfetivo(config, catalogos, 'pt-BR'), { 'x.a': 'pt a', 'x.b': 'pt b', 'x.c': 'texto pt c' });
});

async function projetoTemporario(mudar) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-i18n-'));
  fs.mkdirSync(path.join(raiz, 'config'));
  fs.mkdirSync(path.join(raiz, 'core', 'site'), { recursive: true });
  fs.cpSync(path.join(RAIZ, 'config/site.schema.json'), path.join(raiz, 'config/site.schema.json'));
  for (const f of ['index.html', 'admin.html']) fs.cpSync(path.join(SITE, f), path.join(raiz, 'core/site', f));
  const c = exemplo();
  if (mudar) mudar(c);
  fs.writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(c, null, 2));
  return raiz;
}

test('aplicar-config: gera locales/<idioma>.json, com o texto do cliente por cima, e o HTML no idioma padrão', async () => {
  const raiz = await projetoTemporario((c) => {
    c.marca.nome = 'Casa do Cinema';
    c.marca.descricao = 'Filmes da Casa do Cinema.';
    c.idiomas = { padrao: 'en', disponiveis: ['en', 'pt-BR'], detectarDoNavegador: true };
    c.textos = { en: { 'site.rodape': 'Made with care by {marca}.', 'site.erroCatalogo': 'Oops, the catalog is down' }, 'pt-BR': { rodape: 'Feito por {marca}.' } };
  });
  const { aplicarConfig } = await imp('scripts/aplicar-config.mjs');
  const r = await aplicarConfig({ raiz });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const loc = (id) => JSON.parse(fs.readFileSync(path.join(raiz, 'core/site/locales', id + '.json'), 'utf8'));
  assert.equal(loc('en')['site.rodape'], 'Made with care by {marca}.');
  assert.equal(loc('en')['site.erroCatalogo'], 'Oops, the catalog is down');
  assert.equal(loc('en')['site.semCapa'], 'No image', 'o que o cliente não trocou vem de fábrica');
  assert.equal(loc('pt-BR')['site.rodape'], 'Feito por {marca}.', 'a chave curta do M4 funciona como apelido');
  assert.equal(loc('pt-BR')['site.erroCatalogo'], 'O catálogo não carregou');
  assert.ok(fs.existsSync(path.join(raiz, 'core/site/locales/es.json')), 'a mesa fala os três idiomas, mesmo que o site não os ofereça');

  const html = fs.readFileSync(path.join(raiz, 'core/site/index.html'), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="preload" href="locales\/en\.json" as="fetch" crossorigin>/);
  assert.match(html, /<a class="pular" [^>]*>Skip to content<\/a>/);
  assert.match(html, /<span id="rodape-texto" data-i18n="site\.rodape">Made with care by Casa do Cinema\.<\/span>/);
  assert.match(html, /placeholder="Search by title, topic or what is said…"/);
  assert.match(html, /<title>Casa do Cinema — catalog<\/title>/);
  assert.ok(!html.includes('Plataforma Exemplo'), 'nenhuma string do exemplo anterior no HTML');
  const admin = fs.readFileSync(path.join(raiz, 'core/site/admin.html'), 'utf8');
  assert.match(admin, /<title>Curation Desk — Casa do Cinema<\/title>/);
  assert.match(admin, /<h1 id="entrar-titulo" data-i18n="mesa\.tituloDaMesa">Curation Desk<\/h1>/);
  assert.ok(!admin.includes('Plataforma Exemplo'));

  /* Idempotente. */
  assert.deepEqual((await aplicarConfig({ raiz })).alterados, []);
  /* Nenhum catálogo gerado traz a marca do exemplo: ela entra por {marca}. */
  for (const id of ['pt-BR', 'en', 'es']) {
    assert.ok(!fs.readFileSync(path.join(raiz, 'core/site/locales', id + '.json'), 'utf8').includes('Plataforma Exemplo'), id);
  }
});

test('aplicar-config: config/locales/<idioma>.json do cliente acrescenta um idioma que o produto não traz', async () => {
  const raiz = await projetoTemporario((c) => { c.idiomas = { padrao: 'pt-BR', disponiveis: ['pt-BR', 'fr'] }; });
  fs.mkdirSync(path.join(raiz, 'config', 'locales'));
  fs.writeFileSync(path.join(raiz, 'config', 'locales', 'fr.json'), JSON.stringify({ 'site.inicio': 'Accueil', 'site.tituloSeries': 'Séries' }));
  const { aplicarConfig } = await imp('scripts/aplicar-config.mjs');
  const r = await aplicarConfig({ raiz });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const fr = JSON.parse(fs.readFileSync(path.join(raiz, 'core/site/locales/fr.json'), 'utf8'));
  assert.equal(fr['site.inicio'], 'Accueil');
  assert.equal(fr['site.semCapa'], 'Sem imagem', 'o que falta no idioma do cliente cai no padrão (pt-BR)');
  assert.equal(Object.keys(fr).length, Object.keys(ptBR).length);
});

test('aplicar-config: config/locales com chave desconhecida ou parâmetro inventado é recusado, sem escrever nada', async () => {
  const raiz = await projetoTemporario((c) => { c.idiomas = { padrao: 'pt-BR', disponiveis: ['pt-BR', 'fr'] }; });
  fs.mkdirSync(path.join(raiz, 'config', 'locales'));
  fs.writeFileSync(path.join(raiz, 'config', 'locales', 'fr.json'), JSON.stringify({ 'site.inicioo': 'Accueil', 'site.semCapa': 'Sans {image}' }));
  const { aplicarConfig } = await imp('scripts/aplicar-config.mjs');
  const r = await aplicarConfig({ raiz });
  assert.equal(r.ok, false);
  assert.equal(r.erros.length, 2);
  assert.match(r.erros[0].mensagem, /Quis dizer "site\.inicio"/);
  assert.match(r.erros[1].mensagem, /usa \{image\}/);
  assert.ok(!fs.existsSync(path.join(raiz, 'core/site/locales')), 'com erro, nada é gravado');
});

test('os catálogos gerados do repositório estão em dia', async () => {
  const { aplicarConfig } = await imp('scripts/aplicar-config.mjs');
  const r = await aplicarConfig({ raiz: RAIZ, verificar: true });
  assert.deepEqual(r.alterados.filter((a) => /locales|index\.html|admin\.html/.test(a)), [], 'rode: node scripts/aplicar-config.mjs');
  for (const id of ['pt-BR', 'en', 'es']) assert.ok(fs.existsSync(path.join(SITE, 'locales', id + '.json')), id);
});

test('trocar marca.nome e o idioma não deixa nenhuma string do exemplo no site gerado', async () => {
  const raiz = await projetoTemporario((c) => { c.marca.nome = 'Outra Casa'; c.marca.nomeCurto = 'Outra'; c.marca.organizacao = 'Outra Org'; c.marca.descricao = 'Outra descrição.'; c.idiomas.padrao = 'es'; c.idiomas.disponiveis = ['es']; });
  const { aplicarConfig } = await imp('scripts/aplicar-config.mjs');
  assert.equal((await aplicarConfig({ raiz })).ok, true);
  for (const f of ['index.html', 'admin.html', 'locales/pt-BR.json', 'locales/en.json', 'locales/es.json', 'config.public.json', 'manifest.webmanifest']) {
    const t = fs.readFileSync(path.join(raiz, 'core/site', f), 'utf8');
    assert.ok(!/Plataforma Exemplo|Organização Exemplo/.test(t), `${f} ainda tem a marca do exemplo`);
  }
  assert.match(fs.readFileSync(path.join(raiz, 'core/site/index.html'), 'utf8'), /<html lang="es">/);
});

/* --------------------------------------------------------------- o site e a mesa */

test('o HTML só usa data-i18n com chave que existe no catálogo', () => {
  for (const f of ['index.html', 'admin.html']) {
    const html = ler('core/site/' + f);
    const chaves = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    for (const par of [...html.matchAll(/data-i18n-attr="([^"]+)"/g)]) chaves.push(...par[1].split(';').map((p) => p.split(':')[1]));
    assert.ok(chaves.length > 5, f);
    for (const c of chaves) assert.ok(c in ptBR, `${f}: a chave ${c} não existe no pt-BR`);
  }
});

test('o seletor de idioma: escondido no HTML, ligado pelo app.js só com mais de um idioma', () => {
  const html = ler('core/site/index.html');
  assert.match(html, /<div class="topo-idioma" id="idioma-caixa" hidden>/);
  assert.match(html, /<select id="idioma"/);
  assert.match(html, /<script src="i18n\.js"><\/script>\s*<script src="catalogo-core\.js"><\/script>/, 'o i18n.js carrega antes do core');
  const app = ler('core/site/app.js');
  const liga = app.match(/function ligarSeletorIdioma\(r\) \{([\s\S]*?)\n  \}/);
  assert.ok(liga, 'não achei ligarSeletorIdioma');
  assert.match(liga[1], /r\.disponiveis\.length < 2/, 'com um idioma só o seletor não aparece');
  assert.match(liga[1], /idi\.seletorVisivel === false/, 'o cliente pode esconder o seletor');
  assert.match(liga[1], /mesa\.ligada/, 'dentro da mesa o idioma do site em edição não se troca por ali');
  assert.match(liga[1], /AppI18n|I18n\.trocarIdioma/);
  assert.match(liga[1], /caixa\.hidden = false/);
  /* O app só desenha depois de o idioma chegar, e a falha de rede espera por ele. */
  assert.match(app, /Promise\.all\(\[idiomaPronto, carregar\(idiomaPronto\)\]\)/);
  const css = ler('core/site/idioma.css');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'o idioma.css não escreve cor: usa as variáveis do tema');
});

test('a mesa carrega o idioma ANTES dos scripts dela, em ordem, e oferece os três idiomas', () => {
  const admin = ler('core/site/admin.html');
  assert.deepEqual([...admin.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['i18n.js', 'mesa-inicio.js']);
  const inicio = ler('core/site/mesa-inicio.js');
  const ordem = [...inicio.matchAll(/'([\w./-]+\.js)'/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['vendor/tus.min.js', 'catalogo-core.js', 'indice-core.js', 'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa-acesso.js', 'mesa.js']);
  assert.match(inicio, /disponiveis: I18n\.IDIOMAS_DE_FABRICA/);
  assert.match(inicio, /tag\.async = false/);
  assert.match(ler('core/site/mesa.js'), /index\.html\?mesa=1&idioma=/, 'o site no quadro abre no idioma da mesa');
});

test('a mesa traduz o erro da API pelo código, com os parâmetros, e cai na mensagem do servidor', () => {
  const base = ler('core/site/mesa-base.js');
  assert.match(base, /I18n\.tem\('api\.' \+ corpo\.codigo\)/);
  assert.match(base, /tr\('api\.' \+ corpo\.codigo, corpo\.params\)/);
  assert.match(base, /new Error\(M\.mensagemDeErro\(corpo, r\.status\)\)/);
  /* E ninguém lê `corpo.erro` direto para mostrar na tela. */
  for (const f of ['mesa.js', 'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js']) {
    assert.ok(!/new Error\(corpo\.erro/.test(ler('core/site/' + f)), `${f} mostra corpo.erro sem passar pelo código`);
  }
});

test('nenhuma data, hora ou ordenação fixa em pt-BR: tudo pelo idioma de agora', () => {
  const arquivos = [];
  const varrer = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) { if (!/vendor|locales/.test(n)) varrer(f); } else if (/\.(js|mjs)$/.test(n) && n !== 'i18n.js') arquivos.push(f); } };
  varrer(path.join(RAIZ, 'core', 'site')); varrer(path.join(RAIZ, 'core', 'worker'));
  const fixos = [];
  for (const f of arquivos) {
    const fonte = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/toLocale(?:Date|Time)?String\(\s*['"]pt/.test(fonte) || /localeCompare\([^)]*['"]pt(?:-BR)?['"]\s*\)/.test(fonte)) fixos.push(path.relative(RAIZ, f));
  }
  assert.deepEqual(fixos, []);
});

test('o player e o app não trazem texto de interface escrito à mão: tudo por tr()', () => {
  for (const f of ['app.js', 'player.js', 'player-core.js']) {
    const fonte = ler('core/site/' + f);
    assert.ok(/function tr\(chave, params\)/.test(fonte), `${f} sem o alias tr`);
  }
  assert.match(ler('core/site/player-core.js'), /tr\('player\.volumePct'/);
});
