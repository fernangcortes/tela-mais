/* M6 — a home por blocos (home-blocos.js) e as coleções livres: sem navegador, sem rede.
 *
 * O aceite do plano para esta parte: "com config padrão o comportamento é idêntico ao produto original
 * (teste de equivalência das prateleiras)". O primeiro bloco de testes carrega uma CÓPIA CONGELADA do algoritmo
 * de antes dos blocos (o `prateleiras()` da M5, com as listas SERIES_* escritas no código) e exige que o
 * resultado do registro de blocos seja o mesmo, em vários catálogos e com as escolhas da mesa por cima.
 * Se alguém mudar o padrão de propósito, este teste é onde a mudança precisa ser dita. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const App = require('../core/site/catalogo-core.js');
const AppHome = require('../core/site/home-blocos.js');

const RAIZ = path.join(__dirname, '..');

/* ------------------------------------------------ o algoritmo de ANTES (congelado) */

const ANTES = {
  INSTITUCIONAIS: ['Institucional', 'Eventos', 'Bastidores', 'A classificar'],
  CURTAS: ['Curtas — Exemplo A', 'Curtas — Exemplo B'],
  MINIMO: 3,
  CURTO: 300
};

function classeAntes(nome, site) {
  const escolhida = App.siteSaneado(site).classes[nome];
  if (escolhida) return escolhida;
  if (ANTES.INSTITUCIONAIS.indexOf(nome) >= 0) return 'institucional';
  if (ANTES.CURTAS.indexOf(nome) >= 0) return 'curta';
  return 'pedagogica';
}

function prateleirasAntes(itens, site) {
  const base = App.ordenar(App.publicaveis(itens));
  const saida = [];
  const inst = (i) => classeAntes(i.serie || '', site) === 'institucional';
  const curta = (i) => classeAntes(i.serie || '', site) === 'curta';
  const curtos = base.filter((i) => !inst(i) && typeof i.duracao_seg === 'number' && i.duracao_seg > 0 && i.duracao_seg <= ANTES.CURTO);
  if (curtos.length >= ANTES.MINIMO) saida.push({ id: 'curtos', titulo: 'Até 5 minutos', itens: curtos });
  const porSerie = [];
  const indice = Object.create(null);
  base.forEach((i) => {
    if (inst(i) || curta(i)) return;
    const nome = i.serie || App.semSerie();
    if (!(nome in indice)) { indice[nome] = porSerie.length; porSerie.push({ serie: nome, itens: [] }); }
    porSerie[indice[nome]].itens.push(i);
  });
  const grandes = porSerie.filter((g) => g.itens.length >= ANTES.MINIMO);
  grandes.sort((a, b) => (a.itens.length !== b.itens.length ? b.itens.length - a.itens.length : App.normalizar(a.serie).localeCompare(App.normalizar(b.serie), 'pt-BR')));
  grandes.forEach((g) => saida.push({ id: 'serie:' + g.serie, titulo: g.serie, itens: g.itens }));
  let restos = [];
  porSerie.forEach((g) => { if (g.itens.length < ANTES.MINIMO) restos = restos.concat(g.itens); });
  if (restos.length) saida.push({ id: 'mais-series', titulo: 'Mais séries', itens: App.ordenar(restos) });
  const curtas = base.filter(curta);
  if (curtas.length) saida.push({ id: 'curtas', titulo: 'Curtas', itens: curtas });
  const insts = base.filter(inst);
  if (insts.length) saida.push({ id: 'institucional', titulo: 'Institucional', itens: insts });

  /* As escolhas da mesa de antes: ordem na frente, o resto na ordem do código; nome; escondida. */
  const cfg = App.siteSaneado(site);
  const comIndice = saida.map((p, i) => {
    const e = cfg.prateleiras[p.id] || {};
    if (e.titulo) p.titulo = e.titulo;
    if (e.escondida) p.escondida = true;
    return { p, i, ordem: typeof e.ordem === 'number' ? e.ordem : null };
  });
  comIndice.sort((a, b) => {
    if (a.ordem === null && b.ordem === null) return a.i - b.i;
    if (a.ordem === null) return 1;
    if (b.ordem === null) return -1;
    return a.ordem !== b.ordem ? a.ordem - b.ordem : a.i - b.i;
  });
  return comIndice.map((x) => x.p);
}

const mini = (ps) => ps.map((p) => ({ id: p.id, titulo: p.titulo, itens: p.itens.map((i) => i.id), escondida: p.escondida === true }));

/* ------------------------------------------------------------- catálogos */

function titulos(serie, n, extra) {
  return Array.from({ length: n }, (_, k) => Object.assign({ id: serie.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (k + 1), titulo: serie + ' ' + (k + 1), serie, episodio: k + 1, duracao_seg: 600 + k * 30, publicar: true }, extra || {}));
}

const GRANDE = [].concat(
  titulos('Série Exemplo 1', 4),
  titulos('Série Exemplo 2', 2),
  titulos('Série Exemplo 3', 5, { duracao_seg: 240 }),
  titulos('Série Exemplo 4', 1),
  titulos('Curtas — Exemplo A', 2, { duracao_seg: 120 }),
  titulos('Curtas — Exemplo B', 1, { duracao_seg: 100 }),
  titulos('Eventos', 3, { duracao_seg: 60 }),
  titulos('A classificar', 1, { duracao_seg: 3000 }),
  [{ id: 'sem-serie', titulo: 'Sem série', duracao_seg: 200, publicar: true }],
  [{ id: 'oculto', titulo: 'Fora do ar', serie: 'Série Exemplo 1', episodio: 9, duracao_seg: 400, publicar: false }]
);

const exemplo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'exemplo', 'catalogo.json'), 'utf8'));
const MAGRO = [
  { id: 'a', titulo: 'A', serie: 'Série Exemplo 3', duracao_seg: 900, publicar: true },
  { id: 'b', titulo: 'B', serie: 'Eventos', duracao_seg: 900, publicar: true }
];

const CATALOGOS = { grande: GRANDE, exemplo: exemplo.itens, magro: MAGRO, vazio: [] };

const SITES = {
  nenhum: null,
  vazio: {},
  'a estrutura da M4 por cima': {
    prateleiras: { institucional: { titulo: 'Da rede', ordem: 0 }, curtos: { ordem: 1 }, 'mais-series': { escondida: true } },
    classes: { Eventos: 'pedagogica', 'Série Exemplo 4': 'institucional' },
    textos: { rodape: 'x' }
  }
};

/* ============================================================ equivalência */

test('com a config padrão a chegada é IDÊNTICA à de antes dos blocos (todos os catálogos, com e sem escolhas da mesa)', () => {
  for (const [nomeCat, itens] of Object.entries(CATALOGOS)) {
    for (const [nomeSite, site] of Object.entries(SITES)) {
      assert.deepEqual(mini(App.prateleiras(itens, site)), mini(prateleirasAntes(itens, site)),
        `catálogo "${nomeCat}", site "${nomeSite}": as prateleiras mudaram`);
    }
  }
});

test('o site que o servidor entrega com o config padrão desenha a mesma chegada', () => {
  const padroes = AppHome.padroesDaConfig({ home: {}, catalogo: { modeloDeConteudo: 'seriado' }, idiomas: { disponiveis: ['pt-BR'] } });
  assert.deepEqual(padroes.blocos, undefined, 'o config padrão não tem lista de blocos: vale o código');
  assert.equal(padroes.modeloDeConteudo, undefined, 'seriado é o padrão e não viaja');
  const site = App.siteComPadroes(App.siteSaneado(null), padroes);
  assert.deepEqual(mini(App.prateleiras(GRANDE, site)), mini(prateleirasAntes(GRANDE, null)));
  assert.deepEqual(App.siteSaneado(null), { destaque: null, prateleiras: {}, classes: {}, textos: {}, series: {} },
    'o site sem escolha nenhuma ganhou chave nova: a forma de antes tem de continuar a mesma');
});

test('a sequência padrão é: destaque, e depois as fileiras, na ordem de sempre', () => {
  const h = App.home(GRANDE, null);
  assert.equal(h.sequencia[0].tipo, 'destaque');
  assert.deepEqual(h.sequencia.slice(1).map((e) => e.prateleira.id), h.prateleiras.map((p) => p.id));
  assert.deepEqual(h.prateleiras.map((p) => p.id), ['curtos', 'serie:Série Exemplo 3', 'serie:Série Exemplo 1', 'mais-series', 'curtas', 'institucional']);
});

test('todo título publicado aparece em pelo menos uma fileira, e o não publicado em nenhuma', () => {
  for (const [nome, itens] of Object.entries(CATALOGOS)) {
    const vistos = new Set();
    for (const p of App.prateleiras(itens)) p.itens.forEach((i) => vistos.add(i.id));
    const publicados = App.publicaveis(itens).map((i) => i.id);
    assert.deepEqual([...vistos].sort(), publicados.slice().sort(), nome);
    assert.ok(!vistos.has('oculto'));
  }
});

/* ============================================================ coleções livres */

test('as listas SERIES_* saíram do código: o padrão são duas coleções, que o config ou a mesa trocam', () => {
  for (const nome of ['SERIES_INSTITUCIONAIS', 'SERIES_CURTAS', 'SERIES_PEDAGOGICAS']) assert.ok(!(nome in App), nome + ' voltou');
  const padrao = App.colecoesEfetivas(null);
  assert.deepEqual(padrao.map((c) => [c.id, c.classe]), [['curtas', 'curta'], ['institucional', 'institucional']]);

  /* O cliente troca pelas coleções DELE: as séries de exemplo deixam de ser curtas e institucionais. */
  const site = { colecoes: [
    { id: 'palestras', nome: { 'pt-BR': 'Palestras' }, series: ['Série Exemplo 1'] },
    { id: 'bastidores', nome: 'Bastidores', classe: 'institucional', series: ['Série Exemplo 2'] }
  ] };
  assert.equal(App.classeDaSerie('Eventos', site), 'pedagogica', 'a lista de exemplo continuou valendo');
  assert.equal(App.classeDaSerie('Série Exemplo 2', site), 'institucional');
  assert.equal(App.classeDaSerie('Série Exemplo 1', site), 'pedagogica', 'coleção de seleção não exclui a série das outras fileiras');
});

test('a coleção de seleção é uma fileira a mais: não tira as séries das fileiras por série', () => {
  const site = {
    colecoes: [{ id: 'palestras', nome: { 'pt-BR': 'Palestras' }, series: ['Série Exemplo 1'], tags: ['destaque'] }],
    blocos: [{ id: 'series', tipo: 'prateleira-por-serie' }, { id: 'palestras', tipo: 'prateleira-colecao', colecao: 'palestras' }, { id: 'resto', tipo: 'prateleira-restante' }]
  };
  const itens = GRANDE.map((i) => (i.id === 'serie-exemplo-2-1' ? Object.assign({}, i, { tags: ['Destaque'] }) : i));
  const ps = App.prateleiras(itens, site);
  const palestras = ps.find((p) => p.id === 'palestras');
  assert.equal(palestras.titulo, 'Palestras');
  assert.deepEqual(palestras.itens.map((i) => i.id).sort(), ['serie-exemplo-1-1', 'serie-exemplo-1-2', 'serie-exemplo-1-3', 'serie-exemplo-1-4', 'serie-exemplo-2-1']);
  assert.ok(ps.find((p) => p.id === 'serie:Série Exemplo 1'), 'a série saiu da fileira própria por estar numa coleção de seleção');
});

test('a coleção exclusiva tira as séries das outras fileiras; títulos escolhidos à mão vão na frente', () => {
  const site = {
    colecoes: [{ id: 'oficiais', nome: 'Oficiais', classe: 'institucional', series: ['Série Exemplo 1'], titulos: ['serie-exemplo-3-5'] }],
    blocos: [{ id: 'series', tipo: 'prateleira-por-serie' }, { id: 'oficiais', tipo: 'prateleira-colecao', colecao: 'oficiais' }]
  };
  const ps = App.prateleiras(GRANDE, site);
  assert.ok(!ps.some((p) => p.id === 'serie:Série Exemplo 1'));
  const of = ps.find((p) => p.id === 'oficiais');
  assert.equal(of.itens[0].id, 'serie-exemplo-3-5', 'o título escolhido à mão não foi na frente');
  assert.equal(of.itens.length, 5);
});

test('o nome da coleção segue o idioma, e a de fábrica continua traduzida', () => {
  const I18n = require('../core/site/i18n.js');
  const col = { id: 'x', nome: { 'pt-BR': 'Palestras', en: 'Talks' } };
  const P = { tr: (c) => c, idiomaAtual: () => 'en', idiomaPadrao: () => 'pt-BR' };
  assert.equal(AppHome.nomeDaColecao(col, P), 'Talks');
  assert.equal(AppHome.nomeDaColecao(col, Object.assign({}, P, { idiomaAtual: () => 'es' })), 'Palestras', 'sem o idioma, cai no padrão do site');
  assert.equal(AppHome.nomeDaColecao({ id: 'curtas', nomeChave: 'catalogo.curtas' }, P), 'catalogo.curtas');
  assert.equal(App.prateleiras(GRANDE).find((p) => p.id === 'curtas').titulo, I18n.t('catalogo.curtas'));
});

/* ============================================================ os tipos de bloco */

const home = (blocos, itens, extra, contexto) => App.home(itens || GRANDE, Object.assign({ blocos }, extra || {}), contexto);

test('prateleira-recentes: os últimos que entraram, do mais novo ao mais velho; adicionado_em manda quando existe', () => {
  const ids = (h) => h.prateleiras[0].itens.map((i) => i.id);
  const h = home([{ id: 'novidades', tipo: 'prateleira-recentes', limite: 3 }]);
  assert.deepEqual(ids(h), ['sem-serie', 'a-classificar-1', 'eventos-3'], 'a ordem do catálogo, de trás para a frente');
  assert.equal(h.prateleiras[0].titulo, require('../core/site/i18n.js').t('home.novidades'));

  const datados = GRANDE.map((i) => (i.id === 'serie-exemplo-1-1' ? Object.assign({}, i, { adicionado_em: '2099-01-01T00:00:00Z' }) : i));
  assert.equal(home([{ id: 'novidades', tipo: 'prateleira-recentes', limite: 3 }], datados).prateleiras[0].itens[0].id, 'serie-exemplo-1-1');
});

test('prateleira-duracao: até, a partir de e entre; o mínimo esconde a fileira; institucional só se pedir', () => {
  const fil = (b, itens) => home([Object.assign({ id: 'd', tipo: 'prateleira-duracao' }, b)], itens).prateleiras;
  assert.deepEqual(fil({ ate: 300 })[0].itens.map((i) => i.id).includes('eventos-1'), false, 'institucional entrou sem ser pedido');
  assert.equal(fil({ ate: 300, incluirInstitucional: true })[0].itens.some((i) => i.id === 'eventos-1'), true);
  assert.deepEqual(fil({ ate: 300, minimoDeTitulos: 50 }), [], 'o mínimo não escondeu a fileira');
  const longos = fil({ de: 600 });
  assert.ok(longos[0].itens.every((i) => i.duracao_seg >= 600));
  assert.match(longos[0].titulo, /600|10/, 'o título automático não diz a duração');
  const entre = fil({ de: 600, ate: 700 });
  assert.ok(entre[0].itens.every((i) => i.duracao_seg >= 600 && i.duracao_seg <= 700));
  assert.equal(fil({ ate: 300, titulo: { 'pt-BR': 'Rapidinhos' } })[0].titulo, 'Rapidinhos');
});

test('carrossel: só os títulos escolhidos, na ordem escolhida, e só os que estão no ar', () => {
  const h = home([{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-2', 'oculto', 'nao-existe', 'serie-exemplo-1-1'], titulo: 'Escolhas' }]);
  assert.deepEqual(h.prateleiras[0].itens.map((i) => i.id), ['eventos-2', 'serie-exemplo-1-1']);
  assert.equal(h.prateleiras[0].titulo, 'Escolhas');
  assert.deepEqual(home([{ id: 'sel', tipo: 'carrossel', titulos: [] }]).prateleiras, [], 'carrossel vazio gerou fileira');
});

test('continuar-assistindo e minha-lista vêm do contexto de quem olha; sem contexto, nada', () => {
  const blocos = [{ id: 'continuar', tipo: 'continuar-assistindo', limite: 2 }, { id: 'lista', tipo: 'minha-lista' }];
  assert.deepEqual(home(blocos).prateleiras, [], 'sem contexto não há o que mostrar');
  const mapa = {
    'serie-exemplo-1-1': { t: 120, d: 600, q: 100 },
    'serie-exemplo-1-2': { t: 60, d: 630, q: 300 },
    'serie-exemplo-1-3': { t: 20, d: 660, q: 200 },
    'serie-exemplo-1-4': { t: 680, d: 690, q: 400 },     /* quase no fim: já terminou */
    oculto: { t: 100, d: 400, q: 999 }
  };
  const h = home(blocos, null, null, { logado: true, ondeParou: mapa, minhaLista: ['eventos-1', 'oculto', 'sem-serie'] });
  assert.deepEqual(h.prateleiras.map((p) => p.id), ['continuar', 'lista']);
  assert.deepEqual(h.prateleiras[0].itens.map((i) => i.id), ['serie-exemplo-1-2', 'serie-exemplo-1-3'], 'o visto por último vem primeiro, sem o terminado, sem o fora do ar, no limite');
  assert.deepEqual(h.prateleiras[1].itens.map((i) => i.id), ['eventos-1', 'sem-serie'], 'a lista segue a ordem em que foi guardada e ignora o que saiu do ar');
  assert.deepEqual(home(blocos, null, null, { minhaLista: null }).prateleiras, [], 'sem conta não há Minha lista');
});

test('visibilidade: "logado" só com conta, "anonimo" só sem, e a mesa vê todos', () => {
  const blocos = [
    { id: 'todos', tipo: 'carrossel', titulos: ['eventos-1'] },
    { id: 'so-logado', tipo: 'carrossel', titulos: ['eventos-2'], visibilidade: 'logado' },
    { id: 'so-anonimo', tipo: 'carrossel', titulos: ['eventos-3'], visibilidade: 'anonimo' }
  ];
  const ids = (ctx) => home(blocos, null, null, ctx).prateleiras.map((p) => p.id);
  assert.deepEqual(ids({ logado: false }), ['todos', 'so-anonimo']);
  assert.deepEqual(ids({ logado: true }), ['todos', 'so-logado']);
  assert.deepEqual(ids({ ignorarVisibilidade: true }), ['todos', 'so-logado', 'so-anonimo']);
  assert.deepEqual(ids(undefined), ['todos', 'so-anonimo'], 'sem contexto, a pessoa é anônima');
});

test('título por idioma: o do idioma, o da mesma língua, o do padrão do site, e por fim qualquer um', () => {
  const t = { 'pt-BR': 'Novidades', en: 'New', es: 'Novedades' };
  assert.equal(AppHome.tituloNoIdioma(t, 'en', 'pt-BR'), 'New');
  assert.equal(AppHome.tituloNoIdioma(t, 'en-GB', 'pt-BR'), 'New', 'região diferente, mesma língua');
  assert.equal(AppHome.tituloNoIdioma(t, 'fr', 'pt-BR'), 'Novidades');
  assert.equal(AppHome.tituloNoIdioma({ es: 'Novedades' }, 'fr', 'pt-BR'), 'Novedades');
  assert.equal(AppHome.tituloNoIdioma('Texto único', 'fr', 'pt-BR'), 'Texto único');
  assert.equal(AppHome.tituloNoIdioma(undefined, 'pt-BR', 'pt-BR'), '');

  const I18n = require('../core/site/i18n.js');
  const anterior = I18n.idioma();
  try {
    I18n.instancia().definirIdioma('en');
    assert.equal(home([{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-1'], titulo: t }]).prateleiras[0].titulo, 'New');
  } finally { I18n.instancia().definirIdioma(anterior); }
});

test('prateleira-restante com garantia: nenhum título fica de fora, nem com blocos apagados', () => {
  /* Sem nenhum outro bloco, o restante recolhe TUDO. */
  const so = home([{ id: 'resto', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: true }]);
  assert.equal(so.prateleiras[0].itens.length, App.publicaveis(GRANDE).length);

  /* Tirou a fileira "curtas" e "institucional" da lista: as séries delas ainda são exclusivas, mas ninguém as mostra.
   * Com a garantia ligada elas caem no restante; desligada, o dono escolheu deixá-las de fora. */
  const base = [{ id: 'series', tipo: 'prateleira-por-serie' }];
  const com = home(base.concat([{ id: 'resto', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: true }]));
  const sem = home(base.concat([{ id: 'resto', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: false }]));
  const vistos = (h) => new Set(h.prateleiras.flatMap((p) => p.itens.map((i) => i.id)));
  for (const i of App.publicaveis(GRANDE)) assert.ok(vistos(com).has(i.id), i.id + ' ficou de fora mesmo com a garantia');
  assert.ok(!vistos(sem).has('eventos-1'), 'sem a garantia o institucional deveria ficar de fora');

  /* A garantia vale para QUALQUER lista de blocos: nenhuma lista com o restante deixa título sem fileira. */
  const listas = [
    [{ id: 'a', tipo: 'prateleira-colecao', colecao: 'curtas' }, { id: 'r', tipo: 'prateleira-restante' }],
    [{ id: 'novidades', tipo: 'prateleira-recentes' }, { id: 'r', tipo: 'prateleira-restante' }],
    [{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-1'] }, { id: 'r', tipo: 'prateleira-restante' }]
  ];
  for (const l of listas) {
    for (const i of App.publicaveis(GRANDE)) assert.ok(vistos(home(l)).has(i.id), JSON.stringify(l[0].tipo) + ': ' + i.id + ' ficou de fora');
  }
});

test('bloco escondido continua na lista (o "Ver tudo" e a mesa leem dela), mas some da sequência', () => {
  const h = home([{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-1'], escondido: true }, { id: 'sel2', tipo: 'carrossel', titulos: ['eventos-2'] }]);
  assert.equal(h.prateleiras.find((p) => p.id === 'sel').escondida, true);
  assert.ok(App.prateleiraPorId(GRANDE, 'sel', { blocos: [{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-1'], escondido: true }] }));
  assert.deepEqual(App.prateleirasVisiveis(GRANDE, { blocos: [{ id: 'sel', tipo: 'carrossel', titulos: ['eventos-1'], escondido: true }] }), []);
});

test('texto, banner e busca: blocos que não são fileiras; link e imagem só do próprio site ou https', () => {
  const h = home([
    { id: 'aviso', tipo: 'texto', titulo: 'Aviso', texto: { 'pt-BR': 'Primeiro.\n\nSegundo.' } },
    { id: 'faixa', tipo: 'banner', texto: 'Venha', imagem: 'marca/faixa.jpg', link: '#/series' },
    { id: 'achar', tipo: 'busca', titulo: 'Procure' },
    { id: 'vazio', tipo: 'texto' }
  ]);
  assert.deepEqual(h.sequencia.map((e) => e.tipo), ['texto', 'banner', 'busca'], 'o texto sem conteúdo não vira bloco');
  assert.equal(h.sequencia[0].texto.texto, 'Primeiro.\n\nSegundo.');
  assert.equal(h.sequencia[1].texto.link, '#/series');
  assert.equal(h.sequencia[2].texto.titulo, 'Procure');
  assert.deepEqual(h.prateleiras, []);

  const mau = AppHome.blocosSaneados([
    { tipo: 'banner', texto: 'x', link: 'javascript:alert(1)', imagem: '../../etc/passwd' },
    { tipo: 'banner', texto: 'x', link: 'https://exemplo.com/a', imagem: 'https://exemplo.com/a.png' },
    { tipo: 'banner', texto: 'x', link: '//exemplo.com', imagem: 'data:image/png;base64,AAAA' }
  ]);
  assert.ok(!('link' in mau[0]) && !('imagem' in mau[0]), 'link javascript: ou caminho com .. passou');
  assert.equal(mau[1].link, 'https://exemplo.com/a');
  assert.ok(!('link' in mau[2]) && !('imagem' in mau[2]), 'link sem protocolo ou data: passou');
});

test('a escolha por fileira da M4 (nome, ordem, escondida) continua valendo por cima dos blocos', () => {
  const blocos = [{ id: 'a', tipo: 'carrossel', titulos: ['eventos-1'] }, { id: 'b', tipo: 'carrossel', titulos: ['eventos-2'] }, { id: 'c', tipo: 'carrossel', titulos: ['eventos-3'] }];
  const h = home(blocos, null, { prateleiras: { c: { ordem: 0, titulo: 'Primeira' }, a: { escondida: true } } });
  assert.deepEqual(h.prateleiras.map((p) => p.id), ['c', 'a', 'b'], 'quem tem ordem vai na frente; o resto fica na ordem da lista');
  assert.equal(h.prateleiras[0].titulo, 'Primeira');
  assert.equal(h.prateleiras[1].escondida, true);
  assert.deepEqual(h.sequencia.filter((e) => e.prateleira && !e.prateleira.escondida).map((e) => e.prateleira.id), ['c', 'b']);
});

test('o destaque é um bloco: só o primeiro vale, e escondido ele some', () => {
  assert.equal(home([{ id: 'd1', tipo: 'destaque' }, { id: 'd2', tipo: 'destaque' }]).sequencia.length, 1);
  assert.equal(home([{ id: 'd1', tipo: 'destaque', escondido: true }]).sequencia.length, 0);
  assert.equal(home([{ id: 'x', tipo: 'busca' }, { id: 'd1', tipo: 'destaque' }]).sequencia[0].tipo, 'busca', 'a ordem da lista manda');
});

/* ============================================================ modelo de conteúdo */

test('modeloDeConteudo: seriado é o padrão; avulso troca a lista padrão e vem do site', () => {
  assert.equal(App.modeloDeConteudo(null), 'seriado');
  assert.equal(App.modeloDeConteudo({ modeloDeConteudo: 'inventado' }), 'seriado');
  assert.equal(App.modeloDeConteudo({ modeloDeConteudo: 'avulso' }), 'avulso');
  const avulso = App.home(GRANDE, { modeloDeConteudo: 'avulso' });
  assert.deepEqual(avulso.blocos.map((b) => b.tipo), ['destaque', 'prateleira-recentes', 'prateleira-duracao', 'prateleira-restante', 'prateleira-colecao', 'prateleira-colecao']);
  assert.ok(!avulso.prateleiras.some((p) => p.id.indexOf('serie:') === 0), 'o modelo avulso gerou fileira por série');
  const vistos = new Set(avulso.prateleiras.flatMap((p) => p.itens.map((i) => i.id)));
  for (const i of App.publicaveis(GRANDE)) assert.ok(vistos.has(i.id), i.id + ' ficou de fora no avulso');
  /* Lista escolhida pela mesa ganha do padrão do modelo. */
  assert.deepEqual(App.home(GRANDE, { modeloDeConteudo: 'avulso', blocos: [{ id: 'x', tipo: 'busca' }] }).blocos.map((b) => b.bloco.id), ['x']);
});

/* ============================================================ saneamento e escritas */

test('o saneador de blocos: tipo desconhecido cai, id é único e válido, parâmetros têm limite', () => {
  const s = AppHome.blocosSaneados([
    { tipo: 'inventado' }, 'lixo', null,
    { id: 'x', tipo: 'prateleira-recentes', limite: 500, lixo: true },
    { id: 'x', tipo: 'prateleira-recentes', limite: 5 },
    { id: 'Id Inválido!', tipo: 'busca', titulo: { 'pt-BR': '  Procure  ', xx_YY: 'não', en: '' } },
    { tipo: 'carrossel', titulos: ['a', 'a', 7, '', 'b'] },
    { tipo: 'prateleira-duracao', ate: -3, de: 1.5, minimoDeTitulos: 0 },
    { tipo: 'texto', escondido: 'sim', visibilidade: 'todos' }
  ]);
  assert.equal(s.length, 6);
  assert.deepEqual(s[0], { id: 'x', tipo: 'prateleira-recentes' }, 'limite acima de 100 passou ou campo estranho ficou');
  assert.notEqual(s[1].id, 'x', 'id repetido');
  assert.equal(s[1].limite, 5);
  assert.match(s[2].id, /^[a-z0-9-]{1,40}$/);
  assert.deepEqual(s[2].titulo, { 'pt-BR': 'Procure' });
  assert.deepEqual(s[3].titulos, ['a', 'b']);
  assert.deepEqual(s[4], { id: s[4].id, tipo: 'prateleira-duracao' }, 'duração negativa ou fracionada passou');
  assert.ok(!('escondido' in s[5]) && !('visibilidade' in s[5]), '"sim" não é true e "todos" é o padrão');
  assert.equal(AppHome.blocosSaneados('lixo'), null);
  assert.equal(AppHome.blocosSaneados(undefined), null);
  assert.deepEqual(AppHome.blocosSaneados([]), []);
  assert.equal(AppHome.blocosSaneados(Array.from({ length: 60 }, () => ({ tipo: 'busca' }))).length, AppHome.LIMITE_BLOCOS);
  /* idempotente: sanear o já saneado não muda nada (a mesa compara por valor). */
  assert.deepEqual(AppHome.blocosSaneados(s), s);
  assert.deepEqual(AppHome.blocosInvalidos([{ tipo: 'busca' }, { tipo: 'nao-existe' }, 3]).map((r) => r.indice), [1, 2]);
});

test('o saneador do site guarda as três chaves novas só quando existem, e o siteVazio as vê', () => {
  assert.deepEqual(Object.keys(App.siteSaneado({ blocos: [{ tipo: 'busca' }], colecoes: [{ id: 'a' }], modeloDeConteudo: 'avulso' })).sort(),
    ['blocos', 'classes', 'colecoes', 'destaque', 'modeloDeConteudo', 'prateleiras', 'series', 'textos']);
  assert.equal(App.siteVazio({ blocos: [] }), false, 'uma home deliberadamente vazia é uma escolha');
  assert.equal(App.siteVazio({ modeloDeConteudo: 'avulso' }), false);
  assert.equal(App.siteVazio({ blocos: null, colecoes: 'lixo', modeloDeConteudo: 'x' }), true);
  const s = App.siteSaneado({ colecoes: [{ id: 'ok', series: ['A', 'A', 'B'], classe: 'inventada' }, { id: 'Ruim Id' }, { id: 'ok' }] });
  assert.deepEqual(s.colecoes, [{ id: 'ok', series: ['A', 'B'] }]);
});

test('as escritas da mesa são puras e devolvem listas novas e saneadas', () => {
  const base = AppHome.blocosPadrao('seriado');
  const congelada = JSON.stringify(base);
  const mais = AppHome.comBlocoAdicionado(base, 'minha-lista');
  assert.equal(mais.length, base.length + 1);
  assert.equal(mais[mais.length - 1].tipo, 'minha-lista');
  assert.equal(mais[mais.length - 1].visibilidade, 'logado', 'a Minha lista nasce só para quem tem conta');
  assert.equal(JSON.stringify(base), congelada, 'a escrita mexeu na lista que recebeu');
  const duas = AppHome.comBlocoAdicionado(mais, 'minha-lista');
  assert.notEqual(duas[duas.length - 1].id, mais[mais.length - 1].id, 'dois blocos do mesmo tipo com o mesmo id');
  assert.equal(AppHome.comBlocoAdicionado(base, 'nao-existe').length, base.length);

  assert.deepEqual(AppHome.comBlocoMovido(base, 'series', -1).map((b) => b.id).slice(0, 3), ['destaque', 'series', 'curtos']);
  assert.deepEqual(AppHome.comBlocoMovido(base, 'destaque', -1).map((b) => b.id), base.map((b) => b.id), 'mover o primeiro para cima não faz nada');
  assert.equal(AppHome.comBlocoRemovido(base, 'curtos').length, base.length - 1);
  const oculto = AppHome.comBlocoAlterado(base, 'curtos', { escondido: true, ate: 600 });
  assert.equal(oculto.find((b) => b.id === 'curtos').escondido, true);
  assert.equal(oculto.find((b) => b.id === 'curtos').ate, 600);
  assert.ok(!('escondido' in AppHome.comBlocoAlterado(oculto, 'curtos', { escondido: false }).find((b) => b.id === 'curtos')), 'desligar apaga a chave, não grava false');
  assert.equal(AppHome.comBlocoAlterado(base, 'mais-series', { garantirQueTodoTituloApareca: false }).find((b) => b.id === 'mais-series').garantirQueTodoTituloApareca, false);
  assert.equal(AppHome.comBlocoAlterado(base, 'curtos', { id: 'outro', tipo: 'busca' }).find((b) => b.id === 'curtos').tipo, 'prateleira-duracao', 'id e tipo não se mudam');

  const t = AppHome.comTituloNoIdioma(base, 'curtos', 'en', 'Quick');
  assert.deepEqual(t.find((b) => b.id === 'curtos').titulo, { en: 'Quick' });
  assert.ok(!('titulo' in AppHome.comTituloNoIdioma(t, 'curtos', 'en', '').find((b) => b.id === 'curtos')));

  const cols = AppHome.comColecaoAlterada(AppHome.colecoesPadrao(), { id: 'novas', nome: { 'pt-BR': 'Novas' }, series: ['A'] });
  assert.equal(cols.length, 3);
  assert.equal(AppHome.comColecaoRemovida(cols, 'novas').length, 2);
  assert.equal(AppHome.comColecaoAlterada(cols, { id: 'curtas', nome: { 'pt-BR': 'Rapidinhas' } }).find((c) => c.id === 'curtas').nome['pt-BR'], 'Rapidinhas');
  assert.ok(AppHome.comColecaoAlterada(AppHome.colecoesPadrao(), { id: 'curtas', nome: 'X', nomeChave: 'catalogo.curtas', classe: 'curta', series: ['A'] }).find((c) => c.id === 'curtas').nomeChave === 'catalogo.curtas', 'o nome de fábrica não sobreviveu à gravação da lista');
  assert.match(AppHome.idDeColecaoNova(cols, 'Novas séries!'), /^novas-series/);
  assert.notEqual(AppHome.idDeColecaoNova(cols, 'Novas'), 'novas', 'id de coleção repetido');
});

test('a mesa grava os blocos pelo rascunho: campos novos do site, permissão estrutura, e voltar ao padrão é apagar', () => {
  for (const campo of ['blocos', 'colecoes', 'modeloDeConteudo']) {
    assert.ok(App.CAMPOS_SITE_MESA.includes(campo), campo + ' não é campo da mesa');
    assert.equal(App.permissaoDoCampo('site', campo), 'estrutura');
  }
  const catalogo = { rev: 1, itens: [{ id: 'a', publicar: true }] };
  const lista = AppHome.comBlocoAdicionado(AppHome.blocosPadrao(), 'busca');
  const rasc = App.registrarMudanca([], { alvo: 'site', campo: 'blocos', antes: undefined, depois: lista });
  const aplicado = App.aplicarRascunho(catalogo, rasc);
  assert.deepEqual(App.siteSaneado(aplicado.site).blocos, lista);
  /* "Voltar ao padrão" grava null; o saneador apaga a chave. */
  const volta = App.aplicarRascunho(aplicado, [{ alvo: 'site', campo: 'blocos', antes: lista, depois: null }]);
  assert.ok(!('blocos' in App.siteSaneado(volta.site)));
  /* O Publicar confere o valor cru do servidor: outra tela que mexeu nos blocos é conflito. */
  assert.deepEqual(App.conflitosRascunho({ itens: [], site: { blocos: [{ id: 'x', tipo: 'busca' }] } }, rasc).map((c) => c.campo), ['blocos']);
  assert.deepEqual(App.conflitosRascunho(catalogo, rasc), []);

  /* O que o histórico guarda: a lista inteira, com a permissão do campo, e dá para desfazer. */
  const difs = App.diferencasDoCatalogo(catalogo, aplicado);
  const d = difs.find((x) => x.alvo === 'site' && x.campo === 'blocos');
  assert.ok(d && d.permissao === 'estrutura');
  assert.deepEqual(App.desfazerMudanca(d), { alvo: 'site', campo: 'blocos', valor: null });
});

test('o config entra por baixo: home.blocos, catalogo.colecoes e o modelo; o que a mesa escolheu vence', () => {
  const config = {
    home: { blocos: [{ id: 'busca', tipo: 'busca' }, { id: 'lixo', tipo: 'nao-existe' }] },
    catalogo: { modeloDeConteudo: 'avulso', colecoes: [{ id: 'palestras', series: ['Série Exemplo 1'] }] },
    idiomas: { disponiveis: ['pt-BR', 'en', 'portugues'] }
  };
  const padroes = AppHome.padroesDaConfig(config);
  assert.deepEqual(padroes.blocos, [{ id: 'busca', tipo: 'busca' }]);
  assert.equal(padroes.modeloDeConteudo, 'avulso');
  assert.deepEqual(padroes.idiomas, ['pt-BR', 'en']);
  const doConfig = App.siteComPadroes(App.siteSaneado(null), padroes);
  assert.deepEqual(doConfig.blocos, [{ id: 'busca', tipo: 'busca' }]);
  assert.equal(App.modeloDeConteudo(doConfig), 'avulso');
  assert.deepEqual(App.colecoesEfetivas(doConfig).map((c) => c.id), ['palestras']);
  const daMesa = App.siteComPadroes(App.siteSaneado({ blocos: [{ tipo: 'texto', texto: 'oi' }] }), padroes);
  assert.equal(daMesa.blocos[0].tipo, 'texto', 'o config passou por cima da escolha da mesa');
  assert.equal(App.siteSaneado(null).blocos, undefined, 'siteComPadroes mexeu no objeto que recebeu');
});

test('o home-blocos.js é puro: não toca em DOM, rede, armazenamento nem relógio', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'core', 'site', 'home-blocos.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const proibido of ['document', 'window', 'fetch(', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'Date.now', 'Math.random', 'require(']) {
    assert.ok(!fonte.includes(proibido), 'home-blocos.js usa ' + proibido);
  }
  assert.ok(!/\.play\(/.test(fonte), 'nada aqui toca vídeo');
});
