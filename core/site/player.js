/* player.js — o player nosso. Fase 0.
 *
 * PADRÃO desde 03/09. O embed do Bunny continua no repositório e a uma URL de
 * distância (`?player=embed`), como plano B — ele é o que sobra se algo aqui
 * quebrar num navegador que ninguém testou.
 *
 * REGRAS DE PRODUTO — as mesmas três de sempre, agora responsabilidade nossa:
 *   1. nada toca sozinho   -> o <video> nunca leva o atributo `autoplay`; `.play()`
 *                             só em DUAS funções: `tocarPorGesto` (clique, tecla,
 *                             toque) e `tocarAutomatico`, que começa perguntando
 *                             ao guardião (`podeIniciarSozinho`, guardiao.js).
 *                             Com a config padrão (`player.autoplay.modo:
 *                             'nunca'`) o guardião nunca deixa. Há teste varrendo
 *                             este arquivo atrás de chamadas fora disso.
 *   2. nada repete         -> `loop` nunca.
 *   3. nada avança sozinho -> não há listener do fim do vídeo. O próximo episódio
 *                             (`player.proximoEpisodio`) só aparece como cartão,
 *                             e só avança sozinho com `modo: 'automatico'` E
 *                             `autoplay.modo` diferente de 'nunca'. Há teste.
 *
 * Quem decide qualquer coisa é player-core.js. Aqui só se aplica.
 */
(function (raiz) {
  'use strict';

  /* A tradução: `tr` é o AppI18n.t deste arquivo. O catálogo do idioma já foi
   * carregado pelo app.js antes de a ficha pedir o player. */
  var I18n = raiz.AppI18n;
  function tr(chave, params) { return I18n.t(chave, params); }

  var HLS_SRC = 'vendor/hls.light.min.js';
  var hlsPromessa = null;

  /* O som do player vivo, para a torneira de medição lá embaixo. É a ÚNICA
   * variável de módulo que aponta para dentro de uma ficha, e `destruir()` a
   * limpa — senão ela seguraria um <video> morto e o contexto dele. */
  var ultimoSom = null;

  /* A curva do moldador, feita na primeira vez que alguém usa reforço e
   * reusada daí em diante: são 2048 casas que não mudam nunca. */
  var curvaDoMoldador = null;

  /* ------------------------------------------- a pessoa já interagiu?
   *
   * O guardião só deixa o som sair (modo `com-som-apos-interacao`, próximo
   * episódio) depois de um gesto REAL nesta página. Ele é anotado aqui, uma
   * vez por carga, por quem chega primeiro: o clique no cartão, a tecla, o
   * toque. Evento sintético (`isTrusted` falso) não conta. */
  var jaInteragiu = false;
  (function observarInteracao() {
    var doc = raiz.document;
    if (!doc || !doc.addEventListener) return;
    var nomes = ['pointerdown', 'keydown', 'touchend', 'click'];
    function marcar(ev) {
      if (ev && ev.isTrusted === false) return;
      jaInteragiu = true;
      nomes.forEach(function (n) { doc.removeEventListener(n, marcar, true); });
    }
    nomes.forEach(function (n) { doc.addEventListener(n, marcar, { capture: true, passive: true }); });
  })();

  function perguntaDeMidia(consulta, padrao) {
    try {
      return !!(raiz.matchMedia && raiz.matchMedia(consulta).matches);
    } catch (e) { return padrao; }
  }

  /* Sem `matchMedia` o navegador é velho: nas perguntas de "movimento" e de
   * "tela pequena" a dúvida fecha (devolve true). */
  function movimentoReduzido() {
    if (!raiz.matchMedia) return true;
    return perguntaDeMidia('(prefers-reduced-motion: reduce)', true);
  }

  function telaPequena() {
    if (!raiz.matchMedia) return true;
    return perguntaDeMidia('(max-width: 768px), (pointer: coarse)', true);
  }

  /* `saveData` não existe no Safari nem no Firefox: sem a API, vale o que os
   * outros portões decidirem. */
  function economiaDeDados() {
    try {
      var c = raiz.navigator && (raiz.navigator.connection || raiz.navigator.mozConnection);
      if (!c) return false;
      return c.saveData === true || /(^|-)2g$/.test(String(c.effectiveType || ''));
    } catch (e) { return false; }
  }

  /* A prévia do /admin é a página de verdade dentro de um quadro: ali nada
   * começa sozinho, nem com a config mais aberta. */
  function naMesa() {
    try {
      return raiz.parent !== raiz && /[?&]mesa=1(&|$)/.test(raiz.location.search);
    } catch (e) { return true; }
  }

  function contextoDeInicio(origem) {
    var doc = raiz.document;
    var ativacao = false;
    try { ativacao = !!(raiz.navigator && raiz.navigator.userActivation && raiz.navigator.userActivation.hasBeenActive); } catch (e) { /* sem a API */ }
    return {
      origem: origem,
      jaInteragiu: jaInteragiu || ativacao,
      visivel: !!doc && doc.visibilityState !== 'hidden' && !naMesa(),
      telaPequena: telaPequena(),
      economiaDeDados: economiaDeDados(),
      movimentoReduzido: movimentoReduzido()
    };
  }

  /* ------------------------------------------------ preferência da legenda
   *
   * O ÚNICO estado que este projeto guarda no navegador, e há teste exigindo
   * que continue sendo o único — em especial que a POSIÇÃO do vídeo nunca
   * entre aqui: `rememberPosition=false` é regra de produto desde o embed.
   *
   * Ligar a legenda a cada vídeo é justamente o tipo de atrito que faz alguém
   * desistir de usá-la, e quem depende dela depende sempre.
   *
   * Tudo em try/catch: em aba anônima, com armazenamento bloqueado por
   * política da rede ou com a cota estourada, `localStorage` LANÇA
   * ao ser lido. Sem a proteção, o player inteiro morre antes de desenhar. */
  var CHAVE_LEGENDA = App.PREFIXO + ':legenda';

  function lerPreferenciaLegenda() {
    try {
      var cru = raiz.localStorage.getItem(CHAVE_LEGENDA);
      if (!cru) return null;
      var p = JSON.parse(cru);
      if (!p || typeof p !== 'object') return null;
      return {
        ligada: p.ligada === true,
        /* Escala vinda de outra versão do site não pode virar legenda de
         * 400 px: só vale o que está na lista de degraus de hoje. */
        escala: AppPlayerCore.TAMANHOS_LEGENDA.indexOf(p.escala) >= 0 ? p.escala : 1
      };
    } catch (e) {
      return null;
    }
  }

  function gravarPreferenciaLegenda(ligada, escala) {
    try {
      raiz.localStorage.setItem(CHAVE_LEGENDA,
        JSON.stringify({ ligada: !!ligada, escala: Number(escala) || 1 }));
    } catch (e) { /* sem armazenamento: a preferência vale só nesta ficha */ }
  }

  /* A preferência de som (fase 4). Guardada pelo mesmo motivo da legenda: quem
   * precisa de reforço precisa dele em TODO vídeo, e refazer 200% a cada
   * título transformaria o item 12 em enfeite. O compressor é o que torna isso
   * seguro — sem ele, um volume de 200% guardado seria uma emboscada. */
  var CHAVE_SOM = App.PREFIXO + ':som';

  function lerPreferenciaSom() {
    try {
      var cru = raiz.localStorage.getItem(CHAVE_SOM);
      if (!cru) return null;
      var p = JSON.parse(cru);
      if (!p || typeof p !== 'object') return null;
      /* Um volume vindo de outra versão do site não pode virar ganho 12: o
       * mesmo cuidado que a escala da legenda já toma. */
      return {
        volume: AppPlayerCore.proximoVolume(p.volume, 0, AppPlayerCore.VOLUME_MAX_GANHO),
        estavel: p.estavel === true
      };
    } catch (e) {
      return null;
    }
  }

  function gravarPreferenciaSom(volume, estavel) {
    try {
      raiz.localStorage.setItem(CHAVE_SOM,
        JSON.stringify({ volume: Number(volume) || 0, estavel: !!estavel }));
    } catch (e) { /* sem armazenamento: a preferência vale só nesta ficha */ }
  }

  /* A TERCEIRA COISA GUARDADA, desde a fase 6 (23/09):
   * onde o vídeo parou, para o "Continuar" da página da série. A regra de
   * sempre — NADA RETOMA SOZINHO — é o padrão (`player.retomar.modo: 'nunca'`):
   * com ele este arquivo só GRAVA a chave, e quem lê é a página da série, que
   * oferece um link que a pessoa clica. Com `perguntar` o player mostra um
   * cartão com a pergunta; com `automatico` ele posiciona o vídeo no ponto —
   * e nos dois a LEITURA só acontece quando o cliente escolheu isso, e o play
   * continua sendo da pessoa (`tocarPorGesto`).
   *
   * O mapa é montado pelo core (`App.lembrarOndeParou`): o começo e o fim do
   * vídeo não ficam, e só os 50 mais recentes. */
  function gravarOndeParou(id, t, duracao) {
    try {
      var cru = raiz.localStorage.getItem(App.CHAVE_ONDE_PAROU);
      var mapa = App.lembrarOndeParou(cru ? JSON.parse(cru) : {}, id, t, duracao, Date.now());
      raiz.localStorage.setItem(App.CHAVE_ONDE_PAROU, JSON.stringify(mapa));
    } catch (e) { /* sem armazenamento: o "Continuar" não aparece, e é só isso */ }
  }

  function lerOndeParou(id) {
    try {
      var cru = raiz.localStorage.getItem(App.CHAVE_ONDE_PAROU);
      return App.ondeParouDe(cru ? JSON.parse(cru) : {}, id);
    } catch (e) {
      return null;
    }
  }

  /* --------------------------------------------------------------- auxílio */

  function criar(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function botao(classe, rotulo) {
    var b = criar('button', classe);
    b.type = 'button';
    b.setAttribute('aria-label', rotulo);
    b.title = rotulo;
    return b;
  }

  /* Ícones desenhados aqui, em SVG, e não como fonte de ícones nem como
   * arquivo: um site interno não pede um recurso a mais para mostrar um
   * triângulo de play, e `innerHTML` não entra neste projeto.
   *
   * `currentColor` é o que faz os ícones acompanharem o tema claro/escuro
   * sozinhos, sem uma regra de CSS por ícone. */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* `tracos` é um array: cada item é `d` (preenchido) ou `[d, true]` (contorno).
   * Um ícone pode ter mais de um — o mudo é o alto-falante preenchido MAIS o X
   * em contorno, no mesmo SVG. Sobrepor dois <svg> com position:absolute
   * também funcionaria, mas quebra assim que alguém mexe no tamanho do botão. */
  function icone(classe, tracos) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');   /* o rótulo está no aria-label do botão */
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', classe);
    (Array.isArray(tracos) ? tracos : [tracos]).forEach(function (t) {
      var d = Array.isArray(t) ? t[0] : t;
      var contorno = Array.isArray(t) && t[1];
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      if (contorno) {
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', 'currentColor');
        p.setAttribute('stroke-width', '2');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
      } else {
        p.setAttribute('fill', 'currentColor');
      }
      s.appendChild(p);
    });
    return s;
  }

  /* Carregado sob demanda, como o Player.js dos capítulos: quem abre a grade
   * não paga 353 KB por uma biblioteca que a grade não usa. */
  function carregarHls() {
    if (hlsPromessa) return hlsPromessa;
    hlsPromessa = new Promise(function (resolve, reject) {
      if (raiz.Hls) { resolve(raiz.Hls); return; }
      var tag = document.createElement('script');
      tag.src = HLS_SRC;
      tag.async = true;
      tag.addEventListener('load', function () {
        if (raiz.Hls) resolve(raiz.Hls);
        else reject(new Error('hls.js carregou sem expor Hls'));
      });
      tag.addEventListener('error', function () {
        reject(new Error(tr('player.erroCarregarHls')));
      });
      document.head.appendChild(tag);
    });
    return hlsPromessa;
  }

  /* O <video> toca HLS sozinho? Safari e iOS sim; Chrome e Firefox não. */
  function temHlsNativo(video) {
    if (!video || !video.canPlayType) return false;
    return !!video.canPlayType('application/vnd.apple.mpegurl');
  }

  /* ------------------------------------------------------------------ player
   *
   * Devolve { no, video, destruir, irPara, aoTempo, tocar } ou null quando o
   * item não tem vídeo utilizável. `tocar()` é a entrada do "Assistir" (D6), e
   * o comentário dela diz por que ela não é um segundo play.
   *
   * `destruir()` NÃO é opcional. Tirar o <video> do DOM para a reprodução do
   * elemento, mas a instância do hls.js continua viva com os seus próprios
   * carregadores — ela seguiria puxando segmentos da pull zone para um vídeo
   * que ninguém está vendo. Quem monta tem obrigação de chamar.
   */
  function criarPlayer(item, config, ganchos) {
    var midia = App.midiaDe(item);
    if (!midia) return null;

    /* `ganchos.anterior` e `ganchos.proximo` são os vizinhos da série, que só
     * o app.js conhece — o player recebe um item, não o catálogo. Servem a
     * Shift+N / Shift+P, que é navegação EXPLÍCITA por tecla, não avanço
     * automático: nada disso é chamado pelo fim do vídeo.
     *
     * `ganchos.aoFechar` é o deslize ↓ da fase 7: o player pede para ser
     * destruído e a ficha, redesenhada. Ele NÃO faz isso sozinho — quem sabe
     * montar a ficha é o app.js, e um player que se arranca do DOM em que
     * outra pessoa o pôs deixa a página com um buraco. Sem o gancho o gesto
     * simplesmente não existe, que é o que acontece no /admin e em qualquer
     * outro lugar que monte um player fora da ficha. */
    var g = ganchos || {};

    /* A config `player.*`, já saneada. Sem nada, é o comportamento de sempre:
     * nada toca, nada avança, nada retoma. */
    var cfg = AppPlayerCore.configDoPlayer(config);

    /* Os capítulos do item, saneados pelo MESMO `App.capitulos` que a lista
     * clicável da ficha usa. Tem que ser a mesma leitura nos dois lugares,
     * senão o segmento desenhado na barra e a linha destacada da lista
     * discordam sobre onde um capítulo começa. Vazio em 22 dos 33 títulos no
     * ar — e aí a barra é um segmento só, igual à de antes da fase 3. */
    var caps = App.capitulos(item);

    var urlHls = AppPlayerCore.urlHls(midia);
    var urlMp4 = AppPlayerCore.urlMp4(midia, '360p');
    if (!urlHls && !urlMp4) return null;

    var caixa = criar('div', 'pl');
    var video = document.createElement('video');

    /* As regras de produto entram aqui, e só aqui. */
    var attrs = AppPlayerCore.atributosVideo();
    video.autoplay = attrs.autoplay;
    video.loop = attrs.loop;
    video.controls = attrs.controls;
    video.preload = attrs.preload;
    video.playsInline = attrs.playsInline;
    video.setAttribute('playsinline', '');       /* iOS antigo lê o atributo */
    video.crossOrigin = attrs.crossOrigin;
    video.className = 'pl-video';

    /* A capa como poster evita o retângulo preto antes do play — e ela já está
     * no cache do navegador, porque a grade acabou de mostrá-la. */
    var capa = App.urlCapa(item);
    if (capa) video.poster = capa;

    caixa.appendChild(video);

    var hls = null;
    var carregouAlgo = false;      /* o primeiro play já mandou baixar? */
    /* O momento pedido ANTES do primeiro play — o `?t=` de um trecho da
     * busca, um capítulo clicado com o vídeo parado. É dele que o download
     * começa (ver `liberarDownload`). */
    var momentoAntesDoPlay = 0;
    var destruido = false;
    /* O <video> já tem de onde tocar? E o "Assistir" pediu o play antes
     * disso? As duas respostas moram aqui por causa de `tocar()`, que é quem
     * explica por que o pedido espera a fonte. */
    var temFonte = false;
    var tocarQuandoLigar = false;
    /* Origem de um início sem gesto que o guardião já autorizou e que espera
     * a fonte ('' = nenhum). */
    var inicioAutomaticoPendente = '';
    var carregouFonte = false;
    var usandoMp4 = false;
    /* Quem mexeu no tempo antes do primeiro play (`?t=`, capítulo) manda mais
     * do que o "onde parou". */
    var pediuMomento = false;

    /* ---------------------------------------------------------- controles */

    var controles = criar('div', 'pl-controles');

    var bPlay = botao('pl-b pl-play', tr('player.reproduzir'));

    /* As setas de capítulo (decisão de 08/09).
     *
     * O gesto de dois dedos e o `Ctrl`+seta pulam capítulo desde a fase 3 e a
     * fase 5, e os dois têm o mesmo defeito: o projeto já avisava que o
     * gesto não existe no YouTube e ninguém o descobre sozinho. Um atalho de
     * teclado tem o mesmo problema. O que faltava era o caminho VISÍVEL.
     *
     * Elas só existem quando o título TEM capítulo — 39 dos 66. Nos outros 27
     * a linha fica idêntica à de hoje, em vez de ganhar dois botões apagados
     * que só sabem dizer "este título não tem capítulos". */
    var bCapAnt = caps.length ? botao('pl-b pl-cap-ant', tr('player.capituloAnterior')) : null;
    var bCapProx = caps.length ? botao('pl-b pl-cap-prox', tr('player.capituloProximo')) : null;

    var bCC = botao('pl-b pl-cc', tr('player.legenda'));
    var bMudo = botao('pl-b pl-mudo', tr('player.silenciar'));
    var bCheia = botao('pl-b pl-cheia', tr('player.telaCheia'));

    /* Bloqueio de tela (item 9, fase 5). Só aparece em tela cheia, e o CSS é
     * quem decide isso — a lição da fase 3 continua valendo: em 375 px os
     * quatro botões e o relógio já comem 317 dos 349 px da linha, e um quinto
     * botão a quebraria em três. Deitado em tela cheia sobra largura, e é
     * justamente ali que travar a tela serve para alguma coisa. */
    var bTrava = botao('pl-b pl-trava', tr('player.bloquearTela'));
    bTrava.setAttribute('aria-pressed', 'false');

    /* "CC" escrito, não desenhado: as duas letras num retângulo são o símbolo
     * que todo mundo reconhece, e desenhá-las como `path` seria pior em toda
     * medida — inclusive para quem aumenta a fonte do sistema. */
    bCC.appendChild(criar('span', 'pl-cc-marca', 'CC'));

    /* Os dois estados de cada botão vivem juntos no DOM e quem escolhe é o CSS,
     * por classe no contêiner. Trocar o `d` do path a cada play/pause faria o
     * mesmo trabalho dezenas de vezes por sessão, de graça. */
    var ALTOFALANTE = 'M4 9v6h4l5 4V5L8 9H4z';
    bPlay.appendChild(icone('pl-ic pl-ic-play', 'M8 5v14l11-7z'));
    bPlay.appendChild(icone('pl-ic pl-ic-pause', 'M6 5h4v14H6zm8 0h4v14h-4z'));
    bMudo.appendChild(icone('pl-ic pl-ic-som',
      [ALTOFALANTE, 'M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z']));
    bMudo.appendChild(icone('pl-ic pl-ic-mudo',
      [ALTOFALANTE, ['M16 10l4 4m0-4l-4 4', true]]));
    bCheia.appendChild(icone('pl-ic', [['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', true]]));

    /* O par de setas é o desenho de "faixa anterior / próxima faixa" de
     * qualquer tocador — triângulo encostado numa barra —, e um é o espelho do
     * outro em torno de x=12. É de propósito que não sejam as setas duplas do
     * pular 5 s: aquelas andam no tempo, estas andam na LISTA, e o desenho
     * precisa dizer isso antes de alguém apertar. */
    if (bCapAnt) {
      bCapAnt.appendChild(icone('pl-ic', ['M5 5h2v14H5z', 'M17 5v14l-9-7z']));
      bCapProx.appendChild(icone('pl-ic', ['M7 5v14l9-7z', 'M17 5h2v14h-2z']));
    }

    /* O cadeado é o mesmo desenho nos dois estados — corpo cheio e arco em
     * contorno. Aberto e fechado seriam dois desenhos para manter, e quem diz
     * qual é qual já é o `aria-pressed` e o próprio quadro, que fica sem
     * controles quando está travado. */
    var CADEADO = ['M5 11h14v9H5z', ['M8 11V7.5a4 4 0 0 1 8 0V11', true]];
    bTrava.appendChild(icone('pl-ic', CADEADO));

    /* O painel de som (fase 4). O Volume Estável e o Boost precisam de
     * controle visível, e a linha de controles NÃO tem onde crescer: em 375 px
     * os quatro botões e o relógio já comem 317 dos 349 px (medido na fase 3).
     * Um quinto botão empurraria a linha para 361 e a quebraria em três.
     *
     * Por isso o painel PENDURA no botão de mudo que já existe, e custa zero
     * de largura na barra. */
    var somCaixa = criar('div', 'pl-som-caixa');
    var painel = criar('div', 'pl-som');
    painel.hidden = true;

    /* `(hover: none)` é a pergunta certa — não "é um celular?", mas "existe
     * passar o ponteiro neste aparelho?", que é exatamente o que decide se o
     * painel consegue abrir sozinho. Onde não há, o botão abre o painel e o
     * mudo mora dentro dele; onde há, o botão silencia como sempre silenciou e
     * o ponteiro abre o painel de passagem. */
    var semHover = false;
    try {
      semHover = !!(raiz.matchMedia && raiz.matchMedia('(hover: none)').matches);
    } catch (e) { /* navegador sem matchMedia: trata como se tivesse ponteiro */ }

    /* `<input type="range">` e não uma barra nossa: ele já vem com teclado,
     * leitor de tela e arrasto de graça, e nada aqui precisa desenhar por cima
     * — ao contrário da linha do tempo, que precisava dos capítulos. */
    var faixaVol = document.createElement('input');
    faixaVol.type = 'range';
    faixaVol.className = 'pl-som-faixa';
    faixaVol.min = '0';
    faixaVol.max = String(Math.round(AppPlayerCore.VOLUME_MAX_GANHO * 100));
    faixaVol.step = '5';
    faixaVol.value = '100';
    faixaVol.setAttribute('aria-label', tr('player.volume'));

    var valorVol = criar('span', 'pl-som-valor', '100%');

    /* O mudo do painel existe para quem não tem ponteiro: ali o botão da barra
     * abre o painel, e sem isto não sobraria como silenciar sem teclado.
     * É texto e não ícone de propósito — duplicar o alto-falante em SVG faria
     * dois lugares para manter o mesmo desenho. */
    var bMudoPainel = botao('pl-som-mudo', tr('player.silenciar'));
    bMudoPainel.appendChild(criar('span', null, tr('player.mudo')));
    bMudoPainel.setAttribute('aria-pressed', 'false');

    var linhaVol = criar('div', 'pl-som-linha');
    linhaVol.appendChild(bMudoPainel);
    linhaVol.appendChild(faixaVol);
    linhaVol.appendChild(valorVol);

    /* Volume Estável (item 8) — o compressor. O rótulo ENVOLVE a caixinha em
     * vez de apontar para ela por `for`: sem id não há como dois players na
     * mesma página colidirem, e a área de clique já vira o texto inteiro. */
    var rotEstavel = criar('label', 'pl-som-linha pl-som-rotulo');
    var caixaEstavel = document.createElement('input');
    caixaEstavel.type = 'checkbox';
    caixaEstavel.className = 'pl-som-caixinha';
    rotEstavel.appendChild(caixaEstavel);
    rotEstavel.appendChild(document.createTextNode(tr('player.volumeEstavel')));

    /* Onde o painel diz a verdade quando não dá para mexer no volume — o
     * iPhone sem Web Audio, o contexto que não ligou. */
    var recadoSom = criar('div', 'pl-som-recado');
    recadoSom.hidden = true;

    /* A ORDEM é geometria, não gosto (04/09): a linha do volume é a ÚLTIMA
     * porque é ela que fica deitada ao lado do ícone — o CSS ancora o painel
     * pelo pé. O que vier antes empilha para cima, e é por isso que o "Volume
     * estável" fica logo ACIMA do controle deslizante, como pedido, e o recado
     * — que só aparece quando não dá para mexer no volume — fica no topo. */
    painel.appendChild(recadoSom);
    painel.appendChild(rotEstavel);
    painel.appendChild(linhaVol);
    somCaixa.appendChild(bMudo);
    somCaixa.appendChild(painel);

    var tempo = criar('span', 'pl-tempo');
    var atualEl = criar('span', 'pl-tempo-atual', '0:00');
    var totalEl = criar('span', 'pl-tempo-total',
      item && item.duracao_seg ? App.formatarTempo(item.duracao_seg) : '0:00');
    tempo.appendChild(atualEl);
    tempo.appendChild(criar('span', 'pl-tempo-sep', ' / '));
    tempo.appendChild(totalEl);

    /* Barra própria, não <input type="range">: os segmentos de capítulo
     * (fase 3), o arrasto (fase 5) e o scrubber (fase 6) precisam desenhar por
     * cima e receber o ponteiro cru. */
    var barra = criar('div', 'pl-barra');
    barra.setAttribute('role', 'slider');
    barra.setAttribute('tabindex', '0');
    barra.setAttribute('aria-label', tr('player.linhaDoTempo'));
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuenow', '0');

    /* Os trilhos, montados por `montarSegmentos()`: um pedaço por capítulo,
     * com o vão entre eles. Sem capítulos é um pedaço só, e a barra fica
     * idêntica à de antes desta fase. */
    var trilhos = criar('div', 'pl-trilhos');
    var bolinha = criar('div', 'pl-barra-bolinha');

    /* A dica que segue o ponteiro: o título do capítulo e o tempo daquele
     * ponto. É o que substitui o hover que o embed do Bunny dava de graça
     * dentro do iframe — sem ela, os segmentos viram enfeite, porque não há
     * como saber o que cada um é sem clicar. */
    var dica = criar('div', 'pl-dica');
    dica.hidden = true;
    dica.setAttribute('aria-hidden', 'true');   /* a lista da ficha é o caminho acessível */
    var dicaTitulo = criar('span', 'pl-dica-titulo');
    var dicaTempo = criar('span', 'pl-dica-tempo');
    dica.appendChild(dicaTitulo);
    dica.appendChild(dicaTempo);

    barra.appendChild(trilhos);
    barra.appendChild(bolinha);
    barra.appendChild(dica);

    /* Camada da legenda: nossa, em DOM, e não a nativa do <track>.
     *
     * Fica ANTES dos controles no DOM para ficar embaixo deles no empilhamento
     * — legenda não pode cobrir a barra de controles. O `bottom` do CSS a
     * levanta acima da barra. */
    var camadaLegenda = criar('div', 'pl-legenda');
    camadaLegenda.hidden = true;
    caixa.appendChild(camadaLegenda);

    controles.appendChild(bPlay);

    /* As setas ficam coladas no play, e não no fim da linha: as três juntas
     * são o transporte — o que anda no vídeo —, e o resto da linha é ajuste.
     *
     * O relógio e a barra passam a andar JUNTOS, dentro de um contêiner. É o
     * que faz o desenho caber, e a conta é esta, medida em 375 px: a linha tem
     * 325 px de conteúdo, e hoje o play, o relógio, o CC, o som e a tela cheia
     * comem 282,9 — sobram 42,1 px, e um botão de 44 px com o vão de 10 pede
     * 54. Duas setas são impossíveis: só os itens já somam 330,9 px, mais do
     * que a linha inteira.
     *
     * A largura sai do RELÓGIO, que sobe para a linha da barra no celular —
     * onde a barra já mora sozinha desde a fase 3. A linha dos botões fica com
     * seis de 44 px: 310 dos 325 px, com o par de capítulo contando como um.
     * É o desenho do YouTube no celular, e não uma invenção nossa.
     *
     * E as duas setas moram num contêiner DELAS (`pl-cap-par`), encostadas uma
     * na outra. Pular capítulo é uma função só, com duas direções — como o
     * `Ctrl`+seta é uma tecla só com dois sentidos —, e duas setas separadas
     * pelo mesmo vão de todo o resto leem como dois botões sem parentesco.
     * O contêiner também é o que faz o par sobreviver ao `space-between` do
     * celular: ali a linha distribui a sobra ENTRE os itens, e sem o par ser
     * um item as duas setas se afastariam justamente onde deviam se juntar.
     *
     * Os contêineres só nascem quando há capítulo. Sem eles o DOM continua
     * sendo o de hoje, item por item — a promessa de que os 27 títulos sem
     * capítulo não pagam nada por esta entrega vale para o desenho E para a
     * árvore. */
    if (bCapAnt) {
      var capPar = criar('div', 'pl-cap-par');
      capPar.appendChild(bCapAnt);
      capPar.appendChild(bCapProx);
      controles.appendChild(capPar);
      var tempoBarra = criar('div', 'pl-tempo-barra');
      tempoBarra.appendChild(tempo);
      tempoBarra.appendChild(barra);
      controles.appendChild(tempoBarra);
    } else {
      controles.appendChild(tempo);
      controles.appendChild(barra);
    }
    controles.appendChild(bCC);
    controles.appendChild(somCaixa);
    controles.appendChild(bTrava);
    controles.appendChild(bCheia);
    caixa.appendChild(controles);

    var recado = criar('div', 'pl-recado');
    recado.hidden = true;
    caixa.appendChild(recado);

    /* A FALHA AO CARREGAR. Antes não havia nada: se o hls.js e o MP4 falhavam,
     * o quadro ficava preto, parado, sem dizer por quê. Agora há uma mensagem
     * (traduzida, sem jargão) e um botão para tentar de novo. */
    var painelErro = criar('div', 'pl-erro');
    painelErro.setAttribute('role', 'alert');
    painelErro.hidden = true;
    var textoErro = criar('p', 'pl-erro-texto', tr('player.erroAoCarregar'));
    var bRecarregar = botao('pl-erro-botao', tr('player.tentarDeNovo'));
    bRecarregar.textContent = tr('player.tentarDeNovo');
    painelErro.appendChild(textoErro);
    painelErro.appendChild(bRecarregar);
    caixa.appendChild(painelErro);

    /* Marca d'água de texto (opcional, `player.marcaDagua`): só desenho, não
     * recebe toque nem foco. */
    if (cfg.marcaDagua.ligada) {
      var marca = criar('div', 'pl-marca', cfg.marcaDagua.texto);
      marca.setAttribute('aria-hidden', 'true');
      caixa.appendChild(marca);
    }

    /* Download (`player.download.ligado`): só existe se o provedor entregou um
     * MP4 — o HLS puro não se baixa. É um link comum: o clique é da pessoa. */
    var urlBaixar = cfg.download.ligado ? AppPlayerCore.urlMp4(midia, '720p') : null;
    if (urlBaixar) {
      var linkBaixar = criar('a', 'pl-baixar', tr('player.baixar'));
      linkBaixar.href = urlBaixar;
      linkBaixar.setAttribute('download', '');
      linkBaixar.rel = 'noopener';
      caixa.appendChild(linkBaixar);
    }

    /* Os cartões: o de "Continuar de onde parou?" e o do próximo episódio. O
     * mesmo molde, e cada um só nasce se a config escolheu. */
    function montarCartao(classe, rotuloDoGrupo) {
      var no = criar('div', 'pl-cartao ' + classe);
      no.setAttribute('role', 'group');
      no.setAttribute('aria-label', rotuloDoGrupo);
      no.hidden = true;
      var texto = criar('p', 'pl-cartao-texto');
      var linha = criar('div', 'pl-cartao-botoes');
      no.appendChild(texto);
      no.appendChild(linha);
      caixa.appendChild(no);
      return {
        no: no, texto: texto, linha: linha,
        get hidden() { return no.hidden; },
        mostrar: function (sim) { no.hidden = !sim; },
        focarPrimeiro: function () {
          var b = linha.querySelector('button');
          if (b) b.focus();
        }
      };
    }

    /* ---- retomar (player.retomar.modo) ---- */
    var cartaoDeRetomada = null;

    function pontoSalvo() {
      if (cfg.retomar.modo === 'nunca') return null;
      var ponto = lerOndeParou(item.id);
      return AppPlayerCore.pontoParaRetomar(ponto, config, momentoAntesDoPlay > 0 || pediuMomento);
    }

    /* `automatico`: no primeiro play, vai ao ponto antes. */
    function retomarNoPrimeiroPlay() {
      if (cfg.retomar.modo !== 'automatico' || jaTocou) return;
      var t = pontoSalvo();
      if (t != null && (video.currentTime || 0) < 1) irPara(t);
    }

    /* `perguntar`: o cartão. Escolher "Continuar" é um gesto, e toca por ele. */
    function oferecerRetomada() {
      if (destruido || jaTocou || cfg.retomar.modo !== 'perguntar') return;
      var t = pontoSalvo();
      if (t == null) return;
      cartaoDeRetomada = montarCartao('pl-cartao-retomar', tr('player.retomarGrupo'));
      cartaoDeRetomada.texto.textContent = tr('player.retomarPergunta', { tempo: App.formatarTempo(t) });
      var sim = botao('pl-cartao-b pl-cartao-primario', tr('player.retomarSim'));
      sim.textContent = tr('player.retomarSim');
      var nao = botao('pl-cartao-b', tr('player.retomarNao'));
      nao.textContent = tr('player.retomarNao');
      sim.addEventListener('click', function () {
        cartaoDeRetomada.mostrar(false);
        irPara(t);
        tocarPorGesto();
      });
      nao.addEventListener('click', function () {
        cartaoDeRetomada.mostrar(false);
        tocarPorGesto();
      });
      cartaoDeRetomada.linha.appendChild(sim);
      cartaoDeRetomada.linha.appendChild(nao);
      cartaoDeRetomada.mostrar(true);
    }

    /* ---- próximo episódio (player.proximoEpisodio) ---- */
    var cartaoDoProximo = null;
    var proximoDispensado = false;
    var proximoDisparado = false;

    function abrirProximo(automatico) {
      if (!g.proximo) return;
      if (typeof g.abrirProximo === 'function') {
        g.abrirProximo(g.proximo, { automatico: !!automatico });
      } else {
        raiz.location.hash = '#/ep/' + encodeURIComponent(g.proximo.id);
      }
    }

    function montarCartaoDoProximo() {
      cartaoDoProximo = montarCartao('pl-cartao-proximo', tr('player.proximoGrupo'));
      var agora = botao('pl-cartao-b pl-cartao-primario', tr('player.assistirAgora'));
      agora.textContent = tr('player.assistirAgora');
      var cancelar = botao('pl-cartao-b', tr('player.cancelar'));
      cancelar.textContent = tr('player.cancelar');
      /* "Assistir agora" é um clique: abre a ficha seguinte COM o pedido de
       * tocar, o mesmo do "Assistir" do destaque. */
      agora.addEventListener('click', function () {
        proximoDisparado = true;
        abrirProximo(false);
      });
      cancelar.addEventListener('click', function () {
        proximoDispensado = true;
        cartaoDoProximo.mostrar(false);
      });
      cartaoDoProximo.linha.appendChild(agora);
      cartaoDoProximo.linha.appendChild(cancelar);
      cartaoDoProximo.titulo = criar('strong', 'pl-cartao-titulo', '');
      cartaoDoProximo.contagem = criar('span', 'pl-cartao-contagem', '');
      cartaoDoProximo.no.insertBefore(cartaoDoProximo.titulo, cartaoDoProximo.texto);
      cartaoDoProximo.texto.appendChild(cartaoDoProximo.contagem);
    }

    /* Chamado a cada `timeupdate`. Sem próximo, ou com `modo: 'nunca'`, não
     * faz nada — e é o que acontece com a config padrão. */
    function atualizarProximo() {
      if (!g.proximo || proximoDispensado || proximoDisparado || destruido) return;
      var t = video.currentTime || 0;
      var d = duracao();
      var visivel = AppPlayerCore.cartaoDoProximoVisivel(t, d, config, true);
      if (!visivel) {
        if (cartaoDoProximo && !cartaoDoProximo.hidden) cartaoDoProximo.mostrar(false);
        return;
      }
      if (!cartaoDoProximo) montarCartaoDoProximo();
      if (cartaoDoProximo.hidden) {
        cartaoDoProximo.titulo.textContent = tr('player.proximoTitulo', { titulo: g.proximo.titulo || '' });
        cartaoDoProximo.mostrar(true);
      }
      var falta = AppPlayerCore.contagemDoProximo(t, d, config);
      cartaoDoProximo.contagem.textContent = falta == null ? '' : tr('player.proximoEm', { n: falta });
      if (falta === 0 || (video.ended && falta != null)) {
        proximoDisparado = true;
        /* O guardião tem a última palavra: com a aba escondida, por exemplo,
         * a contagem não avança — vira pergunta. */
        if (AppPlayerCore.podeIniciarSozinho(contextoDeInicio('proximo-episodio'), config)) {
          abrirProximo(true);
        } else {
          proximoDisparado = false;
          proximoDispensado = true;
          cartaoDoProximo.contagem.textContent = '';
        }
      }
    }

    function avisar(texto) {
      recado.textContent = texto;
      recado.hidden = !texto;
    }

    /* Selo passageiro no canto: "⏩ 10 s", "1,5×", "Volume 40%".
     *
     * Não é enfeite — é o que torna o teclado descobrível. Sem retorno na
     * tela, apertar `L` num vídeo pausado não muda nada visível e a tecla
     * parece morta. Ele também é a base do selo de zoom da fase 8. */
    var selo = criar('div', 'pl-selo');
    selo.setAttribute('role', 'status');   /* leitor de tela anuncia a mudança */
    selo.hidden = true;
    caixa.appendChild(selo);

    /* O cadeado no canto, enquanto a tela estiver travada (item 9, fase 5).
     * Com os controles escondidos ele é a ÚNICA marca de que o player não
     * morreu — sem ele, uma tela travada é indistinguível de um player que
     * parou de responder. */
    /* A prévia do arrasto — item 6, o scrubber, e o gesto que originou toda a
     * Parte B. Não existe storyboard no Bunny (são 5 quadros por vídeo, tanto
     * num de 10 minutos quanto num de 27), então o quadro sai de um SEGUNDO
     * <video>, escondido, apontando para o `play_240p.mp4` que já está no ar.
     * É o caminho "barato": zero infraestrutura nova, o
     * arquivo tem `Accept-Ranges` e CORS, e o navegador busca só a faixa de
     * bytes do segundo pedido — não os 51 MB do arquivo.
     *
     * O elemento é mostrado como está, sem `<canvas>` no meio: um vídeo
     * pausado JÁ desenha o quadro em que está, e passar por `drawImage`
     * acrescentaria uma cópia por quadro para chegar ao mesmo pixel.
     *
     * NO CANTO SUPERIOR ESQUERDO, e isso foi pedido depois do teste no dedo:
     * é o único canto que a mão não cobre enquanto arrasta. O selo mora no
     * mesmo lugar e por isso os dois nunca aparecem juntos — durante o
     * arrasto quem fala é a prévia, que já mostra o relógio. */
    var urlPrevia = AppPlayerCore.urlMp4(midia, '240p');
    var previaCaixa = criar('div', 'pl-previa');
    previaCaixa.hidden = true;
    previaCaixa.setAttribute('aria-hidden', 'true');   /* o selo é o caminho acessível */
    var previaQuadro = document.createElement('video');
    previaQuadro.className = 'pl-previa-quadro';
    previaQuadro.muted = true;
    previaQuadro.playsInline = true;
    previaQuadro.setAttribute('playsinline', '');
    /* `metadata` e não `auto`: o que se quer é a régua do tempo, para poder
     * procurar. Os bytes de cada quadro vêm por faixa, quando o dedo pede. */
    previaQuadro.preload = 'metadata';
    previaCaixa.appendChild(previaQuadro);
    var previaCap = criar('div', 'pl-previa-cap');
    var previaTitulo = criar('span', 'pl-previa-titulo');
    var previaTempo = criar('span', 'pl-previa-tempo');
    previaCap.appendChild(previaTitulo);
    previaCap.appendChild(previaTempo);
    previaCaixa.appendChild(previaCap);
    caixa.appendChild(previaCaixa);

    var cadeado = criar('div', 'pl-cadeado');
    cadeado.appendChild(icone('pl-ic', CADEADO));
    cadeado.hidden = true;
    cadeado.setAttribute('aria-hidden', 'true');
    caixa.appendChild(cadeado);

    var seloEspera = 0;

    /* `fixo` é da fase 5: o selo de um ARRASTO tem que ficar na tela enquanto
     * o dedo estiver andando. Sem ele, o volume sumiria do olho
     * 900 ms depois de o gesto começar, bem no meio do ajuste. */
    function mostrarSelo(texto, fixo) {
      selo.textContent = texto;
      selo.hidden = false;
      selo.classList.remove('pl-selo-vivo');
      /* Ler uma propriedade de layout reinicia a animação; sem isto, dois
       * toques seguidos na mesma tecla não repetem o efeito. */
      void selo.offsetWidth;
      if (seloEspera) { clearTimeout(seloEspera); seloEspera = 0; }
      if (fixo) return;
      selo.classList.add('pl-selo-vivo');
      seloEspera = setTimeout(function () { selo.hidden = true; }, 900);
    }

    function esconderSelo() {
      if (seloEspera) { clearTimeout(seloEspera); seloEspera = 0; }
      selo.classList.remove('pl-selo-vivo');
      selo.hidden = true;
    }

    /* ------------------------------------------------------------- estado */

    function duracao() {
      var d = video.duration;
      if (isFinite(d) && d > 0) return d;
      /* Antes do `loadedmetadata` o <video> devolve NaN. O catálogo já sabe a
       * duração — é o que deixa a barra e o "/ 10:14" corretos desde o
       * primeiro quadro, com `preload: none` e nada baixado ainda. */
      return item && item.duracao_seg ? Number(item.duracao_seg) : NaN;
    }

    /* -------------------------------------------- os segmentos da barra
     *
     * Fase 3. A barra deixa de ser uma régua só e passa a ser uma lista de
     * pedaços — um por capítulo. Quem decide onde cada um começa e termina é
     * `AppPlayerCore.segmentosCapitulos`, que é puro e tem teste; aqui só se desenha.
     */

    /* O vão entre um pedaço e o seguinte, em px. Ele sai da LARGURA do
     * segmento, e não de uma margem, porque a posição de cada um é uma
     * porcentagem exata do tempo: mexer na esquerda desalinharia o desenho do
     * relógio, e o clique cairia num segundo diferente do que se vê. */
    var VAO_PX = 2;

    /* Abaixo desta largura o vão é maior do que o próprio pedaço e o segmento
     * sumiria. Num capítulo tão curto (menos de 1% do vídeo) é melhor perder o
     * corte do que perder o pedaço. */
    var VAO_MIN_PCT = 1;

    var segmentos = [];
    var trilhosNos = [];
    var duracaoDesenhada = -1;

    function montarSegmentos() {
      var d = duracao();
      var chave = isFinite(d) && d > 0 ? d : -1;
      /* Os segmentos só dependem dos capítulos (fixos) e da duração. Sem esta
       * porta, o `loadedmetadata` remontaria os mesmos nós por nada — e no
       * meio de um hover, jogaria fora o segmento realçado. */
      if (chave === duracaoDesenhada) return;
      duracaoDesenhada = chave;

      segmentos = AppPlayerCore.segmentosCapitulos(caps, d);
      while (trilhos.firstChild) trilhos.removeChild(trilhos.firstChild);
      trilhosNos = segmentos.map(function (s, i) {
        var no = criar('div', 'pl-seg');
        no.style.left = s.esquerda + '%';
        /* O último não perde o vão: não há pedaço depois dele para separar, e
         * encurtá-lo deixaria uma falha no fim da barra. */
        var ultimo = i === segmentos.length - 1;
        no.style.width = (ultimo || s.largura < VAO_MIN_PCT)
          ? s.largura + '%'
          : 'calc(' + s.largura + '% - ' + VAO_PX + 'px)';
        var carregado = criar('div', 'pl-seg-carregado');
        var tocado = criar('div', 'pl-seg-tocado');
        no.appendChild(carregado);
        no.appendChild(tocado);
        trilhos.appendChild(no);
        return { no: no, carregado: carregado, tocado: tocado };
      });
    }

    function pintar() {
      var d = duracao();
      var t = video.currentTime || 0;
      var pct = isFinite(d) && d > 0 ? Math.min(100, (t / d) * 100) : 0;
      for (var i = 0; i < trilhosNos.length; i++) {
        trilhosNos[i].tocado.style.width = AppPlayerCore.fracaoNoSegmento(segmentos[i], t) + '%';
      }
      bolinha.style.left = pct + '%';
      atualEl.textContent = App.formatarTempo(t);
      if (isFinite(d) && d > 0) {
        totalEl.textContent = App.formatarTempo(d);
        barra.setAttribute('aria-valuemax', String(Math.floor(d)));
      }
      barra.setAttribute('aria-valuenow', String(Math.floor(t)));
      /* O capítulo entra no texto do slider: quem navega por leitor de tela
       * ouve "12:34, O treinador" em vez de só o relógio. */
      var iCap = caps.length ? App.capituloEm(caps, t) : -1;
      barra.setAttribute('aria-valuetext',
        App.formatarTempo(t) + (iCap >= 0 ? ' · ' + caps[iCap].titulo : ''));
    }

    function pintarBuffer() {
      if (!video.buffered || !video.buffered.length) return;
      var fim = video.buffered.end(video.buffered.length - 1);
      for (var i = 0; i < trilhosNos.length; i++) {
        trilhosNos[i].carregado.style.width = AppPlayerCore.fracaoNoSegmento(segmentos[i], fim) + '%';
      }
    }

    /* --------------------------------------------------------- reprodução */

    /* O PLAY DE QUEM ESTÁ ASSISTINDO. Um dos DOIS lugares do projeto que chamam
     * play() (o outro é `tocarAutomatico`, logo abaixo, e ele pergunta ao
     * guardião antes). Este só roda a partir de um gesto: clique no botão,
     * tecla, toque, o "Assistir" do destaque, um botão do cartão. */
    function tocarPorGesto() {
      /* A pessoa pediu: conta como interação, e o som pode sair. */
      jaInteragiu = true;
      /* `preload: none` e `autoStartLoad: false` seguraram a rede até agora.
       * O primeiro play é quem libera — é a tradução fiel do `preload=false`
       * que o embed do Bunny recebia. */
      liberarDownload();
      /* Retomar `automatico`: o ponto da última vez vale ANTES do primeiro
       * play, e só nele. */
      retomarNoPrimeiroPlay();
      /* O gesto que o AudioContext exige. Fica ANTES do `play()` para que
       * o grafo esteja montado quando o primeiro quadro tocar — montado
       * depois, o começo do vídeo sairia com o volume errado. */
      somDaPreferencia();
      var p = video.play();
      /* Navegador pode recusar o play (política de mídia, aba em segundo
       * plano). Recusa não pode virar exceção não tratada no console. */
      if (p && p.catch) p.catch(function () { sincronizarPlay(); });
    }

    /* O OUTRO play: o que começa SEM gesto, e por isso a PRIMEIRA coisa que ele
     * faz é perguntar ao guardião (guardiao.js). Com `player.autoplay.modo:
     * 'nunca'` — o padrão — a resposta é sempre não, para qualquer origem.
     * Quando o guardião deixa, o início sai MUDO, a não ser que o modo seja
     * `com-som-apos-interacao` e a pessoa já tenha interagido com a página.
     * `origem`: 'autoplay' (abrir a ficha) ou 'proximo-episodio'. */
    function tocarAutomatico(origem) {
      var contexto = contextoDeInicio(origem);
      if (!AppPlayerCore.podeIniciarSozinho(contexto, config)) return false;
      if (destruido || !video.paused) return false;
      var decisao = AppPlayerCore.decisaoDeInicio(contexto, config);
      /* Sem gesto não há grafo de áudio (o contexto nasceria suspenso): o
       * volume do elemento basta, e o reforço espera o primeiro gesto. */
      liberarDownload();
      if (decisao.mudo) definirMudo(true);
      var p = video.play();
      if (p && p.catch) p.catch(function () { sincronizarPlay(); });
      return true;
    }

    /* O botão, a tecla e o toque. Pausar não é "começar": só o play passa pelo
     * gesto de cima. */
    function alternarPlay() {
      if (video.paused) tocarPorGesto();
      else video.pause();
    }

    /* A ENTRADA DO "ASSISTIR". O destaque da chegada abre
     * a ficha com o pedido de tocar, e o app.js chama isto logo depois de
     * `criar()` — a decisão D5, "o toque em Assistir é o pedido".
     *
     * NÃO É UM TERCEIRO CAMINHO PARA O PLAY: é o MESMO `alternarPlay` do botão,
     * da tecla e do toque (logo, `tocarPorGesto`), e só com o vídeo parado —
     * pedir para tocar o que já toca não pode virar pausa. A REGRA 1 admite
     * duas chamadas de `play()` no player, e este não é uma delas.
     *
     * O player não sabe de onde veio o pedido, e não precisa: quem garante que
     * só se chega aqui por um clique é o app.js, que não deixa o pedido
     * viajar na URL — um link que tocasse sozinho tocaria para quem só o
     * abriu.
     *
     * O PEDIDO ESPERA A FONTE. No caminho do hls.js o <video> só ganha fonte
     * no `.then` da biblioteca, e o `tocar()` chega antes, logo depois de
     * `criar()`. Um play dado ali é CANCELADO quando a biblioteca já está em
     * cache: o `.then` roda na microtarefa seguinte, e o `attachMedia` troca a
     * fonte de um elemento que acabou de pedir uma — o `networkState` dele
     * ainda está em "sem fonte", e não em "vazio", porque a seleção de fonte
     * do play só termina depois. A carga nova interrompe o play: `AbortError`,
     * "The play() request was interrupted by a new load request". Medido no
     * ar em 21/09, logo depois do deploy da D6 — o "Assistir" só tocava na
     * PRIMEIRA ficha de cada visita, a única em que a biblioteca ainda está
     * chegando. O teste local só tinha exercitado essa.
     *
     * Por isso, sem fonte, o pedido fica guardado, e quem liga a fonte o
     * atende (`aoLigarFonte`) — com o <video> já tendo de onde tocar. Com
     * fonte, o play sai na hora: é o caminho do HLS nativo do iPhone, onde o
     * play precisa ficar o mais perto possível do toque. */
    function tocar() {
      if (!video.paused) return;
      /* `retomar: perguntar` com um ponto guardado: a pergunta vem antes, e
       * o "Assistir" a deixa na tela em vez de responder por quem clicou. */
      if (cartaoDeRetomada && !cartaoDeRetomada.hidden) { cartaoDeRetomada.focarPrimeiro(); return; }
      if (!temFonte) { tocarQuandoLigar = true; return; }
      alternarPlay();
    }

    function sincronizarPlay() {
      var tocando = !video.paused && !video.ended;
      bPlay.setAttribute('aria-label', tocando ? tr('player.pausar') : tr('player.reproduzir'));
      bPlay.title = tocando ? tr('player.pausar') : tr('player.reproduzir');
      caixa.classList.toggle('pl-tocando', tocando);
    }

    /* Quem quiser acompanhar o relógio do vídeo se inscreve aqui — hoje, a
     * lista de capítulos da ficha.
     *
     * Ela NÃO pode ouvir `timeupdate` direto no <video>, e isso é a parte não
     * óbvia da fase 3: com `preload: none` e nada carregado, escrever em
     * `currentTime` não dispara evento nenhum. Um pulo por Ctrl+seta antes do
     * primeiro play deixaria a lista destacando o capítulo anterior, como se a
     * tecla não tivesse funcionado. */
    var ouvintesTempo = [];

    function aoTempo(fn) {
      if (typeof fn === 'function') ouvintesTempo.push(fn);
    }

    function avisarTempo() {
      var t = video.currentTime || 0;
      for (var i = 0; i < ouvintesTempo.length; i++) ouvintesTempo[i](t);
    }

    function irPara(segundos) {
      var alvo = AppPlayerCore.limitarTempo(segundos, duracao());
      video.currentTime = alvo;
      if (!carregouAlgo) momentoAntesDoPlay = alvo;
      pintar();
      avisarTempo();
    }

    /* LIBERAR O DOWNLOAD, no primeiro play — e a PARTIR DO MOMENTO PEDIDO.
     *
     * Com o vídeo parado e nada baixado, o `irPara` escreve no `currentTime`
     * de um <video> sem dados, e o navegador guarda o valor como a posição de
     * partida: vale quando os dados chegam. O vídeo abria no lugar certo — o
     * clique num trecho da busca tocou em 6:39 no primeiro teste —, mas o
     * hls.js não sabe disso e começa a baixar do ZERO: medido em 21/09 (fase 2
     * da busca), um `video0.ts` em 240p e outro em 480p desciam antes do salto
     * para o segmento 99.
     *
     * Passar a posição ao `startLoad` não basta no 1.6: antes de o manifesto
     * chegar ele marca o pedido e DESCARTA o número, e quem o refaz depois é o
     * carregador de playlist, com o `config.startPosition` (conferido no
     * código do 1.6.14, `playlist-loader.ts`, `checkAutostartLoad`). Por isso o
     * momento vai nos dois lugares. -1 é o "do começo" do próprio hls.js. */
    function liberarDownload() {
      if (!hls || carregouAlgo) return;
      var inicio = momentoAntesDoPlay > 0 ? momentoAntesDoPlay : -1;
      hls.config.startPosition = inicio;
      hls.startLoad(inicio);
      carregouAlgo = true;
    }

    /* ------------------------------------------- barra: arrasto e a dica */

    /* Mouse ou dedo? A barra pergunta isso o tempo todo desde hoje — o quadro
     * no hover, o lugar da moldura, o que fica na tela depois de soltar —, e a
     * resposta é UMA. Ponteiro sem tipo conta como mouse, que é o que a barra
     * já fazia antes de existir esta função.
     *
     * É a mesma pergunta do `pontoDoEvento` dos gestos, e é de propósito que
     * ela seja o `pointerType` cru: para saber se um PAINEL pode abrir sozinho
     * a pergunta certa é outra, `matchMedia('(hover: none)')`, e a fase 4
     * deixou isso escrito. Aparelho e evento são coisas diferentes. */
    function ehMouse(ev) {
      return !ev.pointerType || ev.pointerType === 'mouse';
    }

    function tempoDoPonteiro(clientX) {
      var r = barra.getBoundingClientRect();
      if (!r.width) return 0;
      var frac = (clientX - r.left) / r.width;
      frac = Math.max(0, Math.min(1, frac));
      var d = duracao();
      return isFinite(d) && d > 0 ? frac * d : 0;
    }

    var segSob = -1;

    /* Realça o pedaço sob o ponteiro. É o retorno que diz "este trecho é uma
     * coisa só" — sem ele os vãos parecem sujeira na barra, e não divisões. */
    function marcarSegmento(i) {
      if (i === segSob) return;
      if (trilhosNos[segSob]) trilhosNos[segSob].no.classList.remove('pl-seg-sob');
      if (trilhosNos[i]) trilhosNos[i].no.classList.add('pl-seg-sob');
      segSob = i;
    }

    /* O ponteiro está sobre a barra? É o que o relógio do quadro pergunta antes
     * de gastar rede, e quem desliga é o `pointerleave`. */
    var sobreABarra = false;

    /* O QUADRO NO PASSAR DO PONTEIRO (04/09, a pedido). O maquinário é o mesmo
     * do arrasto — o mesmo <video> de 240p, a mesma fila de um lugar só —, e a
     * diferença é o RITMO: no arrasto o quadro é pedido a cada movimento;
     * aqui, no máximo um a cada 300 ms.
     *
     * Esse número faz dois trabalhos, e é por isso que é um só:
     *
     * 1. o PRIMEIRO pedido também espera os 300 ms, então levar o mouse até o
     *    botão de play — que fica a 20 px da barra — continua sem baixar byte
     *    nenhum. Era exatamente essa a razão de a fase 6 ter deixado o hover de
     *    fora, e ela some com a espera, não com uma decisão contrária;
     * 2. depois disso, três quadros por segundo no máximo. É "bem menos
     *    fluido" de propósito, e o que salva a sensação é a divisão do
     *    trabalho: a MOLDURA acompanha o ponteiro a cada movimento, de graça —
     *    caixa, capítulo e relógio são desenho, não rede —, e só a IMAGEM
     *    chega em passos. */
    var QUADRO_HOVER_MS = 300;
    var quadroHover = { espera: 0, alvo: 0 };

    function agendarQuadroHover(t) {
      /* Guardar só o alvo mais recente é a mesma disciplina da fila da prévia:
       * enfileirar pedidos faria a imagem correr atrás do ponteiro, cada vez
       * mais atrasada, em vez de mostrar o quadro mais novo que deu tempo. */
      quadroHover.alvo = t;
      if (quadroHover.espera) return;
      quadroHover.espera = setTimeout(function () {
        quadroHover.espera = 0;
        /* O ponteiro pode ter saído da barra — ou a ficha ter ido embora —
         * enquanto o relógio corria. */
        if (destruido || !sobreABarra) return;
        pedirQuadro(quadroHover.alvo);
      }, QUADRO_HOVER_MS);
    }

    function cancelarQuadroHover() {
      if (quadroHover.espera) { clearTimeout(quadroHover.espera); quadroHover.espera = 0; }
    }

    /* A moldura EM CIMA DA BARRA, seguindo o ponteiro. Escreve e posiciona; o
     * quadro é pedido por fora, e é lá que mora o ritmo.
     *
     * O canto superior esquerdo continua existindo para o DEDO, e a razão é a
     * mesma que o pôs lá na fase 6: a mão cobre a barra e o que está logo
     * acima dela. O mouse não cobre nada, e aí o lugar certo é onde o olho já
     * está — em cima do ponto que se vai clicar. */
    function previaSobreBarra(t, clientX, iCap, r) {
      var rc = caixa.getBoundingClientRect();
      /* A moldura já diz capítulo e relógio: deixar a dica junto seria a mesma
       * informação duas vezes, uma em cima da outra. */
      dica.hidden = true;
      previaCaixa.hidden = false;
      previaCaixa.classList.add('pl-previa-barra');
      previaTitulo.textContent = iCap >= 0 ? caps[iCap].titulo : '';
      previaTitulo.hidden = iCap < 0;
      previaTempo.textContent = App.formatarTempo(t);
      /* Medir DEPOIS de escrever, como a dica da fase 3: a largura muda com o
       * título, e é ela que decide o quanto a centralização pode empurrar
       * antes de encostar na borda. */
      previaCaixa.style.left = (r.left - rc.left +
        AppPlayerCore.posicaoDica(clientX - r.left, r.width, previaCaixa.offsetWidth, 4)) + 'px';
      previaCaixa.style.bottom = (rc.bottom - r.top + 8) + 'px';
    }

    function moverDica(clientX, mouse) {
      var r = barra.getBoundingClientRect();
      if (!r.width) return;
      sobreABarra = true;
      var t = tempoDoPonteiro(clientX);
      var i = caps.length ? App.capituloEm(caps, t) : -1;

      /* Sem o 240p — ou depois de ele falhar — a dica de texto volta a ser o
       * caminho, e o hover fica igualzinho ao de antes de hoje. */
      if (mouse && urlPrevia && !previa.morto) {
        previaSobreBarra(t, clientX, i, r);
      } else {
        dicaTitulo.textContent = i >= 0 ? caps[i].titulo : '';
        dicaTitulo.hidden = i < 0;        /* sem capítulo, sobra só o relógio */
        dicaTempo.textContent = App.formatarTempo(t);

        dica.hidden = false;
        /* Medir DEPOIS de escrever o texto: a largura da dica muda com o
         * título, e é ela que decide o quanto a centralização pode empurrar. */
        dica.style.left =
          AppPlayerCore.posicaoDica(clientX - r.left, r.width, dica.offsetWidth, 4) + 'px';
      }
      marcarSegmento(AppPlayerCore.segmentoEm(segmentos, t));
    }

    function esconderDica() {
      dica.hidden = true;
      sobreABarra = false;
      cancelarQuadroHover();
      /* A moldura do hover sai junto — mas NUNCA no meio de um arrasto: com o
       * botão apertado o ponteiro sai da barra o tempo todo (é para isso que
       * existe o `setPointerCapture`), e a moldura tem que continuar lá. */
      if (!barra.classList.contains('pl-barra-ativa')) esconderPrevia();
      marcarSegmento(-1);
    }

    function aoDescer(ev) {
      /* `setPointerCapture` é o que faz o arrasto continuar valendo quando o
       * dedo sai da barra — sem ele, escorregar 2 px para fora larga o
       * controle no meio do movimento. */
      if (barra.setPointerCapture) barra.setPointerCapture(ev.pointerId);
      barra.classList.add('pl-barra-ativa');
      var t0 = tempoDoPonteiro(ev.clientX);
      irPara(t0);
      /* No toque não existe hover: a dica só aparece com o dedo na barra, e é
       * ali que ela mais serve — é o que diz em que capítulo o arrasto vai
       * parar antes de soltar. */
      moverDica(ev.clientX, ehMouse(ev));
      /* Apertar é um pedido explícito: aqui o quadro não espera os 300 ms do
       * hover. Com o dedo a moldura vai para o canto; com o mouse ela já está
       * em cima da barra pelo `moverDica` acima, e NÃO pula de lugar quando o
       * botão desce. */
      if (ehMouse(ev)) pedirQuadro(t0);
      else mostrarPrevia(t0, null);
      ev.preventDefault();
    }

    function aoMover(ev) {
      var mouse = ehMouse(ev);
      moverDica(ev.clientX, mouse);
      if (!barra.classList.contains('pl-barra-ativa')) {
        /* Só passando o ponteiro: o quadro vem em passos, e o primeiro deles
         * só depois da espera — quem atravessa a barra a caminho do play não
         * baixa nada. */
        if (mouse) agendarQuadroHover(tempoDoPonteiro(ev.clientX));
        return;
      }
      var t = tempoDoPonteiro(ev.clientX);
      irPara(t);
      /* A prévia (item 6) vale nos DOIS arrastos horizontais, e no da barra
       * ela resolve o mesmo problema: no celular a barra fica embaixo da mão,
       * e a dica que a fase 3 desenhou nasce logo acima do dedo. A moldura no
       * canto de cima é o único lugar que a mão não cobre. */
      if (mouse) pedirQuadro(t);
      else mostrarPrevia(t, null);
    }

    function aoSubir(ev) {
      var mouse = ehMouse(ev);
      /* O dedo não "sai" da barra como o ponteiro do mouse: sem isto a dica
       * ficaria parada na tela depois do arrasto, no celular. */
      if (!mouse) esconderDica();
      if (!barra.classList.contains('pl-barra-ativa')) return;
      /* Com o mouse a moldura FICA: soltar o botão não tira o ponteiro da
       * barra, e o hover não acabou. Quem a tira é o `pointerleave`. */
      if (!mouse) esconderPrevia();
      barra.classList.remove('pl-barra-ativa');
      if (barra.releasePointerCapture) {
        try { barra.releasePointerCapture(ev.pointerId); } catch (e) { /* já solto */ }
      }
    }

    /* ---------------------------------------------------------- tela cheia */

    function telaCheia() {
      var doc = document;
      var saindo = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (saindo) {
        (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
        return;
      }
      var pedir = caixa.requestFullscreen || caixa.webkitRequestFullscreen;
      if (pedir) { pedir.call(caixa); return; }
      /* iPhone: `requestFullscreen` não existe — só `webkitEnterFullscreen`,
       * que entrega a tela ao player nativo da Apple e leva junto os nossos
       * capítulos, a nossa legenda e a barra inteira. Confirmado em aparelho
       * (iPhone 15, 02/09), não suposto.
       *
       * A alternativa era a "tela cheia de mentira" — um `position: fixed`
       * ocupando a viewport, que manteria tudo nosso. **Ela foi DECIDIDA COMO
       * NÃO em 03/09**, e a razão está em decisão de projeto: ela deixaria a barra
       * de endereço do Android na tela o tempo todo para tirar um aviso cinza
       * que some em segundos. Não é trabalho pendente — é uma porta fechada,
       * e reabri-la exige desfazer aquela decisão primeiro.
       *
       * Então aqui fica o player da Apple, que é melhor do que um botão que
       * não faz nada. */
      if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }

    /* ------------------------------------------------------------ legenda
     *
     * Fase 2. Três decisões, todas medidas contra os arquivos de verdade:
     *
     * 1. **Não dá para usar `<track>`.** A pull zone serve o `.vtt` como
     *    `application/octet-stream`, e o navegador exige `text/vtt`. Ele
     *    recusa o arquivo em SILÊNCIO — nem erro no console. Por isso a
     *    legenda é buscada por `fetch()` e o VTT é lido por `AppPlayerCore.analisarVtt`.
     *
     * 2. **Mas a régua de tempo é do navegador.** As cues vão para um
     *    `TextTrack` de verdade, em `mode = 'hidden'`: ele mantém `activeCues`
     *    e dispara `cuechange` com precisão de quadro, sem desenhar nada.
     *    Quem desenha somos nós, o que dá controle do corpo da letra (teclas
     *    `+`/`-`, que o `::cue` não entrega igual em todo navegador) e mantém
     *    a legenda viva na tela cheia nossa.
     *
     * 3. **Só é buscada quando alguém pede.** Mesma disciplina do vídeo: abrir
     *    a ficha para ler a sinopse não baixa legenda de 73 KB.
     */
    var pref = lerPreferenciaLegenda();
    var legenda = {
      cues: null,
      faixa: null,
      ligada: false,
      escala: pref ? pref.escala : 1,
      carregando: false,
      indisponivel: false
    };

    function pintarLegenda() {
      while (camadaLegenda.firstChild) camadaLegenda.removeChild(camadaLegenda.firstChild);

      var ativas = legenda.ligada && legenda.faixa ? legenda.faixa.activeCues : null;
      /* Duas cues no ar ao mesmo tempo: vale a última que começou. Nos
       * arquivos medidos em 01/09 não há sobreposição nenhuma, mas o acervo
       * pode ser retranscrito e texto dobrado na tela é ilegível. */
      var texto = ativas && ativas.length ? String(ativas[ativas.length - 1].text || '') : '';
      if (!texto.trim()) { camadaLegenda.hidden = true; return; }

      /* Uma linha por linha, cada uma com o seu próprio fundo — é o que
       * impede o retângulo preto de esticar até o fim da linha mais curta. */
      texto.split('\n').forEach(function (linha) {
        if (!linha.trim()) return;
        var l = criar('div', 'pl-legenda-linha');
        l.appendChild(criar('span', 'pl-legenda-texto', linha));
        camadaLegenda.appendChild(l);
      });
      camadaLegenda.hidden = false;
    }

    function montarFaixa(cues) {
      var Cue = raiz.VTTCue || raiz.TextTrackCue;
      if (!video.addTextTrack || !Cue) return null;
      var dadosDaFaixa = AppPlayerCore.faixaDeLegenda(midia) || {};
      var faixa = video.addTextTrack('captions', dadosDaFaixa.rotulo || '', dadosDaFaixa.idioma || '');   /* rótulo e idioma da faixa vêm do servidor: dado (a língua da fala), não texto da interface */
      faixa.mode = 'hidden';
      cues.forEach(function (c) {
        /* Uma cue torta não pode derrubar as outras 835. */
        try { faixa.addCue(new Cue(c.inicio, c.fim, c.texto)); } catch (e) { /* pula */ }
      });
      faixa.addEventListener('cuechange', pintarLegenda);
      return faixa;
    }

    function carregarLegenda() {
      if (legenda.cues) return Promise.resolve(legenda.cues);
      /* O idioma padrão do cliente (`player.legenda.idiomaPadrao`) vale quando
       * o título tem essa faixa; sem ela, a primeira, como sempre. */
      var idiomaDaLegenda = cfg.legenda.idiomaPadrao;
      var url = (idiomaDaLegenda && AppPlayerCore.urlLegenda(midia, idiomaDaLegenda)) || AppPlayerCore.urlLegenda(midia);
      if (!url) return Promise.reject(new Error(tr('player.erroSemUrlLegenda')));
      return fetch(url).then(function (r) {
        /* 404 é caso REAL e esperado: o institucional não tem legenda nenhuma
         * (o áudio é só trilha), e 1 dos 33 no ar está nessa situação. */
        if (!r.ok) throw new Error(tr('player.erroLegendaStatus', { status: r.status }));
        return r.text();
      }).then(function (texto) {
        /* Dois passos com nomes próprios, e não um só: `analisarVtt` é fiel ao
         * arquivo, `desenrolarLegenda` converte legenda ROLANTE em pop-on —
         * o bloco aparece inteiro e é substituído, em vez de a linha de baixo
         * subir empurrando a de cima. Em legenda normal o segundo passo não
         * encontra nada para fazer e devolve as cues intactas. */
        var cues = AppPlayerCore.desenrolarLegenda(AppPlayerCore.analisarVtt(texto));
        if (!cues.length) throw new Error(tr('player.erroLegendaVazia'));
        legenda.cues = cues;
        legenda.faixa = montarFaixa(cues);
        if (!legenda.faixa) throw new Error('navegador sem TextTrack');
        return cues;
      });
    }

    function sincronizarCC() {
      var ligada = legenda.ligada;
      bCC.setAttribute('aria-pressed', String(ligada));
      bCC.setAttribute('aria-label', ligada ? tr('player.desligarLegenda') : tr('player.ligarLegenda'));
      bCC.title = bCC.getAttribute('aria-label');
      caixa.classList.toggle('pl-legenda-ativa', ligada);
    }

    /* `calada` distingue os dois jeitos de a legenda ligar: por tecla/botão,
     * que merece selo na tela, e pela preferência guardada, que não pode
     * anunciar nada — nem o erro. Um título sem legenda não vai xingar quem
     * simplesmente abriu a ficha. */
    function ligarLegendaBaixando(calada) {
      if (legenda.carregando) return;
      legenda.carregando = true;
      if (!calada) mostrarSelo(tr('player.carregandoLegenda'));
      carregarLegenda().then(function () {
        legenda.carregando = false;
        if (destruido) return;
        legenda.ligada = true;
        sincronizarCC();
        pintarLegenda();
        if (!calada) mostrarSelo(tr('player.legendaLigada'));
      }).catch(function () {
        legenda.carregando = false;
        if (destruido) return;
        legenda.indisponivel = true;
        bCC.disabled = true;
        if (!calada) mostrarSelo(tr('player.semLegenda'));
      });
    }

    function alternarLegenda() {
      if (legenda.indisponivel) { mostrarSelo(tr('player.semLegenda')); return; }

      if (legenda.ligada || legenda.cues) {
        legenda.ligada = !legenda.ligada;
        gravarPreferenciaLegenda(legenda.ligada, legenda.escala);
        sincronizarCC();
        pintarLegenda();
        mostrarSelo(legenda.ligada ? tr('player.legendaLigada') : tr('player.legendaDesligada'));
        return;
      }

      /* Grava a intenção ANTES de saber se este título tem legenda: quem
       * apertou C quer legenda: se falta neste, o próximo já abre com ela. */
      gravarPreferenciaLegenda(true, legenda.escala);
      ligarLegendaBaixando(false);
    }

    function ajustarCorpoLegenda(passo) {
      if (!legenda.ligada) { mostrarSelo(tr('player.ligueLegendaPrimeiro')); return; }
      legenda.escala = AppPlayerCore.proximoTamanhoLegenda(legenda.escala, passo);
      caixa.style.setProperty('--pl-leg', String(legenda.escala));
      gravarPreferenciaLegenda(true, legenda.escala);
      mostrarSelo(tr('player.legendaEscala', { pct: Math.round(legenda.escala * 100) }));
    }

    /* -------------------------------------------------- ações do teclado
     *
     * Fase 1. QUEM decide que tecla virou que ação é `AppPlayerCore.acaoDeTecla`, no
     * player-core, que é puro e testado. O que está aqui é só a execução.
     */

    function definirMudo(mudo) {
      video.muted = !!mudo;
      /* `muted` funciona no iPhone, ao contrário de `volume` — e continua
       * valendo com o grafo montado, porque ele silencia o ELEMENTO, antes de
       * qualquer nó nosso. Por isso o mudo não passou a depender do ganho. */
      var rotulo = video.muted ? tr('player.ativarSom') : tr('player.silenciar');
      bMudo.setAttribute('aria-label', semHover ? tr('player.volume') : rotulo);
      bMudo.title = semHover ? tr('player.volume') : rotulo;
      bMudoPainel.setAttribute('aria-label', rotulo);
      bMudoPainel.setAttribute('aria-pressed', video.muted ? 'true' : 'false');
      caixa.classList.toggle('pl-mudo-ativo', video.muted);
    }

    /* ---------------------------------------------------------- som (fase 4)
     *
     * Um grafo Web Audio — `<video>` → ganho → compressor → saída — resolve o
     * Volume Estável (item 8), o Boost até 200% (item 12), o volume por gesto
     * que a fase 5 vai chamar (10b) e o `↑`/`↓` do iPhone (item 22), onde
     * `video.volume` é somente-leitura. QUEM decide os números está no
     * player-core, testado sem navegador; o que está aqui é a montagem.
     *
     * A regra que atravessa o bloco inteiro, e a razão de ele ser tão
     * cuidadoso: **`createMediaElementSource` não tem volta.** Depois dele o
     * áudio do vídeo só sai pelo grafo, para sempre, e um grafo que falhe
     * deixa o vídeo MUDO. Por isso o grafo só é montado para quem precisa
     * dele: num desktop com o volume em 80% o `video.volume` dá conta sozinho,
     * e ali o caminho mais seguro é não existir grafo nenhum.
     */

    var som = {
      volume: 1,        /* 0 a 2 — a verdade do volume. `video.volume` não é */
      estavel: false,
      ctx: null, fonte: null, ganho: null, nivel: null, limite: null, molde: null,
      ativo: false,     /* o grafo está montado e o áudio passa por ele */
      possivel: true,   /* ainda vale tentar montar */
      obedece: true,    /* `video.volume` aceitou a última escrita */
      espera: 0
    };

    ultimoSom = { som: som, video: video };

    var prefSom = lerPreferenciaSom();
    if (prefSom) { som.volume = prefSom.volume; som.estavel = prefSom.estavel; }

    /* O IPHONE NÃO TEM ESTA FUNÇÃO — decidido em 04/09, com medida no aparelho.
     *
     * A fase 4 respondia ao `video.volume` somente-leitura do iOS montando o
     * grafo: era o item 22, "o grafo entra e o `↑`/`↓` passa a funcionar de
     * verdade". A premissa caiu num iPhone 11: com o grafo montado, mexer no
     * volume e ligar o Volume Estável **não mudam nada que se ouça**. O
     * `AppPlayer.medir()` explicou por quê —
     *
     *     { via: 'ganho', estado: 'suspended', pico: 0, moldador: true }
     *
     * — o contexto fica SUSPENSO, e o iOS o suspende de novo toda vez que a
     * página sai da frente. Um grafo parado não processa nada.
     *
     * Montar ali, então, não entrega nada E cobra caro: depois do
     * `createMediaElementSource` o áudio só sai pelo grafo (a armadilha sem
     * volta da fase 4), e um grafo parado é um vídeo MUDO — sem aviso e sem
     * volta, porque nada torna a chamar `resume()` depois dos 500 ms do vigia.
     * Era muito pouco por muito problema.
     *
     * Então no iPhone o volume é o DO APARELHO, e o painel diz isso com todas
     * as letras. É o plano B do volume, que deixou de ser plano
     * B. O mudo continua nosso: `muted` funciona no iOS, ao contrário de
     * `volume`.
     *
     * A pergunta é de RECURSO, não de navegador — nada de farejar `userAgent`,
     * que este projeto não faz em lugar nenhum. Quem responde é o próprio
     * elemento, e a pergunta é inaudível: escreve 1% de diferença, confere se
     * pegou e devolve o valor que estava. */
    function elementoAceitaVolume() {
      try {
        var antes = video.volume;
        var teste = antes > 0.5 ? antes - 0.01 : antes + 0.01;
        video.volume = teste;
        var aceitou = Math.abs(video.volume - teste) < 0.001;
        video.volume = antes;
        return aceitou;
      } catch (e) {
        return false;      /* lançou ao escrever: também não obedece */
      }
    }

    if (!elementoAceitaVolume()) {
      som.obedece = false;
      /* E o grafo NÃO é a saída — é esta linha que fecha a porta antes de
       * qualquer um dos três caminhos que montariam o grafo. */
      som.possivel = false;
      /* A preferência guardada pode dizer "estável ligado" ou "150%", de antes
       * desta decisão. Aqui as duas coisas não existem, e mostrar a caixinha
       * marcada e inerte seria mentir. NÃO é gravada de volta: o que está no
       * armazenamento continua valendo no dia em que o aparelho mudar. */
      som.estavel = false;
      som.volume = 1;
    }

    var gravacaoSom = 0;

    /* A fase 5 vai arrastar o volume com o dedo, e o `input` do controle
     * deslizante já dispara dezenas de vezes por arrasto. Sem isto, cada passo
     * viraria uma escrita em `localStorage`. */
    function agendarGravacaoSom() {
      if (gravacaoSom) clearTimeout(gravacaoSom);
      gravacaoSom = setTimeout(function () {
        gravacaoSom = 0;
        gravarPreferenciaSom(som.volume, som.estavel);
      }, 300);
    }

    function dizerNoPainel(texto) {
      recadoSom.textContent = texto || '';
      recadoSom.hidden = !texto;
    }

    /* O AudioContext nasce suspenso enquanto a página não recebeu um gesto, e
     * no iOS ele volta a suspender sozinho quando a aba sai e volta. Chamar
     * `resume()` é barato e não faz nada quando já está tocando. */
    function acordarSom() {
      if (!som.ctx || som.ctx.state === 'running') return;
      try {
        var p = som.ctx.resume();
        if (p && p.catch) p.catch(function () { /* contexto fechado */ });
      } catch (e) { /* alguns navegadores lançam; não é fatal */ }
    }

    /* Rede de segurança do passo sem volta: se meio segundo depois de montar o
     * contexto ainda não estiver tocando, o áudio está saindo por um grafo
     * parado — ou seja, não está saindo. Dizer isso é melhor do que deixar a
     * pessoa concluir que o vídeo veio sem som. */
    function vigiarContexto() {
      if (som.espera) clearTimeout(som.espera);
      som.espera = setTimeout(function () {
        som.espera = 0;
        if (destruido || !som.ctx) return;
        if (som.ctx.state === 'running') { dizerNoPainel(''); return; }
        acordarSom();
        dizerNoPainel(tr('player.somNaoComecou'));
      }, 500);
    }

    function definirParam(param, valor) {
      if (!param) return;
      try { param.value = valor; } catch (e) { /* somente-leitura: ignora */ }
    }

    function aplicarNo(no, a) {
      if (!no) return;
      definirParam(no.threshold, a.threshold);
      definirParam(no.knee, a.knee);
      definirParam(no.ratio, a.ratio);
      definirParam(no.attack, a.attack);
      definirParam(no.release, a.release);
    }

    /* Monta o grafo. Devolve `true` se o áudio passou a sair por ele.
     *
     * SÓ pode ser chamada de dentro de um gesto — clique, toque ou tecla —
     * porque é isso que o navegador exige para ligar um AudioContext. Todos os
     * caminhos que chegam aqui são gestos; não há chamada no carregamento. */
    function montarGrafo() {
      if (som.ativo) return true;
      if (!som.possivel || destruido) return false;

      var AC = raiz.AudioContext || raiz.webkitAudioContext;
      if (!AC) { som.possivel = false; return false; }

      try {
        som.ctx = new AC();
        /* Os QUATRO nós antes da fonte, de propósito: `createMediaElementSource`
         * é o passo sem volta, e nada que possa lançar pode vir depois dele.
         * Se um `createGain()` fosse falhar, que falhe com o vídeo ainda
         * ligado na saída normal do navegador. */
        som.ganho = som.ctx.createGain();
        som.nivel = som.ctx.createDynamicsCompressor();
        som.limite = som.ctx.createDynamicsCompressor();
        som.molde = som.ctx.createWaveShaper();
        som.fonte = som.ctx.createMediaElementSource(video);
        /* A CADEIA, e cada elo tem uma razão medida em 02/09 contra o player
         * rodando — nenhum deles é precaução teórica:
         *
         * 1. o ganho vem PRIMEIRO. Depois dos outros, o Boost multiplicaria a
         *    saída já tratada e clipparia com nada para segurar.
         * 2. o NIVELADOR é o Volume Estável (item 8): ataque lento, porque
         *    nivelar é sobre a média.
         * 3. o LIMITADOR é outro nó, e não o mesmo: com um só, 200% + estável
         *    dava pico 1,846 no analisador, porque o ataque de 20 ms do
         *    nivelador deixa o transiente passar inteiro. Ataque de 1 ms.
         * 4. o MOLDADOR fecha a conta. Mesmo o limitador ultrapassa ~5 dB no
         *    transiente — com ele sozinho o pior caso ainda batia em 1,042. O
         *    moldador é uma função da amostra, não um envelope no tempo, então
         *    o teto dele é aritmética: 0,881, medido igual ao previsto. */
        som.fonte.connect(som.ganho);
        som.ganho.connect(som.nivel);
        som.nivel.connect(som.limite);
        som.limite.connect(som.molde);
        som.molde.connect(som.ctx.destination);
      } catch (e) {
        som.possivel = false;
        if (som.fonte) {
          /* A fonte já capturou o áudio e não há como devolvê-lo ao navegador
           * — fechar o contexto aqui deixaria o vídeo mudo. O menos ruim é
           * ligar a fonte direto na saída: perdem-se o ganho e o tratamento, o
           * volume volta a ser o do elemento, e o vídeo continua com som. */
          try { som.fonte.connect(som.ctx.destination); } catch (e2) { /* nem isso */ }
          return false;
        }
        try { if (som.ctx) som.ctx.close(); } catch (e3) { /* já fechado */ }
        som.ctx = null; som.ganho = null;
        som.nivel = null; som.limite = null; som.molde = null;
        return false;
      }

      som.ativo = true;
      acordarSom();
      aplicarSom();
      vigiarContexto();
      return true;
    }

    function aplicarSom() {
      if (!som.ativo) return;
      var g = AppPlayerCore.ganhoDeSaida({ volume: som.volume, estavel: som.estavel });
      /* Rampa curta em vez de atribuição seca: trocar o ganho de um golpe faz
       * um clique audível, e segurar o `↑` faria um por tecla. */
      try {
        som.ganho.gain.setTargetAtTime(g, som.ctx.currentTime || 0, 0.015);
      } catch (e) {
        som.ganho.gain.value = g;
      }

      aplicarNo(som.nivel, AppPlayerCore.ajusteNivelador({ estavel: som.estavel }));
      /* O limitador olha o ganho DE SAÍDA, não o volume da tela: o estável
       * sozinho já leva o ganho a 1,9 com o volume em 100%, e é o que entra no
       * nó que faz estourar. */
      aplicarNo(som.limite, AppPlayerCore.ajusteLimitador({ ganho: g }));

      /* `curve = null` desliga o WaveShaper de VERDADE: a amostra passa
       * adiante sem ninguém tocar nela. É o que mantém o áudio em volume
       * normal exatamente como era — inclusive no iPhone, que monta o grafo só
       * para ter volume. A curva é feita uma vez e reusada por todas as
       * fichas: são 2048 casas que não mudam nunca. */
      som.molde.curve = AppPlayerCore.precisaMoldador({ ganho: g })
        ? (curvaDoMoldador || (curvaDoMoldador = AppPlayerCore.curvaSuave()))
        : null;

      /* Com o grafo no comando o elemento fica com o sinal inteiro. Um
       * `video.volume` em 0,5 dividiria o volume entre dois lugares, e o
       * painel mostraria um número que não bate com o que se ouve. */
      try { video.volume = 1; } catch (e) { /* iOS: já é 1 e é somente-leitura */ }
    }

    /* A preferência guardada pode pedir 150% ou o Volume Estável, e os dois
     * exigem o grafo — que exige um gesto. O primeiro play É esse gesto, e é
     * também o primeiro instante em que montar faz diferença: antes dele não
     * há som para processar. */
    function somDaPreferencia() {
      if (som.ativo || !som.possivel) return;
      if (som.volume <= 1 && !som.estavel) return;
      montarGrafo();
      sincronizarSom();
    }

    /* Põe o volume onde der, e devolve por onde ele passou. */
    function definirVolume(pedido) {
      var via = AppPlayerCore.viaDoVolume({
        pedido: pedido,
        grafoAtivo: som.ativo,
        elementoObedece: som.obedece,
        grafoPossivel: som.possivel
      });

      if (via === 'montar') via = montarGrafo() ? 'ganho' : 'nenhuma';

      if (via === 'ganho') {
        som.volume = pedido;
        aplicarSom();
      } else if (via === 'elemento') {
        var alvo = pedido > 1 ? 1 : pedido;
        video.volume = alvo;
        /* ARMADILHA DO iOS: `video.volume` é somente-leitura no iPhone e no
         * iPad. Atribuir não dá erro — simplesmente não pega, e RELER é a
         * única forma de saber. Descobrir isso aqui é o gatilho do conserto do
         * item 22: o grafo entra e o `↑`/`↓` passa a funcionar de verdade. */
        if (Math.round(video.volume * 100) !== Math.round(alvo * 100)) {
          /* O elemento recusou a escrita. Até 04/09 isto MONTAVA o grafo — era
           * o item 22 —, e a medida no iPhone 11 mostrou que ali o grafo não
           * entrega nada e ainda arrisca deixar o vídeo mudo. A recusa agora
           * fecha a porta, e o painel diz "Use os botões do aparelho".
           *
           * O `probe` lá de cima costuma chegar primeiro; esta linha é para o
           * elemento que aceitava e parou de aceitar. */
          som.obedece = false;
          som.possivel = false;
          via = 'nenhuma';
        } else {
          som.volume = alvo;
        }
      }

      /* Subir o volume com o som mudo tem que tirar o mudo — senão a tecla não
       * faz nada audível e parece quebrada. */
      if (via !== 'nenhuma' && som.volume > 0 && video.muted) definirMudo(false);

      sincronizarSom();
      if (via !== 'nenhuma') agendarGravacaoSom();
      return via;
    }

    function ajustarVolume(passo) {
      /* O teto é 200% só quando existe com que entregar. Sem grafo possível,
       * `video.volume` para em 1 e prometer reforço no selo seria mentira. */
      var teto = (som.ativo || som.possivel) ? AppPlayerCore.VOLUME_MAX_GANHO : 1;
      var via = definirVolume(AppPlayerCore.proximoVolume(som.volume, passo, teto));
      mostrarSelo(AppPlayerCore.rotuloVolume({ via: via, volume: som.volume }));
    }

    function definirEstavel(ligado) {
      /* O Volume Estável É o compressor: sem grafo não há o que ligar. */
      if (ligado && !som.ativo && !montarGrafo()) {
        som.estavel = false;
        sincronizarSom();
        dizerNoPainel(tr('player.navegadorSemSom'));
        mostrarSelo(tr('player.volumeEstavelIndisponivel'));
        return;
      }
      som.estavel = !!ligado;
      aplicarSom();
      sincronizarSom();
      agendarGravacaoSom();
      mostrarSelo(som.estavel ? tr('player.volumeEstavelLigado') : tr('player.volumeEstavelDesligado'));
    }

    /* O painel é o espelho de `som` — nunca a fonte da verdade. */
    function sincronizarSom() {
      var pct = Math.round(som.volume * 100);
      faixaVol.value = String(pct);
      faixaVol.setAttribute('aria-valuetext', pct + '%');
      valorVol.textContent = pct + '%';
      caixaEstavel.checked = som.estavel;
      /* Acima de 100% o número muda de cor: reforço tem que ser visível, senão
       * um 200% guardado da sessão passada vira susto no próximo vídeo. */
      caixa.classList.toggle('pl-reforco', som.volume > 1);

      /* Só desiste quando não sobrou caminho nenhum: o elemento não obedece, o
       * grafo não está montado e não dá mais para montar. */
      var semSaida = !som.obedece && !som.ativo && !som.possivel;
      faixaVol.disabled = semSaida;
      caixaEstavel.disabled = !som.ativo && !som.possivel;
      if (semSaida) dizerNoPainel(tr('player.useBotoesDoAparelho'));
    }


    function ajustarVelocidade(passo) {
      video.playbackRate = AppPlayerCore.proximaVelocidade(video.playbackRate, passo, cfg.velocidades);
      mostrarSelo(String(video.playbackRate).replace('.', ',') + '×');
    }

    /* Modo teatro: o player ocupa a largura toda e a ficha vira uma coluna.
     * A classe vai no <body> porque quem manda no layout da ficha é o CSS do
     * site, não o player — e `destruir()` limpa, senão a grade voltaria
     * estreita depois de sair da ficha em modo teatro. */
    function alternarTeatro() {
      var ligado = document.body.classList.toggle('app-teatro');
      mostrarSelo(ligado ? tr('player.modoTeatro') : tr('player.modoNormal'));
    }

    /* -------------------------------------------- gestos de toque (fase 5)
     *
     * Quem DECIDE o que um dedo quis dizer é `AppPlayerCore.criarGestos()`, puro e com
     * teste; daqui para baixo só se executa o que ele mandou. É a mesma
     * divisão do teclado da fase 1 — e é ela que faz uma fase inteira de
     * toque caber em `node --test`, sem navegador e sem dedo.
     */

    var gestos = AppPlayerCore.criarGestos();
    var esperaSegurar = 0;
    var arrastoBase = null;

    /* ------------------------------------- o sumiço dos controles (03/09)
     *
     * A barra e os botões saem de cena depois de alguns segundos de quietude e
     * voltam ao primeiro sinal de vida. Quem decide SE pode sumir é o
     * `player-core`; aqui só se conta o tempo e se põe a classe.
     *
     * `0` quer dizer "nunca some", e é uma escolha válida no `/admin`. */
    var segundosSumico = AppPlayerCore.segundosDeSumico(
      (config && config.ajustes) ? config.ajustes.controlesEspera : undefined);
    var esperaControles = 0;

    function cancelarSumico() {
      if (esperaControles) { clearTimeout(esperaControles); esperaControles = 0; }
    }

    function agendarSumico() {
      cancelarSumico();
      if (!segundosSumico) return;
      esperaControles = setTimeout(function () {
        esperaControles = 0;
        if (!AppPlayerCore.podeEsconderControles({
          tocando: !video.paused && !video.ended,
          painelAberto: painelAberto,
          arrastando: !!arrastoBase || barra.classList.contains('pl-barra-ativa'),
          /* `activeElement` e não um listener de foco: é a pergunta direta, e
           * ela também cobre o foco que chegou por clique. */
          focoDentro: controles.contains(document.activeElement)
        })) {
          /* Ainda não pode. Tenta de novo daqui a pouco, em vez de desistir —
           * senão pausar e despausar deixaria os controles para sempre. */
          agendarSumico();
          return;
        }
        caixa.classList.add('pl-sem-controles');
      }, segundosSumico * 1000);
    }

    /* Qualquer sinal de vida traz tudo de volta e reinicia a contagem. */
    function acordarControles() {
      if (destruido) return;
      caixa.classList.remove('pl-sem-controles');
      agendarSumico();
      /* E o SOM acorda junto (04/09). Esta função já é chamada em todo sinal de
       * vida — tecla, ponteiro que desce, ponteiro que anda, play, pause, foco
       * pelo Tab —, então pendurar aqui é pendurar nos seis de uma vez, e o
       * sétimo que alguém acrescentar amanhã vem de graça.
       *
       * O problema que isto resolve foi achado medindo o iPhone: o
       * `AudioContext` suspende sozinho quando a página sai da frente, e até
       * hoje o `resume()` só era chamado ao montar o grafo e uma vez, 500 ms
       * depois, no vigia. Depois disso, nada — e com o elemento já capturado
       * pelo grafo, contexto suspenso é vídeo MUDO, sem aviso e sem volta.
       *
       * No iPhone o problema sumiu porque lá não existe mais grafo; no Android
       * e no desktop ele existe para quem liga o Volume Estável, e é aí que
       * esta linha vale. `acordarSom()` sai na primeira linha quando não há
       * contexto ou quando ele já está tocando: custa duas comparações. */
      acordarSom();
    }

    /* O quadro medido, em coordenadas de tela. Fica guardado em vez de ser
     * relido a cada movimento por dois motivos: `getBoundingClientRect()` é
     * uma leitura de layout e viria umas 60 vezes por segundo durante um
     * arrasto, e — o que importa mais — um arrasto tem que ser medido contra
     * o MESMO quadro do começo ao fim. */
    var quadro = { esquerda: 0, topo: 0 };

    /* Medido a cada `pointerdown`, e não uma vez só: o quadro muda de tamanho
     * ao girar o telefone, ao entrar em tela cheia e no modo teatro. Uma
     * medida velha põe a faixa da direita no meio da tela. */
    /* A fração do vídeo que um arranco pode atravessar, escolhida no `/admin`.
     * Vem do catálogo junto com a pull zone; na falta dela vale o padrão do
     * `player-core`, e um valor torto é aparado lá dentro. */
    var fracaoTeto = (config && config.ajustes) ? config.ajustes.arrastoTeto : undefined;

    function medirQuadro() {
      var r = caixa.getBoundingClientRect();
      quadro.esquerda = r.left;
      quadro.topo = r.top;
      /* A duração vai junto porque o teto do arranco sai dela: "seis vezes" não
       * quer dizer a mesma coisa num vídeo de dois minutos e num de uma hora. */
      gestos.medir({
        largura: r.width, altura: r.height,
        duracao: duracao(), fracaoTeto: fracaoTeto,
        /* O tamanho de VERDADE do vídeo vai junto desde a fase 8: é dele que
         * sai o retângulo da imagem, e é a borda da IMAGEM — não a do quadro —
         * que segura o arrasto do zoom. Zero antes do metadata, e o
         * `loadedmetadata` remede logo abaixo. */
        videoLargura: video.videoWidth, videoAltura: video.videoHeight
      });
    }

    /* Girar o aparelho em tela cheia é a única coisa que muda o quadro sem
     * passar por um dedo — e com a imagem ampliada isso importa: o
     * deslocamento que estava encostado na borda pode passar a mostrar faixa
     * preta. Remedir já reapara o número lá dentro; aqui é só reaplicá-lo.
     *
     * Quem não ampliou não paga nada além da remedida, que é uma leitura de
     * retângulo — e ela é útil de graça para o arrasto seguinte. */
    function aoRedimensionar() {
      if (destruido) return;
      medirQuadro();
      var z = gestos.zoomAtual();
      if (z.escala !== AppPlayerCore.ZOOM_MIN) definirZoom(z.escala, z.x, z.y);
    }
    raiz.addEventListener('resize', aoRedimensionar);

    function pontoDoEvento(ev) {
      return {
        id: ev.pointerId,
        tipo: ev.pointerType === 'mouse' ? 'mouse' : 'toque',
        x: ev.clientX - quadro.esquerda,
        y: ev.clientY - quadro.topo,
        /* `timeStamp` do evento, e não `Date.now()`: é o relógio monotônico do
         * navegador, e é ele que mede os 300 ms entre dois toques sem sofrer
         * com acerto de hora nem com o adiamento de temporizador. */
        t: ev.timeStamp
      };
    }

    /* Os controles são deles. A barra tem o próprio arrasto desde a fase 0, e
     * o painel de som — o cuidado que a fase 4 deixou escrito para esta fase —
     * ocupa o canto de baixo à direita do quadro. `somCaixa` vive DENTRO de
     * `controles`, então uma checagem só cobre os dois. */
    function foraDosControles(ev) {
      return !(ev.target && controles.contains && controles.contains(ev.target));
    }

    /* Zoom da IMAGEM (item 7, fase 8) — e é da imagem no sentido mais literal:
     * `transform` no <video>, sem qualidade nova nenhuma para revelar. Ampliar
     * 4× um quadro de 240p mostra o 240p ampliado, e mesmo assim é o que serve
     * a um acervo cheio de slide com letra pequena.
     *
     * Nasce em 1 e NÃO é guardado: a lista do que pode ir para o
     * navegador tem dois itens, legenda e som, e há teste varrendo este arquivo
     * atrás de uma terceira chave. Ampliar é ajuste de momento — serve para ler
     * o que está escrito naquele slide e acaba quando o slide acaba.
     *
     * A legenda NÃO é ampliada junto, de propósito: ela fica onde estava,
     * legível e no lugar de sempre, enquanto a imagem passa por baixo. Quem
     * quer a legenda maior tem o `+` do item 24. */
    function definirZoom(escala, x, y) {
      var e = AppPlayerCore.limitarZoom(escala);
      /* A mesma disciplina do grafo de som: a classe — e com ela o
       * `transform`, que obriga o navegador a compor o vídeo numa camada
       * própria — só entra quando alguém ampliou de verdade. */
      caixa.classList.toggle('pl-zoom', e !== AppPlayerCore.ZOOM_MIN);
      caixa.style.setProperty('--pl-zoom', String(e));
      caixa.style.setProperty('--pl-zoom-x', (Number(x) || 0) + 'px');
      caixa.style.setProperty('--pl-zoom-y', (Number(y) || 0) + 'px');
    }

    /* ------------------------------------------ a prévia do arrasto (item 6)
     *
     * Três estados, e é só isso: `pedido` é o segundo que o dedo quer agora,
     * `ocupado` diz se o <video> ainda está procurando o anterior, e `morto`
     * fecha a porta quando o arquivo não vem.
     *
     * A fila tem UM lugar de propósito. O dedo pede um segundo diferente a
     * cada quadro da tela, e enfileirar isso faria a prévia correr atrás do
     * dedo, cada vez mais atrasada. Guardando só o último pedido, ela mostra
     * sempre o quadro mais recente que deu tempo de buscar — que é justamente
     * o que se quer olhar. */
    var previa = { pedido: null, ocupado: false, morto: false, ligada: false, espera: 0 };

    /* Uma procura que não termina travaria a fila para sempre, e o sintoma
     * seria o pior que existe: a moldura congelada num quadro velho, sem erro
     * nenhum. Dois segundos é muito mais do que uma faixa de bytes de 240p
     * demora, e menos do que alguém aguenta olhando para o quadro errado. */
    var PREVIA_PACIENCIA_MS = 2000;

    function ligarPrevia() {
      if (previa.ligada || previa.morto) return;
      if (!urlPrevia) { previa.morto = true; return; }
      previa.ligada = true;
      /* O `src` só é posto AGORA, no primeiro arrasto. Mesma disciplina do
       * vídeo principal e da legenda: quem abre a ficha para ler a sinopse não
       * baixa quadro nenhum. */
      previaQuadro.src = urlPrevia;
    }

    function liberarPrevia() {
      if (previa.espera) { clearTimeout(previa.espera); previa.espera = 0; }
      previa.ocupado = false;
    }

    function servirQuadro() {
      if (previa.morto || previa.pedido == null) { liberarPrevia(); return; }

      /* ARMADILHA JÁ PAGA UMA VEZ, na fase 3, e ela voltou aqui: escrever em
       * `currentTime` antes de o navegador ter a régua de tempo não dispara
       * evento NENHUM. Sem esta guarda o primeiro pedido é engolido, o
       * `seeked` nunca chega e a fila fica ocupada para sempre — a moldura
       * abre e nunca mostra quadro. O pedido fica guardado e o
       * `loadedmetadata` logo abaixo o serve. */
      if (previaQuadro.readyState < 1) { previa.ocupado = true; return; }

      var t = previa.pedido;
      previa.pedido = null;
      /* Procurar o segundo em que já se está não dispara `seeked` — mesmo
       * buraco, outra porta. Num arrasto lento isso acontece o tempo todo. */
      if (Math.abs(previaQuadro.currentTime - t) < 0.05) { liberarPrevia(); return; }

      previa.ocupado = true;
      if (previa.espera) clearTimeout(previa.espera);
      previa.espera = setTimeout(function () { previa.espera = 0; previa.ocupado = false; },
        PREVIA_PACIENCIA_MS);
      try { previaQuadro.currentTime = t; } catch (e) { liberarPrevia(); }
    }

    function pedirQuadro(segundos) {
      if (previa.morto) return;
      ligarPrevia();
      previa.pedido = AppPlayerCore.limitarTempo(segundos, duracao());
      if (!previa.ocupado) servirQuadro();
    }

    /* A régua de tempo chegou: o pedido que ficou esperando por ela pode ir. */
    previaQuadro.addEventListener('loadedmetadata', function () {
      liberarPrevia();
      servirQuadro();
    });

    previaQuadro.addEventListener('seeked', function () {
      /* Só a partir do primeiro quadro de verdade a moldura mostra imagem —
       * antes disso ela seria um retângulo preto dizendo que algo quebrou. */
      previaCaixa.classList.add('pl-previa-viva');
      liberarPrevia();
      servirQuadro();
    });
    previaQuadro.addEventListener('error', function () {
      /* Sem o 240p a prévia simplesmente não existe, e o arrasto continua
       * funcionando com o relógio — que é o que ele já fazia ontem. */
      previa.morto = true;
      previa.ocupado = false;
      previaCaixa.classList.remove('pl-previa-viva');
    });

    /* A moldura durante o arrasto: o quadro, o capítulo e o relógio de
     * destino. Fica no lugar do selo, e some com ele. */
    /* A partir de quanto do caminho até o cancelamento a moldura avisa. Antes
     * disso o dedo ainda está só arrastando torto, e um aviso a cada tremida
     * seria pior do que aviso nenhum. */
    var AVISO_DESCARTE = 0.35;

    function mostrarPrevia(alvo, delta, descarte) {
      previaCaixa.hidden = false;
      /* Este é o caminho do CANTO — o arrasto do quadro (item 11) e o da barra
       * no dedo. Se o mouse tiver deixado a moldura em cima da barra, ela
       * volta para casa aqui. */
      previaNoCanto();
      esconderSelo();
      /* A moldura cresceu a pedido (03/09) e agora encosta na linha de
       * controles: num quadro embutido de 195 px de altura ela ocupa 152.
       * Em vez de encolher a moldura de novo, os BOTÕES desbotam enquanto se
       * procura — ninguém aperta play no meio de um arrasto. A barra fica
       * intacta de propósito: ela é a única coisa que mostra para onde o
       * ponteiro do vídeo está indo. */
      caixa.classList.add('pl-procurando');

      /* Jogar o dedo para baixo cancela o arrasto — e é um gesto que ninguém
       * descobre sozinho. A moldura desbota e diz o que vai acontecer ANTES de
       * acontecer: é a única chance de aprender o gesto sem manual. */
      var indo = Number(descarte) > AVISO_DESCARTE;
      previaCaixa.classList.toggle('pl-previa-indo', indo);

      var i = caps.length ? App.capituloEm(caps, alvo) : -1;
      previaTitulo.textContent = i >= 0 ? caps[i].titulo : '';
      previaTitulo.hidden = i < 0 || indo;
      /* "desça mais", e não "solte": o cancelamento acontece ao ATRAVESSAR o
       * limiar, com o dedo ainda na tela. Dizer "solte" ensinaria o gesto
       * errado — soltar ali em cima confirma o arrasto, não o desfaz. */
      previaTempo.textContent = indo
        ? tr('player.descaMaisParaCancelar')
        : App.formatarTempo(alvo) +
          (delta == null ? '' : '  ' + (delta < 0 ? '−' : '+') + Math.abs(delta) + ' s');
      pedirQuadro(alvo);
    }

    /* A moldura tem DOIS lugares desde 04/09: o canto, para o dedo, e em cima
     * da barra, para o mouse. Trocar de lugar é desfazer o outro — o
     * `left`/`bottom` em linha são do modo sobre a barra, e um resto deles
     * deslocaria a moldura do canto para o meio do nada. */
    function previaNoCanto() {
      previaCaixa.classList.remove('pl-previa-barra');
      previaCaixa.style.left = '';
      previaCaixa.style.bottom = '';
    }

    function esconderPrevia() {
      previaCaixa.hidden = true;
      previaCaixa.classList.remove('pl-previa-indo');
      previaNoCanto();
      caixa.classList.remove('pl-procurando');
      previa.pedido = null;
    }

    /* Pressionar e segurar (item 3). Guarda a velocidade de ANTES porque ela
     * pode não ser 1: quem estava em 1,5× pelo Shift+> tem que voltar para
     * 1,5× ao soltar o dedo, não para o normal. */
    var velocidadeAntes = 0;

    function velocidadeTemporaria(ligada) {
      if (ligada) {
        /* Segurar num vídeo parado não é 2× de nada, e o selo estaria
         * mentindo sobre uma coisa que não está acontecendo. */
        if (velocidadeAntes || video.paused) return;
        velocidadeAntes = video.playbackRate || 1;
        video.playbackRate = AppPlayerCore.VELOCIDADE_SEGURAR;
        mostrarSelo(tr('player.velocidadeSegurar', { x: AppPlayerCore.VELOCIDADE_SEGURAR }), true);
      } else {
        if (!velocidadeAntes) return;
        video.playbackRate = velocidadeAntes;
        velocidadeAntes = 0;
        esconderSelo();
      }
    }

    /* Bloqueio de tela (item 9). Some com os controles e deixa os gestos
     * inertes; o único que continua valendo é o toque duplo, que destrava.
     *
     * O TECLADO continua funcionando, de propósito. Bloqueio é para o dedo — é
     * dele que vêm os toques sem querer com o aparelho na mão — e pôr o
     * teclado dentro da tranca criaria a única forma de deixar o player
     * inutilizável sem saída num computador. */
    var travado = false;

    function travar(sim) {
      travado = !!sim;
      gestos.travar(travado);
      caixa.classList.toggle('pl-travado', travado);
      cadeado.hidden = !travado;
      bTrava.setAttribute('aria-pressed', travado ? 'true' : 'false');
      var rotulo = travado ? tr('player.desbloquearTela') : tr('player.bloquearTela');
      bTrava.setAttribute('aria-label', rotulo);
      bTrava.title = rotulo;
      mostrarSelo(travado ? tr('player.telaBloqueada')
        : tr('player.telaLiberada'));
    }

    /* Em tela cheia o vídeo é dono da tela, e é só ali que o arrasto VERTICAL
     * (itens 10a e 10b) pode existir. Fora dela, no telefone, o quadro ocupa
     * 211 px de uma tela de 812 e a ficha inteira mora embaixo: roubar o
     * arrasto vertical ali é entregar uma página que não rola quando o polegar
     * cai no vídeo. Trocar a rolagem da página pelo volume seria um
     * péssimo negócio, e o CSS acompanha esta decisão com `touch-action`.
     *
     * No iPhone isto ainda não acontece: `requestFullscreen` não existe lá e
     * maximizar entrega a tela ao player nativo da Apple, onde nada nosso
     * sobrevive. A tela cheia de mentira da fase 7 é que vai ligar os dois
     * gestos verticais no iPhone — e ela liga por aqui, sem mexer no gesto. */
    function emTelaCheia() {
      var el = document.fullscreenElement || document.webkitFullscreenElement;
      return !!el && (el === caixa || (el.contains ? el.contains(caixa) : false));
    }

    function aoTrocarTelaCheia() {
      var cheia = emTelaCheia();
      caixa.classList.toggle('pl-cheia', cheia);
      gestos.permitirVertical(cheia);
      /* A pinça (item 7) segue a mesma regra do arrasto vertical, e por um
       * motivo a mais: fora da tela cheia o `touch-action` entrega a pinça ao
       * NAVEGADOR, que a usa para ampliar a página — e esse zoom é
       * acessibilidade, não se disputa. */
      gestos.permitirPinca(cheia);
      /* Sair da tela cheia zera a ampliação lá dentro; aqui é onde a tela
       * acompanha. Sem isto o quadro de 211 px da ficha voltaria com um pedaço
       * de imagem ampliada e nenhum gesto à mão para desfazer. */
      if (!cheia) { definirZoom(AppPlayerCore.ZOOM_MIN, 0, 0); zoomNoSelo = 0; }
      /* Sair da tela cheia travado deixaria a ficha com um player sem
       * controles e sem o botão que solta. */
      if (!cheia && travado) travar(false);
      medirQuadro();
    }

    /* O arrasto contínuo — itens 11, 10a e 10b. A máquina manda o DELTA desde
     * o ponto em que o eixo ficou decidido; quem sabe de onde ele partiu é
     * aqui, e é por isso que o valor de partida é guardado no `inicio`. Somar
     * o delta ao valor CORRENTE a cada quadro acumularia o erro do
     * arredondamento e o vídeo escorregaria sozinho. */
    function aplicarArrasto(a) {
      if (a.fase === 'inicio') {
        arrastoBase = {
          alvo: a.alvo,
          tempo: video.currentTime || 0,
          volume: som.volume
        };
      }
      if (!arrastoBase || arrastoBase.alvo !== a.alvo) return;

      if (a.alvo === 'tempo') {
        var alvo = AppPlayerCore.limitarTempo(arrastoBase.tempo + a.valor, duracao());
        irPara(alvo);
        /* O relógio de DESTINO e o quanto andou, juntos: sozinho, o destino
         * não diz se o dedo está indo ou voltando, e sozinho o delta não diz
         * onde o vídeo vai parar. */
        var delta = Math.round(alvo - arrastoBase.tempo);
        if (a.fase === 'fim') {
          /* Solta a mão: a moldura sai e o selo diz onde parou, sumindo
           * sozinho como sempre fez. */
          esconderPrevia();
          mostrarSelo(a.cancelado
            ? tr('player.arrastoCancelado', { tempo: App.formatarTempo(alvo) })
            : App.formatarTempo(alvo) + '  ' + (delta < 0 ? '−' : '+') +
              Math.abs(delta) + ' s');
        } else {
          mostrarPrevia(alvo, delta, a.descarte);
        }
      } else if (a.alvo === 'volume') {
        /* O MESMO `definirVolume` do painel, das setas e da fase 4 inteira: o
         * gesto não é um segundo caminho para o som, é mais um jeito de pedir
         * ao caminho que já existe — com o grafo, o iPhone e o recado honesto
         * de quando não dá, tudo já resolvido lá dentro. */
        var teto = (som.ativo || som.possivel) ? AppPlayerCore.VOLUME_MAX_GANHO : 1;
        /* `volumeDoArrasto` e não `proximoVolume`: só o gesto tem o ímã dos
         * 100%. As setas e o painel andam em passos de 5%, onde o ímã seria
         * um passo que não anda. */
        var via = definirVolume(AppPlayerCore.volumeDoArrasto(arrastoBase.volume, a.valor, teto));
        mostrarSelo(AppPlayerCore.rotuloVolume({ via: via, volume: som.volume }), a.fase !== 'fim');
      }
      /* NÃO há terceiro ramo. Havia um, o brilho, e ele saiu em 09/09: era
       * `filter: brightness()` na imagem vendido como brilho de tela. Os
       * dois alvos que restam são os dois que o `player-core` sabe abrir, e
       * um `else` solto aqui aplicaria o valor de um terceiro que não
       * existe. */

      if (a.fase === 'fim') arrastoBase = null;
    }

    /* O selo só é reescrito quando o TAMANHO muda. Arrastar a imagem ampliada
     * não mexe na escala, e repetir "Zoom 2,4×" a cada quadro reiniciaria a
     * animação sessenta vezes por segundo para dizer a mesma coisa. */
    var zoomNoSelo = 0;

    function aplicarZoomGesto(a) {
      definirZoom(a.escala, a.x, a.y);
      if (a.fase === 'fim' || a.escala !== zoomNoSelo) {
        /* Fixo enquanto os dedos estão na tela, como o selo do arrasto: sem
         * isso o tamanho sumiria do olho no meio do gesto. */
        mostrarSelo(AppPlayerCore.rotuloZoom(a.escala), a.fase !== 'fim');
      }
      zoomNoSelo = a.fase === 'fim' ? 0 : a.escala;
    }

    /* Os dois deslizes da fase 7 (itens 4 e 5).
     *
     * O `player-core` já decidiu QUAL dos dois cabe na orientação de agora, e
     * se a distância bastou. Aqui só se desenha o aviso enquanto o dedo anda —
     * um gesto que ninguém descobre sozinho precisa se anunciar antes de
     * acontecer, que é a lição do `descarte` do arrasto horizontal — e se
     * executa no `fim`.
     *
     * `alvo: null` chega de propósito (↓ em pé, ↑ deitado) e serve para APAGAR
     * o aviso: sem esta passagem o selo ficaria pendurado depois de um deslize
     * que não fez nada. */
    var ROTULO_DESLIZE = {
      get deitar() { return tr('player.deslizeDeitar'); },
      get fechar() { return tr('player.deslizeFechar'); }
    };

    function aplicarDeslize(a) {
      if (a.fase !== 'fim') {
        if (a.alvo) {
          /* Enquanto não chegou, o aviso diz que ainda falta; ao chegar, ele
           * afirma. É a diferença entre "solte agora e acontece" e "continue". */
          mostrarSelo(ROTULO_DESLIZE[a.alvo] + (a.progresso >= 1 ? '' : '…'), true);
        }
        return;
      }
      if (!a.feito) { esconderSelo(); return; }
      if (a.alvo === 'deitar') { deitarImagem(); return; }
      if (a.alvo === 'fechar') fecharPlayer();
    }

    /* Deita a IMAGEM sem o usuário girar o telefone.
     *
     * `screen.orientation.lock()` só existe dentro de tela cheia, e é a única
     * forma de vencer a trava de rotação do aparelho — que é o estado normal
     * de muita gente, e sem a qual girar o telefone não faz nada.
     *
     * **Não existe no iOS**, nem no iPhone nem no iPad, e isso é decisão
     * tomada e não pendência: lá a tela cheia já é do player da Apple, que
     * gira sozinho. O gesto simplesmente não acontece naquele aparelho.
     *
     * A promessa REJEITA por motivos normais — o navegador não permitir, o
     * usuário ter saído da tela cheia no meio. Rejeitar não é erro, e o
     * `catch` existe para que a página não registre exceção não tratada por
     * uma coisa que só não aconteceu. */
    function deitarImagem() {
      var o = raiz.screen && raiz.screen.orientation;
      if (!o || typeof o.lock !== 'function') {
        mostrarSelo(tr('player.gireOAparelho'));
        return;
      }
      try {
        var pedido = o.lock('landscape');
        if (pedido && typeof pedido.catch === 'function') {
          pedido.catch(function () { mostrarSelo(tr('player.gireOAparelho')); });
        }
      } catch (e) {
        mostrarSelo(tr('player.gireOAparelho'));
      }
    }

    /* Fecha o player e devolve quem estava assistindo à FICHA do título, fora
     * da tela cheia.
     *
     * A ordem importa e não é gosto: sair da tela cheia PRIMEIRO. Destruir o
     * elemento que está em tela cheia deixa o navegador saindo dela sozinho
     * depois, com um quadro em que a página já mudou embaixo — e no meio disso
     * o `fullscreenchange` do próprio player dispara sobre um player que não
     * existe mais.
     *
     * Quem redesenha a ficha é o app.js, pelo `aoFechar`: ele é o dono do DOM
     * onde este player foi pendurado. Sem o gancho o gesto não faz nada, e é
     * melhor assim do que um player que se arranca da página. */
    function fecharPlayer() {
      var doc = document;
      var saindo = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (saindo) {
        /* `exitFullscreen()` devolve uma PROMESSA, e ela rejeita quando o
         * navegador acha que já não está em tela cheia — o que acontece se o
         * estado tiver saído de sincronia por qualquer caminho. O `try/catch`
         * sozinho não basta: ele pega o lançamento síncrono e deixa a rejeição
         * passar como promessa não tratada, que o navegador registra no
         * console de quem está assistindo. Achado na conferência, simulando o
         * gesto fora de uma tela cheia de verdade.
         *
         * Rejeitar aqui não é erro e não muda nada do que vem depois: já
         * estamos saindo. */
        try {
          var pedido = (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
          if (pedido && typeof pedido.catch === 'function') pedido.catch(function () { /* já saiu */ });
        } catch (e) { /* já saiu */ }
      }
      if (typeof g.aoFechar === 'function') g.aoFechar();
    }

    function aoGesto(acao) {
      if (!acao) return;
      switch (acao.acao) {
        case 'arrastar': aplicarArrasto(acao); break;
        case 'deslize': aplicarDeslize(acao); break;
        case 'zoom': aplicarZoomGesto(acao); break;
        case 'velocidadeTemporaria': velocidadeTemporaria(acao.ligada); break;
        case 'avisoTravado':
          mostrarSelo(tr('player.telaBloqueada'));
          break;
        case 'destravar': travar(false); break;
        /* Duplo clique do mouse: tela cheia SEM mexer no play. O primeiro
         * clique já alternou, e é aqui que ele é desfeito — não no `pointerup`
         * do segundo, que a entrada em tela cheia pode engolir (era o defeito
         * visto no site no ar em 04/09).
         *
         * `alternarPlay()` é o MESMO caminho de sempre, e é de propósito: a
         * REGRA 1 tem um dono só para o `play()`, e há teste contando as
         * chamadas. Isto aqui não é o player tocando sozinho — é ele desfazendo
         * o que o clique de 150 ms atrás fez. */
        case 'telaCheiaNoDuploClique':
          alternarPlay();
          telaCheia();
          break;
        /* Pular, capítulo e play/pause passam pelo MESMO `executar()` do
         * teclado. É o que garante que o toque duplo pule exatamente como a
         * seta pula — os mesmos limites, o mesmo selo, o mesmo `irPara` — em
         * vez de virar um segundo lugar de onde o vídeo se move. */
        default: executar(acao); break;
      }
    }

    function agendarSegurar() {
      if (esperaSegurar) clearTimeout(esperaSegurar);
      /* O relógio é daqui; a decisão de o 2× valer ou não continua sendo da
       * máquina, que confere se o dedo ficou mesmo parado. */
      esperaSegurar = setTimeout(function () {
        esperaSegurar = 0;
        aoGesto(gestos.aoSegurar());
      }, AppPlayerCore.SEGURAR_MS);
    }

    function cancelarSegurar() {
      if (esperaSegurar) { clearTimeout(esperaSegurar); esperaSegurar = 0; }
    }

    /* Ctrl + setas. Posiciona e só: como a lista clicável da ficha, ele nunca
     * chama play() — pular de capítulo num vídeo pausado deixa o vídeo pausado
     * no capítulo novo.
     *
     * Quem decide o alvo é `AppPlayerCore.alvoDeCapitulo`, e a seta da esquerda não é o
     * espelho da direita: no meio de um capítulo ela RECOMEÇA o capítulo, como
     * o botão de faixa anterior de qualquer tocador. */
    function irParaCapitulo(direcao) {
      if (!caps.length) { mostrarSelo(tr('player.semCapitulos')); return; }
      var agora = video.currentTime || 0;
      var alvo = AppPlayerCore.alvoDeCapitulo(caps, App.capituloEm(caps, agora), agora, direcao);
      if (!alvo) {
        mostrarSelo(direcao > 0 ? tr('player.ultimoCapitulo') : tr('player.primeiroCapitulo'));
        return;
      }
      irPara(alvo.inicio);
      mostrarSelo((direcao > 0 ? '▶▶ ' : '◀◀ ') + alvo.titulo);
    }

    /* Shift+N / Shift+P. Navegação explícita, disparada por tecla — a mesma
     * coisa que clicar nos botões da série logo abaixo do player. */
    function irParaEpisodio(direcao) {
      var alvo = direcao > 0 ? g.proximo : g.anterior;
      if (!alvo) {
        mostrarSelo(direcao > 0 ? tr('player.ultimoDaSerie') : tr('player.primeiroDaSerie'));
        return;
      }
      raiz.location.hash = '#/ep/' + encodeURIComponent(alvo.id);
    }

    function executar(acao) {
      switch (acao.acao) {
        case 'alternarPlay':
          alternarPlay();
          break;
        case 'pular':
          irPara(AppPlayerCore.tempoRelativo(video.currentTime, acao.segundos, duracao()));
          mostrarSelo((acao.segundos < 0 ? '◀◀ ' : '▶▶ ') + Math.abs(acao.segundos) + ' s');
          break;
        case 'irPara':
          irPara(acao.segundos);
          mostrarSelo(App.formatarTempo(acao.segundos));
          break;
        case 'irParaFim':
          irPara(duracao());
          mostrarSelo(tr('player.fim'));
          break;
        case 'irParaDecimo': {
          var t = AppPlayerCore.tempoPorDecimo(acao.digito, duracao());
          if (t == null) return;           /* sem duração não dá para calcular */
          irPara(t);
          mostrarSelo(acao.digito * 10 + '%');
          break;
        }
        case 'volume': ajustarVolume(acao.passo); break;
        case 'velocidade': ajustarVelocidade(acao.passo); break;
        case 'alternarMudo':
          definirMudo(!video.muted);
          mostrarSelo(video.muted ? tr('player.mudo') : tr('player.somLigado'));
          break;
        case 'alternarLegenda': alternarLegenda(); break;
        case 'corpoLegenda': ajustarCorpoLegenda(acao.passo); break;
        case 'alternarTelaCheia': telaCheia(); break;
        case 'alternarTeatro': alternarTeatro(); break;
        case 'capitulo': irParaCapitulo(acao.direcao); break;
        case 'episodio': irParaEpisodio(acao.direcao); break;
      }
    }

    /* O foco está num campo de texto? É a trava mais importante da fase: o
     * site tem uma busca no topo de todas as telas, e sem isto digitar
     * "futebol" silenciaria o vídeo, pularia para 60% e mudaria a velocidade. */
    function digitando(alvo) {
      if (!alvo) return false;
      if (alvo.isContentEditable) return true;
      var tag = (alvo.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    }

    function aoTeclar(ev) {
      if (destruido || ev.defaultPrevented) return;
      var acao = AppPlayerCore.acaoDeTecla({
        key: ev.key,
        shiftKey: ev.shiftKey,
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        altKey: ev.altKey,
        digitando: digitando(ev.target),
        emBotao: !!(ev.target && ev.target.closest && ev.target.closest('button'))
      });
      if (!acao) return;
      /* Só depois de saber que a tecla é nossa. Barra de espaço rola a página,
       * setas rolam a página, Home e End vão para o topo e o fim do documento:
       * tudo isso tem que ser cancelado, mas apenas quando agimos. */
      ev.preventDefault();
      /* Tecla nossa também é sinal de vida: quem aperta `L` precisa ver a
       * barra andar, e quem aperta `M` precisa ver o alto-falante mudar. */
      acordarControles();
      executar(acao);
    }

    /* No `document`, e não no player: ninguém deveria precisar clicar no vídeo
     * antes de o teclado funcionar. Sai em `destruir()` — a ficha é destruída
     * a cada troca de rota, e um listener por ficha visitada se acumularia. */
    document.addEventListener('keydown', aoTeclar);

    /* ------------------------------------------------------------- ligação */

    bPlay.addEventListener('click', alternarPlay);

    /* As setas caem em `irParaCapitulo`, a MESMA função do `Ctrl`+seta e do
     * gesto de dois dedos. Nada de caminho novo: o botão da esquerda recomeça
     * o capítulo quando já se andou nele, mostra "Primeiro capítulo" quando
     * não há para onde ir, e nunca chama play() — as três coisas vêm de graça
     * por ser a mesma função, e é por isso que o botão foi ligado nela em vez
     * de ganhar lógica própria. */
    if (bCapAnt) {
      bCapAnt.addEventListener('click', function () { irParaCapitulo(-1); });
      bCapProx.addEventListener('click', function () { irParaCapitulo(1); });
    }

    bCC.addEventListener('click', alternarLegenda);

    /* ------------------------------------------------ ligação do som (fase 4) */

    var painelAberto = false;

    function mostrarPainel(sim) {
      painelAberto = !!sim;
      painel.hidden = !painelAberto;
      bMudo.setAttribute('aria-expanded', painelAberto ? 'true' : 'false');
    }
    bMudo.setAttribute('aria-expanded', 'false');

    /* Onde existe ponteiro, o painel abre de passagem e o clique continua
     * silenciando — mudar o que o alto-falante faz no clique seria trocar um
     * gesto que todo mundo já conhece por um que ninguém pediu. O clique
     * TAMBÉM abre o painel: num laptop com tela sensível ao toque o
     * `hover: hover` é verdadeiro e mesmo assim ninguém passa o ponteiro. */
    somCaixa.addEventListener('pointerenter', function (ev) {
      if (semHover || ev.pointerType === 'touch') return;
      mostrarPainel(true);
    });
    /* Foco de TECLADO dentro do painel — e não foco de qualquer origem, que é o
     * que estava escrito aqui e virou defeito (relatado em 04/09).
     *
     * A guarda antiga perguntava `painel.contains(document.activeElement)`, e
     * ela existe pelo motivo certo: quem chega ao controle deslizante pelo Tab
     * tira o ponteiro dali, e o painel sumiria com o foco dentro. Só que
     * `activeElement` também fica no controle depois de um CLIQUE nele — então
     * quem mexia no volume com o mouse deixava foco para trás e o painel
     * PARAVA de fechar ao sair. Sem clique fechava; com clique, não.
     *
     * `:focus-visible` é a pergunta certa, e é o próprio navegador respondendo:
     * verdadeiro para quem chegou pelo Tab, falso para quem clicou. É a MESMA
     * distinção que o CSS daqui já usa para desenhar o anel de foco. Conferido
     * no navegador em 04/09: depois de um clique na caixinha do Volume Estável,
     * `matches(':focus-visible')` devolve false.
     *
     * Navegador sem `:focus-visible` cai na linha antiga, de propósito: ela
     * erra para o lado de não arrancar o painel de quem está no teclado, que é
     * o erro mais barato dos dois. */
    function focoDeTecladoNoPainel() {
      try { return !!painel.querySelector(':focus-visible'); }
      catch (e) { return painel.contains(document.activeElement); }
    }

    somCaixa.addEventListener('pointerleave', function (ev) {
      if (semHover || ev.pointerType === 'touch') return;
      /* Botão apertado é ARRASTO em curso, e o ponteiro sair do painel no meio
       * dele é comum: a linha do volume tem 26 px de altura e a mão transborda
       * para cima ou para baixo sem querer. Fechar aqui mataria o arrasto pela
       * metade, com o volume onde ele parou.
       *
       * Conferido no navegador em 04/09: o `pointerleave` chega MESMO com
       * `buttons: 1`, e chega de novo com `buttons: 0` quando o botão solta —
       * é esse segundo que fecha o painel. */
      if (ev.buttons) return;
      if (focoDeTecladoNoPainel()) return;
      mostrarPainel(false);
    });

    bMudo.addEventListener('click', function () {
      if (semHover) { mostrarPainel(!painelAberto); return; }
      definirMudo(!video.muted);
      mostrarPainel(true);
    });

    /* Tocar em qualquer outro lugar do player fecha o painel. Sem isto, num
     * aparelho sem ponteiro ele só fecharia pelo próprio botão. */
    caixa.addEventListener('pointerdown', function (ev) {
      if (!painelAberto) return;
      if (somCaixa.contains(ev.target)) return;
      mostrarPainel(false);
    });

    bMudoPainel.addEventListener('click', function () { definirMudo(!video.muted); });

    /* `input` e não `change`: o volume tem que seguir o dedo, não esperar ele
     * soltar. Quem escreve em `localStorage` é o agendador, com folga. */
    faixaVol.addEventListener('input', function () {
      var via = definirVolume((Number(faixaVol.value) || 0) / 100);
      /* O painel já mostra o número; o selo só entra quando há má notícia. */
      if (via === 'nenhuma') mostrarSelo(AppPlayerCore.rotuloVolume({ via: via, volume: som.volume }));
    });

    caixaEstavel.addEventListener('change', function () {
      definirEstavel(caixaEstavel.checked);
    });

    bCheia.addEventListener('click', telaCheia);

    barra.addEventListener('pointerdown', aoDescer);
    barra.addEventListener('pointermove', aoMover);
    barra.addEventListener('pointerup', aoSubir);
    barra.addEventListener('pointercancel', aoSubir);
    barra.addEventListener('pointerleave', esconderDica);

    /* ---------------------------------------- ligação dos gestos (fase 5) */

    /* Chegar aos controles pelo Tab traz tudo de volta: um elemento focado e
     * invisível é o pior resultado possível para quem usa teclado. */
    controles.addEventListener('focusin', acordarControles);

    bTrava.addEventListener('click', function () { travar(!travado); });

    /* A tela cheia pode ser pedida pelo botão, pela tecla F ou desfeita pelo
     * Esc e pelo botão do sistema — os três chegam aqui, e é por isso que
     * quem decide o estado é o evento, e não quem chamou `telaCheia()`. */
    document.addEventListener('fullscreenchange', aoTrocarTelaCheia);
    document.addEventListener('webkitfullscreenchange', aoTrocarTelaCheia);

    /* A aba que volta é o momento em que o contexto costuma estar suspenso —
     * é o próprio sistema que o suspende quando a página sai da frente. Voltar
     * NÃO é um gesto, então o `resume()` daqui pode não pegar; por isso o vigia
     * é rearmado junto, e ele faz as duas coisas que faltam: tenta de novo
     * meio segundo depois e, se ainda não estiver tocando, põe o recado
     * honesto no painel em vez de deixar o vídeo mudo em silêncio.
     *
     * Só para quem TEM grafo: sem ele não há nada para acordar. */
    function aoVoltarVisivel() {
      if (destruido || document.hidden || !som.ativo) return;
      acordarSom();
      vigiarContexto();
    }
    document.addEventListener('visibilitychange', aoVoltarVisivel);

    caixa.addEventListener('pointerdown', function (ev) {
      acordarControles();
      if (destruido || !foraDosControles(ev)) return;
      medirQuadro();
      var acao = gestos.descer(pontoDoEvento(ev));
      agendarSegurar();
      aoGesto(acao);
    });

    caixa.addEventListener('pointermove', function (ev) {
      if (destruido) return;
      /* Ponteiro andando por cima do quadro é sinal de vida. No toque este
       * evento só chega com o dedo na tela, e aí vale a mesma coisa. */
      acordarControles();
      var acao = gestos.mover(pontoDoEvento(ev));
      /* Vale para o arrasto e para a pinça: os dois continuam com o dedo fora
       * do quadro, e os dois precisam que o navegador não faça mais nada com
       * aquele ponteiro. */
      if (acao && (acao.acao === 'arrastar' || acao.acao === 'zoom') &&
        acao.fase === 'inicio') {
        cancelarSegurar();
        /* O arrasto continua valendo com o dedo fora do quadro — o mesmo
         * `setPointerCapture` que a barra usa desde a fase 0. Só AQUI, e não
         * no `pointerdown`: capturar todo toque roubaria o `pointerenter` do
         * painel de som de quem usa o mouse com o botão apertado. */
        if (caixa.setPointerCapture) {
          try { caixa.setPointerCapture(ev.pointerId); } catch (e) { /* sem captura */ }
        }
        ev.preventDefault();
      }
      aoGesto(acao);
    });

    caixa.addEventListener('pointerup', function (ev) {
      if (destruido) return;
      cancelarSegurar();
      aoGesto(gestos.subir(pontoDoEvento(ev)));
    });

    /* `pointercancel` chega quando o navegador toma o gesto para si — a
     * rolagem da página, o "voltar" da borda, uma chamada entrando. O 2× e o
     * arrasto TÊM que desfazer aqui: sem isto o vídeo ficaria em 2× para
     * sempre, sem nenhum dedo na tela para soltar. */
    caixa.addEventListener('pointercancel', function () {
      if (destruido) return;
      cancelarSegurar();
      aoGesto(gestos.cancelar());
    });

    /* Pressionar e segurar (item 3) é o gesto do 2×. Sem isto o Android abre o
     * menu de contexto do vídeo por cima dele e o `pointercancel` derruba o
     * gesto no meio. E há uma segunda razão, que vale também no computador: o
     * menu nativo do <video> oferece "repetir" e "baixar" — a REGRA 2 e a pull
     * zone, as duas coisas que este player não entrega por fora. */
    caixa.addEventListener('contextmenu', function (ev) {
      if (foraDosControles(ev)) ev.preventDefault();
    });

    /* ONDE PAROU (fase 6): poucas vezes por minuto tocando, e sempre no
     * pause e na saída. Só depois do primeiro play: a ficha aberta num `?t=`
     * e deixada parada não é "parou no meio". */
    var ANOTAR_A_CADA_MS = 15000;
    var jaTocou = false, ultimaAnotacao = 0;
    function anotarOndeParou(agoraMesmo) {
      if (!jaTocou || !cfg.retomar.guardarPosicao) return;
      var agora = Date.now();
      if (!agoraMesmo && agora - ultimaAnotacao < ANOTAR_A_CADA_MS) return;
      ultimaAnotacao = agora;
      gravarOndeParou(item.id, video.currentTime || 0, duracao());
    }
    function aoSairDaPagina() { anotarOndeParou(true); }
    raiz.addEventListener('pagehide', aoSairDaPagina);

    video.addEventListener('timeupdate', function () { pintar(); avisarTempo(); });
    /* O cartão do próximo episódio: com `proximoEpisodio.modo: 'nunca'` (o
     * padrão) a função sai na primeira linha. */
    video.addEventListener('timeupdate', atualizarProximo);
    video.addEventListener('timeupdate', function () { if (!video.paused) anotarOndeParou(false); });
    video.addEventListener('progress', pintarBuffer);
    video.addEventListener('loadedmetadata', function () {
      /* A duração medida pelo Bunny diverge da do catálogo em um ou dois
       * segundos. Antes dela os segmentos foram desenhados com a do catálogo,
       * que é o que existe com `preload: none`; agora dá para acertar. */
      montarSegmentos();
      pintar();
      pintarBuffer();
      /* E agora existe `videoWidth`: até aqui o limite do arrasto da imagem
       * ampliada estava usando o quadro como palpite. Remedir é uma linha e
       * acerta a proporção antes de qualquer pinça. */
      medirQuadro();
    });
    /* Play e pause são os dois momentos em que a resposta de
     * `podeEsconderControles` muda: dar play começa a contagem, pausar traz
     * tudo de volta e a mantém parada. */
    video.addEventListener('play', function () { jaTocou = true; sincronizarPlay(); acordarControles(); });
    video.addEventListener('pause', function () { sincronizarPlay(); acordarControles(); anotarOndeParou(true); });
    video.addEventListener('waiting', function () { caixa.classList.add('pl-esperando'); });
    video.addEventListener('playing', function () { caixa.classList.remove('pl-esperando'); });

    /* REGRA 3, escrita como AUSÊNCIA de código: NÃO existe listener do fim do
     * vídeo neste projeto, em arquivo nenhum, e há teste varrendo os quatro
     * atrás da string. Isto não é excesso de zelo — é o que garante que nunca
     * vai existir um lugar conveniente para alguém pendurar um "próximo
     * episódio" automático.
     *
     * O botão continua certo no fim sem esse listener: a especificação manda o
     * navegador marcar `paused` e disparar `pause` ANTES de `ended`, então
     * `sincronizarPlay` já roda pelo listener de `pause` logo acima. */

    /* Clicar no quadro dá play/pause, como em qualquer player — mas desde a
     * fase 5 quem trata isso é a camada de gestos, lá em cima, e não um
     * `click` no <video>.
     *
     * A troca não é gosto: com o `click` do elemento, um toque duplo na
     * lateral disparava DOIS play/pause além do pulo de 5 s, e a tela piscava
     * a cada gesto. Play/pause no toque passou a ser o que ele sempre foi na
     * decisão da máquina: um toque simples, no centro do quadro. */

    /* -------------------------------------------------------------- fonte */

    /* Todo caminho que dá fonte ao <video> passa por aqui logo depois — o
     * HLS nativo, o MP4 e o hls.js depois do `attachMedia`. É aqui que o
     * pedido do "Assistir" guardado por `tocar()` é atendido: o <video> já
     * tem de onde tocar, e a troca de fonte não tem mais play nenhum para
     * cancelar. Só com o vídeo parado — se alguém apertou o play nesse meio
     * tempo, o pedido já foi atendido, e atendê-lo de novo seria pausar. */
    function aoLigarFonte() {
      temFonte = true;
      carregouFonte = true;
      if (destruido) return;
      /* O início sem gesto também espera a fonte, pelo mesmo motivo do
       * "Assistir": um play dado antes da fonte é cancelado pela carga. */
      if (inicioAutomaticoPendente) {
        var origem = inicioAutomaticoPendente;
        inicioAutomaticoPendente = '';
        tocarAutomatico(origem);
        return;
      }
      if (!tocarQuandoLigar) return;
      tocarQuandoLigar = false;
      if (video.paused) alternarPlay();
    }

    /* Último recurso: MP4 progressivo. Sem qualidade adaptativa e pesado —
     * 360p para não afogar a rede. */
    function cairParaMp4(motivo) {
      if (destruido) return;
      limparEsperaDeRede();
      if (!urlMp4) { falharAoCarregar(motivo); return; }
      if (hls) { hls.destroy(); hls = null; }
      usandoMp4 = true;
      video.src = urlMp4;
      carregouAlgo = true;
      avisar('');
      aoLigarFonte();
    }

    /* SEM MAIS PARA ONDE IR: mensagem amigável e um botão para tentar de novo.
     * Não toca em nada (nem play) e não mexe no que a pessoa já escolheu. */
    function falharAoCarregar() {
      if (destruido) return;
      limparEsperaDeRede();
      if (hls) { hls.destroy(); hls = null; }
      avisar('');
      caixa.classList.remove('pl-esperando');
      caixa.classList.add('pl-falhou');
      painelErro.hidden = false;
      inicioAutomaticoPendente = '';
      tocarQuandoLigar = false;
      try { video.pause(); } catch (e) { /* sem vídeo */ }
    }

    /* "Tentar de novo" é um clique. Refaz a fonte do zero; quem quiser tocar
     * aperta o play, como em qualquer ficha. */
    function tentarDeNovo() {
      if (destruido) return;
      painelErro.hidden = true;
      caixa.classList.remove('pl-falhou');
      if (hls) { hls.destroy(); hls = null; }
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* alguns navegadores reclamam */ }
      carregouAlgo = false; temFonte = false; usandoMp4 = false; falhasDeRede = 0;
      ligarFonte();
    }
    bRecarregar.addEventListener('click', tentarDeNovo);

    var falhasDeRede = 0;
    var manifestoOk = false;
    var esperaDeRede = 0;
    var ESPERA_REDE_MS = 20000;
    function limparEsperaDeRede() {
      if (esperaDeRede) { clearTimeout(esperaDeRede); esperaDeRede = 0; }
    }
    video.addEventListener('error', function () {
      if (destruido || !video.error) return;
      /* O arquivo/stream falhou por baixo do hls.js ou do MP4: tenta o MP4
       * uma vez; se já era ele, ou não há, é falha. */
      if (!usandoMp4 && urlMp4) { cairParaMp4(tr('player.problemaDeReproducao')); return; }
      falharAoCarregar();
    });

    /* HLS nativo, para quem não tem MSE — na prática o iPhone, onde o Safari
     * toca de verdade. Só é escolhido quando o hls.js está fora de questão. */
    function cairParaNativoOuMp4() {
      if (destruido) return;
      if (urlHls && temHlsNativo(video)) { video.src = urlHls; aoLigarFonte(); return; }
      cairParaMp4('');
    }

    function ligarFonte() {
      if (!urlHls) { cairParaMp4(''); return; }

      var caminho = AppPlayerCore.estrategia({
        /* Checagem barata, antes de baixar 353 KB para nada. */
        mseDisponivel: typeof raiz.MediaSource !== 'undefined',
        hlsNativo: temHlsNativo(video)
      });

      if (caminho === 'nativo') { video.src = urlHls; aoLigarFonte(); return; }
      if (caminho === 'mp4') { cairParaMp4(''); return; }

      carregarHls().then(function (Hls) {
        if (destruido) return;
        /* `MediaSource` existir não garante os codecs. `isSupported()` é a
         * palavra final, e só o hls.js carregado sabe dá-la. */
        if (!Hls.isSupported()) { cairParaNativoOuMp4(); return; }
        hls = new Hls(AppPlayerCore.configHls());
        manifestoOk = false;
        hls.on(Hls.Events.MANIFEST_PARSED, function () { manifestoOk = true; });
        hls.on(Hls.Events.FRAG_LOADED, function () { falhasDeRede = 0; manifestoOk = true; limparEsperaDeRede(); });
        hls.on(Hls.Events.ERROR, function (_e, dados) {
          if (!dados || !dados.fatal) return;      /* o hls.js recupera sozinho */
          if (dados.type === Hls.ErrorTypes.NETWORK_ERROR) {
            /* `startLoad()` NÃO refaz o manifesto que falhou: sem manifesto (404,
             * rede abortada) não há o que retomar, e é falha na hora — com
             * mensagem. Com manifesto, rede que cai e volta se recupera; rede
             * que não volta, não: três tentativas seguidas, ou o tempo limite
             * sem nenhum segmento novo, e é falha. */
            if (!manifestoOk || ++falhasDeRede > 3) { cairParaMp4(tr('player.problemaDeReproducao')); return; }
            if (!esperaDeRede) {
              esperaDeRede = setTimeout(function () {
                esperaDeRede = 0;
                if (!destruido && hls) cairParaMp4(tr('player.problemaDeReproducao'));
              }, ESPERA_REDE_MS);
            }
            hls.startLoad();
            return;
          }
          if (dados.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          cairParaMp4(tr('player.problemaDeReproducao'));
        });
        hls.loadSource(urlHls);
        hls.attachMedia(video);
        /* O PLAY QUE CHEGOU ANTES DA BIBLIOTECA — de quem apertou o play da
         * primeira ficha de uma visita antes de o `vendor/hls.light.min.js`
         * chegar, numa rede lenta. `alternarPlay` só libera o download se o
         * hls.js já existe, e ele nasce aqui. Sem esta linha o vídeo ficava
         * querendo tocar (`paused` falso, o botão dizendo "Pausar", a rodinha
         * girando) sem nenhum segmento pedido, para sempre. Medido em 21/09,
         * com o clique dado antes de o `Hls` existir: cinco segundos depois,
         * `readyState` 0 e só o playlist mestre na rede. Quem clicava de novo
         * PAUSAVA, e só o terceiro clique tocava.
         *
         * `startLoad()` antes do manifesto é seguro no hls.js 1.6: ele marca o
         * pedido (`forceStartLoad`) e começa quando o manifesto chega. E o
         * vídeo continua querendo tocar depois do `attachMedia` porque a
         * biblioteca chega numa TAREFA POSTERIOR ao clique: até lá o <video>
         * voltou a `networkState` vazio, e um elemento vazio troca de fonte sem
         * voltar a pausar. O "Assistir" não passa por aqui, e não pode — o
         * `tocar()` explica por quê. */
        if (!video.paused) liberarDownload();
        aoLigarFonte();
      }).catch(cairParaNativoOuMp4);
    }

    /* `ligarFonte` é chamado de novo por `tentarDeNovo`; a primeira chamada
     * acontece logo abaixo. */

    ligarFonte();

    /* Quem pediu ao player um início sem gesto (autoplay da config, ou o
     * próximo episódio que a ficha anterior abriu): o guardião decide JÁ, para
     * não deixar uma espera armada à toa, e `tocarAutomatico` decide de novo
     * quando a fonte chega. Com a config padrão, nada disto faz nada. */
    var origemDoInicio = g.origemDoInicio === 'proximo-episodio' ? 'proximo-episodio' : 'autoplay';
    if (AppPlayerCore.podeIniciarSozinho(contextoDeInicio(origemDoInicio), config)) {
      if (temFonte) tocarAutomatico(origemDoInicio);
      else inicioAutomaticoPendente = origemDoInicio;
    }

    /* A pergunta de retomar espera um instante: o app.js pode pedir um momento
     * (`?t=`) logo depois de criar o player, e esse pedido manda mais. */
    var esperaRetomada = cfg.retomar.modo === 'perguntar' ? setTimeout(oferecerRetomada, 0) : 0;

    /* Antes do `pintar()`: sem os segmentos montados não há onde pintar o
     * primeiro quadro da barra. A duração vem do catálogo — é o que deixa os
     * capítulos desenhados corretamente com `preload: none` e zero byte de
     * vídeo baixado. */
    montarSegmentos();
    pintar();
    sincronizarPlay();
    sincronizarCC();

    /* O volume guardado vale desde já no que dá para valer SEM grafo. O que
     * passa de 100% e o Volume Estável esperam o primeiro play, que é o gesto
     * que o AudioContext exige — montar aqui seria montar sem gesto, e o
     * contexto nasceria suspenso com o áudio já capturado. */
    if (som.volume <= 1) { try { video.volume = som.volume; } catch (e) { /* iOS */ } }
    sincronizarSom();
    definirMudo(video.muted);

    /* O corpo da letra escolhido da última vez vale desde o primeiro quadro. */
    caixa.style.setProperty('--pl-leg', String(legenda.escala));

    /* ÚNICA exceção ao "nada de rede antes de alguém pedir": se a preferência
     * guardada diz que a legenda está ligada, ela É o pedido — feito numa
     * sessão anterior. E tem que chegar ANTES do primeiro quadro, senão as
     * primeiras falas passam sem legenda justamente para quem depende dela.
     * São dezenas de KB de texto, não o vídeo. */
    if (pref && pref.ligada) ligarLegendaBaixando(true);

    function destruir() {
      if (destruido) return;
      destruido = true; limparEsperaDeRede();
      if (esperaRetomada) { clearTimeout(esperaRetomada); esperaRetomada = 0; }
      /* Sair da ficha é o último "onde parou" — e o ouvinte da janela sai
       * junto, como os outros daqui. */
      anotarOndeParou(true);
      raiz.removeEventListener('pagehide', aoSairDaPagina);
      document.removeEventListener('keydown', aoTeclar);
      /* Sem isto a grade voltaria em coluna única depois de sair da ficha em
       * modo teatro — a classe é do <body>, não do player. */
      document.body.classList.remove('app-teatro');
      /* Gestos (fase 5). Os dois ouvintes de tela cheia são do `document`,
       * como o do teclado: sem tirá-los, um por ficha visitada se acumularia,
       * e cada um apontaria para o `caixa` de uma ficha que não existe mais. */
      document.removeEventListener('fullscreenchange', aoTrocarTelaCheia);
      document.removeEventListener('webkitfullscreenchange', aoTrocarTelaCheia);
      /* Do `document` como os outros dois, e pelo mesmo motivo: um por ficha
       * visitada se acumularia, cada um apontando para o som de uma ficha que
       * não existe mais. */
      document.removeEventListener('visibilitychange', aoVoltarVisivel);
      /* Da janela, e pela mesma razão dos outros: um por ficha visitada se
       * acumularia, cada um remedindo o quadro de uma ficha que não existe. */
      raiz.removeEventListener('resize', aoRedimensionar);
      cancelarSegurar();
      cancelarSumico();
      /* O relógio do quadro no hover (04/09). Sem isto ele acordaria depois da
       * saída da ficha e pediria um quadro a um <video> que já morreu. */
      cancelarQuadroHover();
      if (seloEspera) { clearTimeout(seloEspera); seloEspera = 0; }
      /* Som (fase 4). */
      if (som.espera) { clearTimeout(som.espera); som.espera = 0; }
      if (gravacaoSom) {
        /* Sair da ficha no meio dos 300 ms de folga não pode perder o volume
         * que a pessoa acabou de escolher. */
        clearTimeout(gravacaoSom); gravacaoSom = 0;
        gravarPreferenciaSom(som.volume, som.estavel);
      }
      /* Fechar o AudioContext é obrigatório, e pelo MESMO motivo do
       * `hls.destroy()` logo abaixo: o navegador limita quantos contextos uma
       * página pode ter — a ordem de meia dúzia —, e um por ficha visitada
       * esgota a conta em seis idas e voltas entre a grade e a ficha.
       *
       * O `<video>` desta ficha morre junto, então não há o que devolver: a
       * captura sem volta do `createMediaElementSource` termina aqui. */
      if (som.ctx) {
        try { som.ctx.close(); } catch (e) { /* já fechado */ }
        som.ctx = null; som.fonte = null;
        som.ganho = null; som.nivel = null; som.limite = null; som.molde = null;
        som.ativo = false;
      }
      if (ultimoSom && ultimoSom.som === som) ultimoSom = null;
      /* Os inscritos são funções da FICHA (a lista de capítulos). Ela vai
       * embora junto, mas soltar a lista aqui é o que garante que nada do
       * player continue chamando código de uma tela que não existe mais. */
      ouvintesTempo.length = 0;
      if (legenda.faixa) {
        legenda.faixa.removeEventListener('cuechange', pintarLegenda);
        legenda.faixa.mode = 'disabled';
        legenda.faixa = null;
      }
      video.pause();
      /* A prévia do arrasto (item 6) é um SEGUNDO elemento de mídia por ficha,
       * e morre com o mesmo rigor do primeiro: sem tirar o src e chamar load(),
       * a faixa de bytes em andamento continuaria vindo da pull zone para uma
       * ficha que já saiu da tela. */
      previa.morto = true;
      previa.pedido = null;
      if (previa.espera) { clearTimeout(previa.espera); previa.espera = 0; }
      previaQuadro.removeAttribute('src');
      try { previaQuadro.load(); } catch (e) { /* alguns navegadores reclamam */ }
      if (hls) { hls.destroy(); hls = null; }
      /* Tirar o src E chamar load() é o que aborta um download em andamento.
       * Só remover o nó deixaria a requisição viva até o fim. */
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* alguns navegadores reclamam; tudo bem */ }
      if (caixa.parentNode) caixa.parentNode.removeChild(caixa);
    }

    return {
      no: caixa, video: video, destruir: destruir,
      /* Quem chama de fora (o app.js, com o `?t=` do link ou um capítulo
       * clicado) pediu um momento: ele manda mais do que o "onde parou". */
      irPara: function (segundos) { pediuMomento = true; irPara(segundos); },
      aoTempo: aoTempo, tocar: tocar
    };
  }

  /* Uma torneira para MEDIR o áudio em aparelho, sem tocar no caminho audível.
   *
   * Existe por uma razão prática e imediata: o risco que sobrou da fase 4 é o
   * iOS, e a medida que se planejava — montar um
   * `createMediaElementSource` no console do Safari — agora LANÇA
   * `InvalidStateError`, porque o elemento já está capturado pelo nosso grafo.
   * Um elemento só pode ser capturado uma vez. Sem isto, a primeira coisa que
   * quem tiver o iPhone à mão fosse tentar daria um erro que parece bug e não
   * é.
   *
   * Com o vídeo TOCANDO, no console:
   *
   *     AppPlayer.medir().then(console.log)
   *
   *   { via: 'ganho', estado: 'running', pico: 0.4 }  → o som sai pelo grafo
   *   { via: 'ganho', estado: 'running', pico: 0 }    → é o bug do Safari:
   *        o grafo montou, o contexto está tocando e mesmo assim não passa
   *        sinal. A fase 4 vai para o plano B —
   *        `som.possivel = false` no iOS, e o volume volta a ser só do
   *        elemento, com o aviso honesto que o painel já sabe dar.
   *   { via: 'elemento' }  → o grafo nem foi montado; mexa no volume primeiro.
   */
  function medirSom() {
    var alvo = ultimoSom;
    if (!alvo || !alvo.som.ativo || !alvo.som.ctx) {
      return Promise.resolve({
        via: alvo ? 'elemento' : 'sem player', /* i18n-ignorar: código interno (diagnóstico), não texto de tela */
        estado: alvo && alvo.som.ctx ? alvo.som.ctx.state : null,
        pico: null
      });
    }

    var s = alvo.som;
    var ctx = s.ctx;
    var an = ctx.createAnalyser();
    an.fftSize = 2048;

    /* O analisador precisa estar no caminho até a saída para ser processado —
     * um ramo solto pode nunca ser puxado. O ganho zero no fim é o que deixa
     * ele no caminho sem somar nada ao que se ouve. */
    var sumidouro = ctx.createGain();
    sumidouro.gain.value = 0;
    s.molde.connect(an);
    an.connect(sumidouro);
    sumidouro.connect(ctx.destination);

    var buf = new Float32Array(an.fftSize);
    return new Promise(function (resolve) {
      setTimeout(function () {
        an.getFloatTimeDomainData(buf);
        var pico = 0;
        for (var i = 0; i < buf.length; i++) {
          var v = Math.abs(buf[i]);
          if (v > pico) pico = v;
        }
        /* `disconnect(an)` e não `disconnect()`: sem o argumento, o moldador
         * largaria TAMBÉM a saída, e medir o som deixaria o vídeo mudo. */
        try { s.molde.disconnect(an); } catch (e) { /* já solto */ }
        try { an.disconnect(); sumidouro.disconnect(); } catch (e2) { /* idem */ }
        resolve({
          via: 'ganho',
          estado: ctx.state,
          pico: Math.round(pico * 1000) / 1000,
          ganho: s.ganho.gain.value,
          estavel: s.estavel,
          /* `true` = o moldador está no caminho, ou seja, há reforço. */
          moldador: !!s.molde.curve,
          nivelador: s.nivel.reduction,
          limitador: s.limite.reduction
        });
      }, 800);
    });
  }

  /* A chave da fase 0, INVERTIDA em 03/09: o player nosso é o padrão, e
   * `?player=embed` é a saída de emergência que devolve o iframe do Bunny.
   *
   * A saída fica, e não é excesso de zelo. O embed é a única coisa que continua
   * funcionando se algo daqui quebrar num navegador que ninguém testou, em pleno uso — e ela cabe numa URL que dá para ditar em voz alta.
   * `?player=novo` continua valendo, e cai no padrão: link antigo não quebra.
   *
   * O `catch` devolve o EMBED de propósito. Um navegador sem
   * `URLSearchParams` é velho o bastante para provavelmente não dar conta do
   * player novo — mandá-lo para o iframe é a resposta certa, não a covarde. */
  function playerNovoPedido() {
    try {
      return new URLSearchParams(raiz.location.search).get('player') !== 'embed';
    } catch (e) {
      return false;
    }
  }

  raiz.AppPlayer = { criar: criarPlayer, pedido: playerNovoPedido, medir: medirSom };
})(typeof globalThis !== 'undefined' ? globalThis : this);
