/* destaque-fundo.js — o fundo em movimento do destaque da chegada (M6).
 *
 *   montarFundoDoDestaque(el, item, config)
 *
 * `el` é o bloco do destaque; `item`, o título em destaque (com `item.midia`
 * pronto do servidor); `config`, a config pública (`home.destaque.fundo` e
 * `player.*`; o guardião lê o que precisa). Devolve `null` quando não há nada
 * a mostrar — tipo `capa` (o padrão), item sem mídia de fundo, ou o guardião
 * dizendo não — e, quando monta, um objeto `{ no, pausar, retomar, destruir }`.
 *
 * As REGRAS, todas conferidas em tests/player-fundo.test.js:
 *   - o fundo NUNCA usa a mídia principal com som: usa a prévia do item
 *     (`midia.clipe`, um clipe HLS curto, ou `midia.previa`, a prévia animada
 *     do provedor), sempre MUDA;
 *   - nada carrega com "reduzir movimento" ou economia de dados: o <video> nem
 *     é criado, e nenhuma URL de mídia é pedida;
 *   - desligado no celular por padrão (`somenteDesktop`);
 *   - só toca com o destaque à vista (IntersectionObserver) e a aba visível;
 *   - botão de pausa SEMPRE visível enquanto houver movimento (WCAG 2.2.2);
 *   - a capa (poster) é o fallback: falha, pausa ou fim voltam a ela;
 *   - NÃO conta como reprodução: este arquivo não grava onde parou, não toca no
 *     player e não escreve em nada do navegador;
 *   - o único `.play()` está em `tocarFundo`, que começa perguntando ao
 *     guardião (`podeIniciarSozinho`, guardiao.js) — o mesmo guardião do player. */
(function (raiz) {
  'use strict';

  var HLS_SRC = 'vendor/hls.light.min.js';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ESPERA_IMAGEM_MS = 8000;

  function tr(chave, params) {
    return raiz.AppI18n ? raiz.AppI18n.t(chave, params) : chave;
  }

  function criar(tag, classe) {
    var n = raiz.document.createElement(tag);
    if (classe) n.className = classe;
    return n;
  }

  function pergunta(consulta, padrao) {
    try {
      return !!(raiz.matchMedia && raiz.matchMedia(consulta).matches);
    } catch (e) { return padrao; }
  }

  /* Na dúvida, fecha: sem `matchMedia` o navegador é velho demais para o fundo. */
  function movimentoReduzido() {
    if (!raiz.matchMedia) return true;
    return pergunta('(prefers-reduced-motion: reduce)', true);
  }

  function telaPequena() {
    if (!raiz.matchMedia) return true;
    return pergunta('(max-width: 768px), (pointer: coarse)', true);
  }

  /* `saveData` não existe no Safari nem no Firefox; sem a API, vale o resto. */
  function economiaDeDados() {
    try {
      var c = raiz.navigator && (raiz.navigator.connection || raiz.navigator.mozConnection);
      if (!c) return false;
      return c.saveData === true || /(^|-)2g$/.test(String(c.effectiveType || ''));
    } catch (e) { return false; }
  }

  function abaVisivel() {
    return !!raiz.document && raiz.document.visibilityState !== 'hidden';
  }

  function contextoDoFundo() {
    return {
      origem: 'fundo-mudo',
      visivel: abaVisivel(),
      telaPequena: telaPequena(),
      economiaDeDados: economiaDeDados(),
      movimentoReduzido: movimentoReduzido()
    };
  }

  /* De onde sai o movimento. Nunca `midia.hls`/`midia.mp4` (a mídia principal). */
  var EXT_VIDEO = /\.(mp4|webm)(\?|#|$)/i;
  function escolherFonte(item, fundo) {
    var m = item && item.midia;
    if (!m || typeof m !== 'object') return null;
    var clipe = typeof m.clipe === 'string' && m.clipe ? m.clipe : null;
    var previa = typeof m.previa === 'string' && m.previa ? m.previa : null;
    if (fundo.tipo === 'video-mudo' && clipe && fundo.usarTrailer) return { tipo: 'video', url: clipe, hls: /\.m3u8(\?|#|$)/i.test(clipe) };
    if (previa && EXT_VIDEO.test(previa)) return { tipo: 'video', url: previa, hls: false };
    if (previa) return { tipo: 'imagem', url: previa };
    return null;
  }

  function icone(classe, d) {
    var s = raiz.document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', classe);
    var p = raiz.document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'currentColor');
    s.appendChild(p);
    return s;
  }

  var hlsPromessa = null;
  function carregarHls() {
    if (raiz.Hls) return Promise.resolve(raiz.Hls);
    if (hlsPromessa) return hlsPromessa;
    hlsPromessa = new Promise(function (resolve, reject) {
      var tag = raiz.document.createElement('script');
      tag.src = HLS_SRC;
      tag.async = true;
      tag.addEventListener('load', function () { raiz.Hls ? resolve(raiz.Hls) : reject(new Error('hls')); });
      tag.addEventListener('error', function () { hlsPromessa = null; reject(new Error('hls')); });
      raiz.document.head.appendChild(tag);
    });
    return hlsPromessa;
  }

  function montarFundoDoDestaque(el, item, config) {
    var G = raiz.AppGuardiao;
    if (!el || !G || !raiz.document) return null;
    var fundo = G.fundoDoDestaque(config);
    if (fundo.tipo === 'capa') return null;

    /* PRIMEIRO PORTÃO, antes de criar qualquer elemento de mídia: sem
     * permissão, o fundo é a capa e mais nada. */
    if (!G.podeIniciarSozinho(contextoDoFundo(), config)) return null;
    var fonte = escolherFonte(item, fundo);
    if (!fonte) return null;
    if (fundo.tipo === 'previa-animada' && fonte.tipo === 'video' && fonte.hls) return null;

    var capa = item.midia && typeof item.midia.capa === 'string' ? item.midia.capa : '';
    var st = { morto: false, pronto: false, visivel: false, pausado: false, tocando: false, voltas: 0, espera: 0, parar: 0 };
    var video = null, hls = null, observador = null, mq = null, conexao = null;

    /* A camada: a capa como poster, decorativa (o título e a sinopse são HTML
     * real do destaque), atrás do texto. */
    var camada = criar('div', 'destaque-fundo');
    camada.setAttribute('aria-hidden', 'true');
    var poster = criar('img', 'destaque-fundo-midia');
    poster.alt = '';
    poster.decoding = 'async';
    if (capa) poster.src = capa;
    camada.appendChild(poster);
    el.classList.add('destaque-com-fundo');
    el.insertBefore(camada, el.firstChild);

    /* O botão de pausa mora no destaque, e não na camada de trás: a camada não
     * recebe clique. Visível o tempo todo (WCAG 2.2.2). */
    var botao = criar('button', 'destaque-fundo-pausa');
    botao.type = 'button';
    botao.appendChild(icone('df-ic-pausa', 'M6 5h4v14H6zm8 0h4v14h-4z'));
    botao.appendChild(icone('df-ic-play', 'M8 5v14l11-7z'));
    function pintarBotao() {
      var parado = st.pausado;
      botao.setAttribute('aria-pressed', parado ? 'true' : 'false');
      var rotulo = parado ? tr('site.reproduzirFundo') : tr('site.pausarFundo');
      botao.setAttribute('aria-label', rotulo);
      botao.title = rotulo;
    }
    pintarBotao();
    botao.addEventListener('click', function () {
      st.pausado = !st.pausado;
      pintarBotao();
      sincronizar();
    });
    el.appendChild(botao);

    /* ------------------------------------------------------------- vídeo */

    /* A camada nasce INVISÍVEL (opacity 0 no CSS) e só aparece com movimento de
     * verdade. Um elemento invisível não é candidato a LCP; o poster em tela
     * cheia, pintado 1,2 s depois, virava o novo LCP da home (medido: de 92
     * para 1076 ms no desktop). A capa de sempre do destaque continua à vista. */
    function mostrar(sim) { camada.classList[sim ? 'add' : 'remove']('destaque-fundo-ativo'); }

    function voltarAoPoster() {
      mostrar(false);
      st.tocando = false;
      if (st.parar) { clearTimeout(st.parar); st.parar = 0; }
      if (video) { try { video.pause(); } catch (e) { /* sem vídeo */ } video.style.display = 'none'; }
      if (fonte.tipo === 'imagem' && capa) poster.src = capa;
    }

    /* O ÚNICO play() deste arquivo, e a PRIMEIRA coisa que ele faz é perguntar
     * ao guardião (de novo: o mundo muda entre o portão do começo e agora —
     * a pessoa ligou "reduzir movimento", a aba foi para o fundo). */
    function tocarFundo() {
      if (!G.podeIniciarSozinho(contextoDoFundo(), config)) { voltarAoPoster(); return false; }
      if (st.morto || !video) return false;
      /* Sempre mudo, e sem som mesmo que o navegador queira dar. */
      video.muted = true;
      video.defaultMuted = true;
      video.style.display = '';
      var p = video.play();
      if (p && p.catch) p.catch(function () { voltarAoPoster(); });
      st.tocando = true;
      mostrar(true);
      return true;
    }

    function prepararVideo() {
      video = criar('video', 'destaque-fundo-midia');
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.playsInline = true;
      video.loop = false;
      video.autoplay = false;
      video.preload = 'auto';
      video.controls = false;
      video.disablePictureInPicture = true;
      video.setAttribute('aria-hidden', 'true');
      video.tabIndex = -1;
      if (capa) video.poster = capa;
      /* Depois de N voltas, descansa na capa: não é loop infinito. */
      video.addEventListener('ended', function () {
        st.voltas++;
        if (st.voltas < fundo.repeticoes && querTocar()) {
          try { video.currentTime = 0; } catch (e) { /* sem tempo */ }
          tocarFundo();
        } else {
          voltarAoPoster();
        }
      });
      video.addEventListener('error', function () { voltarAoPoster(); st.pronto = false; });
      video.addEventListener('canplay', function () { st.pronto = true; sincronizar(); }, { once: true });
      camada.appendChild(video);
      video.style.display = 'none';

      if (fonte.hls) {
        if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = fonte.url;
        } else {
          carregarHls().then(function (Hls) {
            if (st.morto || !Hls.isSupported()) { if (!st.morto) voltarAoPoster(); return; }
            hls = new Hls({ maxBufferLength: 12, capLevelToPlayerSize: true, startLevel: 0 });
            hls.on(Hls.Events.ERROR, function (_e, d) { if (d && d.fatal) { voltarAoPoster(); st.pronto = false; } });
            hls.loadSource(fonte.url);
            hls.attachMedia(video);
          }).catch(function () { voltarAoPoster(); });
        }
      } else {
        video.src = fonte.url;
      }
    }

    function prepararImagem() {
      var teste = new raiz.Image();
      teste.onload = function () { if (!st.morto) { st.pronto = true; sincronizar(); } };
      teste.onerror = function () { voltarAoPoster(); };
      teste.src = fonte.url;
    }

    /* ------------------------------------------------------ quando tocar */

    function querTocar() {
      return !st.morto && st.pronto && st.visivel && !st.pausado && abaVisivel();
    }

    function sincronizar() {
      if (st.morto) return;
      if (!querTocar()) {
        if (st.tocando) {
          if (fonte.tipo === 'video' && video) { try { video.pause(); } catch (e) { /* sem vídeo */ } st.tocando = false; }
          else voltarAoPoster();
        }
        /* Pausa do usuário em vídeo mostra o quadro parado; em imagem, a capa. */
        if (st.pausado && fonte.tipo === 'imagem') voltarAoPoster();
        return;
      }
      if (st.tocando) return;
      if (fonte.tipo === 'video') {
        tocarFundo();
      } else if (G.podeIniciarSozinho(contextoDoFundo(), config)) {
        poster.src = fonte.url;
        st.tocando = true;
        mostrar(true);
        if (st.parar) clearTimeout(st.parar);
        st.parar = setTimeout(voltarAoPoster, ESPERA_IMAGEM_MS * fundo.repeticoes);
      }
    }

    function parar() {
      /* "Reduzir movimento" ligado no meio da visita, ou economia de dados:
       * para tudo e descansa na capa. */
      if (G.podeIniciarSozinho(contextoDoFundo(), config)) return;
      st.pronto = false;
      voltarAoPoster();
      if (botao.parentNode) botao.parentNode.removeChild(botao);
    }

    function destruir() {
      if (st.morto) return;
      st.morto = true;
      if (st.espera) { clearTimeout(st.espera); st.espera = 0; }
      if (st.parar) { clearTimeout(st.parar); st.parar = 0; }
      if (observador) { observador.disconnect(); observador = null; }
      raiz.document.removeEventListener('visibilitychange', sincronizar);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', parar);
      if (conexao && conexao.removeEventListener) conexao.removeEventListener('change', parar);
      if (hls) { try { hls.destroy(); } catch (e) { /* já destruído */ } hls = null; }
      if (video) {
        try { video.pause(); } catch (e) { /* sem vídeo */ }
        video.removeAttribute('src');
        try { video.load(); } catch (e) { /* alguns navegadores reclamam */ }
      }
      if (camada.parentNode) camada.parentNode.removeChild(camada);
      if (botao.parentNode) botao.parentNode.removeChild(botao);
      el.classList.remove('destaque-com-fundo');
    }

    /* A visibilidade, a aba e as preferências que mudam durante a visita. */
    if (typeof raiz.IntersectionObserver === 'function') {
      observador = new raiz.IntersectionObserver(function (entradas) {
        var e = entradas[entradas.length - 1];
        st.visivel = !!(e && e.isIntersecting && e.intersectionRatio >= 0.25);
        sincronizar();
      }, { threshold: [0, 0.25, 0.5] });
      observador.observe(el);
    }
    raiz.document.addEventListener('visibilitychange', sincronizar);
    try {
      mq = raiz.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', parar);
    } catch (e) { mq = null; }
    try {
      conexao = raiz.navigator && raiz.navigator.connection;
      if (conexao && conexao.addEventListener) conexao.addEventListener('change', parar);
    } catch (e) { conexao = null; }

    /* Só depois da carga da página (a capa do destaque é o LCP) e do atraso
     * pedido. Sem IntersectionObserver nada começa: fecha. */
    function comecar() {
      st.espera = setTimeout(function () {
        st.espera = 0;
        if (st.morto || !G.podeIniciarSozinho(contextoDoFundo(), config)) return;
        if (fonte.tipo === 'video') prepararVideo(); else prepararImagem();
      }, fundo.atrasoMs);
    }
    if (raiz.document.readyState === 'complete') comecar();
    else raiz.addEventListener('load', comecar, { once: true });

    return {
      no: camada,
      pausar: function () { st.pausado = true; pintarBotao(); sincronizar(); },
      retomar: function () { st.pausado = false; pintarBotao(); sincronizar(); },
      destruir: destruir
    };
  }

  raiz.montarFundoDoDestaque = montarFundoDoDestaque;
  raiz.AppDestaqueFundo = { montar: montarFundoDoDestaque };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.AppDestaqueFundo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
