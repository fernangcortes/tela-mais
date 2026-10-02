/* mesa-home.js — a tela "Home" da mesa: os BLOCOS da página inicial e as COLEÇÕES (M6).
 *
 * É uma lista ordenável de blocos (home-blocos.js): subir, descer, ocultar, remover, adicionar, e os parâmetros
 * de cada tipo. Cada escrita é UMA mudança no rascunho, com a lista inteira (`site.blocos`, `site.colecoes`,
 * `site.modeloDeConteudo`) — a mesma regra das outras escritas da estrutura: o Publicar confere o "antes" contra
 * o servidor (409 se outra tela mexeu), o servidor confere a permissão `estrutura` campo a campo e o histórico
 * guarda a mudança. Esta tela não grava nada por conta própria, e a prévia que ela mostra sai das MESMAS funções
 * que o site usa (`App.home`): não existe uma segunda regra de "o que aparece".
 *
 * Os textos de tela não são escritos aqui: `tr('telas.home…')`. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr, st = M.st;
  var AppHome = window.AppHome;
  if (!AppHome) return;

  /* A prévia e as listas da mesa ignoram "quem vê": quem edita vê todos os blocos. */
  M.CTX = { ignorarVisibilidade: true, ondeParou: null, minhaLista: null };

  /* Rótulo e ajuda de cada tipo. Uma tabela explícita (e não chaves montadas) para o conferidor de textos
   * enxergar cada chave que o código usa. */
  var TIPOS = {
    'destaque': [tr('telas.homeTipoDestaque'), tr('telas.homeAjudaDestaque')],
    'continuar-assistindo': [tr('telas.homeTipoContinuar'), tr('telas.homeAjudaContinuar')],
    'minha-lista': [tr('telas.homeTipoMinhaLista'), tr('telas.homeAjudaMinhaLista')],
    'prateleira-recentes': [tr('telas.homeTipoNovidades'), tr('telas.homeAjudaNovidades')],
    'prateleira-duracao': [tr('telas.homeTipoDuracao'), tr('telas.homeAjudaDuracao')],
    'prateleira-por-serie': [tr('telas.homeTipoPorSerie'), tr('telas.homeAjudaPorSerie')],
    'prateleira-colecao': [tr('telas.homeTipoColecao'), tr('telas.homeAjudaColecao')],
    'carrossel': [tr('telas.homeTipoCarrossel'), tr('telas.homeAjudaCarrossel')],
    'prateleira-restante': [tr('telas.homeTipoRestante'), tr('telas.homeAjudaRestante')],
    'texto': [tr('telas.homeTipoTexto'), tr('telas.homeAjudaTexto')],
    'banner': [tr('telas.homeTipoBanner'), tr('telas.homeAjudaBanner')],
    'busca': [tr('telas.homeTipoBusca'), tr('telas.homeAjudaBusca')]
  };
  var VISIBILIDADE = {
    todos: tr('telas.homeVisTodos'),
    logado: tr('telas.homeVisLogado'),
    anonimo: tr('telas.homeVisAnonimo')
  };
  var CLASSE = {
    pedagogica: tr('telas.homeClasseSelecao'),
    curta: tr('telas.homeClasseCurta'),
    institucional: tr('telas.homeClasseInstitucional')
  };

  function chip(texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); }
  function topo(titulo, sub, extra) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null), extra || null);
  }

  /* Os idiomas do site: o cliente escolhe no config (`idiomas.disponiveis`); sem isso, o idioma da mesa. */
  function idiomasDoSite() {
    var p = st.servidor && st.servidor.padroes;
    var lista = p && Array.isArray(p.idiomas) && p.idiomas.length ? p.idiomas : [M.I18n.idioma()];
    return lista;
  }

  function um(chave, valor) { var o = {}; o[chave] = valor; return o; }

  function efetivos() { return AppHome.blocosEfetivos(M.site()); }
  function colecoes() { return AppHome.colecoesEfetivas(M.site()); }

  /* Escritas. `opcoes.semCentro`: não redesenha a tela (digitar num campo não pode tirar o cursor dele). */
  function gravarBlocos(lista, opcoes) { M.mudarSite('blocos', lista, opcoes); }
  function gravarColecoes(lista, opcoes) { M.mudarSite('colecoes', lista, opcoes); }

  function escolhidoPelaMesa() {
    var s = M.site(true);
    return Array.isArray(s.blocos) || Array.isArray(s.colecoes);
  }

  /* ---------------------------------------------------------------- a tela */

  function nomeDoTitulo(cat, id) {
    var it = App.porId(cat.itens, id);
    return it ? (App.tituloCurto(it) || it.titulo || id) : id;
  }

  function campo(rotulo, controle, dica, classe) {
    return h('div', { class: 'campo ' + (classe || '') }, h('label', null, rotulo), controle, dica ? h('small', { class: 'dica', text: dica }) : null);
  }

  /* Um controle de um bloco. `data-hcampo` diz o que ele muda; `data-bloco`, de quem. */
  function entrada(tipo, bloco, nome, valor, extra) {
    var props = Object.assign({ type: tipo, 'data-hcampo': nome, 'data-bloco': bloco.id, value: valor == null ? '' : String(valor) }, extra || {});
    return h('input', props);
  }

  function selecao(bloco, nome, opcoes, atual, extra) {
    return h('select', Object.assign({ 'data-hcampo': nome, 'data-bloco': bloco.id }, extra || {}),
      opcoes.map(function (o) { return h('option', { value: o[0], selected: String(o[0]) === String(atual) ? 'selected' : null, text: o[1] }); }));
  }

  function titulosPorIdioma(bloco, rotulo, nomeCampo, longo, pode) {
    var idiomas = idiomasDoSite();
    var atual = bloco[nomeCampo];
    var corpo = idiomas.map(function (id) {
      var valor = typeof atual === 'string' ? (id === idiomas[0] ? atual : '') : (atual && atual[id]) || '';
      var props = { 'data-hcampo': nomeCampo + '-idioma', 'data-bloco': bloco.id, 'data-idioma': id, disabled: !pode, 'aria-label': rotulo + ' (' + M.I18n.rotuloDoIdioma(id) + ')' };
      var no = longo
        ? h('textarea', Object.assign({ rows: '3' }, props, { value: valor }))
        : h('input', Object.assign({ type: 'text' }, props, { value: valor }));
      return h('div', { class: 'home-idioma' }, h('span', { class: 'mono home-idioma-id', text: id }), no);
    });
    return h('div', { class: 'campo' }, h('label', null, rotulo), h('div', { class: 'home-idiomas' }, corpo));
  }

  function parametros(cat, b, pode) {
    var t = b.tipo;
    var campos = [];
    var off = !pode;
    if (t === 'continuar-assistindo' || t === 'minha-lista' || t === 'prateleira-recentes' || t === 'prateleira-colecao') {
      campos.push(campo(tr('telas.homeLimite'), entrada('number', b, 'limite', b.limite, { min: '1', max: '100', disabled: off })));
    }
    if (t === 'prateleira-duracao') {
      campos.push(h('div', { class: 'campo-duo' },
        campo(tr('telas.homeDuracaoDe'), entrada('number', b, 'de', b.de ? Math.round(b.de / 6) / 10 : '', { min: '0', step: '0.5', disabled: off })),
        campo(tr('telas.homeDuracaoAte'), entrada('number', b, 'ate', b.ate ? Math.round(b.ate / 6) / 10 : '', { min: '0', step: '0.5', placeholder: b.de ? '' : '5', disabled: off }))));
      campos.push(campo(tr('telas.homeMinimo'), entrada('number', b, 'minimoDeTitulos', b.minimoDeTitulos, { min: '1', max: '50', placeholder: '3', disabled: off })));
      campos.push(h('label', { class: 'home-marca' },
        entrada('checkbox', b, 'incluirInstitucional', '', { checked: b.incluirInstitucional === true, disabled: off }), h('span', { text: tr('telas.homeIncluirInstitucional') })));
    }
    if (t === 'prateleira-por-serie') {
      campos.push(campo(tr('telas.homeMinimo'), entrada('number', b, 'minimoDeTitulos', b.minimoDeTitulos, { min: '1', max: '50', placeholder: '3', disabled: off })));
    }
    if (t === 'prateleira-colecao') {
      var lista = colecoes().map(function (c) { return [c.id, AppHome.nomeDaColecao(c, { tr: tr, idiomaAtual: function () { return M.I18n.idioma(); } })]; });
      campos.push(campo(tr('telas.homeColecao'), selecao(b, 'colecao', [['', tr('telas.homeEscolhaUmaColecao')]].concat(lista), b.colecao || '', { disabled: off })));
    }
    if (t === 'carrossel') campos.push(carrossel(cat, b, pode));
    if (t === 'prateleira-restante') {
      campos.push(h('label', { class: 'home-marca' },
        entrada('checkbox', b, 'garantirQueTodoTituloApareca', '', { checked: b.garantirQueTodoTituloApareca !== false, disabled: off }),
        h('span', { text: tr('telas.homeGarantir') })));
    }
    if (t === 'texto' || t === 'banner') campos.push(titulosPorIdioma(b, tr('telas.homeTexto'), 'texto', true, pode));
    if (t === 'banner') {
      campos.push(campo(tr('telas.homeImagem'), entrada('text', b, 'imagem', b.imagem, { disabled: off, placeholder: 'marca/banner.jpg' })));
      campos.push(campo(tr('telas.homeLink'), entrada('text', b, 'link', b.link, { disabled: off, placeholder: '#/series' })));
    }
    return campos;
  }

  /* O carrossel manual: os títulos escolhidos, na ordem, e uma lista para acrescentar. */
  function carrossel(cat, b, pode) {
    var escolhidos = b.titulos || [];
    var disponiveis = App.ordenar(App.publicaveis(cat.itens)).filter(function (i) { return escolhidos.indexOf(i.id) < 0; });
    var lista = escolhidos.length
      ? h('ol', { class: 'home-titulos' }, escolhidos.map(function (id, i) {
        return h('li', null, h('span', { text: nomeDoTitulo(cat, id) }),
          h('span', { class: 'col-botoes' },
            h('button', { type: 'button', class: 'icone-botao', 'data-home': 'tit-sobe', 'data-bloco': b.id, 'data-id': id, disabled: !pode || i === 0, 'aria-label': tr('telas.subir'), title: tr('telas.subir') }, M.ic('esq')),
            h('button', { type: 'button', class: 'icone-botao', 'data-home': 'tit-desce', 'data-bloco': b.id, 'data-id': id, disabled: !pode || i === escolhidos.length - 1, 'aria-label': tr('telas.descer'), title: tr('telas.descer') }, M.ic('dir')),
            h('button', { type: 'button', class: 'icone-botao', 'data-home': 'tit-remove', 'data-bloco': b.id, 'data-id': id, disabled: !pode, 'aria-label': tr('telas.homeRemover'), title: tr('telas.homeRemover') }, M.ic('x'))));
      }))
      : h('p', { class: 'p-nota', text: tr('telas.homeNenhumTitulo') });
    var sel = h('select', { 'data-home-add-titulo': b.id, 'aria-label': tr('telas.homeAdicionarTitulo'), disabled: !pode },
      [h('option', { value: '', text: tr('telas.homeAdicionarTitulo') })].concat(disponiveis.map(function (i) {
        return h('option', { value: i.id, text: App.tituloCurto(i) || i.titulo || i.id });
      })));
    return h('div', { class: 'campo' }, h('label', null, tr('telas.homeTitulosEscolhidos')), lista, sel);
  }

  /* O que o bloco resultou: as fileiras que ele gera agora, com o rascunho. */
  function resumoDoBloco(res, b, cat) {
    var r = res.blocos.filter(function (x) { return x.bloco.id === b.id; })[0];
    if (!r) return null;
    if (b.tipo === 'destaque') {
      var d = App.destaque(cat.itens, M.site());
      return d ? tr('telas.homePreviaDestaque', { titulo: App.tituloCurto(d) || d.titulo || d.id }) : tr('telas.homeSemFileira');
    }
    if (b.tipo === 'busca') return tr('telas.homePreviaBusca');
    if (b.tipo === 'texto' || b.tipo === 'banner') return r.texto ? (r.texto.titulo ? r.texto.titulo + ' — ' : '') + String(r.texto.texto).slice(0, 80) : tr('telas.homeSemFileira');
    if (!r.prateleiras.length) return tr('telas.homeSemFileira');
    var total = r.prateleiras.reduce(function (n, p) { return n + p.itens.length; }, 0);
    var nomes = r.prateleiras.slice(0, 3).map(function (p) { return p.titulo; }).join(' · ') + (r.prateleiras.length > 3 ? ' …' : '');
    return tr('comum.titulos', { n: total }) + ' · ' + tr('telas.homeFileirasN', { n: r.prateleiras.length }) + ' · ' + nomes;
  }

  function linhaDoBloco(cat, res, b, i, total, pode) {
    var ajuda = TIPOS[b.tipo];
    var corpo = [];
    if (b.tipo !== 'destaque' && b.tipo !== 'prateleira-por-serie') {
      var rotuloTitulo = b.tipo === 'texto' || b.tipo === 'banner' || b.tipo === 'busca' ? tr('telas.homeTituloOpcional') : tr('telas.homeTitulosPorIdioma');
      corpo.push(titulosPorIdioma(b, rotuloTitulo, 'titulo', false, pode));
    }
    corpo = corpo.concat(parametros(cat, b, pode));
    corpo.push(campo(tr('telas.homeVisibilidade'), selecao(b, 'visibilidade', AppHome.VISIBILIDADES.map(function (v) { return [v, VISIBILIDADE[v]]; }), b.visibilidade || 'todos', { disabled: !pode })));
    var oculto = b.escondido === true;
    var unico = total === 1;
    return h('li', { class: 'home-bloco' + (oculto ? ' escondido' : ''), 'data-bloco-id': b.id },
      h('div', { class: 'home-bloco-cabeca' },
        h('span', { class: 'mono col-ordem', text: String(i + 1) }),
        h('div', { class: 'home-bloco-nome' },
          h('b', { text: ajuda[0] }),
          h('small', { class: 'dica', text: resumoDoBloco(res, b, cat) || '' })),
        oculto ? chip(tr('telas.homeOculto'), 'chip-alerta') : null,
        h('span', { class: 'col-botoes' },
          h('button', { type: 'button', class: 'icone-botao', 'data-home': 'sobe', 'data-bloco': b.id, disabled: !pode || i === 0, 'aria-label': tr('telas.subir'), title: tr('telas.subir') }, M.ic('esq')),
          h('button', { type: 'button', class: 'icone-botao', 'data-home': 'desce', 'data-bloco': b.id, disabled: !pode || i === total - 1, 'aria-label': tr('telas.descer'), title: tr('telas.descer') }, M.ic('dir')),
          h('button', { type: 'button', class: 'icone-botao' + (oculto ? ' apagado' : ''), 'data-home': 'oculta', 'data-bloco': b.id, 'aria-pressed': String(oculto), disabled: !pode, 'aria-label': oculto ? tr('telas.homeMostrar') : tr('telas.homeOcultar'), title: oculto ? tr('telas.homeMostrar') : tr('telas.homeOcultar') }, M.ic('olho')),
          h('button', { type: 'button', class: 'icone-botao', 'data-home': 'remove', 'data-bloco': b.id, disabled: !pode || unico, 'aria-label': tr('telas.homeRemover'), title: unico ? tr('telas.homeUltimoBloco') : tr('telas.homeRemover') }, M.ic('x')))),
      h('p', { class: 'p-nota', text: ajuda[1] }),
      corpo.length ? h('div', { class: 'p-form home-bloco-form' }, corpo) : null);
  }

  function linhaDaColecao(cat, c, pode) {
    var nomes = App.series(App.publicaveis(cat.itens));
    (c.series || []).forEach(function (n) { if (nomes.indexOf(n) < 0) nomes.push(n); });
    var idiomas = idiomasDoSite();
    var nomeAtual = c.nome;
    var porIdioma = idiomas.map(function (id) {
      var valor = typeof nomeAtual === 'string' ? (id === idiomas[0] ? nomeAtual : '') : (nomeAtual && nomeAtual[id]) || '';
      return h('div', { class: 'home-idioma' }, h('span', { class: 'mono home-idioma-id', text: id }),
        h('input', { type: 'text', value: valor, 'data-hcol': c.id, 'data-hcol-campo': 'nome', 'data-idioma': id, disabled: !pode, 'aria-label': tr('telas.homeNomeDaColecao') + ' (' + M.I18n.rotuloDoIdioma(id) + ')',
          placeholder: c.nomeChave ? tr(c.nomeChave) : '' }));
    });
    var series = h('div', { class: 'home-series' }, nomes.map(function (n) {
      return h('label', { class: 'home-marca' },
        h('input', { type: 'checkbox', 'data-hcol': c.id, 'data-hcol-campo': 'serie', 'data-serie': n, checked: (c.series || []).indexOf(n) >= 0, disabled: !pode }), h('span', { text: n }));
    }));
    return h('li', { class: 'home-bloco', 'data-colecao-id': c.id },
      h('div', { class: 'home-bloco-cabeca' },
        h('div', { class: 'home-bloco-nome' }, h('b', { text: AppHome.nomeDaColecao(c, { tr: tr, idiomaAtual: function () { return M.I18n.idioma(); } }) }), h('small', { class: 'mono dica', text: c.id })),
        h('span', { class: 'col-botoes' },
          h('button', { type: 'button', class: 'icone-botao', 'data-home': 'col-remove', 'data-colecao': c.id, disabled: !pode, 'aria-label': tr('telas.homeRemoverColecao'), title: tr('telas.homeRemoverColecao') }, M.ic('x')))),
      h('div', { class: 'p-form home-bloco-form' },
        h('div', { class: 'campo' }, h('label', null, tr('telas.homeNomeDaColecao')), h('div', { class: 'home-idiomas' }, porIdioma)),
        campo(tr('telas.homeClasse'), h('select', { 'data-hcol': c.id, 'data-hcol-campo': 'classe', disabled: !pode },
          AppHome.CLASSES_DE_COLECAO.map(function (k) { return h('option', { value: k, selected: (c.classe || 'pedagogica') === k ? 'selected' : null, text: CLASSE[k] }); }))),
        h('details', { class: 'home-detalhes' }, h('summary', { text: tr('telas.homeSeriesDaColecao') + ' (' + (c.series || []).length + ')' }), series),
        campo(tr('telas.homeTags'), h('input', { type: 'text', value: (c.tags || []).join(', '), 'data-hcol': c.id, 'data-hcol-campo': 'tags', disabled: !pode }))));
  }

  /* A prévia: a sequência que o site desenha, e quem ficaria de fora. */
  function previa(cat, res) {
    var linhas = [];
    res.sequencia.forEach(function (e) {
      if (e.tipo === 'destaque') {
        var d = App.destaque(cat.itens, M.site());
        linhas.push(h('li', null, h('b', { text: TIPOS.destaque[0] }), ' · ', d ? (App.tituloCurto(d) || d.titulo || d.id) : '—'));
      } else if (e.tipo === 'prateleira') {
        var p = e.prateleira;
        if (!p) return;
        var amostra = p.itens.slice(0, 5).map(function (i) { return App.tituloCurto(i) || i.titulo || i.id; }).join(', ') + (p.itens.length > 5 ? ' …' : '');
        linhas.push(h('li', { class: p.escondida ? 'escondida' : '' },
          h('b', { text: p.titulo }), ' · ', tr('comum.titulos', { n: p.itens.length }), p.escondida ? ' · ' + tr('telas.homeOculto') : '',
          h('small', { class: 'dica', text: amostra })));
      } else if (e.tipo === 'busca') {
        linhas.push(h('li', null, h('b', { text: TIPOS.busca[0] })));
      } else if (e.texto) {
        linhas.push(h('li', null, h('b', { text: TIPOS[e.tipo][0] }), ' · ', e.texto.titulo || String(e.texto.texto).slice(0, 60)));
      }
    });
    var vistos = Object.create(null);
    res.prateleiras.forEach(function (p) { if (!p.escondida) p.itens.forEach(function (i) { vistos[i.id] = true; }); });
    var fora = App.ordenar(App.publicaveis(cat.itens)).filter(function (i) { return !vistos[i.id]; });
    return h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.homePrevia') }),
      h('p', { class: 'a-sub', text: tr('telas.homePreviaSub') }),
      linhas.length ? h('ol', { class: 'home-previa' }, linhas) : h('p', { class: 'p-nota', text: tr('telas.homeSemFileira') }),
      fora.length ? h('div', { class: 'aviso-opcao' },
        h('b', null, tr('telas.homeFicamDeFora', { n: fora.length }) + ' '),
        tr('telas.homeFicamDeForaAjuda') + ' ',
        fora.slice(0, 5).map(function (i) { return App.tituloCurto(i) || i.titulo || i.id; }).join(', ') + (fora.length > 5 ? ' …' : '')) : null);
  }

  M.telaHome = function (cat) {
    var pode = M.pode('estrutura');
    var site = M.site();
    var blocos = AppHome.blocosEfetivos(site);
    var res = App.home(cat.itens, site, M.CTX);
    var a = h('div', { class: 'a home' },
      topo(tr('telas.homeTitulo'), tr('telas.homeSub'),
        h('div', { class: 'botoes-linha' },
          pode ? null : chip(tr('telas.soLeitura'), 'chip-alerta'),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-home': 'padrao', disabled: !pode || !escolhidoPelaMesa(), title: tr('telas.homeVoltarAoPadraoDica') }, tr('telas.homeVoltarAoPadrao')),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-home': 'ver-site' }, M.ic('site'), tr('telas.homeVerNoSite')))));

    var modelo = AppHome.modeloDe(site);
    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.homeModelo') }),
      h('div', { class: 'p-form' },
        h('div', { class: 'campo' },
          h('select', { 'data-hmodelo': '1', 'aria-label': tr('telas.homeModelo'), disabled: !pode },
            [['seriado', tr('telas.homeModeloSeriado')], ['avulso', tr('telas.homeModeloAvulso')]].map(function (o) {
              return h('option', { value: o[0], selected: modelo === o[0] ? 'selected' : null, text: o[1] });
            })),
          h('small', { class: 'dica', text: tr('telas.homeModeloDica') })))));

    var lista = h('ol', { class: 'home-lista' }, blocos.map(function (b, i) { return linhaDoBloco(cat, res, b, i, blocos.length, pode); }));
    var tipos = AppHome.ORDEM_DOS_TIPOS.map(function (t) { return h('option', { value: t, text: TIPOS[t][0] }); });
    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.homeBlocos') }),
      lista,
      h('div', { class: 'botoes-linha home-adicionar' },
        h('select', { 'data-hnovo': 'tipo', 'aria-label': tr('telas.homeAdicionar'), disabled: !pode || blocos.length >= AppHome.LIMITE_BLOCOS }, tipos),
        h('button', { type: 'button', class: 'botao botao-pequeno', 'data-home': 'add', disabled: !pode || blocos.length >= AppHome.LIMITE_BLOCOS, text: tr('telas.homeAdicionarBotao') }))));

    var cols = colecoes();
    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.homeColecoes') }),
      h('p', { class: 'a-sub', text: tr('telas.homeColecoesSub') }),
      cols.length ? h('ol', { class: 'home-lista' }, cols.map(function (c) { return linhaDaColecao(cat, c, pode); })) : h('p', { class: 'p-nota', text: tr('telas.homeSemColecoes') }),
      h('div', { class: 'botoes-linha home-adicionar' },
        h('input', { type: 'text', 'data-hnovo': 'colecao', placeholder: tr('telas.homeNovaColecaoNome'), 'aria-label': tr('telas.homeNovaColecaoNome'), disabled: !pode }),
        h('button', { type: 'button', class: 'botao botao-pequeno', 'data-home': 'col-add', disabled: !pode, text: tr('telas.homeCriar') }))));

    a.appendChild(previa(cat, res));
    return a;
  };

  /* --------------------------------------------------------------- eventos
   *
   * Delegados no centro da mesa (#palco-admin), que sobrevive aos redesenhos. Atributos próprios (`data-home`,
   * `data-hcampo`, `data-hcol`...) para não cruzar com os `data-acao` do mesa.js. */

  var centro = document.getElementById('palco-admin');
  if (!centro) return;

  function bloco(id) { return efetivos().filter(function (b) { return b.id === id; })[0]; }

  function lerNumero(no) {
    var t = String(no.value).trim().replace(',', '.');
    if (!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  function aplicarCampo(no, semCentro) {
    var id = no.getAttribute('data-bloco');
    var campoNome = no.getAttribute('data-hcampo');
    var lista = efetivos();
    var opc = semCentro ? { semCentro: true } : undefined;
    var nova = null;
    if (/-idioma$/.test(campoNome)) {
      var base = campoNome.replace(/-idioma$/, '');
      var b = bloco(id);
      var idioma = no.getAttribute('data-idioma');
      var atual = b && b[base] && typeof b[base] === 'object' ? Object.assign({}, b[base]) : (b && typeof b[base] === 'string' ? um(idiomasDoSite()[0], b[base]) : {});
      var texto = no.value.trim();
      if (texto) atual[idioma] = texto; else delete atual[idioma];
      nova = AppHome.comBlocoAlterado(lista, id, um(base, Object.keys(atual).length ? atual : null));
    } else if (campoNome === 'ate' || campoNome === 'de') {
      var minutos = lerNumero(no);
      nova = AppHome.comBlocoAlterado(lista, id, um(campoNome, minutos && minutos > 0 ? Math.round(minutos * 60) : null));
    } else if (campoNome === 'limite' || campoNome === 'minimoDeTitulos') {
      var n = lerNumero(no);
      nova = AppHome.comBlocoAlterado(lista, id, um(campoNome, n && n >= 1 ? Math.floor(n) : null));
    } else if (no.type === 'checkbox') {
      nova = AppHome.comBlocoAlterado(lista, id, um(campoNome, no.checked));
    } else if (campoNome === 'visibilidade') {
      nova = AppHome.comBlocoAlterado(lista, id, { visibilidade: no.value === 'todos' ? null : no.value });
    } else {
      nova = AppHome.comBlocoAlterado(lista, id, um(campoNome, no.value.trim() || null));
    }
    gravarBlocos(nova, opc);
  }

  function aplicarColecao(no, semCentro) {
    var id = no.getAttribute('data-hcol');
    var campoNome = no.getAttribute('data-hcol-campo');
    var lista = colecoes();
    var c = lista.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var nova = Object.assign({}, c);
    if (campoNome === 'nome') {
      var idioma = no.getAttribute('data-idioma');
      var atual = c.nome && typeof c.nome === 'object' ? Object.assign({}, c.nome) : (typeof c.nome === 'string' ? um(idiomasDoSite()[0], c.nome) : {});
      var t = no.value.trim();
      if (t) atual[idioma] = t; else delete atual[idioma];
      if (Object.keys(atual).length) nova.nome = atual; else delete nova.nome;
    } else if (campoNome === 'classe') {
      nova.classe = no.value;
    } else if (campoNome === 'tags') {
      nova.tags = no.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    } else if (campoNome === 'serie') {
      var s = no.getAttribute('data-serie');
      var series = (c.series || []).filter(function (x) { return x !== s; });
      if (no.checked) series.push(s);
      nova.series = series;
    }
    gravarColecoes(AppHome.comColecaoAlterada(lista, nova), semCentro ? { semCentro: true } : undefined);
  }

  centro.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-home]');
    if (!b || b.disabled || !centro.contains(b)) return;
    var acao = b.getAttribute('data-home');
    var id = b.getAttribute('data-bloco');
    var lista = efetivos();
    if (acao === 'ver-site') return M.irTela('site');
    if (acao === 'padrao') {
      if (!window.confirm(tr('telas.homeConfirmaPadrao'))) return;
      M.mudarVarios('site', [['blocos', null], ['colecoes', null], ['modeloDeConteudo', null]]);
      return;
    }
    if (acao === 'sobe') return gravarBlocos(AppHome.comBlocoMovido(lista, id, -1));
    if (acao === 'desce') return gravarBlocos(AppHome.comBlocoMovido(lista, id, 1));
    if (acao === 'oculta') {
      var atual = bloco(id);
      return gravarBlocos(AppHome.comBlocoAlterado(lista, id, { escondido: !(atual && atual.escondido) }));
    }
    if (acao === 'remove') {
      if (lista.length <= 1) return;
      var alvo = bloco(id);
      if (alvo && !window.confirm(tr('telas.homeConfirmaRemover', { tipo: TIPOS[alvo.tipo][0] }))) return;
      return gravarBlocos(AppHome.comBlocoRemovido(lista, id));
    }
    if (acao === 'add') {
      var sel = centro.querySelector('[data-hnovo="tipo"]');
      return gravarBlocos(AppHome.comBlocoAdicionado(lista, sel ? sel.value : 'texto'));
    }
    if (acao === 'tit-remove' || acao === 'tit-sobe' || acao === 'tit-desce') {
      var bl = bloco(id);
      var ids = ((bl && bl.titulos) || []).slice();
      var i = ids.indexOf(b.getAttribute('data-id'));
      if (i < 0) return;
      if (acao === 'tit-remove') ids.splice(i, 1);
      else {
        var j = i + (acao === 'tit-sobe' ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
      }
      return gravarBlocos(AppHome.comBlocoAlterado(lista, id, { titulos: ids }));
    }
    if (acao === 'col-add') {
      var campoNome = centro.querySelector('[data-hnovo="colecao"]');
      var nome = campoNome ? campoNome.value.trim() : '';
      if (!nome) { if (campoNome) campoNome.focus(); return; }
      var cols = colecoes();
      var nomeDoIdioma = {};
      nomeDoIdioma[idiomasDoSite()[0]] = nome;
      return gravarColecoes(AppHome.comColecaoAlterada(cols, { id: AppHome.idDeColecaoNova(cols, nome), nome: nomeDoIdioma }));
    }
    if (acao === 'col-remove') {
      var cid = b.getAttribute('data-colecao');
      if (!window.confirm(tr('telas.homeConfirmaRemoverColecao'))) return;
      return gravarColecoes(AppHome.comColecaoRemovida(colecoes(), cid));
    }
  });

  /* Texto: grava a cada tecla, sem redesenhar a tela (o cursor fica onde está). */
  centro.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!centro.contains(t)) return;
    var ehTexto = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text');
    if (!ehTexto) return;
    if (t.hasAttribute('data-hcampo')) aplicarCampo(t, true);
    else if (t.hasAttribute('data-hcol') && t.getAttribute('data-hcol-campo') !== 'tags') aplicarColecao(t, true);
  });

  /* Número, seleção e caixa de marcar: ao confirmar, e a tela se redesenha (a prévia muda). */
  centro.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!centro.contains(t)) return;
    if (t.hasAttribute('data-hmodelo')) return M.mudarSite('modeloDeConteudo', t.value);
    if (t.hasAttribute('data-home-add-titulo')) {
      if (!t.value) return;
      var id = t.getAttribute('data-home-add-titulo');
      var bl = bloco(id);
      var ids = ((bl && bl.titulos) || []).concat([t.value]);
      return gravarBlocos(AppHome.comBlocoAlterado(efetivos(), id, { titulos: ids }));
    }
    if (t.hasAttribute('data-hcampo')) {
      var ehTexto = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text');
      /* O texto já foi gravado a cada tecla; ao sair do campo a tela só se redesenha (a prévia). */
      if (ehTexto) return M.aoMudar({ semPainel: true });
      return aplicarCampo(t, false);
    }
    if (t.hasAttribute('data-hcol')) return aplicarColecao(t, false);
  });
})();
