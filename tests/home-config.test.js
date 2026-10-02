/* M6 — a home e as coleções no config/site.json: o schema aceita o que o saneador aceita, recusa o que ele descartaria,
 * e os dois não divergem (os tipos de bloco e os parâmetros de cada um moram em home-blocos.js e no schema). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AppHome = require('../core/site/home-blocos.js');
const RAIZ = path.join(__dirname, '..');
const validar = () => import('../core/worker/_lib/config-validar.mjs');
const schema = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'site.schema.json'), 'utf8'));
const base = () => JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'site.json'), 'utf8'));
const com = (mudar) => { const c = base(); mudar(c); return c; };

test('o schema e o registro de blocos falam dos mesmos tipos e dos mesmos parâmetros', () => {
  const item = schema.properties.home.properties.blocos.items;
  assert.deepEqual(item.properties.tipo.enum.slice().sort(), Object.keys(AppHome.TIPOS).sort(), 'tipos diferentes entre o schema e home-blocos.js');
  const comuns = ['id', 'tipo', 'titulo', 'escondido', 'visibilidade'];
  const doSchema = Object.keys(item.properties).filter((k) => !comuns.includes(k)).sort();
  const doCodigo = [...new Set(Object.values(AppHome.PARAMETROS).flat())].sort();
  assert.deepEqual(doSchema, doCodigo, 'parâmetros diferentes entre o schema e home-blocos.js');
  assert.deepEqual(item.properties.visibilidade.enum, AppHome.VISIBILIDADES);
  assert.equal(item.additionalProperties, false, 'um parâmetro com erro de digitação passaria calado');
  assert.deepEqual(schema.properties.catalogo.properties.modeloDeConteudo.enum, AppHome.MODELOS);
  assert.deepEqual(schema.properties.catalogo.properties.colecoes.items.properties.classe.enum, AppHome.CLASSES_DE_COLECAO);
  assert.equal(schema.properties.home.properties.blocos.maxItems, AppHome.LIMITE_BLOCOS);
  /* A lista padrão e as coleções padrão passam pelo próprio schema. */
});

test('config padrão: sem home.blocos, sem catalogo.colecoes, seriado, sem service worker, Minha lista ligada', async () => {
  const { validarConfig } = await validar();
  const r = validarConfig(schema, base());
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(r.config.home.blocos, undefined);
  assert.equal(r.config.catalogo.colecoes, undefined);
  assert.equal(r.config.catalogo.modeloDeConteudo, 'seriado');
  assert.equal(r.config.recursos.pwaCacheDoShell, false);
  assert.equal(r.config.recursos.minhaLista, true);
});

test('a lista padrão de blocos e as coleções padrão são válidas no schema', async () => {
  const { validarConfig } = await validar();
  for (const modelo of AppHome.MODELOS) {
    const r = validarConfig(schema, com((c) => {
      c.home = { blocos: AppHome.blocosPadrao(modelo) };
      c.catalogo = { modeloDeConteudo: modelo, colecoes: AppHome.colecoesPadrao().map((x) => { const { nomeChave, ...resto } = x; return resto; }) };
    }));
    assert.equal(r.ok, true, modelo + ': ' + JSON.stringify(r.erros));
  }
});

test('o schema recusa o que o saneador descartaria: tipo inventado, parâmetro estranho, limite, id e visibilidade ruins', async () => {
  const { validarConfig } = await validar();
  const ruim = (bloco) => validarConfig(schema, com((c) => { c.home = { blocos: [bloco] }; }));
  for (const b of [
    { tipo: 'nao-existe' },
    { tipo: 'busca', parametroInventado: 1 },
    { tipo: 'prateleira-recentes', limite: 0 },
    { tipo: 'prateleira-recentes', limite: 101 },
    { tipo: 'prateleira-recentes', limite: '12' },
    { tipo: 'busca', id: 'Id Com Espaço' },
    { tipo: 'busca', visibilidade: 'quase-todos' },
    { tipo: 'busca', escondido: 'sim' },
    { tipo: 'prateleira-duracao', ate: 0 },
    { tipo: 'prateleira-colecao', colecao: 'Com Espaço' },
    { tipo: 'carrossel', titulos: 'a,b' },
    { tipo: 'texto', texto: 'texto puro' },
    { tipo: 'texto', texto: { 'portugues': 'x' } },
    { tipo: 'busca', titulo: { 'pt-BR': 'x'.repeat(301) } },
    {}
  ]) {
    assert.equal(ruim(b).ok, false, 'o schema aceitou ' + JSON.stringify(b));
  }
  assert.equal(validarConfig(schema, com((c) => { c.home = { blocos: Array.from({ length: 41 }, () => ({ tipo: 'busca' })) }; })).ok, false, 'mais de 40 blocos');
  assert.equal(validarConfig(schema, com((c) => { c.catalogo = { modeloDeConteudo: 'filme' }; })).ok, false);
  assert.equal(validarConfig(schema, com((c) => { c.catalogo = { colecoes: [{ id: 'x', classe: 'inventada' }] }; })).ok, false);
  assert.equal(validarConfig(schema, com((c) => { c.catalogo = { colecoes: [{ nome: 'sem id' }] }; })).ok, false);
});

test('o que o schema aceita sobrevive ao saneador sem perda (config e mesa falam a mesma língua)', async () => {
  const { validarConfig } = await validar();
  const blocos = [
    { id: 'a', tipo: 'destaque', escondido: true, visibilidade: 'logado', titulo: { 'pt-BR': 'x', en: 'y' } },
    { id: 'b', tipo: 'prateleira-duracao', de: 60, ate: 300, minimoDeTitulos: 2, incluirInstitucional: true },
    { id: 'c', tipo: 'prateleira-colecao', colecao: 'minha-colecao', limite: 10 },
    { id: 'd', tipo: 'carrossel', titulos: ['x', 'y'] },
    { id: 'e', tipo: 'banner', texto: { 'pt-BR': 'Olá' }, imagem: 'marca/faixa.jpg', link: '#/series' },
    { id: 'f', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: false },
    { id: 'g', tipo: 'minha-lista', limite: 5 },
    { id: 'h', tipo: 'continuar-assistindo' }
  ];
  const r = validarConfig(schema, com((c) => { c.home = { blocos }; }));
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.deepEqual(AppHome.blocosSaneados(r.config.home.blocos), blocos.map((b) => JSON.parse(JSON.stringify(b))), 'o saneador mexeu no que o schema aceitou');

  const colecoes = [{ id: 'minha-colecao', nome: { 'pt-BR': 'Minha' }, classe: 'curta', series: ['A'], tags: ['t'], titulos: ['x'] }];
  const r2 = validarConfig(schema, com((c) => { c.catalogo = { colecoes }; }));
  assert.equal(r2.ok, true, JSON.stringify(r2.erros));
  assert.deepEqual(AppHome.colecoesSaneadas(r2.config.catalogo.colecoes), colecoes);
});

test('home.blocos é operação: o KV pode trocar (seção home), e um bloco inválido no KV é ignorado com aviso', async () => {
  const { montarConfig } = await import('../core/worker/_lib/config.js');
  const ok = montarConfig(schema, base(), { home: { blocos: [{ tipo: 'busca' }] } });
  assert.equal(ok._estado.operacaoAplicada, true);
  assert.deepEqual(ok.home.blocos, [{ tipo: 'busca' }]);
  const ruim = montarConfig(schema, base(), { home: { blocos: [{ tipo: 'nao-existe' }] } });
  assert.equal(ruim._estado.operacaoAplicada, false);
  assert.ok(ruim._estado.avisos.some((a) => /não passou na validação/.test(a)), 'sem aviso do override inválido');
  assert.equal(ruim.home.blocos, undefined, 'o override inválido valeu');
});

test('a config pública não leva home nem catalogo (a home chega pelo catálogo, com o que a mesa escolheu por cima)', async () => {
  const pub = JSON.parse(fs.readFileSync(path.join(RAIZ, 'core', 'site', 'config.public.json'), 'utf8'));
  assert.ok(!('home' in pub) && !('catalogo' in pub));
  assert.equal(pub.recursos.minhaLista, true);
});
