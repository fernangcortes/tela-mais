/* i18n.js — a tradução da interface: t(), plural, datas e durações por idioma.
 *
 * UM arquivo, três usos, sem etapa de build (o mesmo desenho dos *-core.js):
 *   - no site e na mesa, como <script> comum, expondo window.AppI18n;
 *   - no Worker, como import (o esbuild o empacota como CommonJS);
 *   - nos testes, como módulo CommonJS.
 * Sem DOM e sem rede: quem baixa o catálogo de textos é o app.js (ou a mesa); aqui
 * só se resolve a chave. Em Node/Worker o catálogo pt-BR já vem junto (require
 * do JSON), para que as mensagens das APIs e os testes funcionem sem preparo; no
 * navegador ele chega por `iniciar()`, e só o idioma que a pessoa usa.
 *
 * COMO UMA CHAVE É RESOLVIDA (a primeira que existir vence):
 *   1. override do cliente no idioma atual  (config.textos[idioma][chave])
 *   2. catálogo do idioma atual             (core/locales/<idioma>.json)
 *   3. override do cliente no idioma padrão
 *   4. catálogo do idioma padrão
 *   5. catálogo pt-BR (o de referência, sempre completo)
 *   6. a própria chave — e ela é registrada em `faltantes()`, para teste e depuração
 * Um idioma só traduzido pela metade, portanto, nunca deixa buraco na tela.
 *
 * FORMATO DO VALOR:
 *   "Olá, {nome}"                        interpolação de {param}
 *   { "um": "{n} título", "outro": "{n} títulos" }   plural: escolhido por
 *       Intl.PluralRules sobre `params.n`. Categorias CLDR (zero, one, two, few,
 *       many, other) valem; "um" é apelido de "one", "outro" de "other", e uma
 *       chave "=0" (ou "=1"...) vence a categoria quando n é exatamente aquele número.
 * Interpolar NUNCA gera HTML: quem insere o texto usa textContent.
 */
(function (raiz) {
  'use strict';

  /* Os idiomas que o produto traz traduzidos. O cliente pode acrescentar outros
   * com config/locales/<idioma>.json; estes três vêm de fábrica. */
  var IDIOMAS_DE_FABRICA = ['pt-BR', 'en', 'es'];
  var IDIOMA_REFERENCIA = 'pt-BR';
  var ROTULOS_DO_IDIOMA = { 'pt-BR': 'Português', en: 'English', es: 'Español' }; /* i18n-ignorar: cada idioma se chama na própria língua */
  var APELIDOS_CATEGORIA = { um: 'one', outro: 'other', zero: 'zero', dois: 'two', poucos: 'few', muitos: 'many' };

  var catalogoPtNode = null;
  try {
    if (typeof require === 'function') catalogoPtNode = require('../locales/pt-BR.json');
  } catch (e) { catalogoPtNode = null; }

  /* ------------------------------------------------------------ idioma */

  /* "pt-br", "pt_BR", "PT" -> "pt-BR"; "en-US" -> "en-US". Nada reconhecível: ''. */
  function normalizarIdioma(tag) {
    var m = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}|\d{3}))?/.exec(String(tag == null ? '' : tag).trim());
    if (!m) return '';
    var lingua = m[1].toLowerCase();
    return m[2] ? lingua + '-' + m[2].toUpperCase() : lingua;
  }

  /* O melhor idioma da lista `disponiveis` para o pedido: igual > mesma língua
   * (en-US -> en; pt-PT -> pt-BR) > ''. */
  function combinarIdioma(pedido, disponiveis) {
    var alvo = normalizarIdioma(pedido);
    if (!alvo || !disponiveis || !disponiveis.length) return '';
    var i;
    for (i = 0; i < disponiveis.length; i++) if (normalizarIdioma(disponiveis[i]) === alvo) return disponiveis[i];
    var lingua = alvo.split('-')[0];
    for (i = 0; i < disponiveis.length; i++) if (normalizarIdioma(disponiveis[i]).split('-')[0] === lingua) return disponiveis[i];
    return '';
  }

  /* Escolhe o idioma pelos pedidos do navegador (navigator.languages, na ordem
   * de preferência) entre os `disponiveis`; sem casamento, o `padrao`. */
  function detectarDoNavegador(pedidos, disponiveis, padrao) {
    var lista = Array.isArray(pedidos) ? pedidos : (pedidos ? [pedidos] : []);
    for (var i = 0; i < lista.length; i++) {
      var achado = combinarIdioma(lista[i], disponiveis);
      if (achado) return achado;
    }
    return padrao || IDIOMA_REFERENCIA;
  }

  /* O mesmo, para o cabeçalho Accept-Language de uma requisição ("pt-BR,pt;q=0.9,en;q=0.8"),
   * ordenado pelo q. Serve ao Worker, que não tem navigator. */
  function detectarDoCabecalho(cabecalho, disponiveis, padrao) {
    var partes = String(cabecalho || '').split(',').map(function (p, ordem) {
      var campos = p.trim().split(';');
      var q = 1;
      for (var k = 1; k < campos.length; k++) {
        var mq = /^\s*q\s*=\s*([\d.]+)/.exec(campos[k]);
        if (mq) q = parseFloat(mq[1]);
      }
      return { tag: campos[0], q: isNaN(q) ? 0 : q, ordem: ordem };
    }).filter(function (p) { return p.tag && p.tag !== '*' && p.q > 0; });
    partes.sort(function (a, b) { return b.q - a.q || a.ordem - b.ordem; });
    return detectarDoNavegador(partes.map(function (p) { return p.tag; }), disponiveis, padrao);
  }

  /* ------------------------------------------------------- interpolação */

  function valorDe(params, nome) {
    var v = params && Object.prototype.hasOwnProperty.call(params, nome) ? params[nome] : undefined;
    return v == null ? '' : String(v);
  }

  function interpolar(modelo, params) {
    return String(modelo).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function (todo, nome) {
      return params && Object.prototype.hasOwnProperty.call(params, nome) ? valorDe(params, nome) : todo;
    });
  }

  function escolherPlural(forma, n, idioma) {
    var exato = forma['=' + n];
    if (typeof exato === 'string') return exato;
    var categoria = 'other';
    try { categoria = new Intl.PluralRules(idioma || IDIOMA_REFERENCIA).select(Number(n)); } catch (e) { /* idioma torto: other */ }
    var chaves = Object.keys(forma);
    for (var i = 0; i < chaves.length; i++) {
      var cat = APELIDOS_CATEGORIA[chaves[i]] || chaves[i];
      if (cat === categoria && typeof forma[chaves[i]] === 'string') return forma[chaves[i]];
    }
    var outro = forma.other != null ? forma.other : forma.outro;
    return typeof outro === 'string' ? outro : '';
  }

  /* ------------------------------------------------------------ formatos */

  function formatador(Classe, idioma, opcoes) {
    try { return new Classe(idioma, opcoes); } catch (e) { return new Classe(IDIOMA_REFERENCIA, opcoes); }
  }

  function paraData(valor) {
    var d = valor instanceof Date ? valor : new Date(valor);
    return isNaN(d.getTime()) ? null : d;
  }

  var ESTILOS_DE_DATA = {
    curta: { day: '2-digit', month: '2-digit', year: 'numeric' },
    longa: { day: 'numeric', month: 'long', year: 'numeric' },
    dataHora: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    hora: { hour: '2-digit', minute: '2-digit' },
    mesAno: { month: 'long', year: 'numeric' }
  };

  function formatarData(valor, idioma, estilo, fusoHorario) {
    var d = paraData(valor);
    if (!d) return '';
    var opcoes = Object.assign({}, typeof estilo === 'object' && estilo ? estilo : (ESTILOS_DE_DATA[estilo] || ESTILOS_DE_DATA.curta));
    if (fusoHorario) opcoes.timeZone = fusoHorario;
    return formatador(Intl.DateTimeFormat, idioma, opcoes).format(d);
  }

  function formatarNumero(valor, idioma, opcoes) {
    var n = Number(valor);
    if (!isFinite(n)) return '';
    return formatador(Intl.NumberFormat, idioma, opcoes).format(n);
  }

  /* "1 h 23 min", "45 s": uma duração em segundos por extenso curto, na língua
   * do idioma (Intl, unidades `hour`/`minute`/`second`). Zero segundos: "0 s". */
  function formatarDuracao(segundos, idioma) {
    var total = Math.max(0, Math.round(Number(segundos) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var unidade = function (valor, un) {
      return formatador(Intl.NumberFormat, idioma, { style: 'unit', unit: un, unitDisplay: 'short' }).format(valor);
    };
    var partes = [];
    if (h) partes.push(unidade(h, 'hour'));
    if (m) partes.push(unidade(m, 'minute'));
    if (s || !partes.length) {
      /* Com horas, os segundos soltos só poluem: "1 h 23 min", não "1 h 23 min 7 s". */
      if (!h) partes.push(unidade(s, 'second'));
    }
    return partes.join(' ');
  }

  /* "1:23:45" / "3:07": o relógio do player. Os dígitos seguem o idioma. */
  function formatarRelogio(segundos, idioma) {
    var total = Math.max(0, Math.floor(Number(segundos) || 0));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var dois = formatador(Intl.NumberFormat, idioma, { minimumIntegerDigits: 2, useGrouping: false });
    var um = formatador(Intl.NumberFormat, idioma, { useGrouping: false });
    return h ? um.format(h) + ':' + dois.format(m) + ':' + dois.format(s) : um.format(m) + ':' + dois.format(s);
  }

  /* "há 3 dias" / "3 days ago": `valor` é um instante; `agora`, opcional. */
  function formatarRelativo(valor, idioma, agora) {
    var d = paraData(valor);
    if (!d) return '';
    var dif = (d.getTime() - (agora == null ? Date.now() : paraData(agora).getTime())) / 1000;
    var faixas = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    var rtf = formatador(Intl.RelativeTimeFormat, idioma, { numeric: 'auto' });
    for (var i = 0; i < faixas.length; i++) {
      if (Math.abs(dif) >= faixas[i][1]) return rtf.format(Math.round(dif / faixas[i][1]), faixas[i][0]);
    }
    return rtf.format(Math.round(dif), 'second');
  }

  function formatarBytes(bytes, idioma) {
    var n = Number(bytes);
    if (!isFinite(n) || n < 0) return '';
    var un = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];
    var i = 0;
    while (n >= 1024 && i < un.length - 1) { n /= 1024; i++; }
    return formatador(Intl.NumberFormat, idioma, {
      style: 'unit', unit: un[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0
    }).format(n);
  }

  /* Ordenação alfabética no idioma ("ç" depois do "c", "ñ" depois do "n"). */
  function comparar(a, b, idioma) {
    return formatador(Intl.Collator, idioma, { sensitivity: 'base', numeric: true }).compare(String(a), String(b));
  }


  /* ------------------------------------------------- o navegador (site e mesa) */

  function lerJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  /* Qual idioma abrir. A ordem — a primeira que existir e estiver em `disponiveis`:
   *   1. ?idioma=xx na URL (link que já vai no idioma certo);
   *   2. a escolha guardada de quem usa o seletor;
   *   3. o idioma do navegador, SE o cliente ligou `detectarDoNavegador`;
   *   4. o padrão do cliente. */
  function escolherIdiomaInicial(o) {
    var lista = o.disponiveis && o.disponiveis.length ? o.disponiveis : [o.padrao];
    var passos = [o.parametro, o.salvo];
    for (var i = 0; i < passos.length; i++) {
      var achado = combinarIdioma(passos[i], lista);
      if (achado) return achado;
    }
    if (o.detectar) return detectarDoNavegador(o.navegador, lista, o.padrao);
    return o.padrao;
  }

  /* Opções: `chaveSalva` (chave do localStorage da escolha), `base` (prefixo de URL),
   * `disponiveis` e `detectar` (trocam os da config: a mesa fala todos os idiomas
   * que o produto traz, mesmo que o site tenha um só).
   *
   * Prepara o idioma da página: lê config.public.json, escolhe o idioma, baixa SÓ o
   * catálogo dele (core/site/locales/<idioma>.json, já com os textos do cliente
   * mesclados por scripts/aplicar-config.mjs) e deixa `AppI18n.t` pronto. Falha
   * de rede não derruba a página: sem catálogo, `t()` devolve a chave. */
  function iniciarNoNavegador(opcoes) {
    var op = opcoes || {};
    var base = op.base || '';
    var janela = op.janela || raiz;
    var publicaP = op.publica ? Promise.resolve(op.publica)
      : lerJson(base + 'config.public.json').catch(function () { return null; });
    return publicaP.then(function (publica) {
      var idi = (publica && publica.idiomas) || {};
      var padrao = normalizarIdioma(idi.padrao) || IDIOMA_REFERENCIA;
      var disponiveis = Array.isArray(idi.disponiveis) && idi.disponiveis.length ? idi.disponiveis.slice() : [padrao];
      /* A mesa passa os idiomas de fábrica; eles se somam aos do cliente. */
      (op.disponiveis || []).forEach(function (id) { if (disponiveis.indexOf(id) < 0) disponiveis.push(id); });
      var parametro = '';
      var salvo = '';
      try { parametro = new URLSearchParams(janela.location.search).get('idioma') || ''; } catch (e) { parametro = ''; }
      try { salvo = op.chaveSalva ? janela.localStorage.getItem(op.chaveSalva) || '' : ''; } catch (e) { salvo = ''; }
      var idioma = escolherIdiomaInicial({
        disponiveis: disponiveis, padrao: padrao, parametro: parametro, salvo: salvo,
        detectar: op.detectar != null ? op.detectar === true : idi.detectarDoNavegador === true,
        navegador: janela.navigator ? (janela.navigator.languages || [janela.navigator.language]) : []
      });
      var marca = (publica && publica.marca) || {};
      var globais = { marca: marca.nome || '', marcaCurta: marca.nomeCurto || marca.nome || '', organizacao: marca.organizacao || '' };
      var carregar = function (id) { return lerJson(base + 'locales/' + id + '.json'); };
      return carregar(idioma).catch(function () {
        /* O idioma pedido não veio: tenta o padrão antes de desistir. */
        return idioma === padrao ? {} : carregar(padrao).then(function (c) { idioma = padrao; return c; }).catch(function () { return {}; });
      }).then(function (catalogo) {
        var catalogos = {};
        catalogos[idioma] = catalogo;
        var inst = iniciar({ idioma: idioma, padrao: padrao, catalogos: catalogos, globais: globais });
        try { janela.document.documentElement.lang = idioma; } catch (e) { /* sem DOM */ }
        return { instancia: inst, publica: publica, idioma: idioma, disponiveis: disponiveis, padrao: padrao };
      });
    });
  }

  /* O nome do idioma NA PRÓPRIA LÍNGUA ("Español", não "Spanish"): quem procura o
   * seu idioma no seletor o reconhece mesmo se a página estiver em outra. */
  function rotuloDoIdioma(id) {
    if (ROTULOS_DO_IDIOMA[id]) return ROTULOS_DO_IDIOMA[id];
    try {
      var nome = new Intl.DisplayNames([id], { type: 'language' }).of(id);
      return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : id;
    } catch (e) { return id; }
  }

  /* Escreve no HTML estático os textos do idioma de agora:
   *   data-i18n="chave"                       troca o textContent;
   *   data-i18n-attr="aria-label:chave;title:outra"   troca atributos.
   * O aplicar-config já deixa o HTML no idioma padrão (primeiro quadro sem
   * piscar); isto cobre os outros idiomas e só toca o que mudou. */
  function aplicarNoDocumento(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var nos = doc.querySelectorAll('[data-i18n]');
    var i;
    for (i = 0; i < nos.length; i++) {
      var texto = atual.t(nos[i].getAttribute('data-i18n'));
      if (nos[i].textContent !== texto) nos[i].textContent = texto;
    }
    var com = doc.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < com.length; i++) {
      com[i].getAttribute('data-i18n-attr').split(';').forEach(function (par) {
        var corte = par.indexOf(':');
        if (corte < 1) return;
        var attr = par.slice(0, corte).trim();
        var valor = atual.t(par.slice(corte + 1).trim());
        if (com[i].getAttribute(attr) !== valor) com[i].setAttribute(attr, valor);
      });
    }
  }

  /* Guarda a escolha do seletor e recarrega: os textos são desenhados uma vez,
   * então recarregar é o jeito simples e sem resíduo de trocar tudo de língua. */
  function trocarIdioma(id, opcoes) {
    var op = opcoes || {};
    var janela = op.janela || raiz;
    try { if (op.chaveSalva) janela.localStorage.setItem(op.chaveSalva, id); } catch (e) { /* sem storage: vale só até recarregar? não — cai no parâmetro */ }
    try {
      var url = new URL(janela.location.href);
      url.searchParams.set('idioma', id);
      janela.location.replace(url.toString());
    } catch (e) { janela.location.reload(); }
  }

  /* ----------------------------------------------------------- a instância */

  function criar(opcoes) {
    var op = opcoes || {};
    var padrao = normalizarIdioma(op.padrao) || IDIOMA_REFERENCIA;
    var estadoI = {
      idioma: normalizarIdioma(op.idioma) || padrao,
      padrao: padrao,
      catalogos: {},
      overrides: {},
      /* Parâmetros que valem em TODA chave: {marca}, {marcaCurta}, {organizacao}.
       * É por eles que o catálogo nunca precisa escrever o nome do cliente. */
      globais: Object.assign({}, op.globais || {}),
      faltantes: {}
    };
    if (catalogoPtNode) estadoI.catalogos[IDIOMA_REFERENCIA] = catalogoPtNode;
    Object.keys(op.catalogos || {}).forEach(function (k) { estadoI.catalogos[k] = op.catalogos[k]; });
    Object.keys(op.overrides || {}).forEach(function (k) { estadoI.overrides[k] = op.overrides[k]; });

    function achar(chave) {
      var ordem = [
        estadoI.overrides[estadoI.idioma], estadoI.catalogos[estadoI.idioma],
        estadoI.overrides[estadoI.padrao], estadoI.catalogos[estadoI.padrao],
        estadoI.catalogos[IDIOMA_REFERENCIA]
      ];
      for (var i = 0; i < ordem.length; i++) {
        var tab = ordem[i];
        if (tab && Object.prototype.hasOwnProperty.call(tab, chave) && tab[chave] != null) {
          return { valor: tab[chave], idioma: i < 2 ? estadoI.idioma : (i < 4 ? estadoI.padrao : IDIOMA_REFERENCIA) };
        }
      }
      return null;
    }

    function tem(chave) { return !!achar(chave); }

    function t(chave, params) {
      var a = achar(chave);
      if (!a) { estadoI.faltantes[chave] = true; return String(chave); }
      var valor = a.valor;
      /* O plural usa as regras do idioma EM QUE O TEXTO FOI ESCRITO: um plural de
       * pt-BR caído para o fallback segue a regra do pt-BR. */
      if (valor && typeof valor === 'object') valor = escolherPlural(valor, params && params.n, a.idioma);
      return interpolar(valor, Object.assign({}, estadoI.globais, params));
    }

    var inst = {
      t: t,
      tem: tem,
      get idioma() { return estadoI.idioma; },
      get padrao() { return estadoI.padrao; },
      definirIdioma: function (id) { estadoI.idioma = normalizarIdioma(id) || estadoI.padrao; return estadoI.idioma; },
      definirCatalogo: function (id, tabela) { estadoI.catalogos[id] = tabela || {}; },
      definirGlobais: function (g) { estadoI.globais = Object.assign({}, g || {}); },
      definirOverrides: function (id, tabela) { estadoI.overrides[id] = tabela || {}; },
      catalogo: function (id) { return estadoI.catalogos[id || estadoI.idioma] || null; },
      faltantes: function () { return Object.keys(estadoI.faltantes).sort(); },
      data: function (v, estilo, fuso) { return formatarData(v, estadoI.idioma, estilo, fuso); },
      numero: function (v, o) { return formatarNumero(v, estadoI.idioma, o); },
      duracao: function (s) { return formatarDuracao(s, estadoI.idioma); },
      relogio: function (s) { return formatarRelogio(s, estadoI.idioma); },
      relativo: function (v, agora) { return formatarRelativo(v, estadoI.idioma, agora); },
      bytes: function (b) { return formatarBytes(b, estadoI.idioma); },
      comparar: function (a, b) { return comparar(a, b, estadoI.idioma); }
    };
    return inst;
  }

  /* A instância GLOBAL: é ela que `AppI18n.t()` usa, para o código que não
   * carrega uma instância na mão. `iniciar` a substitui. */
  var atual = criar({});

  function iniciar(opcoes) { atual = criar(opcoes); return atual; }

  var AppI18n = {
    IDIOMAS_DE_FABRICA: IDIOMAS_DE_FABRICA,
    IDIOMA_REFERENCIA: IDIOMA_REFERENCIA,
    ROTULOS_DO_IDIOMA: ROTULOS_DO_IDIOMA,
    normalizarIdioma: normalizarIdioma,
    combinarIdioma: combinarIdioma,
    detectarDoNavegador: detectarDoNavegador,
    detectarDoCabecalho: detectarDoCabecalho,
    interpolar: interpolar,
    escolherPlural: escolherPlural,
    formatarData: formatarData,
    formatarNumero: formatarNumero,
    formatarDuracao: formatarDuracao,
    formatarRelogio: formatarRelogio,
    formatarRelativo: formatarRelativo,
    formatarBytes: formatarBytes,
    comparar: comparar,
    criar: criar,
    escolherIdiomaInicial: escolherIdiomaInicial,
    iniciarNoNavegador: iniciarNoNavegador,
    trocarIdioma: trocarIdioma,
    rotuloDoIdioma: rotuloDoIdioma,
    aplicarNoDocumento: aplicarNoDocumento,
    definirGlobais: function (g) { atual.definirGlobais(g); },
    iniciar: iniciar,
    instancia: function () { return atual; },
    t: function (chave, params) { return atual.t(chave, params); },
    tem: function (chave) { return atual.tem(chave); },
    idioma: function () { return atual.idioma; },
    data: function (v, e, f) { return atual.data(v, e, f); },
    numero: function (v, o) { return atual.numero(v, o); },
    duracao: function (s) { return atual.duracao(s); },
    relogio: function (s) { return atual.relogio(s); },
    relativo: function (v, a) { return atual.relativo(v, a); },
    bytes: function (b) { return atual.bytes(b); },
    comparar: function (a, b) { return atual.comparar(a, b); }
  };

  raiz.AppI18n = AppI18n;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppI18n;
})(typeof globalThis !== 'undefined' ? globalThis : this);
