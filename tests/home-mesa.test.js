/* M6 — a tela "Home" da mesa (mesa-home.js) rodando de verdade, com os arquivos reais da mesa (base, painel, telas) num DOM falso.
 *
 * O que se confere: a lista de blocos é a que o site desenha, cada controle grava UMA mudança no rascunho (com a lista inteira, no campo
 * `site.blocos` — o que o PUT valida, o histórico guarda e o 409 protege), quem não tem a permissão `estrutura` não consegue mexer, e
 * "voltar ao padrão" apaga a escolha. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { criarSite, SITE } = require('./home-dom-falso.js');

const itens = [].concat(
  ['a', 'b', 'c', 'd'].map((id, i) => ({ id, titulo: 'Título ' + id, serie: 'Série X', episodio: i + 1, duracao_seg: 900, publicar: true })),
  [{ id: 'e', titulo: 'Solto', serie: 'Eventos', duracao_seg: 60, publicar: true }, { id: 'f', titulo: 'Fora do ar', serie: 'Série X', publicar: false }]
);

function abrirMesa({ super: ehSuper = true, permissoes = [], padroes = { idiomas: ['pt-BR', 'en'] }, site } = {}) {
  const amb = criarSite({});
  const confirmacoes = [];
  amb.janela.confirm = (t) => { confirmacoes.push(t); return true; };
  amb.janela.MESA = undefined;
  const ctx = vm.createContext(amb.janela);
  const palco = amb.doc.createElement('div');
  palco.id = 'palco-admin';
  amb.porId['palco-admin'] = palco;
  amb.doc.body.appendChild(palco);
  for (const arquivo of ['i18n.js', 'home-blocos.js', 'catalogo-core.js']) vm.runInContext(fs.readFileSync(path.join(SITE, arquivo), 'utf8'), ctx, { filename: arquivo });
  ctx.__catalogo = JSON.parse(fs.readFileSync(path.join(SITE, '..', 'locales', 'pt-BR.json'), 'utf8'));
  vm.runInContext("AppI18n.instancia().definirCatalogo('pt-BR', __catalogo);", ctx);
  for (const arquivo of ['mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa-home.js']) vm.runInContext(fs.readFileSync(path.join(SITE, arquivo), 'utf8'), ctx, { filename: arquivo });
  const M = amb.janela.MESA;
  M.sessao.super = ehSuper;
  M.sessao.permissoes = permissoes;
  M.st.servidor = { rev: 1, itens: JSON.parse(JSON.stringify(itens)), padroes: JSON.parse(JSON.stringify(padroes)) };
  if (site) M.st.servidor.site = JSON.parse(JSON.stringify(site));
  const App = amb.janela.App;
  const desenhar = () => {
    palco.replaceChildren(M.telaHome(M.efetivo()));
    return palco;
  };
  const escolhas = () => App.siteSaneado(M.efetivo().site);
  const achar = (sel) => palco.querySelector(sel);
  const todos = (sel) => palco.querySelectorAll(sel);
  const clicar = (sel) => { const b = achar(sel); assert.ok(b, 'não achei ' + sel); b.click(); desenhar(); };
  const mudar = (sel, valor, tipo) => {
    const no = achar(sel);
    assert.ok(no, 'não achei ' + sel);
    if (typeof valor === 'boolean') no.checked = valor; else no.value = valor;
    no.disparar(tipo || 'change');
    desenhar();
  };
  const ids = () => todos('.home-bloco[data-bloco-id]').map((n) => n.getAttribute('data-bloco-id'));
  return { amb, M, App, AppHome: amb.janela.AppHome, palco, desenhar, escolhas, achar, todos, clicar, mudar, ids, confirmacoes };
}

test('a tela lista os blocos que o site desenha, na ordem, com a prévia e os parágrafos de ajuda', () => {
  const t = abrirMesa();
  t.desenhar();
  assert.deepEqual(Array.from(t.ids()), ['destaque', 'curtos', 'series', 'mais-series', 'curtas', 'institucional']);
  const linhas = t.todos('.home-bloco').filter((n) => n.hasAttribute('data-bloco-id'));
  assert.equal(linhas.filter((n) => n.querySelector('.p-nota')).length, 6, 'cada bloco precisa explicar o que faz');
  assert.ok(t.achar('.home-previa'), 'sem prévia');
  assert.match(t.achar('.home-previa').textContent, /Série X/);
  assert.match(t.palco.textContent, new RegExp(t.amb.janela.AppI18n.t('telas.homeTitulo')));
  assert.equal(t.achar('[data-home="padrao"]').disabled, true, '"voltar ao padrão" liga sem nada escolhido');
  assert.equal(t.achar('[data-home="sobe"][data-bloco="destaque"]').disabled, true, 'o primeiro bloco pode subir');
  assert.equal(t.achar('[data-home="desce"][data-bloco="institucional"]').disabled, true, 'o último bloco pode descer');
  /* A tela não escreveu nada só por ser aberta. */
  assert.deepEqual(Array.from(t.M.st.rascunho), []);
});

test('subir, descer, ocultar e remover: cada um é UMA mudança de `site.blocos` no rascunho, com a lista inteira', () => {
  const t = abrirMesa();
  t.desenhar();
  t.clicar('[data-home="sobe"][data-bloco="series"]');
  assert.equal(t.M.st.rascunho.length, 1);
  assert.deepEqual(Object.assign({}, t.M.st.rascunho[0], { depois: null }), { alvo: 'site', campo: 'blocos', antes: undefined, depois: null });
  assert.deepEqual(Array.from(t.M.st.rascunho[0].depois.map((b) => b.id)), ['destaque', 'series', 'curtos', 'mais-series', 'curtas', 'institucional']);
  assert.deepEqual(Array.from(t.ids()), ['destaque', 'series', 'curtos', 'mais-series', 'curtas', 'institucional'], 'a tela não refletiu o rascunho');

  t.clicar('[data-home="desce"][data-bloco="destaque"]');
  assert.deepEqual(Array.from(t.ids()).slice(0, 2), ['series', 'destaque']);
  assert.equal(t.M.st.rascunho.length, 1, 'duas mudanças no mesmo campo viraram duas linhas no rascunho');
  assert.equal(t.M.st.rascunho[0].antes, undefined, 'o "antes" tem de ser o valor do SERVIDOR (ausente), que é contra o que o Publicar confere');

  t.clicar('[data-home="oculta"][data-bloco="curtos"]');
  assert.equal(t.escolhas().blocos.find((b) => b.id === 'curtos').escondido, true);
  assert.match(t.achar('[data-bloco-id="curtos"]').className, /escondido/);
  assert.equal(t.achar('[data-home="oculta"][data-bloco="curtos"]').getAttribute('aria-pressed'), 'true');
  t.clicar('[data-home="oculta"][data-bloco="curtos"]');
  assert.ok(!('escondido' in t.escolhas().blocos.find((b) => b.id === 'curtos')));

  t.clicar('[data-home="remove"][data-bloco="institucional"]');
  assert.equal(t.confirmacoes.length, 1, 'remover sem perguntar');
  assert.ok(!Array.from(t.ids()).includes('institucional'));
  assert.equal(t.AppHome.blocosInvalidos(t.M.st.rascunho[0].depois).length, 0, 'a mesa produziu um bloco que o servidor recusaria');
});

test('adicionar cada tipo de bloco produz um bloco que o servidor aceita e o site entende', () => {
  const t = abrirMesa();
  t.desenhar();
  for (const tipo of t.AppHome.ORDEM_DOS_TIPOS) {
    const sel = t.achar('[data-hnovo="tipo"]');
    sel.value = tipo;
    t.clicar('[data-home="add"]');
  }
  const blocos = t.escolhas().blocos;
  assert.equal(blocos.length, 6 + t.AppHome.ORDEM_DOS_TIPOS.length > t.AppHome.LIMITE_BLOCOS ? t.AppHome.LIMITE_BLOCOS : 6 + t.AppHome.ORDEM_DOS_TIPOS.length);
  assert.equal(t.AppHome.blocosInvalidos(t.M.st.rascunho[0].depois).length, 0);
  assert.equal(new Set(blocos.map((b) => b.id)).size, blocos.length, 'ids repetidos');
  /* O site desenha a lista nova sem quebrar, com ou sem conta. */
  for (const ctx of [{}, { logado: true, ignorarVisibilidade: true, minhaLista: ['a'], ondeParou: {} }]) {
    assert.doesNotThrow(() => t.App.home(itens, t.escolhas(), ctx));
  }
  /* Cada bloco novo tem rótulo e ajuda (a tela os desenha por tipo). */
  assert.equal(t.todos('.home-bloco-nome').filter((n) => n.parentNode.parentNode.hasAttribute('data-bloco-id')).filter((n) => !n.children[0].textContent).length, 0);
  assert.ok(!/telas\.home/.test(t.palco.textContent), 'sobrou chave de texto sem tradução na tela');
});

test('parâmetros: número em minutos vira segundos, vazio apaga, checkbox liga, e título por idioma grava só o idioma digitado', () => {
  const t = abrirMesa();
  t.desenhar();
  t.mudar('input[data-hcampo="ate"][data-bloco="curtos"]', '10');
  assert.equal(t.escolhas().blocos.find((b) => b.id === 'curtos').ate, 600);
  t.mudar('input[data-hcampo="ate"][data-bloco="curtos"]', '');
  assert.ok(!('ate' in t.escolhas().blocos.find((b) => b.id === 'curtos')), 'campo vazio deve voltar ao padrão do bloco');
  t.mudar('input[data-hcampo="minimoDeTitulos"][data-bloco="series"]', '5');
  assert.equal(t.escolhas().blocos.find((b) => b.id === 'series').minimoDeTitulos, 5);
  t.mudar('input[data-hcampo="garantirQueTodoTituloApareca"][data-bloco="mais-series"]', false);
  assert.equal(t.escolhas().blocos.find((b) => b.id === 'mais-series').garantirQueTodoTituloApareca, false);
  t.mudar('select[data-hcampo="visibilidade"][data-bloco="curtos"]', 'logado');
  assert.equal(t.escolhas().blocos.find((b) => b.id === 'curtos').visibilidade, 'logado');
  t.mudar('select[data-hcampo="visibilidade"][data-bloco="curtos"]', 'todos');
  assert.ok(!('visibilidade' in t.escolhas().blocos.find((b) => b.id === 'curtos')));

  /* O título por idioma: um campo por idioma do site; digitar em um não apaga o outro. */
  const campos = t.todos('[data-hcampo="titulo-idioma"][data-bloco="curtos"]');
  assert.deepEqual(Array.from(campos.map((c) => c.getAttribute('data-idioma'))), ['pt-BR', 'en']);
  t.mudar('[data-hcampo="titulo-idioma"][data-bloco="curtos"][data-idioma="pt-BR"]', 'Rapidinhos', 'input');
  t.mudar('[data-hcampo="titulo-idioma"][data-bloco="curtos"][data-idioma="en"]', 'Quick ones', 'input');
  assert.deepEqual(JSON.parse(JSON.stringify(t.escolhas().blocos.find((b) => b.id === 'curtos').titulo)), { 'pt-BR': 'Rapidinhos', en: 'Quick ones' });
  assert.equal(t.App.prateleiras(itens, t.M.site(), t.M.CTX).find((p) => p.id === 'curtos'), undefined, 'a duração mínima mudou e a fileira ainda apareceu (só 4 episódios de 15 min)');
  t.mudar('[data-hcampo="titulo-idioma"][data-bloco="curtos"][data-idioma="en"]', '', 'input');
  assert.deepEqual(JSON.parse(JSON.stringify(t.escolhas().blocos.find((b) => b.id === 'curtos').titulo)), { 'pt-BR': 'Rapidinhos' });
});

test('seleção manual: escolher, ordenar e tirar títulos grava a lista na ordem', () => {
  const t = abrirMesa();
  t.desenhar();
  t.clicar('[data-home="remove"][data-bloco="curtos"]');
  t.achar('[data-hnovo="tipo"]').value = 'carrossel';
  t.clicar('[data-home="add"]');
  const id = t.escolhas().blocos.find((b) => b.tipo === 'carrossel').id;
  const sel = () => t.achar('[data-home-add-titulo="' + id + '"]');
  assert.ok(!sel().querySelectorAll('option').some((o) => o.getAttribute('value') === 'f'), 'o título fora do ar pode ser escolhido');
  for (const escolhido of ['c', 'a', 'e']) {
    sel().value = escolhido;
    sel().disparar('change');
    t.desenhar();
  }
  const titulos = () => Array.from(t.escolhas().blocos.find((b) => b.id === id).titulos);
  assert.deepEqual(titulos(), ['c', 'a', 'e']);
  assert.ok(!sel().querySelectorAll('option').some((o) => o.getAttribute('value') === 'c'), 'o título escolhido continua na lista de opções');
  t.clicar('[data-home="tit-sobe"][data-bloco="' + id + '"][data-id="e"]');
  assert.deepEqual(titulos(), ['c', 'e', 'a']);
  t.clicar('[data-home="tit-desce"][data-bloco="' + id + '"][data-id="c"]');
  assert.deepEqual(titulos(), ['e', 'c', 'a']);
  t.clicar('[data-home="tit-remove"][data-bloco="' + id + '"][data-id="c"]');
  assert.deepEqual(titulos(), ['e', 'a']);
  assert.deepEqual(Array.from(t.App.prateleiras(itens, t.M.site(), t.M.CTX).find((p) => p.id === id).itens.map((i) => i.id)), ['e', 'a']);
});

test('coleções: criar, classe, séries, tags e remover; o bloco "fileira de coleção" enxerga a nova', () => {
  const t = abrirMesa();
  t.desenhar();
  assert.deepEqual(Array.from(t.todos('[data-colecao-id]').map((n) => n.getAttribute('data-colecao-id'))), ['curtas', 'institucional']);
  /* O nome de fábrica aparece traduzido, não como chave. */
  assert.match(t.achar('[data-colecao-id="curtas"]').textContent, /Curtas/);

  t.achar('[data-hnovo="colecao"]').value = 'Palestras 2026';
  t.clicar('[data-home="col-add"]');
  const nova = t.escolhas().colecoes.find((c) => c.id.indexOf('palestras') === 0);
  assert.ok(nova, 'a coleção nova não foi criada');
  assert.equal(nova.nome['pt-BR'], 'Palestras 2026');
  /* Gravar a lista inteira não pode perder o nome de fábrica das duas de sempre. */
  assert.equal(t.escolhas().colecoes.find((c) => c.id === 'curtas').nomeChave, 'catalogo.curtas');

  t.mudar('input[data-hcol="' + nova.id + '"][data-hcol-campo="serie"][data-serie="Série X"]', true);
  t.mudar('input[data-hcol="' + nova.id + '"][data-hcol-campo="tags"]', 'a, b ,, c');
  t.mudar('select[data-hcol="' + nova.id + '"][data-hcol-campo="classe"]', 'institucional');
  const c = t.escolhas().colecoes.find((x) => x.id === nova.id);
  assert.deepEqual(Array.from(c.series), ['Série X']);
  assert.deepEqual(Array.from(c.tags), ['a', 'b', 'c']);
  assert.equal(c.classe, 'institucional');
  assert.equal(t.App.classeDaSerie('Série X', t.M.site()), 'institucional');

  t.clicar('[data-home="col-remove"][data-colecao="' + nova.id + '"]');
  assert.ok(!t.escolhas().colecoes.some((x) => x.id === nova.id));
  assert.equal(t.confirmacoes.length, 1);
  assert.equal(t.AppHome.colecoesSaneadas(t.M.st.rascunho.find((r) => r.campo === 'colecoes').depois).length, 2);
});

test('modelo de conteúdo e "voltar ao padrão"', () => {
  const t = abrirMesa();
  t.desenhar();
  t.mudar('select[data-hmodelo]', 'avulso');
  assert.equal(t.escolhas().modeloDeConteudo, 'avulso');
  assert.deepEqual(Array.from(t.ids()).slice(0, 2), ['destaque', 'novidades'], 'a lista padrão do avulso não entrou na tela');
  t.clicar('[data-home="sobe"][data-bloco="curtos"]');
  assert.ok(t.M.st.rascunho.length >= 2);
  /* Voltar ao padrão: tudo o que era escolha vira null, e o rascunho fica sem mudança (o servidor não tinha nada). */
  t.M.st.servidor.site = { blocos: [{ id: 'x', tipo: 'busca' }], colecoes: [{ id: 'y' }], modeloDeConteudo: 'avulso' };
  t.M.st.rascunho = [];
  t.M.st.versao++;
  t.desenhar();
  assert.equal(!!t.achar('[data-home="padrao"]').disabled, false);
  t.achar('[data-home="padrao"]').click();
  const campos = Object.fromEntries(Array.from(t.M.st.rascunho).map((r) => [r.campo, r.depois]));
  assert.deepEqual(Object.keys(campos).sort(), ['blocos', 'colecoes', 'modeloDeConteudo']);
  assert.ok(Object.values(campos).every((v) => v === null));
  t.desenhar();
  assert.deepEqual(Array.from(t.ids()), ['destaque', 'curtos', 'series', 'mais-series', 'curtas', 'institucional']);
});

test('o config entra por baixo: a tela mostra os blocos do config e, ao mexer, grava só a escolha da mesa', () => {
  const t = abrirMesa({ padroes: { idiomas: ['pt-BR'], blocos: [{ id: 'busca', tipo: 'busca' }, { id: 'sel', tipo: 'carrossel', titulos: ['a'] }] } });
  t.desenhar();
  assert.deepEqual(Array.from(t.ids()), ['busca', 'sel']);
  assert.deepEqual(Array.from(t.M.st.rascunho), [], 'só de abrir a tela, os padrões do config viraram rascunho');
  t.clicar('[data-home="desce"][data-bloco="busca"]');
  assert.deepEqual(Array.from(t.ids()), ['sel', 'busca']);
  assert.equal(t.M.st.rascunho[0].antes, undefined, 'o "antes" é o do KV (ausente), não o do config: o Publicar confere contra o servidor');
  /* O servidor tem o config por baixo; o que a mesa mandou vence. */
  assert.deepEqual(Array.from(t.App.siteSaneado(t.App.aplicarRascunho(t.M.st.servidor, t.M.st.rascunho).site).blocos.map((b) => b.id)), ['sel', 'busca']);
});

test('sem a permissão `estrutura` a tela é só de leitura: todo controle desligado, e nenhum clique grava', () => {
  const t = abrirMesa({ super: false, permissoes: ['conteudo'] });
  t.desenhar();
  const controles = t.palco.querySelectorAll('button[data-home], select, input, textarea');
  assert.ok(controles.length > 10);
  const ligados = controles.filter((c) => !c.disabled && c.getAttribute('data-home') !== 'ver-site');
  assert.deepEqual(Array.from(ligados.map((c) => c.tagName + ' ' + (c.getAttribute('data-home') || c.getAttribute('data-hcampo') || ''))), [], 'controle ligado sem permissão');
  assert.match(t.palco.textContent, new RegExp(t.amb.janela.AppI18n.t('telas.soLeitura')));
});

test('o último bloco não pode ser removido (uma home precisa de pelo menos um)', () => {
  const t = abrirMesa({ padroes: { idiomas: ['pt-BR'], blocos: [{ id: 'so', tipo: 'busca' }] } });
  t.desenhar();
  assert.equal(t.achar('[data-home="remove"][data-bloco="so"]').disabled, true);
});

test('o histórico e o rascunho sabem nomear os campos novos e mostrar "N blocos", e não "[object Object]"', () => {
  const t = abrirMesa();
  for (const campo of ['blocos', 'colecoes', 'modeloDeConteudo']) assert.ok(t.M.CAMPO[campo], 'sem rótulo para ' + campo);
  const I18n = t.amb.janela.AppI18n;
  assert.equal(I18n.t('painel.blocosN', { n: 1 }), '1 bloco');
  assert.equal(I18n.t('painel.blocosN', { n: 6 }), '6 blocos');
  assert.ok(fs.readFileSync(path.join(SITE, 'mesa-telas.js'), 'utf8').includes("campo === 'blocos' && Array.isArray(v)"));
  assert.ok(fs.readFileSync(path.join(SITE, 'mesa-painel.js'), 'utf8').includes("campoNome === 'blocos' && Array.isArray(v)"));
});
