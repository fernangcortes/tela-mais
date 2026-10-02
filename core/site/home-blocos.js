/* home-blocos.js — a chegada (home) como uma LISTA DE BLOCOS. Funções puras: sem DOM, sem rede.
 *
 * Carregado como o catalogo-core.js, sem etapa de build:
 *   - no navegador, <script> comum, expondo window.AppHome (antes do catalogo-core.js);
 *   - no Worker e nos testes, módulo CommonJS.
 *
 * ESTE ARQUIVO NÃO IMPORTA O CATALOGO-CORE. As regras que ele precisa do catálogo
 * (ordenar, achar os publicados, a classe de uma série, o nome "sem série") chegam por
 * argumento (`P`, as "primitivas"), passadas pelo próprio catalogo-core.js, que é quem
 * chama `resolver`. Assim os dois arquivos não dependem um do outro em círculo, e quem usa
 * só o `App.prateleiras(itens, site, contexto)` não precisa saber que os blocos existem.
 *
 * O QUE É UM BLOCO. A home é `site.blocos` (editado na mesa) ou, se ninguém escolheu,
 * `home.blocos` do config/site.json, ou, se também não existe, `BLOCOS_PADRAO`, que desenha a
 * chegada de sempre: o destaque, "Até 5 minutos", uma fileira por série grande, "Mais séries",
 * "Curtas" e "Institucional" (há teste de equivalência). Cada bloco tem um `tipo`:
 *
 *   destaque               o título em destaque do topo (o fundo animado é de destaque-fundo.js)
 *   continuar-assistindo   o que a pessoa parou no meio (a memória do navegador)
 *   minha-lista            a lista da pessoa (D1, só com conta)
 *   prateleira-recentes    novidades: os últimos títulos que entraram no ar
 *   prateleira-duracao     por duração (até X min, e/ou a partir de Y min)
 *   prateleira-por-serie   uma fileira por série com títulos suficientes
 *   prateleira-colecao     uma coleção livre (`colecoes`), por série, tag ou título
 *   carrossel              uma seleção manual de títulos, na ordem escolhida
 *   prateleira-restante    o que sobrou; com `garantirQueTodoTituloApareca`, nada fica de fora
 *   texto / banner         um texto (e, no banner, imagem e link), por idioma
 *   busca                  a busca em destaque
 *
 * Todo bloco pode ter `titulo` por idioma, `escondido` e `visibilidade` ('todos', 'logado' ou
 * 'anonimo'). Bloco que gera fileiras põe nelas o `id` do bloco (ou, na fileira por série,
 * 'serie:<nome>'); é esse `id` que o "Ver tudo" e a mesa usam para achar a fileira de novo.
 *
 * NADA AQUI TOCA SOZINHO: esses blocos só escolhem títulos e textos. O vídeo de fundo do bloco
 * `destaque` mora em outro arquivo, e passa pelo guardião do player. */
(function (raiz) {
  'use strict';

  var LIMITE_BLOCOS = 40;
  var LIMITE_TEXTO = 300;
  var LIMITE_TEXTO_LONGO = 1000;
  var LIMITE_TITULOS = 50;
  var LIMITE_COLECOES = 30;
  var PADRAO_ID = /^[a-z0-9-]{1,40}$/;
  var PADRAO_IDIOMA = /^[a-z]{2}(-[A-Z]{2})?$/;

  /* ------------------------------------------------------------ os tipos */

  /* `prateleira`: o bloco gera fileiras. `cobre`: as fileiras dele contam como "este título
   * já aparece" para o bloco `prateleira-restante`. Fileiras transversais (novidades, duração,
   * continuar, minha lista, seleção manual) NÃO cobrem: repetem títulos de propósito. `rotulo` e
   * `ajuda` são chaves de i18n (home.tipo.<tipo> e home.tipoAjuda.<tipo>). */
  var TIPOS = {
    'destaque': { prateleira: false, cobre: false },
    'continuar-assistindo': { prateleira: true, cobre: false, contexto: 'ondeParou' },
    'minha-lista': { prateleira: true, cobre: false, contexto: 'minhaLista' },
    'prateleira-recentes': { prateleira: true, cobre: false },
    'prateleira-duracao': { prateleira: true, cobre: false },
    'prateleira-por-serie': { prateleira: true, cobre: true },
    'prateleira-colecao': { prateleira: true, cobre: true },
    'carrossel': { prateleira: true, cobre: false },
    'prateleira-restante': { prateleira: true, cobre: false },
    'texto': { prateleira: false, cobre: false },
    'banner': { prateleira: false, cobre: false },
    'busca': { prateleira: false, cobre: false }
  };
  var ORDEM_DOS_TIPOS = ['destaque', 'continuar-assistindo', 'minha-lista', 'prateleira-recentes',
    'prateleira-duracao', 'prateleira-por-serie', 'prateleira-colecao', 'carrossel',
    'prateleira-restante', 'texto', 'banner', 'busca'];
  var VISIBILIDADES = ['todos', 'logado', 'anonimo'];
  var CLASSES = ['pedagogica', 'curta', 'institucional'];
  var MODELOS = ['seriado', 'avulso'];

  /* Parâmetros que cada tipo guarda, com a forma. O que não está aqui é descartado. */
  var PARAMETROS = {
    'continuar-assistindo': ['limite'],
    'minha-lista': ['limite'],
    'prateleira-recentes': ['limite'],
    'prateleira-duracao': ['de', 'ate', 'minimoDeTitulos', 'incluirInstitucional'],
    'prateleira-por-serie': ['minimoDeTitulos'],
    'prateleira-colecao': ['colecao', 'limite'],
    'carrossel': ['titulos'],
    'prateleira-restante': ['garantirQueTodoTituloApareca'],
    'texto': ['texto'],
    'banner': ['texto', 'imagem', 'link']
  };

  /* ------------------------------------------------------------ utilidades */

  function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  function aparado(v, max) { return typeof v === 'string' ? v.trim().slice(0, max || LIMITE_TEXTO) : ''; }

  function inteiro(v, min, max) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max ? v : null;
  }

  function copia(v) { return JSON.parse(JSON.stringify(v)); }

  /* Texto por idioma: texto simples ou { idioma: texto }. Devolve o que sobrou depois da
   * limpeza (string, objeto com as chaves ordenadas) ou null. */
  function textoPorIdioma(v, max) {
    if (typeof v === 'string') return aparado(v, max) || null;
    var o = objeto(v);
    var saida = {};
    Object.keys(o).sort().forEach(function (k) {
      if (!PADRAO_IDIOMA.test(k)) return;
      var t = aparado(o[k], max);
      if (t) saida[k] = t;
    });
    return Object.keys(saida).length ? saida : null;
  }

  /* O texto no idioma de agora: o idioma exato, o mesmo idioma sem a região, o do padrão do site,
   * e por fim qualquer um que exista. Texto simples vale para todos. */
  function tituloNoIdioma(valor, idioma, padrao) {
    if (typeof valor === 'string') return valor;
    var o = objeto(valor);
    var chaves = Object.keys(o);
    if (!chaves.length) return '';
    var base = String(idioma || '').split('-')[0];
    if (o[idioma]) return o[idioma];
    for (var i = 0; i < chaves.length; i++) if (chaves[i].split('-')[0] === base && o[chaves[i]]) return o[chaves[i]];
    if (padrao && o[padrao]) return o[padrao];
    return o[chaves[0]];
  }

  /* Só link do próprio site (#/...) ou https: nada de javascript:, nada de dado. */
  function linkValido(v) {
    if (typeof v !== 'string') return null;
    var t = v.trim();
    if (/^#\/[A-Za-z0-9\/_?=&%.~-]{0,200}$/.test(t)) return t;
    if (/^https:\/\/[^\s"'<>]{1,300}$/.test(t)) return t;
    return null;
  }

  /* Imagem do banner: um arquivo do próprio site (relativo) ou https. */
  function imagemValida(v) {
    if (typeof v !== 'string') return null;
    var t = v.trim();
    if (/^[A-Za-z0-9_][A-Za-z0-9_.\/-]{0,200}$/.test(t) && t.indexOf('..') < 0) return t;
    if (/^https:\/\/[^\s"'<>]{1,300}$/.test(t)) return t;
    return null;
  }

  /* ------------------------------------------------- saneamento do dado */

  function modeloSaneado(v) { return MODELOS.indexOf(v) >= 0 ? v : 'seriado'; }

  function idUnico(base, usados) {
    var raizId = String(base || 'bloco').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'bloco';
    if (!usados[raizId]) return raizId;
    for (var n = 2; n < 10000; n++) {
      var c = raizId + '-' + n;
      if (!usados[c]) return c;
    }
    return raizId + '-x' + Object.keys(usados).length;
  }

  /* A forma conferida de UM bloco, ou null se o tipo não existe. */
  function blocoSaneado(cru, usados) {
    var b = objeto(cru);
    if (!(typeof b.tipo === 'string' && Object.prototype.hasOwnProperty.call(TIPOS, b.tipo))) return null;
    var tipo = b.tipo;
    var ids = usados || {};
    var id = typeof b.id === 'string' && PADRAO_ID.test(b.id) && !ids[b.id] ? b.id : idUnico(tipo, ids);
    ids[id] = true;
    var s = { id: id, tipo: tipo };

    var titulo = textoPorIdioma(b.titulo, LIMITE_TEXTO);
    if (titulo) s.titulo = titulo;
    if (b.escondido === true) s.escondido = true;
    if (VISIBILIDADES.indexOf(b.visibilidade) > 0) s.visibilidade = b.visibilidade;

    (PARAMETROS[tipo] || []).forEach(function (campo) {
      var v = b[campo];
      var limpo = null;
      if (campo === 'limite') limpo = inteiro(v, 1, 100);
      else if (campo === 'de') limpo = inteiro(v, 1, 86400);
      else if (campo === 'ate') limpo = inteiro(v, 1, 86400);
      else if (campo === 'minimoDeTitulos') limpo = inteiro(v, 1, 50);
      else if (campo === 'incluirInstitucional' || campo === 'garantirQueTodoTituloApareca') limpo = typeof v === 'boolean' ? v : null;
      else if (campo === 'colecao') limpo = typeof v === 'string' && PADRAO_ID.test(v) ? v : null;
      else if (campo === 'titulos') {
        if (Array.isArray(v)) {
          var vistos = {};
          limpo = v.filter(function (x) {
            if (typeof x !== 'string' || !x || x.length > 200 || vistos[x]) return false;
            vistos[x] = true;
            return true;
          }).slice(0, LIMITE_TITULOS);
        }
      } else if (campo === 'texto') limpo = textoPorIdioma(v, LIMITE_TEXTO_LONGO);
      else if (campo === 'imagem') limpo = imagemValida(v);
      else if (campo === 'link') limpo = linkValido(v);
      if (limpo !== null && limpo !== undefined) s[campo] = limpo;
    });
    return s;
  }

  /* A lista inteira: no máximo LIMITE_BLOCOS, `id` único, tipo desconhecido descartado. null quando
   * `lista` nem é lista — aí vale o padrão. Lista VAZIA é uma escolha (a home sem nada). */
  function blocosSaneados(lista) {
    if (!Array.isArray(lista)) return null;
    var usados = {};
    var saida = [];
    lista.forEach(function (b) {
      if (saida.length >= LIMITE_BLOCOS) return;
      var s = blocoSaneado(b, usados);
      if (s) saida.push(s);
    });
    return saida;
  }

  /* Quantos blocos da lista crua não passam (tipo que não existe, ou não é objeto). A API usa para
   * recusar o PUT com 400 em vez de descartar em silêncio o que a pessoa escreveu. */
  function blocosInvalidos(lista) {
    if (!Array.isArray(lista)) return lista === undefined || lista === null ? [] : [{ indice: -1, motivo: 'nao-e-lista' }];
    var ruins = [];
    lista.forEach(function (b, i) {
      var o = objeto(b);
      if (!(typeof o.tipo === 'string' && Object.prototype.hasOwnProperty.call(TIPOS, o.tipo))) ruins.push({ indice: i, motivo: 'tipo' });
    });
    if (lista.length > LIMITE_BLOCOS) ruins.push({ indice: LIMITE_BLOCOS, motivo: 'muitos' });
    return ruins;
  }

  /* Coleções livres: { id, nome, classe, series[], tags[], titulos[] }. `classe` decide o que a coleção
   * é: 'pedagogica' (padrão) é só uma seleção — as séries dela continuam nas fileiras por série; 'curta'
   * e 'institucional' são EXCLUSIVAS — as séries dela saem das fileiras por série e de "Mais séries", e
   * a institucional também sai da fileira por duração. */
  function colecaoSaneada(cru, usados) {
    var c = objeto(cru);
    var id = typeof c.id === 'string' && PADRAO_ID.test(c.id) && !usados[c.id] ? c.id : null;
    if (!id) return null;
    usados[id] = true;
    var s = { id: id };
    var nome = textoPorIdioma(c.nome, LIMITE_TEXTO);
    if (nome) s.nome = nome;
    /* Os nomes das duas coleções de fábrica são texto de interface (traduzido): a chave sobrevive quando a
     * mesa grava a lista, e o `nome` escrito por alguém passa na frente dela. */
    if (c.nomeChave === 'catalogo.curtas' || c.nomeChave === 'catalogo.institucional') s.nomeChave = c.nomeChave;
    if (CLASSES.indexOf(c.classe) > 0) s.classe = c.classe;
    ['series', 'tags', 'titulos'].forEach(function (campo) {
      if (!Array.isArray(c[campo])) return;
      var vistos = {};
      var lista = c[campo].filter(function (x) {
        if (typeof x !== 'string') return false;
        var t = x.trim();
        if (!t || t.length > 200 || vistos[t]) return false;
        vistos[t] = true;
        return true;
      }).map(function (x) { return x.trim(); }).slice(0, campo === 'titulos' ? 200 : 100);
      if (lista.length) s[campo] = lista;
    });
    return s;
  }

  function colecoesSaneadas(lista) {
    if (!Array.isArray(lista)) return null;
    var usados = {};
    var saida = [];
    lista.forEach(function (c) {
      if (saida.length >= LIMITE_COLECOES) return;
      var s = colecaoSaneada(c, usados);
      if (s) saida.push(s);
    });
    return saida;
  }

  /* -------------------------------------------------------- os padrões */

  /* O que a chegada era antes dos blocos, como dado. Os ids são os das fileiras de sempre. */
  var BLOCOS_SERIADO = [
    { id: 'destaque', tipo: 'destaque' },
    { id: 'curtos', tipo: 'prateleira-duracao', ate: 300, minimoDeTitulos: 3 },
    { id: 'series', tipo: 'prateleira-por-serie', minimoDeTitulos: 3 },
    { id: 'mais-series', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: true },
    { id: 'curtas', tipo: 'prateleira-colecao', colecao: 'curtas' },
    { id: 'institucional', tipo: 'prateleira-colecao', colecao: 'institucional' }
  ];

  /* Conteúdo avulso (filmes, aulas soltas): sem fileira por série. As novidades vêm primeiro. */
  var BLOCOS_AVULSO = [
    { id: 'destaque', tipo: 'destaque' },
    { id: 'novidades', tipo: 'prateleira-recentes', limite: 12 },
    { id: 'curtos', tipo: 'prateleira-duracao', ate: 300, minimoDeTitulos: 3 },
    { id: 'todos', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: true },
    { id: 'curtas', tipo: 'prateleira-colecao', colecao: 'curtas' },
    { id: 'institucional', tipo: 'prateleira-colecao', colecao: 'institucional' }
  ];

  function blocosPadrao(modelo) { return copia(modelo === 'avulso' ? BLOCOS_AVULSO : BLOCOS_SERIADO); }

  /* As duas coleções de sempre. Os nomes são textos de interface (`nomeChave`, resolvidos por quem
   * desenha) e os nomes de série são DADO DE EXEMPLO: cada instalação troca pela sua lista no
   * config (`catalogo.colecoes`) ou na mesa. */
  function colecoesPadrao() {
    return [
      { id: 'curtas', nomeChave: 'catalogo.curtas', classe: 'curta', series: ['Curtas — Exemplo A', 'Curtas — Exemplo B'] },   /* i18n-ignorar: nomes de série (dado do acervo) */
      { id: 'institucional', nomeChave: 'catalogo.institucional', classe: 'institucional', series: ['Institucional', 'Eventos', 'Bastidores', 'A classificar'] }   /* i18n-ignorar: nomes de série (dado do acervo) */
    ];
  }

  /* O que vale para esta home: o que a mesa escolheu (`site`), senão o padrão. `site` é o do
   * `siteSaneado` (as chaves opcionais podem faltar). */
  function modeloDe(site) { return modeloSaneado(site && site.modeloDeConteudo); }

  function blocosEfetivos(site) {
    var escolhidos = site && Array.isArray(site.blocos) ? blocosSaneados(site.blocos) : null;
    return escolhidos || blocosPadrao(modeloDe(site));
  }

  function colecoesEfetivas(site) {
    var escolhidas = site && Array.isArray(site.colecoes) ? colecoesSaneadas(site.colecoes) : null;
    return escolhidas || colecoesPadrao();
  }

  /* O `site` com o que o config/site.json diz por baixo, para quem ninguém escolheu nada na mesa.
   * `padroes` = { blocos, colecoes, modeloDeConteudo } (de `padroesDaConfig`). Pura, e devolve cópia. */
  function siteComPadroes(site, padroes) {
    var s = Object.assign({}, site || {});
    var p = objeto(padroes);
    if (!Array.isArray(s.blocos) && Array.isArray(p.blocos)) s.blocos = blocosSaneados(p.blocos);
    if (!Array.isArray(s.colecoes) && Array.isArray(p.colecoes)) s.colecoes = colecoesSaneadas(p.colecoes);
    if (!s.modeloDeConteudo && p.modeloDeConteudo) s.modeloDeConteudo = modeloSaneado(p.modeloDeConteudo);
    return s;
  }

  /* O que o servidor tira do config para entregar junto do catálogo. Só o que o navegador pode ver. */
  function padroesDaConfig(config) {
    var c = objeto(config);
    var home = objeto(c.home);
    var cat = objeto(c.catalogo);
    var saida = {};
    var blocos = blocosSaneados(home.blocos);
    if (blocos && blocos.length) saida.blocos = blocos;
    var colecoes = colecoesSaneadas(cat.colecoes);
    if (colecoes && colecoes.length) saida.colecoes = colecoes;
    /* 'seriado' é o padrão do código: só o que foge dele viaja, e o `site` sem escolha continua do mesmo tamanho. */
    if (modeloSaneado(cat.modeloDeConteudo) === 'avulso') saida.modeloDeConteudo = 'avulso';
    var idiomas = objeto(c.idiomas);
    if (Array.isArray(idiomas.disponiveis)) {
      saida.idiomas = idiomas.disponiveis.filter(function (i) { return typeof i === 'string' && PADRAO_IDIOMA.test(i); });
    }
    return saida;
  }

  /* ----------------------------------------------- a classe e a coleção */

  /* A classe da série pelas coleções: a primeira coleção EXCLUSIVA que a lista. Sem lista, pedagógica
   * (o site não esconde título por lista desatualizada: ela cai em "Mais séries"). */
  function classeDasColecoes(nome, colecoes) {
    for (var i = 0; i < colecoes.length; i++) {
      var c = colecoes[i];
      if ((c.classe === 'curta' || c.classe === 'institucional') && (c.series || []).indexOf(nome) >= 0) return c.classe;
    }
    return 'pedagogica';
  }

  /* ------------------------------------------------------- resolver */

  function titulosDe(bloco, P) {
    return tituloNoIdioma(bloco.titulo, P.idiomaAtual(), P.idiomaPadrao ? P.idiomaPadrao() : '');
  }

  function visivelPara(bloco, ctx) {
    if (ctx.ignorarVisibilidade) return true;
    if (bloco.visibilidade === 'logado') return ctx.logado === true;
    if (bloco.visibilidade === 'anonimo') return ctx.logado !== true;
    return true;
  }

  function minutosEmTexto(seg) {
    var m = seg / 60;
    return Math.floor(m) === m ? m : Math.round(m * 10) / 10;
  }

  function tituloDaDuracao(bloco, P) {
    var proprio = titulosDe(bloco, P);
    if (proprio) return proprio;
    var de = bloco.de, ate = bloco.ate;
    if (de && ate) return P.tr('home.duracaoEntre', { de: minutosEmTexto(de), ate: minutosEmTexto(ate) });
    if (de) return P.tr('home.duracaoApartir', { min: minutosEmTexto(de) });
    return P.tr('catalogo.ate', { min: minutosEmTexto(ate || 300) });
  }

  function nomeDaColecao(col, P) {
    var n = tituloNoIdioma(col.nome, P.idiomaAtual(), P.idiomaPadrao ? P.idiomaPadrao() : '');
    if (n) return n;
    return col.nomeChave ? P.tr(col.nomeChave) : col.id;
  }

  /* Resolve a home. Devolve
   *   { blocos:     [ { bloco, tipo, visivel, prateleiras:[] } ]   (todos, na ordem da lista),
   *     sequencia:  [ { tipo, bloco, prateleira? } ]               (o que se desenha, na ordem),
   *     prateleiras:[ { id, titulo, itens, blocoId, tipo, escondida? } ] (as fileiras da sequência) }
   *
   * `itens`: o catálogo; `site`: o `siteSaneado` (com ou sem os padrões); `contexto`:
   * { logado, ondeParou (mapa do navegador), minhaLista (ids, ou null se não há conta),
   *   ignorarVisibilidade }; `P`: as primitivas do catalogo-core. */
  function resolver(itens, site, contexto, P) {
    var ctx = contexto || {};
    var s = site || {};
    var blocos = blocosEfetivos(s);
    var colecoes = colecoesEfetivas(s);
    var classes = objeto(s.classes);
    var modelo = modeloDe(s);

    var pub = P.publicaveis(itens);
    var base = P.ordenar(pub);
    var porId = Object.create(null);
    pub.forEach(function (i) { porId[i.id] = i; });

    /* Classe e coleção de uma série: o dado da mesa (`site.classes`) vence a lista da coleção. */
    function classeDaSerie(nome) { return classes[nome] || classeDasColecoes(nome, colecoes); }
    function primeiraDaClasse(classe) {
      for (var i = 0; i < colecoes.length; i++) if (colecoes[i].classe === classe) return colecoes[i];
      return null;
    }
    function ehInstitucional(i) { return classeDaSerie(i.serie || P.semSerie()) === 'institucional'; }

    function pertence(item, col) {
      if ((col.titulos || []).indexOf(item.id) >= 0) return true;
      var serie = item.serie || P.semSerie();
      if (col.classe === 'curta' || col.classe === 'institucional') {
        if (classeDaSerie(serie) !== col.classe) return false;
        if ((col.series || []).indexOf(serie) >= 0) return true;
        return classes[serie] === col.classe && primeiraDaClasse(col.classe) === col;
      }
      if ((col.series || []).indexOf(serie) >= 0) return true;
      var tags = Array.isArray(item.tags) ? item.tags : [];
      return (col.tags || []).some(function (t) {
        var alvo = P.normalizar(t);
        return tags.some(function (x) { return P.normalizar(x) === alvo; });
      });
    }

    function colecaoPorId(id) {
      for (var i = 0; i < colecoes.length; i++) if (colecoes[i].id === id) return colecoes[i];
      return null;
    }

    var entradas = blocos.map(function (b) {
      return { bloco: b, tipo: b.tipo, visivel: visivelPara(b, ctx), prateleiras: [], extra: null };
    });

    /* Passo 1: tudo menos o restante, que depende do que os outros cobrem. */
    var cobertos = Object.create(null);
    function cobrir(lista) { lista.forEach(function (i) { cobertos[i.id] = true; }); }

    entradas.forEach(function (e) {
      var b = e.bloco;
      var t = e.tipo;
      var saida = [];
      function fileira(id, titulo, lista) { saida.push({ id: id, titulo: titulo, itens: lista, blocoId: b.id, tipo: t }); }

      if (t === 'prateleira-duracao') {
        var de = b.de || 0;
        var ate = b.ate || (b.de ? Infinity : 300);
        var curtos = base.filter(function (i) {
          if (!b.incluirInstitucional && ehInstitucional(i)) return false;
          return typeof i.duracao_seg === 'number' && i.duracao_seg > 0 && i.duracao_seg >= de && i.duracao_seg <= ate;
        });
        if (curtos.length >= (b.minimoDeTitulos || P.MINIMO_PRATELEIRA)) fileira(b.id, tituloDaDuracao(b, P), curtos);
      } else if (t === 'prateleira-por-serie') {
        var minimo = b.minimoDeTitulos || P.MINIMO_PRATELEIRA;
        var porSerie = [];
        var indice = Object.create(null);
        base.forEach(function (i) {
          var nome = i.serie || P.semSerie();
          if (classeDaSerie(nome) !== 'pedagogica') return;
          if (!(nome in indice)) { indice[nome] = porSerie.length; porSerie.push({ serie: nome, itens: [] }); }
          porSerie[indice[nome]].itens.push(i);
        });
        var grandes = porSerie.filter(function (g) { return g.itens.length >= minimo; });
        grandes.sort(function (a, c) {
          if (a.itens.length !== c.itens.length) return c.itens.length - a.itens.length;
          return P.normalizar(a.serie).localeCompare(P.normalizar(c.serie), P.idiomaAtual());
        });
        grandes.forEach(function (g) { fileira('serie:' + g.serie, g.serie, g.itens); });
      } else if (t === 'prateleira-colecao') {
        var col = colecaoPorId(b.colecao);
        if (col) {
          var dela = base.filter(function (i) { return pertence(i, col); });
          /* Os títulos escolhidos à mão vão na frente, na ordem em que foram escolhidos. */
          if ((col.titulos || []).length) {
            var manuais = col.titulos.map(function (id) { return porId[id]; }).filter(Boolean);
            var resto = dela.filter(function (i) { return col.titulos.indexOf(i.id) < 0; });
            dela = manuais.concat(resto);
          }
          if (b.limite) dela = dela.slice(0, b.limite);
          if (dela.length) fileira(b.id, titulosDe(b, P) || nomeDaColecao(col, P), dela);
        }
      } else if (t === 'prateleira-recentes') {
        /* Os últimos que entraram no ar: o catálogo cresce no fim, então é a ordem do KV de trás
         * para a frente; `adicionado_em` (ISO), quando existe, manda. */
        var recentes = pub.map(function (i, n) { return { i: i, n: n, q: typeof i.adicionado_em === 'string' ? i.adicionado_em : '' }; });
        recentes.sort(function (a, c) {
          if (a.q !== c.q) return a.q < c.q ? 1 : -1;
          return c.n - a.n;
        });
        var lista = recentes.slice(0, b.limite || 12).map(function (x) { return x.i; });
        if (lista.length) fileira(b.id, titulosDe(b, P) || P.tr('home.novidades'), lista);
      } else if (t === 'carrossel') {
        var escolhidos = (b.titulos || []).map(function (id) { return porId[id]; }).filter(Boolean);
        if (escolhidos.length) fileira(b.id, titulosDe(b, P) || P.tr('home.selecao'), escolhidos);
      } else if (t === 'continuar-assistindo') {
        var cont = ctx.ondeParou ? P.continuarAssistindo(itens, ctx.ondeParou, b.limite || 12) : [];
        if (cont.length) fileira(b.id, titulosDe(b, P) || P.tr('home.continuarAssistindo'), cont);
      } else if (t === 'minha-lista') {
        var ids = Array.isArray(ctx.minhaLista) ? ctx.minhaLista : [];
        var minha = ids.map(function (id) { return porId[id]; }).filter(Boolean).slice(0, b.limite || 50);
        if (minha.length) fileira(b.id, titulosDe(b, P) || P.tr('home.minhaLista'), minha);
      } else if (t === 'busca') {
        e.extra = { titulo: titulosDe(b, P) };
      } else if (t === 'texto' || t === 'banner') {
        var texto = tituloNoIdioma(b.texto, P.idiomaAtual(), P.idiomaPadrao ? P.idiomaPadrao() : '');
        if (texto) {
          e.extra = { titulo: titulosDe(b, P), texto: texto, link: b.link || null, imagem: b.imagem || null, variante: t };
        }
      }

      e.prateleiras = saida;
      if (TIPOS[t].cobre) saida.forEach(function (p) { cobrir(p.itens); });
    });

    /* Passo 2: o que sobrou. */
    entradas.forEach(function (e) {
      if (e.tipo !== 'prateleira-restante') return;
      var b = e.bloco;
      var garantir = b.garantirQueTodoTituloApareca !== false;
      var sobra = base.filter(function (i) {
        if (cobertos[i.id]) return false;
        if (!garantir && classeDaSerie(i.serie || P.semSerie()) !== 'pedagogica') return false;
        return true;
      });
      if (sobra.length) {
        var padraoTitulo = b.id === 'mais-series' ? P.tr('catalogo.maisSeries') : P.tr('home.maisTitulos');
        e.prateleiras = [{ id: b.id, titulo: titulosDe(b, P) || padraoTitulo, itens: sobra, blocoId: b.id, tipo: e.tipo }];
      }
    });

    /* A marca de escondido: a fileira fica na lista (o "Ver tudo", a mesa e os testes leem dela); quem
     * a tira da tela é `prateleirasVisiveis`. */
    entradas.forEach(function (e) {
      if (e.bloco.escondido) e.prateleiras.forEach(function (p) { p.escondida = true; });
    });

    /* As escolhas de nome, ordem e escondida feitas por fileira na mesa (site.prateleiras) valem por
     * cima. Só as fileiras de blocos visíveis para este público entram na conta. */
    var visiveis = entradas.filter(function (e) { return e.visivel; });
    var planas = [];
    visiveis.forEach(function (e) { e.prateleiras.forEach(function (p) { planas.push(p); }); });
    var finais = P.escolhasDaMesa ? P.escolhasDaMesa(planas, s) : planas;

    /* A sequência: a posição das fileiras na lista de blocos não muda, e quem as ocupa é a ordem final. */
    var sequencia = [];
    var proxima = 0;
    var primeiroDestaque = true;
    visiveis.forEach(function (e) {
      if (e.tipo === 'destaque') {
        if (primeiroDestaque && !e.bloco.escondido) sequencia.push({ tipo: 'destaque', bloco: e.bloco });
        primeiroDestaque = false;
      } else if (e.tipo === 'busca') {
        if (!e.bloco.escondido) sequencia.push({ tipo: 'busca', bloco: e.bloco, texto: e.extra });
      } else if (e.extra) {
        if (!e.bloco.escondido) sequencia.push({ tipo: e.tipo, bloco: e.bloco, texto: e.extra });
      } else {
        e.prateleiras.forEach(function () {
          var p = finais[proxima++];
          sequencia.push({ tipo: 'prateleira', bloco: e.bloco, prateleira: p });
        });
      }
    });

    return {
      modelo: modelo,
      blocos: entradas.map(function (e) { return { bloco: e.bloco, tipo: e.tipo, visivel: e.visivel, prateleiras: e.prateleiras, texto: e.extra }; }),
      sequencia: sequencia,
      prateleiras: finais
    };
  }

  /* ------------------------------------------------- as escritas da mesa
   *
   * Todas puras: recebem a lista de blocos EFETIVA (a que a tela mostra) e devolvem uma lista NOVA.
   * Quem grava é o rascunho da mesa, como o resto da estrutura — e quem recusa é o PUT. */

  function novoBloco(tipo, lista) {
    if (!Object.prototype.hasOwnProperty.call(TIPOS, tipo)) return null;
    var usados = {};
    (lista || []).forEach(function (b) { usados[b.id] = true; });
    var b = { id: idUnico(tipo.replace(/^prateleira-/, ''), usados), tipo: tipo };
    if (tipo === 'prateleira-recentes') b.limite = 12;
    if (tipo === 'prateleira-duracao') { b.ate = 300; b.minimoDeTitulos = 3; }
    if (tipo === 'prateleira-por-serie') b.minimoDeTitulos = 3;
    if (tipo === 'prateleira-restante') b.garantirQueTodoTituloApareca = true;
    if (tipo === 'continuar-assistindo' || tipo === 'minha-lista') b.limite = 12;
    if (tipo === 'carrossel') b.titulos = [];
    if (tipo === 'minha-lista') b.visibilidade = 'logado';
    return b;
  }

  function comBlocoAdicionado(lista, tipo, posicao) {
    var atual = blocosSaneados(lista) || [];
    if (atual.length >= LIMITE_BLOCOS) return atual;
    var b = novoBloco(tipo, atual);
    if (!b) return atual;
    var onde = typeof posicao === 'number' && posicao >= 0 && posicao <= atual.length ? posicao : atual.length;
    var nova = atual.slice();
    nova.splice(onde, 0, b);
    return blocosSaneados(nova);
  }

  function comBlocoRemovido(lista, id) {
    return blocosSaneados((blocosSaneados(lista) || []).filter(function (b) { return b.id !== id; }));
  }

  function comBlocoMovido(lista, id, passo) {
    var nova = (blocosSaneados(lista) || []).slice();
    var i = nova.map(function (b) { return b.id; }).indexOf(id);
    var j = i + passo;
    if (i < 0 || j < 0 || j >= nova.length) return nova;
    var tmp = nova[i];
    nova[i] = nova[j];
    nova[j] = tmp;
    return nova;
  }

  /* `mudanca`: os campos a trocar; um campo com null, '' ou undefined é APAGADO (volta ao padrão do
   * bloco). `titulo` e `texto` aceitam o objeto por idioma inteiro. */
  function comBlocoAlterado(lista, id, mudanca) {
    var nova = (blocosSaneados(lista) || []).map(function (b) {
      if (b.id !== id) return b;
      var novo = Object.assign({}, b);
      Object.keys(mudanca || {}).forEach(function (k) {
        if (k === 'id' || k === 'tipo') return;
        var v = mudanca[k];
        if (v === null || v === undefined || v === '' || v === false && k !== 'garantirQueTodoTituloApareca' && k !== 'incluirInstitucional') delete novo[k];
        else novo[k] = v;
      });
      return novo;
    });
    return blocosSaneados(nova);
  }

  function comTituloNoIdioma(lista, id, idioma, texto) {
    var bloco = (blocosSaneados(lista) || []).filter(function (b) { return b.id === id; })[0];
    if (!bloco || !PADRAO_IDIOMA.test(idioma)) return blocosSaneados(lista) || [];
    var atual = typeof bloco.titulo === 'string' ? {} : Object.assign({}, bloco.titulo || {});
    var t = aparado(texto, LIMITE_TEXTO);
    if (t) atual[idioma] = t; else delete atual[idioma];
    return comBlocoAlterado(lista, id, { titulo: Object.keys(atual).length ? atual : null });
  }

  function comColecaoAlterada(lista, colecao) {
    var atual = (colecoesSaneadas(lista) || []).slice();
    var nova = colecaoSaneada(colecao, {});
    if (!nova) return atual;
    var i = atual.map(function (c) { return c.id; }).indexOf(nova.id);
    if (i >= 0) atual[i] = nova; else atual.push(nova);
    return colecoesSaneadas(atual);
  }

  function comColecaoRemovida(lista, id) {
    return colecoesSaneadas((colecoesSaneadas(lista) || []).filter(function (c) { return c.id !== id; }));
  }

  function idDeColecaoNova(lista, nome) {
    var usados = {};
    (lista || []).forEach(function (c) { usados[c.id] = true; });
    return idUnico(String(nome || 'colecao').normalize('NFD').replace(/[̀-ͯ]/g, ''), usados);
  }

  var AppHome = {
    TIPOS: TIPOS,
    ORDEM_DOS_TIPOS: ORDEM_DOS_TIPOS,
    VISIBILIDADES: VISIBILIDADES,
    CLASSES_DE_COLECAO: CLASSES,
    MODELOS: MODELOS,
    PARAMETROS: PARAMETROS,
    LIMITE_BLOCOS: LIMITE_BLOCOS,
    blocosPadrao: blocosPadrao,
    colecoesPadrao: colecoesPadrao,
    modeloSaneado: modeloSaneado,
    blocoSaneado: blocoSaneado,
    blocosSaneados: blocosSaneados,
    blocosInvalidos: blocosInvalidos,
    colecoesSaneadas: colecoesSaneadas,
    blocosEfetivos: blocosEfetivos,
    colecoesEfetivas: colecoesEfetivas,
    modeloDe: modeloDe,
    siteComPadroes: siteComPadroes,
    padroesDaConfig: padroesDaConfig,
    classeDasColecoes: classeDasColecoes,
    tituloNoIdioma: tituloNoIdioma,
    nomeDaColecao: nomeDaColecao,
    resolver: resolver,
    novoBloco: novoBloco,
    comBlocoAdicionado: comBlocoAdicionado,
    comBlocoRemovido: comBlocoRemovido,
    comBlocoMovido: comBlocoMovido,
    comBlocoAlterado: comBlocoAlterado,
    comTituloNoIdioma: comTituloNoIdioma,
    comColecaoAlterada: comColecaoAlterada,
    comColecaoRemovida: comColecaoRemovida,
    idDeColecaoNova: idDeColecaoNova
  };

  raiz.AppHome = AppHome;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppHome;
})(typeof globalThis !== 'undefined' ? globalThis : this);
