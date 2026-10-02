/* app.js — catálogo público interno: grade, busca, ficha do título.
 *
 * Regras de produto que este arquivo tem obrigação de respeitar:
 *   1. nada toca sozinho     -> urlEmbed() força autoplay=false
 *   2. nada repete           -> urlEmbed() força loop=false
 *   3. nada avança sozinho   -> não há NENHUM listener de fim de vídeo aqui,
 *                               e a navegação entre episódios é só por clique.
 */
(function () {
  'use strict';

  var estado = {
    itens: [],
    config: {},
    /* A estrutura escolhida na mesa (M4): nome, ordem e escondida das
     * prateleiras, classe de cada série, o destaque e os textos fixos. Vem
     * SANEADA do servidor, e `{}` significa "ninguém escolheu nada" — aí vale
     * o padrão do `catalogo-core.js`, que é a chegada de sempre. */
    site: {},
    /* Quem está olhando (M6): { logado, espectador, minhaLista } — o servidor diz, e a home usa para os
     * blocos "só com conta" e para oferecer a Minha lista. */
    quem: {},
    /* Os ids da Minha lista da pessoa (D1), do guardado mais recente ao mais antigo; `null` = não há lista
     * (sem conta, ou ainda não chegou). */
    minhaLista: null,
    termo: '',
    /* O chip ligado no filtro da grade — '' quando nenhum. Refina a resposta
     * de UMA tela, e trocar de tela o desfaz. */
    serie: '',
    /* O id da prateleira aberta pelo "Ver tudo" — '' na chegada. É o que
     * distingue a tela inicial (prateleiras) de uma resposta (grade). */
    prateleira: '',
    /* A série da rota `#/serie/<nome>` — a página dela desde a D6. Até ali a
     * rota abria a grade da série, e é a MESMA rota: o link guardado continua
     * valendo. */
    serieRota: '',
    /* `#/series`: a página Séries, para onde os chips da chegada foram. */
    indiceSeries: false,
    /* O hash da última tela desenhada, para saber quando se TROCOU de tela. */
    rota: null,
    carregado: false
  };

  var el = {
    topo: document.getElementById('topo'),
    sentinela: document.getElementById('topo-sentinela'),
    pular: document.getElementById('pular'),
    conteudo: document.getElementById('conteudo'),
    busca: document.getElementById('busca'),
    abrirBusca: document.getElementById('busca-abrir'),
    fecharBusca: document.getElementById('busca-fechar'),
    linkInicio: document.querySelector('.topo-link[data-inicio]'),
    linkSeries: document.querySelector('.topo-link[href="#/series"]'),
    avisos: document.getElementById('avisos'),
    grade: document.getElementById('conteudo-grade'),
    ficha: document.getElementById('conteudo-ficha')
  };

  /* A tradução: `tr` é o AppI18n.t deste arquivo (o nome `t` aparece como variável
   * local em vários pontos). O idioma e o catálogo chegam em `iniciar()`. */
  var I18n = window.AppI18n;
  function tr(chave, params) { return I18n.t(chave, params); }
  /* "Sem série" e afins: rótulo de tela E chave de agrupamento do core. */
  var semSerie = App.semSerie;

  /* O título-base das abas: "{marca} — catálogo" no idioma de agora. */
  var TITULO_BASE = '';

  /* config.public.json é GERADO de config/site.json (scripts/aplicar-config.mjs)
   * e traz só o que o navegador pode ver: nome da marca, título-base, rodapé.
   * É um complemento: se não vier (rede, arquivo ausente, JSON torto), o site
   * segue com os textos escritos aqui e no catalogo-core.js, como antes. */
  var CONFIG_PUBLICA = null;

  /* O IDIOMA e a config pública chegam juntos: `iniciarNoNavegador` lê
   * config.public.json, escolhe o idioma (?idioma= > escolha guardada > navegador,
   * se o cliente ligou > padrão) e baixa só o catálogo de textos dele — que o
   * aplicar-config já deixou com os textos do cliente por cima. */
  function carregarIdioma() {
    return I18n.iniciarNoNavegador({ chaveSalva: App.PREFIXO + ':idioma' }).then(function (r) {
      CONFIG_PUBLICA = r.publica && typeof r.publica === 'object' ? r.publica : null;
      TITULO_BASE = tr('site.tituloBase');
      I18n.aplicarNoDocumento(document);
      ligarSeletorIdioma(r);
      if (estado.carregado) pintarRodape();
      pintarLinkDaConta();
      return r;
    });
  }

  /* O seletor aparece quando há mais de um idioma e o cliente não o escondeu.
   * Trocar recarrega a página (os textos são desenhados uma vez) e guarda a
   * escolha. Dentro da mesa ele fica escondido: o idioma da mesa é o da pessoa
   * que edita, escolhido na mesa, e não o do site em edição. */
  function ligarSeletorIdioma(r) {
    var caixa = document.getElementById('idioma-caixa');
    var sel = document.getElementById('idioma');
    var idi = (CONFIG_PUBLICA && CONFIG_PUBLICA.idiomas) || {};
    if (!caixa || !sel || mesa.ligada || r.disponiveis.length < 2 || idi.seletorVisivel === false) return;
    limpar(sel);
    r.disponiveis.forEach(function (id) {
      var o = criar('option', null, I18n.rotuloDoIdioma(id));
      o.value = id;
      if (id === r.idioma) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      I18n.trocarIdioma(sel.value, { chaveSalva: App.PREFIXO + ':idioma' });
    });
    caixa.hidden = false;
  }

  /* ------------------------------------------------------------- modo mesa
   *
   * O /admin mostra o site dentro de um <iframe> com `?mesa=1`. Nesse modo a página não busca a API: recebe da mesa o catálogo com
   * o rascunho aplicado, marca o que é editável com `data-mesa` e avisa a mesa
   * de cada clique. Quem desenha continua sendo este arquivo — nada é
   * desenhado duas vezes.
   *
   * As duas travas: fora de um quadro, `?mesa=1` não liga nada; e mensagem só
   * vale se vier da própria origem E da janela de cima. */
  var mesa = {
    ligada: window.parent !== window && /[?&]mesa=1(&|$)/.test(window.location.search),
    selecao: '',
    /* Quem não tem a permissão de conteúdo vê a ficha, mas não digita nela.
     * Quem recusa de verdade é o servidor; isto é para o texto não mudar na
     * tela e depois voltar atrás. */
    editavel: true
  };

  function avisarMesa(msg) {
    if (!mesa.ligada) return;
    msg.app = 'mesa';
    window.parent.postMessage(msg, window.location.origin);
  }

  function marcarMesa(no, alvo) {
    if (!mesa.ligada || !no) return no;
    no.setAttribute('data-mesa', alvo);
    if (mesa.selecao === alvo) no.classList.add('mesa-sel');
    return no;
  }

  function pintarSelecao() {
    var velhos = document.querySelectorAll('.mesa-sel');
    for (var i = 0; i < velhos.length; i++) velhos[i].classList.remove('mesa-sel');
    if (!mesa.selecao) return;
    var novos = document.querySelectorAll('[data-mesa="' + CSS.escape(mesa.selecao) + '"]');
    for (var j = 0; j < novos.length; j++) novos[j].classList.add('mesa-sel');
  }

  /* Rola até o alvo SEM scrollIntoView: dentro de um quadro, ele rola também a
   * página de fora, e a mesa inteira sairia do lugar. */
  function rolarAteMesa(alvo) {
    var no = document.querySelector('[data-mesa="' + CSS.escape(alvo) + '"]');
    if (!no) return;
    var pista = no.closest('.prateleira-pista');
    if (pista) pista.scrollLeft += no.getBoundingClientRect().left - pista.getBoundingClientRect().left - 16;
    window.scrollTo(0, window.scrollY + no.getBoundingClientRect().top - 120);
  }

  /* O player nosso — padrão desde 03/09, com `?player=embed` como saída de
   * emergência. Fica aqui fora porque ele tem que ser DESTRUÍDO ao sair
   * da ficha, e não só removido do DOM: tirar o <video> da página para o
   * elemento, mas a instância do hls.js continua viva, com os carregadores
   * dela, puxando segmentos da pull zone para um vídeo que ninguém está vendo.
   * Com o iframe do Bunny isso não existia — remover o nó bastava. */
  var playerAtivo = null;

  function destruirPlayer() {
    if (!playerAtivo) return;
    playerAtivo.destruir();
    playerAtivo = null;
  }

  function playerNovoLigado() {
    return typeof AppPlayer !== 'undefined' && AppPlayer.pedido();
  }

  /* O PLAYER DESCE DEPOIS DA CHEGADA (o LCP da chegada, 23/09).
   * O `player-core.js` e o `player.js` eram <script> do index.html: 77 KB
   * comprimidos baixando e rodando antes do `app.js`, disputando a banda com
   * o catálogo e com a capa do destaque, numa tela que não usa player. Tirá-
   * -los dali valeu −450 ms de LCP no Lighthouse (mediana de 5, servidor
   * local com gzip: 2.618 → 2.165 ms); pô-los em `defer`, só −80.
   *
   * Agora quem os pede é este arquivo, em dois momentos: depois da capa
   * principal da primeira tela (`depoisDaCapaPrincipal`) — quando alguém
   * clica num cartão, eles quase sempre já estão aqui — ou JÁ NO INÍCIO, se o endereço aberto é de uma ficha, em paralelo
   * com o catálogo.
   *
   * Os dois descem juntos e rodam NA ORDEM (`async = false` num script
   * criado pelo JS): o `player.js` usa o `AppPlayerCore` do core.
   *
   * A promessa nunca rejeita: falha de rede resolve do mesmo jeito, e a ficha
   * vê `AppPlayer` indefinido — é a queda automática para o iframe, a mesma
   * de quando o <script> do HTML não carregava. Quem falhou pode tentar de
   * novo na próxima ficha. */
  var ESPERA_PLAYER_MS = 8000;
  var carregandoPlayer = null;

  function carregarPlayer() {
    if (typeof AppPlayer !== 'undefined') return Promise.resolve();
    if (carregandoPlayer) return carregandoPlayer;
    carregandoPlayer = new Promise(function (resolve) {
      var faltam = 3;
      var fim = function (ok) {
        if (!ok) { faltam = 0; carregandoPlayer = null; resolve(); return; }
        if (--faltam === 0) resolve();
      };
      ['guardiao.js', 'player-core.js', 'player.js'].forEach(function (src) {
        /* O guardião pode já estar na página (o fundo do destaque o usa). */
        if (src === 'guardiao.js' && typeof AppGuardiao !== 'undefined') { fim(true); return; }
        var tag = document.createElement('script');
        tag.src = src;
        tag.async = false;
        tag.addEventListener('load', function () { fim(true); });
        tag.addEventListener('error', function () { fim(false); });
        document.head.appendChild(tag);
      });
    });
    return carregandoPlayer;
  }

  /* O FUNDO EM MOVIMENTO DO DESTAQUE (`home.destaque.fundo`, M6). Com o padrão
   * (`capa`) isto não baixa NADA: nem os dois arquivos abaixo. Com `previa-
   * animada` ou `video-mudo`, eles só descem DEPOIS da capa do destaque (o
   * LCP), e quem decide se algo começa é o guardião (guardiao.js), dentro do
   * `montarFundoDoDestaque` (destaque-fundo.js). Devolve `{ destruir }` para
   * o bloco do destaque chamar ao ser redesenhado, ou `null` se não há fundo
   * a montar. Este arquivo não chama `play()`: quem chama é o destaque-fundo. */
  var carregandoFundo = null;

  function carregarFundo() {
    if (typeof montarFundoDoDestaque === 'function') return Promise.resolve();
    if (carregandoFundo) return carregandoFundo;
    carregandoFundo = new Promise(function (resolve) {
      var lista = ['guardiao.js', 'destaque-fundo.js'];
      var fim = function (ok) {
        if (!ok) { carregandoFundo = null; resolve(); return; }
        if (!lista.length) { resolve(); return; }
        proximo();
      };
      var proximo = function () {
        var src = lista.shift();
        if (src === 'guardiao.js' && typeof AppGuardiao !== 'undefined') { fim(true); return; }
        var tag = document.createElement('script');
        tag.src = src;
        tag.async = false;
        tag.addEventListener('load', function () { fim(true); });
        tag.addEventListener('error', function () { fim(false); });
        document.head.appendChild(tag);
      };
      proximo();
    });
    return carregandoFundo;
  }

  function ligarFundoDoDestaque(elDestaque, item) {
    var destaque = estado.config && estado.config.home && estado.config.home.destaque;
    var fundo = destaque && destaque.fundo;
    if (!elDestaque || !item || !fundo || !fundo.tipo || fundo.tipo === 'capa') return null;
    var vivo = {
      montado: null, morto: false,
      destruir: function () {
        vivo.morto = true;
        if (vivo.montado) { vivo.montado.destruir(); vivo.montado = null; }
      }
    };
    depoisDaCapaPrincipal(function () {
      carregarFundo().then(function () {
        if (vivo.morto || typeof window.montarFundoDoDestaque !== 'function') return;
        var comportamento = estado.config;
        vivo.montado = window.montarFundoDoDestaque(elDestaque, item, comportamento);
      });
    });
    return vivo;
  }

  /* O player a tempo para UMA ficha: o carregamento, ou o prazo — o que vier
   * primeiro. Vencido o prazo a ficha sai com o iframe, como sairia com o
   * `player.js` fora do ar; o arquivo que chegar depois serve à próxima.
   * Com `?player=embed` não há o que esperar: o iframe é o pedido. */
  function playerATempo() {
    if (typeof AppPlayer !== 'undefined' ||
        new URLSearchParams(window.location.search).get('player') === 'embed') {
      return null;
    }
    return Promise.race([
      carregarPlayer(),
      new Promise(function (resolve) { setTimeout(resolve, ESPERA_PLAYER_MS); })
    ]);
  }

  /* Depois da CAPA PRINCIPAL da tela — a do destaque na chegada, a do alto
   * na página da série —, que é o LCP. O `load` da janela NÃO serve: ele sai
   * antes de o app.js pôr a capa na página (medido no Lighthouse: `load` aos
   * 73 ms, a capa pedida aos 138), e o player voltava a disputar a banda com
   * ela — o ganho caiu de −450 para −150 ms. Sem capa na tela (a busca, as
   * Séries), o prazo abaixo conta do desenho.
   *
   * E não no `load` da CAPA, mas UM SEGUNDO depois dele. Entre a capa
   * descer e ser pintada (`decoding = async`) ainda passam quadros, e um
   * pedido feito aí entra na conta do LCP do Lighthouse, que o simula como se
   * saísse junto com o app.js — medido: no `load` da capa, 2.646 ms; no
   * `requestIdleCallback` seguinte, 2.562, porque o ócio chega ANTES da
   * pintura (pedido aos 148 ms, pintura aos 179). O segundo não custa nada a
   * ninguém: o player só serve num clique, e o clique que vier antes espera
   * por ele na ficha (`playerATempo`). */
  var ESPERA_DEPOIS_DA_CAPA_MS = 1000;

  function depoisDaCapaPrincipal(fn) {
    var capa = el.grade.querySelector('.destaque-capa img');
    var feito = false;
    var depois = function () {
      if (feito) return;
      feito = true;
      setTimeout(fn, ESPERA_DEPOIS_DA_CAPA_MS);
    };
    if (!capa || capa.complete) { depois(); return; }
    capa.addEventListener('load', depois);
    capa.addEventListener('error', depois);
  }

  /* A ABERTURA. O script do <head> do index.html
   * decide se ela roda e põe `abrindo` no <html>; daqui em diante é este
   * arquivo quem a TIRA — e a folha de estilo a tira sozinha aos 3 s se ele
   * nunca chegar.
   *
   * A camada sai quando a capa do destaque DESCEU, e nunca antes de a marca
   * acender (o mínimo, contado do início da navegação: é desde o primeiro
   * quadro que ela está na tela). Aí o destaque entra como no cinema. Tudo o
   * que foge do caminho feliz solta a camada SEM o cinema: o catálogo que
   * falha, a chegada sem destaque, o teto, um clique ou uma tecla — quem tem
   * pressa não espera a marca —, e uma troca de endereço no meio.
   *
   * NADA AQUI mexe na opacidade da capa: ela é o LCP, e a regra está no
   * style.css, com teste. */
  /* 1,4 s: os .8 da marca entrando e .6 dela parada. Eram 700 ms no
   * primeiro deploy, e a marca só piscava (pedido de 23/09). */
  var ABERTURA_MINIMO_MS = 1400;
  var ABERTURA_TETO_MS = 3000;
  var CINEMA_MS = 1800;
  /* A marca sai primeiro e o fundo espera por ela: os .3 s do style.css. */
  var ESPERA_DO_FUNDO_MS = 300;
  var abertura = { no: null, ligada: false, solta: false, semMarca: false };

  function ligarAbertura() {
    var raiz = document.documentElement.classList;
    abertura.no = document.getElementById('abertura');
    abertura.ligada = !!abertura.no && raiz.contains('abrindo');
    abertura.semMarca = raiz.contains('sem-marca');
    if (!abertura.ligada) return;
    var semCinema = function () { soltarAbertura(false); };
    abertura.no.addEventListener('click', semCinema);
    document.addEventListener('keydown', semCinema);
    window.addEventListener('hashchange', semCinema);
    setTimeout(semCinema, Math.max(0, ABERTURA_TETO_MS - agora()));
  }

  function agora() {
    return window.performance && performance.now ? performance.now() : 0;
  }

  function soltarAbertura(comCinema) {
    if (!abertura.ligada || abertura.solta) return;
    abertura.solta = true;
    var cinema = function () {
      el.grade.classList.add('cinema');
      setTimeout(function () { el.grade.classList.remove('cinema'); }, CINEMA_MS);
    };
    /* No app instalado não há camada: o cinema é a abertura inteira. */
    if (abertura.semMarca) {
      if (comCinema) cinema();
      document.documentElement.classList.remove('abrindo');
      return;
    }
    abertura.no.classList.add('abertura-saindo');
    /* O cinema começa junto com o FUNDO saindo, não com a marca: antes disso
     * ele rodaria escondido. */
    if (comCinema) setTimeout(cinema, ESPERA_DO_FUNDO_MS);
    /* A espera do fundo e os .4 s da saída dele, no style.css. */
    setTimeout(function () { document.documentElement.classList.remove('abrindo'); },
      ESPERA_DO_FUNDO_MS + 450);
  }

  /* Depois do primeiro desenho: a chegada com destaque espera a capa; o
   * resto solta a camada já. */
  function abrirChegada() {
    if (!abertura.ligada || abertura.solta) return;
    var capa = el.grade.querySelector('.destaque:not(.serie-cabeca) .destaque-capa img');
    if (!capa) { soltarAbertura(false); return; }
    /* Sem a camada, esperar a capa só mostraria a página parada e DEPOIS a
     * entrada — um salto. O cinema entra no mesmo quadro em que o destaque
     * é desenhado, e a capa, quando desce, já desce se afastando. */
    if (abertura.semMarca) { soltarAbertura(true); return; }
    var pronto = function () {
      setTimeout(function () { soltarAbertura(true); },
        Math.max(0, ABERTURA_MINIMO_MS - agora()));
    };
    if (capa.complete) { pronto(); return; }
    capa.addEventListener('load', pronto);
    capa.addEventListener('error', pronto);
  }

  /* A vez da ficha: cada renderFicha tira um número, e a que esperou o player
   * só se desenha se ninguém tiver passado na frente — voltar, ou abrir outra
   * ficha, enquanto o arquivo descia. */
  var vezDaFicha = 0;

  /* O PEDIDO DE TOCAR (D6). O "Assistir" do destaque abre a ficha E dá o play
   * — decisão de projeto: o toque em "Assistir" é o pedido, e
   * atendê-lo não é "tocar sozinho".
   *
   * O pedido mora AQUI, numa variável, e não na URL. Um `#/ver/<id>` que
   * tocasse sozinho tocaria para quem recebeu o link e só o abriu — e isso é
   * exatamente o "tocar sozinho" que a primeira regra do produto proíbe. O
   * link do "Assistir" é o `#/ep/<id>` de sempre; o que ele leva a mais é o
   * clique.
   *
   * Três cuidados, e cada um fecha uma porta:
   *   - só o clique PRIMÁRIO SEM TECLA liga o pedido. Ctrl+clique abre OUTRA
   *     aba, que não passa por esta página: o pedido ficaria ligado aqui, e a
   *     próxima ficha aberta tocaria sem ninguém ter pedido;
   *   - o roteador CONSOME o pedido em toda troca de tela, tocando ou não. Um
   *     pedido que sobrasse — um clique cuja navegação não aconteceu — não
   *     espera a próxima visita àquele título para tocar;
   *   - quem toca é o PLAYER, pela entrada `tocar()`, que é o mesmo
   *     `alternarPlay` do botão. Este arquivo não chama `play()` — há teste.
   *
   * No iPhone isto é PENDENTE DE APARELHO, pela regra de 04/09. O Safari do
   * iOS só deixa tocar com som dentro do gesto, e o play daqui acontece no
   * `hashchange`, um instante depois do toque. Se ele recusar, o vídeo fica
   * parado com o botão de play à mão — que é a ficha de antes da D6, e não um
   * defeito novo. */
  var pedidoDeTocar = '';

  /* O PRÓXIMO EPISÓDIO (player.proximoEpisodio). Quem abre a ficha seguinte é o
   * player, pelo gancho `abrirProximo`; este arquivo só a navega. Com o clique em
   * "Assistir agora" (`automatico` falso) o pedido é o mesmo do "Assistir": um
   * gesto, e o play é o `tocar()` do player. No avanço por contagem
   * (`automatico` verdadeiro) NÃO há gesto: a ficha nova nasce pedindo ao
   * guardião o início (`origemDoInicio`), e o guardião diz se pode — com
   * `autoplay.modo: 'nunca'` nunca pode. O pedido vale UMA troca de tela, como
   * o do "Assistir". */
  var proximoAutomatico = '';
  function abrirProximoEpisodio(alvo, opcoes) {
    if (!alvo || !alvo.id) return;
    if (opcoes && opcoes.automatico) proximoAutomatico = alvo.id;
    else pedidoDeTocar = alvo.id;
    window.location.hash = '#/ep/' + encodeURIComponent(alvo.id);
  }

  function iconePlay() {
    var play = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    play.setAttribute('viewBox', '0 0 24 24');
    play.setAttribute('aria-hidden', 'true');
    var tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tri.setAttribute('d', 'M8 5 L19 12 L8 19 Z');
    tri.setAttribute('fill', 'currentColor');
    play.appendChild(tri);
    return play;
  }

  /* Onde o vídeo parou, como o player gravou (fase 6). Só a página da
   * série lê — o player nunca. Tudo em try/catch: o `localStorage` lança na
   * aba anônima e na rede que o bloqueia, e aí o "Continuar" some e a página
   * é a de sempre. */
  function lerOndeParou() {
    try {
      var cru = window.localStorage.getItem(App.CHAVE_ONDE_PAROU);
      return cru ? JSON.parse(cru) : {};
    } catch (e) {
      return {};
    }
  }

  /* ----------------------------------------- a home por blocos (M6) */

  /* 'seriado' (padrão) ou 'avulso': no avulso não há "T1 E3" nem a página Séries. */
  function modeloAvulso() { return App.modeloDeConteudo(estado.site) === 'avulso'; }

  function rotuloEp(item) { return modeloAvulso() ? '' : App.rotuloEpisodio(item); }

  function aplicarModelo() {
    if (el.linkSeries) el.linkSeries.hidden = modeloAvulso();
  }

  /* O que os blocos precisam saber de QUEM olha e do que o navegador guardou. Nada disto sai do aparelho:
   * `ondeParou` é a memória local do player, e `minhaLista` vem do D1 só para quem tem conta. Dentro da mesa
   * a pessoa que edita não é o público: ela vê todos os blocos (`ignorarVisibilidade`). */
  function contextoDaHome() {
    var q = estado.quem || {};
    return {
      logado: q.logado === true,
      ondeParou: mesa.ligada ? null : lerOndeParou(),
      minhaLista: estado.minhaLista,
      ignorarVisibilidade: mesa.ligada
    };
  }

  /* A MINHA LISTA. Quem decide se ela existe é o servidor (`quem.minhaLista`: o recurso ligado e o site com
   * contas); quem tem conta de espectador a lê aqui. Falha de rede ou sessão que caiu: a lista some em silêncio,
   * e o site é o de sempre. */
  function minhaListaDisponivel() { return !mesa.ligada && estado.quem && estado.quem.minhaLista === true && estado.quem.espectador === true; }

  function carregarMinhaLista() {
    if (!minhaListaDisponivel() || estado.minhaLista) return;
    fetch('/api/minha-lista', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.ids)) return;
        estado.minhaLista = d.ids;
        /* Na chegada, a fileira entra agora; nas outras telas ela espera a próxima visita à chegada. */
        if (estado.carregado && !estado.termo && !estado.serie && !estado.prateleira && !estado.serieRota &&
            !estado.indiceSeries && !App.rotaDaFicha(window.location.hash || '')) renderGrade();
      })
      .catch(function () { /* sem lista: o resto do site segue */ });
  }

  function naMinhaLista(id) { return Array.isArray(estado.minhaLista) && estado.minhaLista.indexOf(id) >= 0; }

  /* O botão "Minha lista" de um título: guarda ou tira. Otimista — o rótulo muda na hora e volta atrás, com
   * aviso, se o servidor recusar. É um clique: nada aqui toca vídeo. */
  function botaoMinhaLista(id) {
    if (!minhaListaDisponivel() || !Array.isArray(estado.minhaLista)) return null;
    var b = criar('button', 'botao botao-minha-lista');
    b.type = 'button';
    var pintar = function () {
      var dentro = naMinhaLista(id);
      b.textContent = dentro ? tr('home.naMinhaLista') : tr('home.guardarNaMinhaLista');
      b.setAttribute('aria-pressed', dentro ? 'true' : 'false');
    };
    pintar();
    b.addEventListener('click', function () {
      var antes = estado.minhaLista.slice();
      var guardar = !naMinhaLista(id);
      estado.minhaLista = guardar ? [id].concat(antes.filter(function (x) { return x !== id; })) : antes.filter(function (x) { return x !== id; });
      pintar();
      var pedido = guardar
        ? fetch('/api/minha-lista', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ id: id }) })
        : fetch('/api/minha-lista?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' });
      pedido.then(function (r) {
        if (r.ok) { anunciar(guardar ? tr('home.guardadoNaMinhaLista') : tr('home.tiradoDaMinhaLista')); return; }
        return r.json().catch(function () { return {}; }).then(function (c) {
          estado.minhaLista = antes;
          pintar();
          anunciar(c && c.codigo && I18n.tem('api.' + c.codigo) ? tr('api.' + c.codigo, c.params) : tr('home.minhaListaFalhou'));
        });
      }).catch(function () {
        estado.minhaLista = antes;
        pintar();
        anunciar(tr('home.minhaListaFalhou'));
      });
    });
    return b;
  }

  function ligarAssistir(link, id) {
    link.addEventListener('click', function (ev) {
      if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
      pedidoDeTocar = id;
    });
  }

  /* -------------------------------------------------------------- utilidades */

  function criar(tag, classe, texto) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  /* Os textos fixos do site: o rodapé e os cinco estados do B8. O padrão mora
   * no `catalogo-core.js`; `estado.site.textos` só troca o que alguém escreveu
   * na mesa (M4). Chamada na hora de desenhar, e não guardada numa constante,
   * porque dentro da mesa o texto muda a cada tecla do rascunho. */
  function frase(chave) {
    /* Ordem: o que a mesa escreveu > config/site.json (já mesclado no catálogo do
     * idioma) > texto de fábrica do idioma. O `App.textoDoSite` faz as duas pontas. */
    return App.textoDoSite(estado.site, chave);
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }

  /* A faixa amarela de dentro da ficha — hoje só a pendência. Até a D7 ela
   * tinha também uma versão vermelha, para os estados de erro; eles passaram
   * todos para o `estadoVazio`, logo abaixo. */
  function aviso(texto) {
    return criar('div', 'aviso', texto);
  }

  /* ---------------------------------------------- os estados vazios (D7)
   *
   * O B8 do briefing: "cinco situações reais que hoje são só uma linha de
   * texto cinza no meio da tela. Não precisam de ilustração — precisam de
   * hierarquia, espaço e, onde couber, um ícone." É o que esta peça faz, e ela
   * é UMA só para todos: a busca vazia, a ficha que não existe, a falha de
   * rede e os três de texto fixo (catálogo vazio, série e lista que não
   * existem mais). Até a D7 eram dois desenhos — a faixa `.aviso` vermelha e o
   * `.vazio` cinza — escolhidos caso a caso.
   *
   * Ícone é <path> em currentColor, 24×24, traço de 1,6: sem fonte de ícone,
   * sem CDN, como todo ícone do site. */
  var ICONES_ESTADO = {
    busca: 'M10.5 4 a6.5 6.5 0 1 0 0 13 a6.5 6.5 0 1 0 0 -13 Z M15.2 15.2 L20 20',
    /* Uma tela com o play, riscada. */
    ausente: 'M3.5 5.5 H20.5 V18.5 H3.5 Z M10 9 L15 12 L10 15 Z M4 3 L20 21',
    /* Uma nuvem riscada: a rede. */
    rede: 'M7.5 18 H17 a3.5 3.5 0 0 0 .6 -6.95 A5.5 5.5 0 0 0 7 10.2 A3.9 3.9 0 0 0 7.5 18 Z M4 3 L20 21',
    /* Uma pilha de quadros: a lista, a série. */
    lista: 'M4 7 H20 V19 H4 Z M6.5 4 H17.5',
    /* Um quadro com montanha e sol: a capa que falta. */
    imagem: 'M4 5 H20 V19 H4 Z M4 16 L9 11 L13 15 L15.5 12.5 L20 17 M15 8.5 a1.5 1.5 0 1 0 .01 0'
  };

  function iconeEstado(nome, classe) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', classe);
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONES_ESTADO[nome]);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  /* `o` = { icone, titulo, texto, termo, detalhe, acoes: [{ rotulo, href |
   * aoClicar, primario }], erro }. Só `titulo` é obrigatório.
   *
   * O TERMO e o DETALHE vêm em linha própria, fora da frase editável (ver
   * `TEXTOS_PADRAO`). A falha de rede é `role="alert"`: ela substitui a página
   * inteira, e quem ouve a tela precisa saber na hora; os outros são conteúdo
   * comum, lidos na ordem. */
  function estadoVazio(o) {
    var caixa = criar('div', 'vazio' + (o.erro ? ' vazio-erro' : ''));
    if (o.erro) caixa.setAttribute('role', 'alert');
    if (o.icone) caixa.appendChild(iconeEstado(o.icone, 'vazio-icone'));
    caixa.appendChild(criar('h2', 'vazio-titulo', o.titulo));
    if (o.termo) caixa.appendChild(criar('p', 'vazio-termo', '“' + o.termo + '”'));
    if (o.texto) caixa.appendChild(criar('p', 'vazio-texto', o.texto));
    if (o.acoes && o.acoes.length) {
      var botoes = criar('div', 'vazio-acoes');
      o.acoes.forEach(function (a) {
        var b;
        if (a.href) {
          b = criar('a', 'botao' + (a.primario ? ' botao-primario' : ''), a.rotulo);
          b.href = a.href;
        } else {
          b = criar('button', 'botao' + (a.primario ? ' botao-primario' : ''), a.rotulo);
          b.type = 'button';
          b.addEventListener('click', a.aoClicar);
        }
        botoes.appendChild(b);
      });
      caixa.appendChild(botoes);
    }
    if (o.detalhe) caixa.appendChild(criar('p', 'vazio-detalhe', o.detalhe));
    return caixa;
  }

  /* O "sem capa" do B8: a caixa 16:9 continua, com um ícone de imagem e a
   * frase embaixo dele. Uma função só para os sete lugares que desenham capa —
   * eram sete cópias da mesma linha. */
  function capaVazia() {
    var d = criar('div', 'card-capa-vazia');
    d.appendChild(iconeEstado('imagem', 'card-capa-vazia-icone'));
    d.appendChild(criar('span', null, frase('semCapa')));
    return d;
  }

  /* ----------------------------------------------------------------- dados */

  function receberDados(dados) {
    estado.itens = Array.isArray(dados.itens) ? dados.itens : [];
    /* Os ajustes do player (o teto do arranco, hoje) viajam DENTRO do
     * config: é o objeto que já chega ao player e à capa, e criar um
     * segundo canal para um número seria um caminho a mais para manter.
     * `comportamento` é `player.*` e `home.destaque.fundo`, já saneados pelo
     * guardião no Worker (nada do ambiente: `config` não sai pela API).
     * Eles vêm do catálogo, não do ambiente — por isso são um campo à
     * parte na resposta da API. */
    estado.config = Object.assign({}, dados.comportamento || {},
      { ajustes: dados.ajustes || {} });
    estado.site = dados.site || {};
    estado.quem = dados.quem && typeof dados.quem === 'object' ? dados.quem : {};
    estado.carregado = true;
    aplicarModelo();
    pintarRodape();
  }

  /* O rodapé mora no HTML, e continua morando: ele é desenhado com a página,
   * antes de o catálogo responder, e tirá-lo de lá o faria chegar depois. O
   * texto escolhido na mesa entra POR CIMA, e só quando é diferente do que já
   * está escrito — escrever igual seria mexer no DOM à toa, e o rodapé é
   * justamente quem já foi o dono do CLS desta página.
   *
   * Há teste cobrando que o texto do `index.html` e o padrão do
   * `catalogo-core.js` são o MESMO: se separarem, o rodapé pisca a cada carga
   * em todas as visitas, e ninguém ligaria uma coisa à outra. */
  function pintarRodape() {
    var no = document.getElementById('rodape-texto');
    if (!no) return;
    /* O catálogo de vídeos pode chegar antes do de textos: sem ele, o `tr` devolveria a
     * chave. O carregarIdioma repinta o rodapé quando o idioma chega. */
    if (!I18n.tem('site.rodape')) return;
    var novo = frase('rodape');
    if (no.textContent === novo) return;
    no.textContent = novo;
  }

  function irParaEntrar() {
    try {
      location.replace('entrar.html?voltar=' + encodeURIComponent(location.pathname + location.search + location.hash));
      return true;
    } catch (e) { /* sem navegação: a mensagem de erro de baixo cobre */ }
    return false;
  }

  /* "Minha conta" só existe onde há contas (modos `cadastro` e `privado`). */
  function pintarLinkDaConta() {
    var modo = CONFIG_PUBLICA && CONFIG_PUBLICA.acesso && CONFIG_PUBLICA.acesso.modo;
    var a = document.getElementById('rodape-conta');
    var ponto = document.getElementById('rodape-conta-ponto');
    if (!a || mesa.ligada) return;
    var ligado = modo === 'cadastro' || modo === 'privado';
    a.hidden = !ligado;
    if (ponto) ponto.hidden = !ligado;
  }

  /* `espera`: promessa do idioma/config pública. O modo de acesso vem de CONFIG_PUBLICA, que só
   * é preenchida quando ela resolve; sem esperar, `modo` ficaria indefinido e o pré-check seria pulado. */
  function carregar(espera) {
    /* Na mesa o catálogo vem dela, com o rascunho por cima — e com os títulos
     * fora do ar, que a API pública não devolve. A página avisa que está
     * pronta, e a mesa responde com o catálogo. */
    if (mesa.ligada) {
      return new Promise(function (resolve) {
        mesa.aoPrimeiroCatalogo = resolve;
        avisarMesa({ tipo: 'pronto' });
      });
    }
    /* Nos modos restritos, pedir o catálogo sem sessão volta 401 e o navegador o registra
     * como erro no console de toda visita anônima. Antes se pergunta quem a pessoa é
     * (/api/auth/estado, rota aberta): sem sessão, vai direto para a entrada. */
    return Promise.resolve(espera).catch(function () { /* sem config pública: segue com o padrão */ }).then(function () {
    var modo = CONFIG_PUBLICA && CONFIG_PUBLICA.acesso && CONFIG_PUBLICA.acesso.modo;
    var antes = modo === 'cadastro' || modo === 'privado'
      ? fetch('/api/auth/estado', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (e) {
          if (e && e.sessao && e.sessao.papel === 'anonimo') {
            if (irParaEntrar()) return new Promise(function () { /* a página está saindo: não pede o catálogo */ });
          }
        })
      : Promise.resolve();
    return antes.then(function () {
      return fetch('/api/catalogo', { headers: { Accept: 'application/json' } });
    });
    })
      .then(function (r) {
        /* Nos modos `cadastro` e `privado` o catálogo exige sessão: sem ela, a pessoa vai
         * para a página de entrada e volta para cá depois de entrar. */
        if (r.status === 401) irParaEntrar();
        if (!r.ok) throw new Error(tr('site.erroResposta', { status: r.status }));
        return r.json();
      })
      .then(receberDados);
  }

  /* ---------------------------------------------------------------- filtros */

  /* A lista de onde a GRADE parte, antes da busca e do chip: a prateleira do
   * "Ver tudo", ou o catálogo inteiro. A série da rota `#/serie/<nome>` saiu
   * daqui na D6 — ela tem página própria, e não é mais uma grade. */
  function baseDaGrade() {
    /* O "Ver tudo" parte da MESMA prateleira que a chegada desenhou, achada
     * pelo id — a regra dela não é reescrita aqui. O chip filtra por cima.
     * Digitar na busca SAI do "Ver tudo" e procura no catálogo inteiro — ver
     * `aoDigitar`. */
    if (estado.prateleira) {
      var p = App.prateleiraPorId(estado.itens, estado.prateleira, estado.site, contextoDaHome());
      return p ? p.itens : [];
    }
    return App.publicaveis(estado.itens);
  }

  /* O FILTRO POR SÉRIE — os chips que moravam no cabeçalho e saíram dele na D5
   * (decisão D8). Agora eles nascem DENTRO da grade, no mesmo quadro que os
   * cartões, e só com as séries que estão na resposta (`seriesDoFiltro`).
   *
   * Nascer junto com a grade é o que dispensa a reserva de altura de antes: a
   * linha não existe vazia em momento nenhum, e não empurra nada ao chegar. */
  function filtroSeries(opcoes) {
    var caixa = criar('div', 'chips');
    caixa.setAttribute('role', 'group');
    caixa.setAttribute('aria-label', tr('site.filtrarPorSerie'));

    var faz = function (rotulo, valor) {
      var b = criar('button', 'chip', rotulo);
      b.type = 'button';
      b.setAttribute('data-serie', valor);
      b.setAttribute('aria-pressed', String(estado.serie === valor));
      b.addEventListener('click', function () {
        var rolagem = caixa.scrollLeft;
        estado.serie = estado.serie === valor ? '' : valor;
        renderGrade();

        /* O botão apertado acabou de ser RECRIADO junto com a grade, e a linha
         * inteira com ele. Duas coisas se perdiam, as duas medidas em 15/09:
         *   - o FOCO caía no <body>, e quem usa teclado voltava ao começo da
         *     página a cada filtro (ainda com a linha no cabeçalho);
         *   - a ROLAGEM DE LADO voltava a zero: o chip apertado, se estava no
         *     fim da linha, ficava fora da tela com o foco nele — em 375 px,
         *     15 dos 78 px dele à mostra.
         * A rolagem é devolvida primeiro, e o chip é trazido inteiro para a
         * vista só se ainda faltar um pedaço dele. */
        var nova = el.grade.querySelector('.chips');
        if (!nova) return;
        nova.scrollLeft = rolagem;
        var novos = nova.querySelectorAll('.chip');
        for (var i = 0; i < novos.length; i++) {
          if (novos[i].getAttribute('data-serie') !== valor) continue;
          novos[i].focus({ preventScroll: true });
          novos[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
          break;
        }
      });
      caixa.appendChild(b);
    };

    faz(tr('site.todas'), '');
    opcoes.forEach(function (s) { faz(s, s); });
    return caixa;
  }

  /* -------------------------------------------------------------- cabeçalho */

  /* O CABEÇALHO FLUTUANTE (D5): sem fundo com a página no alto, sólido assim
   * que alguma coisa passa por baixo dele — "ao rolar, sólido", como o projeto
   * pede.
   *
   * NENHUM OUVINTE DE `scroll`, e há teste. Um ouvinte de rolagem roda dezenas
   * de vezes por segundo, na mesma linha de execução que desenha a página;
   * aqui quem avisa é o navegador, uma vez em cada travessia.
   *
   * O ALVO É UMA SENTINELA de 1 px no alto do documento, e não o destaque, como
   * o projeto sugeria. As razões apareceram ao desenhar:
   *   - no celular deitado, 812×375, o destaque tem 602 px de altura para 302
   *     livres abaixo deste cabeçalho, e 251 abaixo do de antes (medido em
   *     15/09): um limiar de 100% nele nunca dispara. Com 0%, o cabeçalho
   *     ficaria sem fundo enquanto o título do destaque passa por baixo do
   *     logo — texto sobre texto, sem contraste que se possa medir;
   *   - o destaque é recriado a cada `renderGrade`, e não existe na ficha, na
   *     grade nem na página Séries: o observador teria que ser religado a cada
   *     tela. A sentinela dá a mesma regra em todas, ligada uma vez.
   *
   * Sem IntersectionObserver o cabeçalho fica SÓLIDO de vez: é o estado que
   * nunca deixa conteúdo passar por baixo de um cabeçalho sem fundo. */
  function ligarTopo() {
    if (typeof IntersectionObserver === 'undefined') {
      el.topo.classList.add('topo-solido');
      return;
    }
    new IntersectionObserver(function (entradas) {
      /* Numa rolagem rápida duas travessias podem chegar juntas: vale a
       * última, que é o estado de agora. */
      el.topo.classList.toggle('topo-solido', !entradas[entradas.length - 1].isIntersecting);
    }).observe(el.sentinela);
  }

  /* O link da seção em que a pessoa está, dito ao leitor de tela por
   * `aria-current` — e é o mesmo atributo que pinta o sublinhado no CSS, então
   * o que se vê e o que se ouve não discordam. '' desmarca os dois. */
  function marcarNav(secao) {
    [[el.linkInicio, 'inicio'], [el.linkSeries, 'series']].forEach(function (par) {
      if (par[1] === secao) par[0].setAttribute('aria-current', 'page');
      else par[0].removeAttribute('aria-current');
    });
  }

  /* A BUSCA NO CELULAR mora atrás de um botão. Com o campo sempre à mostra, o
   * cabeçalho de 375 px tinha 137 px de altura, preso no alto da tela — 17%
   * dela, o tempo todo (medido em 15/09). Aberto, o campo toma o lugar do logo
   * e dos links, na mesma linha e com a mesma altura. Quem esconde e mostra é
   * o CSS; no computador a classe não muda nada, e o campo está sempre lá.
   *
   * `aria-expanded` é o que diz a quem ouve a página que a busca abriu. */
  function marcarBusca(aberta) {
    el.topo.classList.toggle('topo-buscando', aberta);
    el.abrirBusca.setAttribute('aria-expanded', String(aberta));
  }

  function abrirBusca() {
    marcarBusca(true);
    prepararBusca();
    el.busca.focus();
  }

  /* ------------------------------------------------------------ a busca nova
   *
   * A BUSCA MORA NUM ARQUIVO À PARTE, o `busca-core.js`,
   * e ele só desce quando alguém VAI buscar: no foco do campo, na lupa do
   * celular ou na primeira tecla. A chegada não pede nada novo — é a regra da
   * regra do projeto, e há teste.
   *
   * Até ele chegar, a resposta sai pela `App.buscar` de antes, que já está na
   * página: quem digita antes do arquivo vê a busca antiga por um instante, e
   * não uma tela vazia. Chegou, a resposta é redesenhada. */
  var busca = {
    core: '',          /* '' · 'carregando' · 'pronto' */
    indice: null,
    indiceDe: null,    /* o `estado.itens` de onde o índice saiu */
    indiceSite: null,  /* e o `estado.site`, que traz os temas das séries */
    /* O ÍNDICE DA FALA (fase 3): o que é falado nos vídeos no ar, ~430 KB
     * — cinco vezes o catálogo. Desce na PRIMEIRA BUSCA, junto com o
     * `busca-core.js`, e nunca na chegada. Até ele chegar, os títulos e os
     * capítulos já respondem. */
    falaEstado: '',    /* '' · 'carregando' · 'pronta' */
    falaTexto: null,   /* o texto que chegou antes do busca-core, esperando */
    fala: null,        /* { videoId: blocos }, depois de lido */
    indiceFala: null,  /* a `fala` de onde o índice saiu */
    /* O SENTIDO (fase 4): a resposta de cada pergunta, guardada pela
     * pergunta — a busca repetida não volta ao servidor. A pergunta sai 400
     * ms depois da última tecla, e só a última vale: a anterior é cancelada. */
    sentido: Object.create(null),
    esperaSentido: 0,
    pedidoSentido: null,
    /* Os vídeos cujo "mais N neste vídeo" foi aberto, para a pergunta de
     * agora. Um redesenho — o chip, o índice que chegou — não os fecha; um
     * termo novo, sim. */
    abertos: Object.create(null),
    abertosDe: '',
    /* O anúncio da contagem para quem ouve a página: um nó que já existe
     * antes da resposta, porque um `aria-live` que nasce junto com o texto
     * não é lido. O texto entra depois de a pessoa parar de digitar. */
    anuncio: null,
    esperaAnuncio: 0
  };

  function carregarScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.addEventListener('load', resolve);
      tag.addEventListener('error', function () { reject(new Error(tr('site.erroCarregarScript', { src: src }))); });
      document.head.appendChild(tag);
    });
  }

  function prepararBusca() {
    if (!busca.core) {
      busca.core = 'carregando';
      carregarScript('busca-core.js').then(function () {
        busca.core = typeof AppBusca !== 'undefined' ? 'pronto' : '';
        lerFalaQueChegou();
        redesenharResposta();
        /* Quem digitou antes de o arquivo chegar também pergunta ao sentido. */
        if (estado.termo) pedirSentidoDepois();
      }, function () {
        /* Sem o arquivo, a busca continua a de antes, e o próximo foco tenta
         * de novo — uma rede que caiu por um instante não deixa a busca velha
         * para sempre. */
        busca.core = '';
      });
    }
    if (!busca.falaEstado) {
      busca.falaEstado = 'carregando';
      /* O navegador guarda a resposta e pergunta pelo `ETag` antes de usar:
       * a segunda visita que busca recebe um 304, sem os 430 KB. */
      fetch('/api/busca/fala', { headers: { Accept: 'text/plain' } }).then(function (r) {
        if (!r.ok) throw new Error(tr('site.erroResposta', { status: r.status }));
        return r.text();
      }).then(function (texto) {
        busca.falaTexto = texto;
        busca.falaEstado = 'pronta';
        lerFalaQueChegou();
        redesenharResposta();
      }).catch(function () {
        /* Sem a fala, a busca continua com os títulos e os capítulos, e o
         * próximo foco tenta de novo. */
        busca.falaEstado = '';
      });
    }
  }

  /* A fala só é LIDA com o busca-core na página — é ele que sabe ler a
   * linha. O que chegar primeiro espera o outro. */
  function lerFalaQueChegou() {
    if (busca.core !== 'pronto' || busca.falaTexto == null) return;
    busca.fala = AppBusca.lerFala(busca.falaTexto);
    busca.falaTexto = null;
  }

  /* A resposta está na tela? Então ela é redesenhada com o que acabou de
   * chegar. Na ficha e nas outras telas não há resposta a redesenhar. */
  function redesenharResposta() {
    if (!estado.termo || !estado.carregado || !el.ficha.hidden) return;
    if (window.location.hash && window.location.hash !== '#/') return;
    renderGrade();
  }

  /* Um índice por catálogo e por fala: montado na primeira busca, de novo
   * quando a fala chega, e de novo quando o catálogo muda — na mesa, a cada
   * tecla do rascunho. Com a fala são ~50 ms, uma vez. */
  function indiceDaBusca() {
    if (busca.indiceDe !== estado.itens || busca.indiceSite !== estado.site || busca.indiceFala !== busca.fala) {
      /* Com os temas da série junto: o tema da página da série abre a
       * busca por ele, e é daqui que a resposta sai. */
      busca.indice = AppBusca.indice(App.comTemasDasSeries(App.publicaveis(estado.itens), estado.site), busca.fala);
      busca.indiceDe = estado.itens;
      busca.indiceSite = estado.site;
      busca.indiceFala = busca.fala;
    }
    return busca.indice;
  }

  /* A PERGUNTA AO SENTIDO (fase 4): 400 ms depois da última tecla, com
   * 3 letras ou mais, e só a última vale — a anterior é cancelada. A resposta
   * fica guardada pela pergunta. Falhou — o teto do mês, a rede —, nada
   * aparece na tela: a busca por palavra é a mesma.
   *
   * O termo sai do navegador aqui, e só aqui: a rota não o
   * grava em lugar nenhum. E ele continua fora do endereço da página. */
  function pedirSentidoDepois() {
    clearTimeout(busca.esperaSentido);
    if (busca.core !== 'pronto') return;
    var q = AppBusca.perguntaDoSentido(estado.termo);
    if (!q || q in busca.sentido) return;
    busca.esperaSentido = setTimeout(function () {
      if (busca.pedidoSentido) busca.pedidoSentido.abort();
      var controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
      busca.pedidoSentido = controle;
      fetch('/api/busca/sentido?q=' + encodeURIComponent(q), controle ? { signal: controle.signal } : undefined)
        .then(function (r) { return r.ok ? r.json() : { resultados: [] }; })
        .then(function (d) {
          busca.sentido[q] = d && Array.isArray(d.resultados) ? d.resultados : [];
          if (busca.pedidoSentido === controle) busca.pedidoSentido = null;
          if (AppBusca.perguntaDoSentido(estado.termo) === q) redesenharResposta();
        })
        .catch(function () { /* cancelada, ou a rede: a busca por palavra continua */ });
    }, 400);
  }

  /* A resposta de uma pergunta: os títulos na ordem em que a grade os desenha,
   * e os trechos. Com termo e com o arquivo da busca, por relevância (fase 1),
   * com os capítulos e a fala que responderam (fases 2 e 3), e com o sentido
   * junto quando ele já respondeu (fase 4); sem termo — o "Ver tudo", o chip
   * —, na ordem do catálogo, como sempre. */
  function responder(base, termo) {
    if (termo && !estado.prateleira && busca.core === 'pronto') {
      var ind = indiceDaBusca();
      var r = AppBusca.procurar(ind, termo);
      var q = AppBusca.perguntaDoSentido(termo);
      if (q && busca.sentido[q]) r = AppBusca.juntar(ind, r, busca.sentido[q]);
      var porSentido = Object.create(null);
      r.titulos.forEach(function (t) { if (t.porSentido) porSentido[t.item.id] = true; });
      return {
        titulos: r.titulos.map(function (t) { return t.item; }),
        porSentido: porSentido,
        trechos: r.trechos,
        casadas: r.casadas
      };
    }
    base = App.comTemasDasSeries(base, estado.site);
    return { titulos: App.ordenar(App.buscar(base, termo)), porSentido: {}, trechos: [], casadas: [] };
  }

  function anunciar(texto) {
    if (!busca.anuncio) return;
    clearTimeout(busca.esperaAnuncio);
    busca.esperaAnuncio = setTimeout(function () {
      if (busca.anuncio.textContent !== texto) busca.anuncio.textContent = texto;
    }, 700);
  }

  /* ------------------------------------------------------------- os trechos */

  /* Um texto com as palavras da consulta marcadas, a partir dos pedaços do
   * `AppBusca.marcar` ou do `AppBusca.frase`. Nós de texto e <mark>, montados um a um:
   * a fala é ASR, e nada dela passa por innerHTML. */
  function comMarcas(no, pedacos) {
    pedacos.forEach(function (p) {
      no.appendChild(p.marca ? criar('mark', null, p.texto) : document.createTextNode(p.texto));
    });
    return no;
  }

  /* O LINK DE UM TRECHO: `#/ep/<id>?t=<segundos>`, e o mesmo pedido de tocar
   * do "Assistir" (`ligarAssistir`): o clique abre a ficha no momento E dá o
   * play; o link colado abre parado no momento. O minuto na frente, e depois
   * o que diz de onde ele é: o capítulo, e — no trecho da fala — a frase em
   * volta da palavra. */
  function linkDoTrecho(t, casadasDaBusca) {
    /* O trecho do SENTIDO (fase 4) não tem palavra a marcar: ele fala do
     * assunto sem usar a palavra. Vai sem marca e com o rótulo. */
    var casadas = t.porSentido ? [] : casadasDaBusca;
    var a = criar('a', 'trecho');
    a.href = App.linkDaFicha(t.item.id, t.inicio);
    ligarAssistir(a, t.item.id);
    /* Os espaços entre os pedaços não aparecem — espaço solto entre itens de
     * flex não ocupa lugar —, e são eles que separam as palavras no nome do
     * link para quem ouve: sem eles, "…de trabalho" e a frase seguinte viravam
     * uma palavra só. */
    a.appendChild(criar('span', 'trecho-tempo', App.formatarTempo(t.inicio)));
    a.appendChild(document.createTextNode(' '));
    var corpo = criar('span', 'trecho-corpo');
    if (t.tipo === 'capitulo') {
      corpo.appendChild(comMarcas(criar('span', 'trecho-capitulo', tr('site.rotuloCapitulo') + ' '), AppBusca.marcar(t.texto, casadas)));
    } else {
      if (t.capitulo) {
        corpo.appendChild(comMarcas(criar('span', 'trecho-capitulo', tr('site.rotuloCapitulo') + ' '), AppBusca.marcar(t.capitulo, casadas)));
        corpo.appendChild(document.createTextNode(' '));
      }
      corpo.appendChild(comMarcas(criar('span', 'trecho-frase'), AppBusca.frase(t.texto, casadas, 120)));
    }
    if (t.porSentido) {
      corpo.appendChild(document.createTextNode(' '));
      corpo.appendChild(criar('span', 'selo selo-sentido', tr('site.seloSentido')));
    }
    a.appendChild(corpo);
    return a;
  }

  /* Um vídeo e os trechos dele: a linha da "Episódios da série" (D6) — a capa
   * pequena, a série e o número, o nome curto —, com os trechos no lugar da
   * sinopse. Até três à mostra, e o "mais N neste vídeo" abre o resto ali
   * mesmo. A capa é enfeite e não é link: quem escolhe é o minuto.
   *
   * Quatro filhos soltos, e não a capa e um corpo como na `.ep`: no celular a
   * lista de trechos desce para baixo da capa, na largura inteira (o CSS de
   * `.trecho-grupo`). Ao lado de uma capa de 40%, a frase teria 170 px. */
  function grupoDeTrechos(g, casadas) {
    var li = criar('li', 'trecho-grupo');
    var capa = criar('div', 'ep-capa');
    var url = App.urlCapa(g.item);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(capaVazia(), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(capaVazia());
    }
    li.appendChild(capa);

    var cabeca = criar('div', 'trecho-cabeca');
    var sobre = [g.item.serie, App.rotuloNumero(g.item)].filter(Boolean).join(' · ');
    if (sobre) cabeca.appendChild(criar('p', 'ep-numero', sobre));
    cabeca.appendChild(criar('h3', 'ep-titulo', App.tituloCurto(g.item) || g.item.titulo || tr('comum.semTitulo')));
    li.appendChild(cabeca);

    var ol = criar('ol', 'trechos-do-video');
    var mostrar = function (lista) {
      limpar(ol);
      lista.forEach(function (t) {
        var linha = criar('li');
        linha.appendChild(linkDoTrecho(t, casadas));
        ol.appendChild(linha);
      });
    };
    var aberto = !!busca.abertos[g.item.id];
    mostrar(aberto ? g.todos : g.visiveis);
    li.appendChild(ol);

    if (!aberto && g.resto.length) {
      var mais = criar('button', 'trecho-mais', tr('site.trechoMais', { n: g.resto.length }));
      mais.type = 'button';
      mais.addEventListener('click', function () {
        busca.abertos[g.item.id] = true;
        mostrar(g.todos);
        /* O botão sai, e o foco vai para o primeiro trecho que ele escondia —
         * sem isto, ele cairia no <body>. */
        var primeiro = g.todos.indexOf(g.resto[0]);
        var links = ol.querySelectorAll('a');
        if (mais.parentNode) mais.parentNode.removeChild(mais);
        if (links[primeiro]) links[primeiro].focus();
      });
      li.appendChild(mais);
    }
    return li;
  }

  function secaoTrechos(trechos, casadas) {
    var secao = criar('section', 'trechos');
    secao.setAttribute('aria-labelledby', 'trechos-titulo');
    var cabeca = criar('div', 'prateleira-cabeca');
    var h2 = criar('h2', 'prateleira-titulo', tr('site.trechos'));
    h2.id = 'trechos-titulo';
    cabeca.appendChild(h2);
    secao.appendChild(cabeca);

    var lista = criar('ul', 'trechos-lista');
    AppBusca.agruparTrechos(trechos, 3).forEach(function (g) { lista.appendChild(grupoDeTrechos(g, casadas)); });
    secao.appendChild(lista);
    return secao;
  }

  /* Esquece a busca inteira: o termo, o campo e o chip que a refinava. */
  function esquecerBusca() {
    estado.termo = '';
    estado.serie = '';
    el.busca.value = '';
    marcarBusca(false);
  }

  /* Fechar é desistir da busca. Só a RESPOSTA, que mora em #/, é redesenhada:
   * na ficha o termo não está desenhado em lugar nenhum, e apagá-lo não pode
   * tirar ninguém do vídeo. O foco volta ao botão que abriu — quando ele está à
   * mostra, que é só no celular. */
  function fecharBusca() {
    var tinha = !!el.busca.value;
    esquecerBusca();
    if (tinha && (!window.location.hash || window.location.hash === '#/')) renderGrade();
    if (el.abrirBusca.offsetParent !== null) el.abrirBusca.focus();
  }

  function aoDigitar() {
    prepararBusca();
    estado.termo = el.busca.value;
    pedirSentidoDepois();
    /* O chip refina UMA resposta. Apagar a busca desfaz a resposta, e o chip
     * vai junto — senão a chegada não voltaria mais: `renderGrade` só a
     * desenha sem termo E sem série. */
    if (!estado.termo) estado.serie = '';
    /* Termo escrito é busca aberta. Sem isto, quem digita no computador e
     * estreita a janela ficaria com a resposta na tela e o campo escondido. */
    else marcarBusca(true);
    /* A busca só faz sentido na grade; digitar volta para ela. */
    if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/';
    else renderGrade();
  }

  /* "Início" — o link do cabeçalho e o logo — é um link para #/. Com uma busca
   * digitada o endereço JÁ É #/, então o clique não dispara `hashchange` e nada
   * acontecia (conferido no logo em 15/09). Aqui ele esquece a busca e, na
   * chegada, desenha a chegada ele mesmo; de qualquer outra tela, a navegação
   * comum leva ao roteador, que sobe ao alto por conta própria.
   *
   * "Na chegada" é #/ E o endereço sem hash nenhum, que é como o site abre: o
   * roteador trata os dois como a mesma tela, e deixar a navegação trocar um
   * pelo outro não subiria ao alto.
   *
   * Só clique primário sem tecla: Ctrl+clique abre OUTRA aba, e apagar a busca
   * desta seria mexer numa tela que a pessoa deixou para trás. */
  function irAoInicio(ev) {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    esquecerBusca();
    if (window.location.hash && window.location.hash !== '#/') return;
    ev.preventDefault();
    rotear();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ grade */

  /* Consultado a cada hover, não uma vez no início: um tablet ganha mouse, um
   * notebook vira tela de toque e a preferência por menos movimento muda no
   * sistema com a página aberta. */
  function podePreview() {
    if (!window.matchMedia) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Trecho animado por cima da capa enquanto o ponteiro está sobre o cartão.
   *
   * Vale para os DOIS cartões — o da grade e o da prateleira —, e é a mesma
   * função ligada nos dois lugares.
   *
   * As duas regras que este trecho existe para cumprir:
   *   1. o preview.webp tem 1,13 MB NA MEDIANA — medido na pull zone em
   *      14/09, nos 66 títulos: de 454 KB a 3,1 MB, 82,2 MB somados. Ele só
   *      pode ser PEDIDO no mouseenter e tem que ser DESCARTADO no
   *      mouseleave. Nada disso pode ir junto com a chegada.
   *      (O "~450 KB" que estava escrito aqui era o MENOR arquivo tomado pelo
   *      tamanho típico, de quando o catálogo tinha 33 títulos.)
   *   2. em toque não existe hover, e quem pediu menos movimento não quer isto:
   *      nesses casos o cartão fica só com a capa.
   */
  function ligarPreview(cartaoEl, capa, item) {
    var previa = novaPrevia(capa, item);
    if (!previa) return;
    cartaoEl.addEventListener('mouseenter', function () { previa.pedir(220); });
    cartaoEl.addEventListener('mouseleave', previa.descartar);
  }

  /* A PEÇA da prévia, sem o cartão: `pedir(espera)` e `descartar()`. Quem
   * decide QUANDO é quem a usa — o cartão da grade no hover dele, o cartão
   * que abre na prateleira (15.2) ao abrir. As duas regras de cima valem
   * aqui dentro, e é por isso que ela é uma só. */
  function novaPrevia(capa, item) {
    var url = App.urlPreview(item);
    if (!url) return null;

    var img = null;
    var espera = 0;
    var indisponivel = false;

    function descartar() {
      if (espera) { clearTimeout(espera); espera = 0; }
      if (!img) return;
      /* Tirar o src antes de remover o nó aborta o download em andamento:
       * passar reto por um cartão não pode continuar puxando 1,13 MB. */
      img.removeAttribute('src');
      if (img.parentNode) img.parentNode.removeChild(img);
      img = null;
      capa.classList.remove('card-capa-com-previa');
    }

    function pedir(ms) {
      if (indisponivel || img || espera || !podePreview()) return;
      /* Atravessar a grade com o mouse passa por dezenas de cartões. Sem esta
       * espera, cada um deles dispararia o seu megabyte de passagem. */
      espera = setTimeout(function () {
        espera = 0;
        img = criar('img', 'card-previa');
        img.alt = '';
        img.decoding = 'async';
        /* Sem `referrerpolicy` aqui: a pull zone é protegida por Allowed
         * Referrers e responde 403 sem o cabeçalho Referer. Quem manda é a
         * política declarada no <meta> do index.html. */
        img.addEventListener('load', function () {
          capa.classList.add('card-capa-com-previa');
        });
        /* Título sem preview gerado no Bunny: desiste de vez e fica na capa. */
        img.addEventListener('error', function () {
          indisponivel = true;
          descartar();
        });
        img.src = url;
        capa.appendChild(img);
      }, ms);
    }

    return { pedir: pedir, descartar: descartar };
  }

  /* `porSentido`: o título que a busca achou SÓ pelo sentido (fase 4) — ele
   * vem depois dos que casaram por palavra, com o rótulo "Sobre o assunto"
   *. */
  function cartao(item, porSentido) {
    var a = criar('a', 'card');
    a.href = '#/ep/' + encodeURIComponent(item.id);
    marcarMesa(a, 'item:' + item.id);

    var capa = criar('div', 'card-capa');
    var url = App.urlCapa(item);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      /* Capa ausente na pull zone não pode deixar um ícone quebrado na grade. */
      img.addEventListener('error', function () {
        capa.replaceChild(capaVazia(), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(capaVazia());
    }

    var dur = App.formatarDuracao(item);
    if (dur) capa.appendChild(criar('span', 'card-duracao', dur));
    a.appendChild(capa);
    ligarPreview(a, capa, item);

    var corpo = criar('div', 'card-corpo');
    corpo.appendChild(criar('h2', 'card-titulo', item.titulo || tr('comum.semTitulo')));

    var meta = [item.serie, rotuloEp(item), item.ano]
      .filter(Boolean).join(' · ');
    if (meta) corpo.appendChild(criar('p', 'card-meta', meta));

    /* Sinopse vazia não vira parágrafo vazio: há título publicado sem ela. */
    var resumo = App.resumoSinopse(item);
    if (resumo) corpo.appendChild(criar('p', 'card-sinopse', resumo));

    if (porSentido) corpo.appendChild(criar('span', 'selo selo-sentido', tr('site.seloSentido')));

    if (!App.midiaDe(item)) {
      corpo.appendChild(criar('span', 'selo selo-erro', frase('videoIndisponivel')));
    } else if (item.pendencia) {
      corpo.appendChild(criar('span', 'selo', App.rotuloPendencia(item.pendencia)));
    }

    a.appendChild(corpo);
    return a;
  }

  /* --------------------------------------------------------------- destaque */

  /* O DESTAQUE da chegada: um título, com a capa, e nada tocando.
   *
   * "Assistir" abre a ficha E DÁ O PLAY desde a D6 — a D5 decidiu que o
   * clique é o pedido. A D4 tentou ligar isso daqui e não deu, por uma trava
   * do player que é boa e tem teste ("REGRA 1"): existe UMA chamada de
   * `play()` no projeto, dentro de `alternarPlay`, e é ela também que libera
   * o download. O caminho foi o player oferecer uma entrada, `tocar()`, que
   * passa por `alternarPlay`; este arquivo só a chama, pelo pedido de tocar
   * lá do alto (`ligarAssistir`), e o porquê de cada cuidado está ali.
   *
   * E NADA TOCA AQUI: o destaque continua sem trailer e sem prévia. O play é
   * na ficha, depois do clique. */
  function destaqueHtml(item) {
    var caixa = criar('section', 'destaque');
    caixa.setAttribute('aria-labelledby', 'destaque-titulo');
    /* Na mesa, escolher o destaque é escolher o título dele — é no inspetor do
     * título que se tira do destaque ou se passa para outro. */
    marcarMesa(caixa, 'item:' + item.id);

    /* ---- a capa ----
     * Duas colunas, e a capa não passa de 640 px de CSS (D2). A original tem
     * 640×360: num destaque de largura inteira, numa janela de 1400, ela
     * subiria 2,2x e ficaria mole. As originais em alta não existem na pull
     * zone — conferido em 10/09 —, e o Bunny Optimizer está desligado, então
     * `?width=` não redimensiona nada. Fica nítida em tela 1x, e custa zero
     * arquivo novo. */
    var molduraCapa = criar('div', 'destaque-capa');
    var url = App.urlCapa(item);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.width = 640;
      img.height = 360;
      img.decoding = 'async';
      /* Esta imagem é o LCP da chegada: ela é a maior coisa pintada na
       * primeira tela. `fetchpriority="high"` a põe na frente das capas das
       * prateleiras, que são `loading="lazy"`. */
      img.setAttribute('fetchpriority', 'high');
      img.addEventListener('error', function () {
        molduraCapa.replaceChild(capaVazia(), img);
      });
      molduraCapa.appendChild(img);
    } else {
      molduraCapa.appendChild(capaVazia());
    }
    /* NENHUMA prévia aqui, e é de propósito: um preview.webp é 1,13 MB na
     * mediana, então o destaque sozinho custaria mais do que as 66 capas
     * juntas (1,83 MB). E "nada toca sozinho" vale para o trecho animado
     * também. `ligarPreview` NÃO é chamada nesta função. */

    /* ---- o texto ---- */
    var texto = criar('div', 'destaque-texto');

    var acima = [item.serie, rotuloEp(item)].filter(Boolean).join(' · ');
    if (acima) texto.appendChild(criar('p', 'destaque-serie', acima));

    var h1 = criar('h1', 'destaque-titulo', App.tituloCurto(item) || item.titulo || tr('comum.semTitulo'));
    h1.id = 'destaque-titulo';
    texto.appendChild(h1);

    var caps = App.capitulos(item);
    var meta = [
      App.formatarDuracao(item),
      item.ano,
      caps.length ? tr('comum.capitulos', { n: caps.length }) : ''
    ].filter(Boolean).join(' · ');
    if (meta) texto.appendChild(criar('p', 'destaque-meta', meta));

    if (item.sinopse) texto.appendChild(criar('p', 'destaque-sinopse', item.sinopse));

    var botoes = criar('div', 'destaque-botoes');

    /* O triângulo é <path> em currentColor, como todo ícone do site: um "▶"
     * de texto vira emoji colorido em parte dos Android, e sai de outra fonte
     * em cada aparelho. */
    var assistir = criar('a', 'botao botao-primario destaque-assistir');
    assistir.href = '#/ep/' + encodeURIComponent(item.id);
    assistir.appendChild(iconePlay());
    assistir.appendChild(document.createTextNode(tr('site.assistir')));
    ligarAssistir(assistir, item.id);
    botoes.appendChild(assistir);

    /* "Ver a série" leva à PÁGINA da série (D6), e só existe quando ela tem
     * página — 3 ou mais títulos, a decisão D7. Numa série menor o "Assistir"
     * já chega a uma ficha que mostra a série inteira embaixo do vídeo.
     *
     * Até a D6 o botão caía na grade da prateleira da série, e por isso só
     * aparecia para quem tinha prateleira própria: uma série institucional de
     * seis títulos, como Campanhas, ficava sem ele. */
    var daSerie = App.paginaDaSerie(estado.itens, item.serie, estado.site);
    if (daSerie && daSerie.temPagina) {
      var verSerie = criar('a', 'botao', tr('site.verSerie'));
      verSerie.href = '#/serie/' + encodeURIComponent(daSerie.nome);
      botoes.appendChild(verSerie);
    }

    texto.appendChild(botoes);

    caixa.appendChild(texto);
    caixa.appendChild(molduraCapa);
    return caixa;
  }

  /* ------------------------------------------------------------ prateleiras */

  /* AS CAPAS DA PRATELEIRA DESCEM PERTO DA TELA, e quem decide a distância é o
   * site, não a rede (22/09). O `loading="lazy"` antecipa pela distância que o
   * NAVEGADOR escolhe, e ela cresce quando a rede piora: medido com o catálogo
   * de produção num Chrome sem janela em 412×823, a chegada pedia 34 capas numa
   * rede rápida e 61 numa lenta — de 87 lugares, com umas oito à vista. É na
   * rede lenta que a tela inicial foi relatada lenta, em 08/09, e era nela que
   * o navegador pedia mais.
   *
   * Um observador só, com a TELA como raiz. A pista de cada prateleira corta o
   * que passa da borda dela, então entra só o cartão à vista — e, para quem vai
   * arrastar a linha, os VIZINHOS_ADIANTE seguintes, pedidos junto. Cada cartão
   * que aparece pede os seus, e a janela anda com o dedo. Na vertical, meia
   * tela abaixo da dobra.
   *
   * Sem IntersectionObserver a capa desce na hora, com o `lazy` de antes. */
  var VIZINHOS_ADIANTE = 2;
  var capasPendentes = null;

  function pedirCapa(img) {
    var url = img && img.getAttribute('data-capa');
    if (!url) return;
    img.removeAttribute('data-capa');
    img.src = url;
  }

  /* O cartão pedido ADIANTADO continua observado: é quando ele entra na tela
   * que a janela anda e os vizinhos DELE são pedidos. Só sai da observação o
   * cartão que já apareceu. (A primeira versão soltava o vizinho junto, e o
   * arrasto curto parava de trazer capa depois do primeiro passo.) */
  function capaPerto(img, url) {
    if (typeof IntersectionObserver === 'undefined') { img.src = url; return; }
    if (!capasPendentes) {
      capasPendentes = new IntersectionObserver(function (entradas) {
        entradas.forEach(function (e) {
          if (!e.isIntersecting) return;
          pedirCapa(e.target);
          var li = e.target.closest('li');
          for (var i = 0; li && i < VIZINHOS_ADIANTE; i++) {
            li = li.nextElementSibling;
            if (li) pedirCapa(li.querySelector('img'));
          }
          capasPendentes.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px 50% 0px' });
    }
    img.setAttribute('data-capa', url);
    capasPendentes.observe(img);
  }

  /* Trocar de tela solta as capas da tela de antes: o observador guarda cada
   * imagem que observa, e elas sairiam do documento sem sair da memória. */
  function soltarCapas() {
    if (capasPendentes) capasPendentes.disconnect();
    capasPendentes = null;
  }

  /* O CARTÃO QUE ABRE: no computador, parar o
   * ponteiro num cartão da prateleira o faz crescer 1,35× por cima dos
   * vizinhos, com um painel embaixo — "Assistir", o título e a duração.
   *
   * ELE NÃO CRESCE DENTRO DA PISTA, e esse é o desenho inteiro: a pista tem
   * `overflow-x: auto`, que corta também o eixo vertical, e 1,35× não
   * cabe em folga nenhuma. Quem cresce é uma CÓPIA, posta no PALCO — a
   * moldura parada que já segura as setas, e que não corta nada —, na
   * posição do cartão. Um só por vez, para a página inteira.
   *
   * As regras de sempre: só com ponteiro fino (dedo não tem hover); a prévia
   * é a mesma peça do cartão da grade, pedida ao abrir e abortada ao fechar;
   * com movimento reduzido abre sem animar e sem prévia; nada entra na
   * carga da chegada — a capa da cópia é a mesma URL, já em cache. E fora
   * da mesa: lá o clique escolhe, não navega.
   *
   * O teclado: o foco visível num cartão abre o mesmo painel. Ele é só
   * vista — `aria-hidden`, e os links dele fora do Tab —, porque o cartão
   * focado já é o link da ficha; um segundo caminho só atravancaria a
   * travessia, como as setas (ver `prateleira`). */
  var ESPERA_POP_MS = 350;
  var ESCALA_POP = 1.35;
  var pop = { no: null, cartao: null, espera: 0, previa: null };

  function podePop() {
    return !!window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  function ligarPop(a, item) {
    a.addEventListener('mouseenter', function () {
      if (!podePop() || pop.cartao === a) return;
      clearTimeout(pop.espera);
      pop.espera = setTimeout(function () { abrirPop(a, item, true); }, ESPERA_POP_MS);
    });
    /* Sair do cartão PARA DENTRO da cópia não fecha: é ela que está por cima
     * dele assim que abre. */
    a.addEventListener('mouseleave', function (ev) {
      clearTimeout(pop.espera);
      pop.espera = 0;
      if (pop.cartao === a && !(pop.no && pop.no.contains(ev.relatedTarget))) fecharPop();
    });
    a.addEventListener('focus', function () {
      if (podePop() && a.matches(':focus-visible')) abrirPop(a, item, false);
    });
    a.addEventListener('blur', function () { if (pop.cartao === a) fecharPop(); });
  }

  function fecharPop() {
    clearTimeout(pop.espera);
    pop.espera = 0;
    if (pop.previa) pop.previa.descartar();
    if (pop.no && pop.no.parentNode) pop.no.parentNode.removeChild(pop.no);
    pop.no = pop.cartao = pop.previa = null;
  }

  /* `peloPonteiro`: só o hover pede a prévia (a regra do projeto). O foco pelo
   * teclado abre o painel com a capa parada. */
  function abrirPop(a, item, peloPonteiro) {
    var palco = a.closest('.prateleira-palco');
    if (!palco) return;
    fecharPop();

    var no = criar('div', 'pop');
    no.setAttribute('aria-hidden', 'true');
    var href = '#/ep/' + encodeURIComponent(item.id);

    var capaLink = criar('a', 'pop-capa');
    capaLink.href = href;
    capaLink.tabIndex = -1;
    var url = App.urlCapa(item);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.width = 640;
      img.height = 360;
      capaLink.appendChild(img);
    } else {
      capaLink.appendChild(capaVazia());
    }
    no.appendChild(capaLink);

    var painel = criar('div', 'pop-painel');
    var assistir = criar('a', 'botao botao-primario pop-assistir');
    assistir.href = href;
    assistir.tabIndex = -1;
    var play = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    play.setAttribute('viewBox', '0 0 24 24');
    play.setAttribute('aria-hidden', 'true');
    var tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tri.setAttribute('d', 'M8 5 L19 12 L8 19 Z');
    tri.setAttribute('fill', 'currentColor');
    play.appendChild(tri);
    assistir.appendChild(play);
    assistir.appendChild(document.createTextNode(tr('site.assistir')));
    /* O mesmo pedido de tocar do destaque (D6): abre a ficha E dá o play. */
    ligarAssistir(assistir, item.id);
    painel.appendChild(assistir);

    var texto = criar('div', 'pop-texto');
    texto.appendChild(criar('p', 'pop-titulo', App.tituloCurto(item) || item.titulo || tr('comum.semTitulo')));
    var caps = App.capitulos(item);
    var meta = [App.formatarDuracao(item), item.ano, caps.length ? tr('comum.capitulos', { n: caps.length }) : '']
      .filter(Boolean).join(' · ');
    if (meta) texto.appendChild(criar('p', 'pop-meta', meta));
    painel.appendChild(texto);
    no.appendChild(painel);

    no.addEventListener('mouseleave', function (ev) {
      if (ev.relatedTarget !== a && !a.contains(ev.relatedTarget)) fecharPop();
    });

    pop.no = no;
    pop.cartao = a;
    palco.appendChild(no);
    posicionarPop();

    /* A prévia na capa da cópia, já que é ela que está na frente. Sem espera
     * a mais: a abertura já esperou os 350 ms do ponteiro parado. */
    pop.previa = peloPonteiro ? novaPrevia(capaLink, item) : null;
    if (pop.previa) pop.previa.pedir(0);

    /* Um quadro na posição de partida (o tamanho do cartão), e só então o
     * crescimento — senão o navegador pula direto para o fim. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (pop.no === no) no.classList.add('pop-aberto'); });
    });
  }

  /* A cópia vai onde o cartão ESTÁ — medido agora, não guardado: a pista
   * rola (a roda, o Tab que traz o cartão focado) e a posição anda junto.
   * Centrada no cartão e presa às bordas do palco, para a do primeiro e a do
   * último não saírem da tela; a origem da animação é o centro do cartão, e
   * é isso que a faz parecer crescer DELE. */
  function posicionarPop() {
    if (!pop.no) return;
    var palco = pop.no.parentNode;
    /* O TAMANHO sai do layout (`offsetWidth`) e o LUGAR do retângulo na
     * tela: o cartão sob o ponteiro já está no `scale(1.03)` do hover, e o
     * retângulo o mede crescido — a cópia saía 1,39× (medido: 323 px contra
     * 313). O centro não muda com a escala, que é pelo meio. */
    var r = pop.cartao.getBoundingClientRect();
    var p = palco.getBoundingClientRect();
    var capa = pop.cartao.querySelector('.pcard-capa');
    var lCartao = pop.cartao.offsetWidth;
    var hCapa = capa ? capa.offsetHeight : lCartao * 9 / 16;
    var largura = lCartao * ESCALA_POP;
    var centro = r.left - p.left + r.width / 2;
    var esquerda = Math.max(0, Math.min(centro - largura / 2, p.width - largura));
    var meioCapa = r.top - p.top + (r.height - pop.cartao.offsetHeight) / 2 + hCapa / 2;
    var topo = meioCapa - largura * 9 / 32;
    pop.no.style.width = largura + 'px';
    pop.no.style.left = esquerda + 'px';
    pop.no.style.top = topo + 'px';
    pop.no.style.transformOrigin = (centro - esquerda) + 'px ' + (largura * 9 / 32) + 'px';
    pop.no.style.setProperty('--pop-partida', String(1 / ESCALA_POP));
  }

  /* A pista deste palco rolou: se o cartão aberto é dela, ele anda junto. */
  function seguirPop(palco) {
    if (pop.no && pop.no.parentNode === palco) posicionarPop();
  }

  /* O cartão da PRATELEIRA. O da grade (`cartao`) continua como está, e os dois
   * existem de propósito: numa linha que rola de lado o cartão é estreito e a
   * capa é quem fala, então a sinopse sai. Na grade da busca ela fica — é lá
   * que alguém está decidindo entre resultados parecidos, e o cartão deitado
   * foi medido para isso. */
  function cartaoPrateleira(item, mostrarSerie) {
    var a = criar('a', 'pcard');
    a.href = '#/ep/' + encodeURIComponent(item.id);
    marcarMesa(a, 'item:' + item.id);

    var capa = criar('div', 'pcard-capa');
    var url = App.urlCapa(item);
    if (url) {
      var img = criar('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      capaPerto(img, url);
      /* A capa tem 640×360 — 16:9. Declarar o tamanho no <img> reserva a caixa
       * mesmo antes de a folha de estilo aplicar o `aspect-ratio`, e é a mesma
       * proporção dos dois lados.
       *
       * NÃO foi isto que tirou o CLS da chegada, e este comentário chegou a
       * dizer que foi (D2). O dono do 0,0985 era o RODAPÉ, empurrado para fora
       * da tela quando o catálogo chega — o conserto está em `#conteudo`, no
       * style.css, com a medida. A caixa da capa sempre teve `aspect-ratio`. */
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(capaVazia(), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(capaVazia());
    }

    var dur = App.formatarDuracao(item);
    if (dur) capa.appendChild(criar('span', 'card-duracao', dur));
    a.appendChild(capa);
    /* Fora da mesa, o cartão ABRE (15.2), e a prévia vai na cópia que abre —
     * pedida aqui também, seriam dois megabytes pelo mesmo trecho. Na mesa,
     * onde o clique escolhe, fica a prévia de sempre, com as mesmas regras:
     * só no mouseenter, só com ponteiro fino, nunca com movimento reduzido. */
    if (mesa.ligada) ligarPreview(a, capa, item);
    else ligarPop(a, item);

    var corpo = criar('div', 'pcard-corpo');
    corpo.appendChild(criar('h3', 'pcard-titulo', App.tituloCurto(item) || tr('comum.semTitulo')));

    /* A linha que desfaz a colisão do título curto: cinco "Literatura e
     * cidadania" só se distinguem por "Parte 3".
     *
     * A SÉRIE só entra quando a prateleira mistura séries — "Até 5 minutos",
     * "Mais séries", "Curtas", "Institucional" —, porque aí ela é o que falta
     * saber. Dentro da linha *Série A* ela seria a repetição que o
     * `tituloCurto` acabou de tirar do título, uma linha abaixo. */
    var partes = [];
    if (mostrarSerie && item.serie) partes.push(item.serie);
    var numero = App.rotuloNumero(item);
    if (numero) partes.push(numero);
    if (partes.length) corpo.appendChild(criar('p', 'pcard-meta', partes.join(' · ')));

    if (!App.midiaDe(item)) {
      corpo.appendChild(criar('span', 'selo selo-erro', frase('videoIndisponivel')));
    }

    a.appendChild(corpo);
    return a;
  }

  /* Uma linha que rola de lado.
   *
   * Leitor de tela: <section aria-labelledby> com o título da prateleira, e os
   * cartões numa <ul> — assim ele anuncia "lista, 11 itens" em vez de despejar
   * onze links soltos no meio da página.
   *
   * Teclado: cada cartão é um link, então o Tab já anda sozinho e o navegador
   * rola a prateleira até o cartão com foco. Não há nada de teclado para
   * escrever aqui — o que existe é a obrigação de NÃO atrapalhar: as setas são
   * `tabindex="-1"` e `aria-hidden`, porque elas repetem um caminho que o Tab
   * já oferece e só atravancariam a travessia. */
  var seqPrateleira = 0;

  /* Uma seta que não tem para onde levar não fica na tela: a da esquerda sai no
   * começo da pista, a da direita no fim, e as duas saem na linha que já cabe
   * inteira — cinco das onze prateleiras da chegada, medidas em 1440 px.
   *
   * Os 2 px de folga são o que separa "chegou ao fim" de "faltam 0,4 px": com
   * zoom do navegador ou tela de densidade fracionária, `scrollLeft` +
   * `clientWidth` não fecha exatamente com `scrollWidth`, e sem a folga a seta
   * da direita nunca sairia — ficaria no canto pedindo um clique que não leva
   * a lugar nenhum. */
  function ajustarSetas(pista) {
    var palco = pista.parentNode;
    if (!palco) return;
    var quieta = function (classe, sim) {
      var b = palco.querySelector('.' + classe);
      if (b) b.classList.toggle('prateleira-seta-quieta', sim);
    };
    var noFim = pista.scrollLeft + pista.clientWidth >= pista.scrollWidth - 2;
    quieta('prateleira-seta-esq', pista.scrollLeft <= 2);
    quieta('prateleira-seta-dir', noFim);
    /* A borda que esmaece no celular (15.2) diz "tem mais"; no fim da pista,
     * ou na pista que cabe inteira, ela só apagaria o último cartão. */
    pista.classList.toggle('pista-no-fim', noFim);
  }

  /* UM observador para todas as pistas: o que muda a resposta de `ajustarSetas`
   * sem ninguém rolar nada é a LARGURA — a janela que encolhe, a barra lateral
   * da mesa que abre, o zoom. Uma linha que cabia inteira em 1440 px passa a
   * ter para onde rolar em 1100, e é aqui que a seta dela reaparece. */
  var observadorDePista = typeof ResizeObserver === 'undefined' ? null :
    new ResizeObserver(function (entradas) {
      for (var i = 0; i < entradas.length; i++) ajustarSetas(entradas[i].target);
    });

  function prateleira(p) {
    var id = 'prat-' + (++seqPrateleira);
    var secao = criar('section', 'prateleira');
    secao.setAttribute('aria-labelledby', id);

    var cabeca = criar('div', 'prateleira-cabeca');
    var h2 = criar('h2', 'prateleira-titulo', p.titulo);
    h2.id = id;
    cabeca.appendChild(h2);

    var tudo = criar('a', 'prateleira-tudo', tr('site.verTudo'));
    tudo.href = '#/tudo/' + encodeURIComponent(p.id);
    /* O rótulo "Ver tudo" repetido dez vezes não diz nada a quem ouve a
     * página fora de contexto. */
    tudo.setAttribute('aria-label', tr('site.verTudoDe', { titulo: p.titulo }));
    cabeca.appendChild(tudo);
    marcarMesa(cabeca, 'prateleira:' + p.id);
    secao.appendChild(cabeca);

    var pista = criar('div', 'prateleira-pista');
    var lista = criar('ul', 'prateleira-lista');
    /* Numa prateleira de série o nome dela já está no título da linha. */
    var misturaSeries = p.id.indexOf('serie:') !== 0;
    p.itens.forEach(function (item) {
      var li = criar('li');
      li.appendChild(cartaoPrateleira(item, misturaSeries));
      lista.appendChild(li);
    });
    pista.appendChild(lista);

    /* As setas só existem onde há ponteiro fino — quem tem dedo arrasta, e o
     * pedaço do próximo cartão é o convite. Quem decide isso é o CSS, pela
     * mesma pergunta que `podePreview()` faz: `(hover: hover) and (pointer:
     * fine)`. Os botões são criados sempre e escondidos lá; criá-los só com
     * matchMedia deixaria um notebook que virou tela de toque sem setas até
     * recarregar a página. */
    var faz = function (dir, rotulo) {
      var b = criar('button', 'prateleira-seta prateleira-seta-' + dir);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-hidden', 'true');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      var caminho = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      /* Ícone é <path> em currentColor: sem fonte de ícone, sem CDN. */
      caminho.setAttribute('d', dir === 'esq' ? 'M15 4 L7 12 L15 20' : 'M9 4 L17 12 L9 20');
      caminho.setAttribute('fill', 'none');
      caminho.setAttribute('stroke', 'currentColor');
      caminho.setAttribute('stroke-width', '2');
      caminho.setAttribute('stroke-linecap', 'round');
      caminho.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(caminho);
      b.appendChild(svg);
      /* O clique do mouse DÁ FOCO ao botão, e era isso que deixava as duas setas
       * acesas depois que o ponteiro ia embora: o `:focus-within` do palco
       * continuava valendo, e a linha ficava piscada sozinha. Só aparecia nas
       * prateleiras COMPRIDAS — na curta, o mesmo clique chega ao fim e a seta
       * se cala por `prateleira-seta-quieta`, que apaga por cima e esconde o
       * defeito.
       *
       * Barrar o `mousedown` tira o foco sem tirar o clique, e é o certo por um
       * segundo motivo, anterior ao sintoma: a seta é `aria-hidden` com
       * `tabindex="-1"` — ela nunca foi feita para segurar foco, e foco em nó
       * escondido do leitor de tela é lugar de onde não se volta. */
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        /* 0,9 da largura e não 1: o cartão que estava na beira continua
         * visível depois do salto, e é ele que diz onde a pessoa estava. */
        var passo = Math.round(pista.clientWidth * 0.9) * (dir === 'esq' ? -1 : 1);
        pista.scrollLeft += passo;
      });
      return b;
    };
    /* O PALCO é uma moldura PARADA, irmã da pista, e é nele que as setas se
     * penduram. Elas moravam dentro da pista até 17/09, e dali vinham os dois
     * defeitos vistos no desktop: uma caixa `position: absolute` dentro de um
     * `overflow-x: auto` se prende ao conteúdo QUE ROLA, não à moldura que o
     * mostra. Medido na página no ar, pista de 1368 px: um clique na seta
     * direita levava o scrollLeft a 84 e arrastava as DUAS setas 84 px para a
     * esquerda junto — a da esquerda parava em x = -55, fora da tela,
     * justamente no instante em que ela passava a ter serventia, e a da direita
     * descolava da borda e ia caminhando para o meio. O palco não rola, então
     * elas ficam onde foram postas. */
    var palco = criar('div', 'prateleira-palco');
    palco.appendChild(pista);
    palco.appendChild(faz('esq', tr('site.anterior')));
    palco.appendChild(faz('dir', tr('site.proxima')));

    /* `passive`: o ouvinte só LÊ a rolagem, e prometer isso ao navegador tira o
     * quadro que ele gastaria esperando um `preventDefault` que não vem. */
    pista.addEventListener('scroll', function () { ajustarSetas(pista); seguirPop(palco); }, { passive: true });
    if (observadorDePista) observadorDePista.observe(pista);

    secao.appendChild(palco);
    return secao;
  }

  /* O destaque como BLOCO da home. O fundo em movimento (home.destaque.fundo) é montado por
   * `ligarFundoDoDestaque`, que entrega `{ destruir }` — guardado aqui para a chegada redesenhada
   * (ou a ficha que abre) soltar o vídeo de fundo antes de o nó sair da página. O ponto de extensão do
   * fundo é `montarFundoDoDestaque(el, item, config)`, em destaque-fundo.js. */
  var fundoDoDestaque = null;

  function soltarFundoDoDestaque() {
    if (fundoDoDestaque) { fundoDoDestaque.destruir(); fundoDoDestaque = null; }
  }

  function blocoDoDestaque(item) {
    var caixa = destaqueHtml(item);
    var botoes = caixa.querySelector('.destaque-botoes');
    var guardar = botoes && botaoMinhaLista(item.id);
    if (guardar) botoes.appendChild(guardar);
    soltarFundoDoDestaque();
    fundoDoDestaque = ligarFundoDoDestaque(caixa, item);
    return caixa;
  }

  /* Bloco de texto e banner: texto por idioma, e (no banner) imagem e link. Tudo entra como TEXTO
   * (textContent): o que o cliente escreve na home nunca vira marcação. */
  function blocoDeTexto(entrada) {
    var t = entrada.texto;
    var secao = criar('section', 'bloco-texto bloco-texto-' + t.variante);
    var rotulo = null;
    if (t.titulo) {
      rotulo = criar('h2', 'bloco-texto-titulo', t.titulo);
      secao.appendChild(rotulo);
    }
    if (t.imagem) {
      var img = criar('img', 'bloco-texto-imagem');
      img.src = t.imagem;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      secao.appendChild(img);
    }
    String(t.texto).split(/\n\s*\n/).forEach(function (par) {
      if (par.trim()) secao.appendChild(criar('p', 'bloco-texto-corpo', par.trim()));
    });
    if (t.link) {
      var a = criar('a', 'botao bloco-texto-link', tr('home.saibaMais'));
      a.href = t.link;
      if (/^https:/.test(t.link)) a.rel = 'noopener noreferrer';   /* i18n-ignorar: valor do atributo rel, não é texto de tela */
      secao.appendChild(a);
    }
    marcarMesa(secao, 'bloco:' + entrada.bloco.id);
    return secao;
  }

  /* A busca em destaque: um campo grande no meio da home. Enviar leva o termo ao MESMO campo do cabeçalho e
   * à mesma resposta — não há uma segunda busca. */
  function blocoDeBusca(entrada) {
    var secao = criar('section', 'bloco-busca');
    secao.setAttribute('role', 'search');
    var titulo = entrada.texto && entrada.texto.titulo;
    var rotuloId = 'busca-bloco-' + entrada.bloco.id;
    if (titulo) {
      var cab = criar('h2', 'bloco-busca-titulo', titulo);
      cab.id = rotuloId + '-titulo';
      secao.appendChild(cab);
      secao.setAttribute('aria-labelledby', cab.id);
    } else {
      secao.setAttribute('aria-label', tr('site.buscarNoCatalogo'));
    }
    var form = criar('form', 'bloco-busca-form');
    var campo = criar('input', 'bloco-busca-campo');
    campo.type = 'search';
    campo.id = rotuloId;
    campo.setAttribute('aria-label', tr('site.buscarNoCatalogo'));
    campo.placeholder = tr('site.buscaPlaceholder');
    campo.autocomplete = 'off';
    var enviar = criar('button', 'botao botao-primario', tr('home.buscar'));
    enviar.type = 'submit';
    form.appendChild(campo);
    form.appendChild(enviar);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var termo = campo.value.trim();
      if (!termo) { campo.focus(); return; }
      el.busca.value = termo;
      aoDigitar();
    });
    secao.appendChild(form);
    marcarMesa(secao, 'bloco:' + entrada.bloco.id);
    return secao;
  }

  /* A CHEGADA: os blocos da home, na ordem da lista (home-blocos.js). Com a config padrão é a de sempre —
   * o destaque e as prateleiras. A grade não morreu — ela é a resposta da busca, do "Ver tudo" e do filtro
   * por série, que é o que ela faz bem. */
  function renderChegada() {
    var h = App.home(estado.itens, estado.site, contextoDaHome());
    var temFileira = h.sequencia.some(function (e) { return e.tipo === 'prateleira' && !e.prateleira.escondida; });
    var emDestaque = App.destaque(estado.itens, estado.site);
    var temDestaque = h.sequencia.some(function (e) { return e.tipo === 'destaque'; }) && !!emDestaque;
    if (!temFileira && !temDestaque && !h.sequencia.some(function (e) { return e.tipo === 'texto' || e.tipo === 'banner' || e.tipo === 'busca'; })) {
      el.grade.appendChild(estadoVazio({
        icone: 'lista',
        titulo: tr('site.nadaAindaTitulo'),
        texto: tr('site.nadaAindaTexto')
      }));
      return;
    }

    seqPrateleira = 0;
    h.sequencia.forEach(function (e) {
      if (e.tipo === 'destaque') {
        if (emDestaque) el.grade.appendChild(blocoDoDestaque(emDestaque));
      } else if (e.tipo === 'prateleira') {
        if (e.prateleira && !e.prateleira.escondida) el.grade.appendChild(prateleira(e.prateleira));
      } else if (e.tipo === 'busca') {
        el.grade.appendChild(blocoDeBusca(e));
      } else if (e.tipo === 'texto' || e.tipo === 'banner') {
        el.grade.appendChild(blocoDeTexto(e));
      }
    });

    /* AQUI, e não dentro de `prateleira()`: só depois de entrar na página a
     * pista tem largura, e é a largura que diz se a linha tem para onde rolar.
     * Ler `clientWidth` obriga o navegador a fechar o cálculo antes de
     * responder, então o primeiro quadro já sai com as setas certas — sem a
     * piscada de duas setas na linha que cabe inteira. */
    var pistas = el.grade.querySelectorAll('.prateleira-pista');
    for (var i = 0; i < pistas.length; i++) ajustarSetas(pistas[i]);
  }

  /* ------------------------------------------------------------ as séries */

  /* O cartão de uma SÉRIE: a capa do primeiro título, o nome, e o tamanho
   * dela. Veste as classes do cartão da prateleira — a mesma capa, o mesmo
   * corte em duas linhas, o mesmo crescimento pequeno — e NÃO tem prévia no
   * hover: o `preview.webp` é de um título, e a série não tem trecho que seja
   * dela.
   *
   * Leva à página da série quando ela TEM página (D7: 3 ou mais títulos), e
   * direto à ficha do primeiro título quando não tem. A ficha já mostra a
   * série inteira embaixo do vídeo; uma página de uma linha só seria um
   * clique a mais para chegar ao mesmo lugar. */
  function cartaoSerie(s) {
    var a = criar('a', 'pcard');
    a.href = s.temPagina
      ? '#/serie/' + encodeURIComponent(s.nome)
      : '#/ep/' + encodeURIComponent(s.itens[0].id);

    var capa = criar('div', 'pcard-capa');
    var url = App.urlCapa(s.itens[0]);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(capaVazia(), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(capaVazia());
    }
    a.appendChild(capa);

    var corpo = criar('div', 'pcard-corpo');
    corpo.appendChild(criar('h3', 'pcard-titulo', s.nome));
    var n = s.itens.length;
    var meta = [tr('comum.titulos', { n: n }), App.formatarMinutos(s.segundos)]
      .filter(Boolean).join(' · ');
    corpo.appendChild(criar('p', 'pcard-meta', meta));
    a.appendChild(corpo);
    return a;
  }

  /* A PÁGINA SÉRIES (D5), para onde os chips da chegada foram (decisão D8): as
   * séries em cartões, em dois grupos — o que é série e o que é
   * institucional —, pelas mesmas listas das prateleiras.
   *
   * Cada cartão leva à página da série, `#/serie/<nome>` — a rota que a D5
   * abriu como grade e que a D6 fez página —, ou à ficha, na série pequena
   * (ver `cartaoSerie`). */
  function renderIndiceSeries() {
    document.title = tr('site.tituloSeries') + ' — ' + TITULO_BASE;
    var grupos = App.gruposDeSeries(estado.itens, estado.site);
    var total = grupos.reduce(function (n, g) { return n + g.series.length; }, 0);

    el.grade.appendChild(criar('h1', 'grade-titulo', tr('site.tituloSeries')));
    el.grade.appendChild(criar('p', 'contagem', tr('comum.series', { n: total })));

    grupos.forEach(function (g) {
      var secao = criar('section', 'indice-grupo');
      secao.setAttribute('aria-labelledby', 'indice-' + g.id);
      var h2 = criar('h2', 'prateleira-titulo indice-grupo-titulo', g.titulo);
      h2.id = 'indice-' + g.id;
      secao.appendChild(h2);

      /* Uma <ul>, como na prateleira: o leitor anuncia "lista, 17 itens". */
      var lista = criar('ul', 'indice-lista');
      g.series.forEach(function (s) {
        var li = criar('li');
        li.appendChild(cartaoSerie(s));
        lista.appendChild(li);
      });
      secao.appendChild(lista);
      el.grade.appendChild(secao);
    });
  }

  /* ------------------------------------------------------- a página da série */

  /* Uma linha da lista de episódios — na página da série e embaixo do vídeo,
   * na ficha (D6). O formato é o de um catálogo de streaming:
   * capa pequena, o número, o título curto, a duração e duas linhas de
   * sinopse.
   *
   * A linha inteira é UM link, como o cartão da grade: o alvo de toque é a
   * linha toda, e não só o título. O título é o curto — "Título Y", e não "De
   * Olho no Futuro: Título Y" —, porque a série está escrita logo acima; e o
   * número que o `tituloCurto` tira do nome volta na linha de cima ("Parte
   * 3"), que é o que distingue as cinco "Tema Comum".
   *
   * A linha do título que está NA TELA não é link. Na ficha, clicar nela não
   * levaria a lugar nenhum: o endereço é o mesmo, e sem troca de hash o
   * roteador nem acorda. Ela é um bloco com `aria-current`, que é o que o
   * leitor de tela anuncia, e com o "Você está aqui" escrito.
   *
   * Sem prévia no hover, de propósito. Na ficha a lista mora embaixo de um
   * vídeo que pode estar tocando, e passar o ponteiro por ela a caminho da
   * barra de rolagem puxaria 1,13 MB por linha. Na página da série a capa é
   * pequena e a escolha é pelo título e pela sinopse. */
  function linhaEpisodio(item, atual, nivel) {
    var linha = criar(atual ? 'div' : 'a', atual ? 'ep ep-atual' : 'ep');
    if (atual) linha.setAttribute('aria-current', 'true');
    else linha.href = '#/ep/' + encodeURIComponent(item.id);
    marcarMesa(linha, 'item:' + item.id);

    var capa = criar('div', 'ep-capa');
    var url = App.urlCapa(item);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 360;
      img.addEventListener('error', function () {
        capa.replaceChild(capaVazia(), img);
      });
      capa.appendChild(img);
    } else {
      capa.appendChild(capaVazia());
    }
    var dur = App.formatarDuracao(item);
    if (dur) capa.appendChild(criar('span', 'card-duracao', dur));
    linha.appendChild(capa);

    var corpo = criar('div', 'ep-corpo');
    var sobre = [App.rotuloNumero(item), item.ano].filter(Boolean).join(' · ');
    if (sobre) corpo.appendChild(criar('p', 'ep-numero', sobre));
    corpo.appendChild(criar(nivel, 'ep-titulo', App.tituloCurto(item) || tr('comum.semTitulo')));
    if (atual) corpo.appendChild(criar('p', 'ep-aqui', tr('site.vocePareAqui')));
    var resumo = App.resumoSinopse(item);
    if (resumo) corpo.appendChild(criar('p', 'ep-sinopse', resumo));
    if (!App.midiaDe(item)) {
      corpo.appendChild(criar('span', 'selo selo-erro', frase('videoIndisponivel')));
    }
    linha.appendChild(corpo);
    return linha;
  }

  /* A lista inteira da série, numa <section> rotulada. Os episódios vão numa
   * <ol>: são uma sequência, e o leitor de tela anuncia "lista, 11 itens",
   * como a <ul> das prateleiras. Título de temporada só quando há mais de uma
   * — e aí o título do episódio desce um nível, para a página continuar
   * sendo um índice que faz sentido.
   *
   * `atualId` é o título da ficha, e '' na página da série. Na ficha a seção
   * se chama "Episódios da série" e ganha o "Ver a série" no canto, quando a
   * série tem página: é o mesmo lugar e o mesmo desenho do "Ver tudo" de uma
   * prateleira, e é pelo mesmo motivo — ir do pedaço para o inteiro. */
  function secaoEpisodios(s, atualId) {
    var secao = criar('section', 'episodios');
    secao.setAttribute('aria-labelledby', 'episodios-titulo');

    var cabeca = criar('div', 'prateleira-cabeca');
    var h2 = criar('h2', 'prateleira-titulo', atualId ? tr('site.episodiosDaSerie') : tr('site.episodios'));
    h2.id = 'episodios-titulo';
    cabeca.appendChild(h2);
    if (atualId && s.temPagina) {
      var ver = criar('a', 'prateleira-tudo', tr('site.verSerie'));
      ver.href = '#/serie/' + encodeURIComponent(s.nome);
      ver.setAttribute('aria-label', tr('site.verPaginaDaSerie', { nome: s.nome }));
      cabeca.appendChild(ver);
    }
    secao.appendChild(cabeca);

    var varias = s.temporadas.length > 1;
    s.temporadas.forEach(function (t) {
      if (varias) secao.appendChild(criar('h3', 'episodios-temporada', App.rotuloTemporada(t.temporada)));
      var lista = criar('ol', 'episodios-lista');
      t.itens.forEach(function (item) {
        var li = criar('li');
        li.appendChild(linhaEpisodio(item, item.id === atualId, varias ? 'h4' : 'h3'));
        lista.appendChild(li);
      });
      secao.appendChild(lista);
    });
    return secao;
  }

  /* O ALTO DA PÁGINA DA SÉRIE veste o desenho do destaque — é por isso que a
   * caixa leva as DUAS classes: texto à esquerda, a capa à direita, uma coluna
   * só abaixo de 900 px, e o padding em cima em vez de margem, que é o que
   * mantém o CLS em zero (a regra está no `.destaque`, com teste).
   *
   * A capa é a do primeiro título, a mesma do cartão da série na página
   * Séries: é a imagem pela qual a pessoa escolheu entrar. Uma série não tem
   * sinopse no catálogo; o que ela tem é o tamanho, e é ele que vai no lugar.
   *
   * SEM "Assistir". Numa série sem número de episódio — Série A,
   * Campanhas — o primeiro é o primeiro em ordem alfabética, e um botão grande
   * para tocá-lo escolheria por quem está chegando. A escolha é a lista, logo
   * abaixo. */
  function cabecaDaSerie(s, a) {
    var caixa = criar('section', 'destaque serie-cabeca' + (a && a.sobre ? ' serie-cabeca-com-sobre' : ''));
    caixa.setAttribute('aria-labelledby', 'serie-titulo');
    /* Na mesa, o alto da série escolhe a apresentação dela (fase 5). */
    marcarMesa(caixa, 'serie:' + s.nome);

    var texto = criar('div', 'destaque-texto');
    texto.appendChild(criar('p', 'destaque-serie', s.grupo.titulo));
    var h1 = criar('h1', 'destaque-titulo', s.nome);
    h1.id = 'serie-titulo';
    texto.appendChild(h1);
    var n = s.itens.length;
    texto.appendChild(criar('p', 'destaque-meta',
      [tr('comum.titulos', { n: n }), App.formatarMinutos(s.segundos), App.formatarAnos(s.anos)]
        .filter(Boolean).join(' · ')));

    /* O "CONTINUAR" (fase 6): o último episódio visto DESTA série, no
     * segundo em que parou. Não é o "Assistir" que o comentário acima recusa
     * — ele não escolhe por quem chega: é a escolha que a própria pessoa já
     * fez. O clique dá o play (`ligarAssistir`); o link guardado abre parado
     * no ponto. Sem memória — navegador novo, aba anônima, a rede que bloqueia
     * o armazenamento —, simplesmente não aparece. */
    var cont = App.continuarDaSerie(estado.itens, s.nome, lerOndeParou());
    if (cont) {
      var botoes = criar('div', 'destaque-botoes');
      var continuar = criar('a', 'botao botao-primario destaque-assistir serie-continuar');
      continuar.href = cont.link;
      continuar.appendChild(iconePlay());
      continuar.appendChild(document.createTextNode(tr('site.continuar')));
      ligarAssistir(continuar, cont.item.id);
      botoes.appendChild(continuar);
      botoes.appendChild(criar('p', 'serie-continuar-onde',
        tr('site.continuarDe', { titulo: App.tituloCurto(cont.item) || cont.item.titulo, tempo: App.formatarTempo(cont.t) })));
      texto.appendChild(botoes);
    }

    /* O "SOBRE" MORA NA COLUNA DO TÍTULO (pedido de 24/09): no computador, o
     * título, o texto embaixo e a capa ao lado dos dois — como faixa própria
     * embaixo do alto, sobrava uma coluna vazia ao lado da capa. No celular a
     * coluna é uma só e a capa sobe (`order`), então a leitura é a mesma. */
    if (a && a.sobre) texto.appendChild(sobreDaSerie(a, s.nome));
    caixa.appendChild(texto);

    /* A mesma capa do destaque, com as mesmas regras: 640 px no máximo, o
     * tamanho declarado para reservar a caixa, e prioridade alta — é a maior
     * coisa da primeira tela, o LCP desta página. Nenhuma prévia. */
    var moldura = criar('div', 'destaque-capa');
    var url = App.urlCapa(s.itens[0]);
    if (url) {
      var img = criar('img');
      img.src = url;
      img.alt = '';
      img.width = 640;
      img.height = 360;
      img.decoding = 'async';
      img.setAttribute('fetchpriority', 'high');
      img.addEventListener('error', function () {
        moldura.replaceChild(capaVazia(), img);
      });
      moldura.appendChild(img);
    } else {
      moldura.appendChild(capaVazia());
    }
    caixa.appendChild(moldura);
    return caixa;
  }

  /* A APRESENTAÇÃO DA SÉRIE: "Sobre a série"
   * embaixo do alto, e os três destaques numa faixa — "Comece por aqui",
   * "Momentos da série" e "Temas". Tudo sai de `App.apresentacaoDaSerie`, que
   * já tirou o que não confere: o momento cujo capítulo sumiu não chega aqui.
   *
   * NENHUMA CAPA A MAIS NA CARGA: os destaques são texto. A capa do começo e
   * as dos momentos já estão na lista de episódios logo abaixo, com `lazy`.
   *
   * O começo e o momento são o caminho do trecho da busca: o link leva à
   * ficha (no segundo, no momento) e o CLIQUE dá o play (`ligarAssistir`); o
   * link colado abre parado. O tema abre a busca por ele — e a busca responde
   * porque os temas da série entram no índice (`App.comTemasDasSeries`).
   *
   * Sem apresentação, nada disto: a página é a de antes, linha por linha. */
  function sobreDaSerie(a, nome) {
    var secao = criar('section', 'serie-sobre');
    secao.setAttribute('aria-labelledby', 'serie-sobre-titulo');
    marcarMesa(secao, 'serie:' + nome);
    var h2 = criar('h2', 'prateleira-titulo', tr('site.sobreASerie'));
    h2.id = 'serie-sobre-titulo';
    secao.appendChild(h2);
    /* Parágrafo por linha em branco: o texto é dado, e nada dele passa por
     * innerHTML. */
    a.sobre.split(/\n\s*\n/).forEach(function (par) {
      var t = par.replace(/\s+/g, ' ').trim();
      if (t) secao.appendChild(criar('p', 'serie-sobre-texto', t));
    });
    return secao;
  }

  function blocoDestaque(classe, titulo) {
    var bloco = criar('section', 'serie-caixa ' + classe);
    bloco.appendChild(criar('h2', 'serie-caixa-titulo', titulo));
    return bloco;
  }

  function destaquesDaSerie(a) {
    var faixa = criar('div', 'serie-destaques');

    if (a.comeco) {
      var b = blocoDestaque('serie-comeco', tr('site.comecePorAqui'));
      var link = criar('a', 'serie-comeco-link');
      link.href = App.linkDaFicha(a.comeco.id);
      ligarAssistir(link, a.comeco.id);
      var sobre = [App.rotuloNumero(a.comeco), App.formatarDuracao(a.comeco)].filter(Boolean).join(' · ');
      if (sobre) link.appendChild(criar('span', 'ep-numero', sobre));
      link.appendChild(criar('span', 'ep-titulo', App.tituloCurto(a.comeco) || a.comeco.titulo || tr('comum.semTitulo')));
      var resumo = App.resumoSinopse(a.comeco, 140);
      if (resumo) link.appendChild(criar('span', 'serie-comeco-sinopse', resumo));
      b.appendChild(link);
      faixa.appendChild(b);
    }

    if (a.momentos.length) {
      var m = blocoDestaque('serie-momentos', tr('site.momentosDaSerie'));
      var lista = criar('ol', 'serie-momentos-lista');
      a.momentos.forEach(function (mo) {
        var li = criar('li');
        var l = criar('a', 'trecho');
        l.href = mo.link;
        ligarAssistir(l, mo.item.id);
        l.appendChild(criar('span', 'trecho-tempo', App.formatarTempo(mo.inicio)));
        l.appendChild(document.createTextNode(' '));
        var corpo = criar('span', 'trecho-corpo');
        corpo.appendChild(criar('span', 'trecho-capitulo', mo.capitulo));
        corpo.appendChild(document.createTextNode(' '));
        corpo.appendChild(criar('span', 'ep-numero', App.tituloCurto(mo.item) || mo.item.titulo));
        l.appendChild(corpo);
        li.appendChild(l);
        lista.appendChild(li);
      });
      m.appendChild(lista);
      faixa.appendChild(m);
    }

    if (a.temas.length) {
      var t = blocoDestaque('serie-temas', tr('site.temas'));
      t.appendChild(chipsDeTemas(a.temas));
      faixa.appendChild(t);
    }
    return faixa.childNodes.length ? faixa : null;
  }

  function chipsDeTemas(temas) {
    var chips = criar('div', 'serie-temas-lista');
    temas.forEach(function (tema) {
      var chip = criar('button', 'chip', tema);
      chip.type = 'button';
      chip.setAttribute('aria-label', tr('site.buscarSobre', { tema: tema }));
      chip.addEventListener('click', function () { buscarPor(tema); });
      chips.appendChild(chip);
    });
    return chips;
  }

  /* Abrir a busca com um termo pronto: o mesmo caminho de quem digita — o
   * campo aberto, o arquivo da busca pedido, a resposta em #/. */
  function buscarPor(termo) {
    el.busca.value = termo;
    aoDigitar();
    window.scrollTo(0, 0);
  }

  /* A ENTRADA DA SÉRIE (fase 4): o cinema da chegada
   * reaproveitado — a capa se afasta só por `transform`, o nome e os números
   * sobem, depois o resto em cascata. UMA VEZ POR SÉRIE EM CADA SESSÃO: a
   * segunda visita à mesma série é trabalho, não chegada.
   *
   * Sem camada e sem marca: quem entra numa série já está dentro do site. E
   * não roda quando não pode lembrar — sem `sessionStorage` (o acesso que
   * lança, uma rede que bloqueia o armazenamento) seria a animação a cada visita —, nem com
   * movimento reduzido, nem dentro da mesa, que redesenha a cada tecla. */
  var ENTRADA_SERIE_MS = 1800;
  var CHAVE_SERIES_VISTAS = App.PREFIXO + '-series-vistas';

  function entradaDaSerie(nome) {
    if (mesa.ligada) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var vistas;
    try {
      vistas = JSON.parse(sessionStorage.getItem(CHAVE_SERIES_VISTAS) || '[]');
      if (!Array.isArray(vistas)) vistas = [];
      if (vistas.indexOf(nome) >= 0) return;
      vistas.push(nome);
      sessionStorage.setItem(CHAVE_SERIES_VISTAS, JSON.stringify(vistas));
    } catch (e) {
      return;
    }
    el.grade.classList.add('cinema-serie');
    setTimeout(function () { el.grade.classList.remove('cinema-serie'); }, ENTRADA_SERIE_MS);
  }

  /* A PÁGINA DA SÉRIE (D6): o alto, e a lista de episódios em ordem. É um ramo
   * de `renderGrade`, como a página Séries, e pelo mesmo motivo: quem chega
   * aqui vindo da ficha tem o player destruído na limpeza de lá.
   *
   * Vale para QUALQUER série, também a pequena que o cartão leva direto à
   * ficha (D7): um link guardado para `#/serie/<nome>` não pode quebrar. */
  function renderSerie(nome) {
    var s = App.paginaDaSerie(estado.itens, nome, estado.site);
    if (!s) {
      el.grade.appendChild(estadoVazio({
        icone: 'lista',
        titulo: tr('site.serieAusenteTitulo'),
        texto: tr('site.serieAusenteTexto'),
        acoes: [{ rotulo: tr('site.verTodasAsSeries'), href: '#/series', primario: true }]
      }));
      return;
    }
    document.title = s.nome + ' — ' + TITULO_BASE;
    var a = App.apresentacaoDaSerie(estado.itens, s.nome, estado.site);
    el.grade.appendChild(cabecaDaSerie(s, a));
    var destaques = a ? destaquesDaSerie(a) : null;
    if (destaques) el.grade.appendChild(destaques);
    el.grade.appendChild(secaoEpisodios(s, ''));
    /* Os TEMAS NO FIM, só no celular (pedido de 24/09): na faixa, embaixo do
     * texto, eram coisa demais antes da lista. Mesma peça, outro lugar; o CSS
     * mostra uma das duas, e a escondida sai também da leitura de tela. */
    if (a && a.temas.length) {
      var fim = blocoDestaque('serie-temas serie-temas-fim', tr('site.temas'));
      fim.appendChild(chipsDeTemas(a.temas));
      el.grade.appendChild(fim);
    }
    entradaDaSerie(s.nome);
  }

  function renderGrade() {
    soltarCapas();
    soltarFundoDoDestaque();
    fecharPop();
    limpar(el.grade);
    limpar(el.avisos);
    /* Esvaziar a ficha é o que PARA o vídeo. Apenas esconder o contêiner com
     * `hidden` deixa o iframe vivo no DOM, tocando — inclusive o áudio — quando
     * o usuário volta para a grade pelo botão do navegador.
     *
     * Para o player nosso esvaziar NÃO basta, e por isso `destruirPlayer()` vem
     * antes: o <video> some junto com a ficha, mas o hls.js sobreviveria. */
    destruirPlayer();
    limpar(el.ficha);
    el.ficha.hidden = true;
    el.grade.hidden = false;
    document.title = TITULO_BASE;

    if (!estado.carregado) return;

    var publicados = App.publicaveis(estado.itens);
    if (!publicados.length) {
      el.grade.appendChild(estadoVazio({
        icone: 'lista',
        titulo: tr('site.nadaAindaTitulo'),
        texto: tr('site.nadaAindaTexto')
      }));
      return;
    }

    /* A página Séries é um ramo DAQUI, e não uma tela à parte: ela precisa da
     * mesma limpeza lá de cima — quem chega nela vindo da ficha tem o player
     * destruído no caminho. */
    if (estado.indiceSeries) {
      marcarNav('series');
      renderIndiceSeries();
      return;
    }

    /* A página de uma série (D6) é outro ramo daqui, pelo mesmo motivo. Ela
     * mora na seção Séries do cabeçalho, e é lá que o sublinhado fica. */
    if (estado.serieRota) {
      marcarNav('series');
      renderSerie(estado.serieRota);
      return;
    }

    /* A CHEGADA é a prateleira; a GRADE é a resposta — da busca, do filtro por
     * série e do "Ver tudo". Sem pergunta não há o que responder, e é por isso
     * que a grade sai da tela inicial sem sair do site. */
    if (!estado.termo && !estado.serie && !estado.prateleira) {
      marcarNav('inicio');
      renderChegada();
      return;
    }
    marcarNav('');
    /* Uma resposta na tela é busca aberta — é o caso de quem volta da ficha
     * pelo botão do navegador: no celular o campo reaparece com o termo. */
    if (estado.termo) marcarBusca(true);

    /* De onde a resposta veio, dito em uma linha. O "Ver tudo" abre uma grade
     * que não tem termo digitado nem chip aceso: sem este título ela pareceria
     * o catálogo inteiro. */
    var prat = estado.prateleira ? App.prateleiraPorId(estado.itens, estado.prateleira, estado.site, contextoDaHome()) : null;
    if (estado.prateleira && !prat) {
      el.grade.appendChild(estadoVazio({
        icone: 'lista',
        titulo: tr('site.listaAusenteTitulo'),
        texto: tr('site.listaAusenteTexto'),
        acoes: [{ rotulo: tr('comum.voltarAoInicio'), href: '#/', primario: true }]
      }));
      return;
    }
    if (prat) {
      el.grade.appendChild(criar('h1', 'grade-titulo', prat.titulo));
      document.title = prat.titulo + ' — ' + TITULO_BASE;
    }

    /* O chip filtra a resposta da busca, e é por isso que as séries dele saem
     * dela ANTES do chip: ligado um, os outros continuam à mão. */
    var resposta = responder(baseDaGrade(), estado.termo);
    var opcoes = App.seriesDoFiltro(resposta.titulos, estado.serie);
    if (opcoes.length) el.grade.appendChild(filtroSeries(opcoes));

    var lista = App.filtrarPorSerie(resposta.titulos, estado.serie);
    /* O chip vale para os trechos também: ligado "Séries", um trecho do
     * *Título X* embaixo da grade contradiria o botão aceso. */
    var trechos = estado.serie
      ? resposta.trechos.filter(function (t) { return (t.item.serie || semSerie()) === estado.serie; })
      : resposta.trechos;
    if (busca.abertosDe !== estado.termo) {
      busca.abertos = Object.create(null);
      busca.abertosDe = estado.termo;
    }

    /* "N títulos · M trechos". */
    var contagem = (lista.length !== publicados.length
      ? tr('site.titulosDeTotal', { n: lista.length, total: publicados.length })
      : tr('comum.titulos', { n: lista.length })) +
      (trechos.length ? ' · ' + tr('comum.trechos', { n: trechos.length }) : '');
    /* O vazio do B8 só quando nem título nem trecho responde — e aí SEM a
     * contagem: "0 títulos de 69" logo acima de "Nenhum vídeo encontrado" diz
     * a mesma coisa duas vezes, a primeira em língua de programador (D7). */
    var vazia = !lista.length && !trechos.length;
    if (!vazia) el.grade.appendChild(criar('p', 'contagem', contagem));

    if (vazia) {
      /* Duas saídas: apagar a busca e voltar às prateleiras, ou olhar as
       * séries — quem não achou pelo nome muitas vezes acha pelo lugar. O
       * termo entra em linha própria, fora da frase editável. */
      el.grade.appendChild(estadoVazio({
        icone: 'busca',
        titulo: frase('buscaVazia'),
        termo: estado.termo.trim(),
        texto: frase('buscaVaziaAjuda'),
        acoes: [
          { rotulo: tr('site.limparBusca'), primario: true, aoClicar: function () {
            fecharBusca();
            el.busca.focus();
          } },
          { rotulo: tr('site.verAsSeries'), href: '#/series' }
        ]
      }));
      if (estado.termo) anunciar(frase('buscaVazia'));
      return;
    }
    if (estado.termo) anunciar(contagem);

    /* Uma grade só, sem cabeçalho de série: os blocos por série deixavam um
     * cartão sozinho por faixa e a tela inteira vazia à direita. A ordem é a
     * da resposta: por RELEVÂNCIA quando há termo — o
     * título com a palavra no nome antes do que só a tem na sinopse —, e a de
     * `ordenar()` no "Ver tudo" e no chip, onde cada série segue junta. Quem
     * quiser ver uma série isolada vai pela página Séries, ou pelo chip. */
    var grade = criar('div', 'grade');
    lista.forEach(function (item) { grade.appendChild(cartao(item, resposta.porSentido[item.id])); });
    el.grade.appendChild(grade);

    /* Embaixo da grade, os TRECHOS: o pedaço do vídeo que responde. */
    if (trechos.length) el.grade.appendChild(secaoTrechos(trechos, resposta.casadas));
  }

  /* -------------------------------------------------------------- capítulos */

  /* Os capítulos aparecem em DOIS lugares, e quem desenha o primeiro depende
   * de qual player está no ar:
   *
   *   - na LINHA DO TEMPO. Com o embed, são os capítulos nativos do Bunny,
   *     gravados no vídeo por scripts/capitulos.mjs: o iframe é de outro
   *     domínio (o do provedor), a página não alcança o DOM dele e
   *     não desenha nada por cima. Com o player nosso, desde a fase 3, quem
   *     segmenta a barra e mostra o título sob o ponteiro é player.js.
   *   - na LISTA clicável abaixo do player, que é o que este trecho monta, e
   *     que funciona igual nos dois casos.
   *
   * Com o embed, a lista atravessa a fronteira do iframe pelo único caminho
   * que existe: o Player.js do provedor (se o embed o declara), que dá ao pai controle de reprodução por
   * postMessage.
   *
   * REGRA DE PRODUTO: só chamamos `setCurrentTime`. NUNCA `play()`. Pular para
   * um capítulo posiciona o vídeo; quem decide tocar é quem aperta o play. */
  var playerjsPromessa = null;

  /* O endereço do script vem do SERVIDOR (`midia.embed.scriptUrl`, declarado
   * pelo adaptador do provedor que tem esse controle): o navegador não sabe de
   * qual host ele é. Carregado sob demanda, e só na ficha de quem tem
   * capítulos: a tela inicial não paga por um script que ela não usa. */
  function carregarPlayerjs(url) {
    if (playerjsPromessa) return playerjsPromessa;
    playerjsPromessa = new Promise(function (resolve, reject) {
      if (window.playerjs) { resolve(window.playerjs); return; }
      if (!url) { reject(new Error(tr('site.erroCarregarPlayerJs'))); return; }
      var tag = document.createElement('script');
      tag.src = url;
      tag.async = true;
      tag.addEventListener('load', function () {
        if (window.playerjs) resolve(window.playerjs);
        else reject(new Error('playerjs carregou sem expor window.playerjs')); /* i18n-ignorar: contrato com a biblioteca, mensagem técnica */
      });
      tag.addEventListener('error', function () {
        reject(new Error(tr('site.erroCarregarPlayerJs')));
      });
      document.head.appendChild(tag);
    });
    return playerjsPromessa;
  }

  /* UM Player.js POR IFRAME, e não um por freguês: a lista de capítulos e o
   * momento do endereço (`?t=`, fase 2 da busca) falam com o mesmo embed, e
   * duas instâncias no mesmo quadro seriam dois ouvintes de postMessage
   * disputando as mesmas mensagens. A promessa resolve no `ready` do player
   * do Bunny, e só com o iframe ainda na página: voltar para a grade destrói a
   * ficha, e instanciar o Player em cima de um nó solto deixaria um ouvinte
   * vivo. */
  var conversasComEmbed = typeof WeakMap === 'undefined' ? null : new WeakMap();

  function conversaComEmbed(iframe) {
    var guardada = conversasComEmbed && conversasComEmbed.get(iframe);
    if (guardada) return guardada;
    var conversa = carregarPlayerjs(iframe.getAttribute('data-controle-url')).then(function (playerjs) {
      return new Promise(function (resolve, reject) {
        if (!iframe.isConnected) { reject(new Error(tr('site.fichaSaiu'))); return; }
        var p = new playerjs.Player(iframe);
        p.on('ready', function () {
          if (iframe.isConnected) resolve(p);
          else reject(new Error(tr('site.fichaSaiu')));
        });
      });
    });
    if (conversasComEmbed) conversasComEmbed.set(iframe, conversa);
    return conversa;
  }

  /* Lista clicável dos capítulos. Devolve null quando o título não tem
   * nenhum — 22 dos 33 no ar não têm, e a ficha deles não pode ganhar uma
   * caixa vazia. */
  function listaCapitulos(item, alvo) {
    var caps = App.capitulos(item);
    if (!caps.length) return null;

    var secao = criar('section', 'capitulos');
    secao.setAttribute('aria-label', tr('site.capitulosDoVideo'));
    secao.appendChild(criar('h2', 'capitulos-titulo', tr('site.capitulosTitulo')));

    var lista = criar('ol', 'capitulos-lista');
    var botoes = [];
    caps.forEach(function (c) {
      var li = criar('li');
      var b = criar('button', 'capitulo');
      b.type = 'button';
      b.appendChild(criar('span', 'capitulo-tempo', App.formatarTempo(c.inicio)));
      b.appendChild(criar('span', 'capitulo-nome', c.titulo));
      li.appendChild(b);
      lista.appendChild(li);
      botoes.push(b);
    });
    secao.appendChild(lista);

    var posicionar = null;   /* como levar o vídeo a um segundo — depende do alvo */
    var pendente = null;     /* clique que chegou antes de o player responder */
    var atual = -1;

    function procurar(segundos) {
      if (posicionar) posicionar(segundos);
      else pendente = segundos;
    }

    /* Um alvo ficou pronto. Daqui para a frente o clique posiciona de verdade,
     * e o que chegou antes é atendido agora. */
    function ativar(comoPosicionar) {
      posicionar = comoPosicionar;
      secao.classList.add('capitulos-ativos');
      if (pendente != null) { comoPosicionar(pendente); pendente = null; }
    }

    function destacar(indice) {
      if (indice === atual) return;      /* timeupdate dispara muitas vezes por segundo */
      if (atual >= 0 && botoes[atual]) botoes[atual].removeAttribute('aria-current');
      if (indice >= 0 && botoes[indice]) botoes[indice].setAttribute('aria-current', 'true');
      atual = indice;
    }

    /* O clique é ligado JÁ, não depois do `ready`: entre desenhar a lista e o
     * iframe responder passam centenas de milissegundos, e um botão que ignora
     * o primeiro clique parece quebrado. O que chegar antes fica em `pendente`. */
    botoes.forEach(function (b, i) {
      b.addEventListener('click', function () { procurar(caps[i].inicio); });
    });

    /* Dois alvos possíveis, um comportamento só. O que muda é a distância:
     * o player nosso está do lado, o embed está do outro lado de uma fronteira
     * de domínio e só responde por postMessage. */

    if (alvo && alvo.irPara) {
      /* PLAYER NOSSO (fase 0). Já está pronto neste instante — sem script
       * externo, sem postMessage, sem `ready` para esperar. */
      ativar(function (s) {
        alvo.irPara(s);
        /* Destaca na hora, sem esperar o `timeupdate`. Com `preload: none`,
         * clicar num capítulo ANTES do primeiro play não dispara timeupdate
         * nenhum — não há mídia carregada — e a lista ficava sem destaque
         * como se o clique não tivesse funcionado. */
        destacar(App.capituloEm(caps, s));
      });
      /* `aoTempo` e não um `timeupdate` no <video>: o player avisa TAMBÉM nos
       * pulos que ele mesmo faz — o Ctrl+seta da fase 3 — que sem mídia
       * carregada não disparam evento nenhum. Ouvir só o <video> deixaria a
       * lista destacando o capítulo anterior depois de um pulo por tecla. */
      alvo.aoTempo(function (segundos) {
        destacar(App.capituloEm(caps, segundos));
      });
      return secao;
    }

    /* EMBED DO PROVEDOR. O iframe é de outro domínio; o Player.js é o único
     * caminho que atravessa, e a conversa com ele é a mesma do momento do
     * endereço (`conversaComEmbed`). */
    conversaComEmbed(alvo).then(function (p) {
      ativar(function (s) { p.setCurrentTime(s); });
      /* Só posição: nada aqui reage ao FIM do vídeo, e nada avança sozinho. */
      p.on('timeupdate', function (d) {
        destacar(App.capituloEm(caps, d && d.seconds));
      });
    }).catch(function () {
      /* Sem Player.js a lista continua valendo como índice do vídeo, com os
       * horários. O que ela perde é o clique — e a classe `capitulos-ativos`,
       * que é quem dá o visual de coisa clicável, nunca entra. */
    });

    return secao;
  }

  /* ------------------------------------------------------------------ ficha */

  function linhaDados(dl, rotulo, valor) {
    if (!valor) return;
    dl.appendChild(criar('dt', null, rotulo));
    dl.appendChild(criar('dd', null, valor));
  }

  /* O alto da coluna do lado, como no destaque (D6): a série e o episódio em
   * cima do título, em amarelo, e a duração, o ano e os capítulos embaixo
   * dele. Até a D6 era uma linha só, embaixo do título, com as cinco coisas. */
  function serieDaFicha(item) {
    return [item.serie, rotuloEp(item)].filter(Boolean).join(' · ');
  }

  function metaDaFicha(item) {
    var caps = App.capitulos(item).length;
    return [App.formatarDuracao(item), item.ano, caps ? tr('comum.capitulos', { n: caps }) : '']
      .filter(Boolean).join(' · ');
  }

  /* Na mesa, o título e a sinopse da ficha são editáveis ali mesmo: o que se vê
   * é o que se grava. O CARTÃO não — ele mostra o título
   * curto, que não existe no catálogo. Os outros campos marcados servem só
   * para a mesa achar o nó e atualizá-lo no lugar. Fora da mesa, nada muda. */
  function campoDaFicha(no, item, campo) {
    if (!mesa.ligada) return no;
    marcarMesa(no, 'item:' + item.id);
    no.setAttribute('data-mesa-campo', campo);
    if (mesa.editavel && (campo === 'titulo' || campo === 'sinopse')) {
      try { no.contentEditable = 'plaintext-only'; } catch (e) { no.contentEditable = 'true'; }
    }
    if (campo === 'sinopse') no.setAttribute('data-vazio', tr('site.sinopseAusente'));
    return no;
  }

  /* Uma mudança do rascunho com a ficha aberta. Redesenhar a ficha passaria por
   * `destruirPlayer()`, e o vídeo pararia a cada tecla digitada na mesa. Então
   * os textos são trocados no lugar — e o campo onde alguém está digitando não
   * é tocado, senão o cursor pularia para o começo. */
  function atualizarFichaNoLugar(id) {
    var item = App.porId(estado.itens, id);
    var titulo = el.ficha.querySelector('[data-mesa-campo="titulo"]');
    var sinopse = el.ficha.querySelector('[data-mesa-campo="sinopse"]');
    if (!item || !titulo || !sinopse) { renderFicha(id); return; }
    var foco = document.activeElement;

    if (titulo !== foco) titulo.textContent = item.titulo || tr('comum.semTitulo');
    el.ficha.querySelector('[data-mesa-campo="serie"]').textContent = serieDaFicha(item);
    el.ficha.querySelector('[data-mesa-campo="meta"]').textContent = metaDaFicha(item);
    if (sinopse !== foco) sinopse.textContent = item.sinopse || '';
    sinopse.classList.toggle('sinopse-vazia', !item.sinopse);

    /* A linha dele na lista da série, embaixo do vídeo, mostra o título CURTO:
     * sem isto, o nome digitado na mesa mudaria no alto e ficaria velho ali. */
    var naLista = el.ficha.querySelector('.ep-atual .ep-titulo');
    if (naLista) naLista.textContent = App.tituloCurto(item) || tr('comum.semTitulo');

    var pend = el.ficha.querySelector('[data-mesa-campo="pendencia"]');
    if (item.pendencia && pend) {
      pend.textContent = App.rotuloPendencia(item.pendencia);
    } else if (item.pendencia) {
      sinopse.parentNode.insertBefore(
        campoDaFicha(aviso(App.rotuloPendencia(item.pendencia)), item, 'pendencia'), sinopse);
    } else if (pend) {
      pend.parentNode.removeChild(pend);
    }

    document.title = (item.titulo || tr('site.tituloPadrao')) + ' — ' + TITULO_BASE;
    pintarSelecao();
  }

  /* `tocar` é o pedido do "Assistir" (ver `ligarAssistir`), e só o roteador o
   * passa. Os outros caminhos que remontam a ficha — o deslize ↓ da fase 7, a
   * mesa — chamam sem ele, e a ficha volta com o vídeo parado.
   *
   * `momento` é o `?t=` do endereço: o segundo em que o
   * vídeo abre. O clique num trecho traz os dois — o momento na URL e o
   * pedido de tocar fora dela —, e o link colado traz só o momento. */
  /* De onde vem o início sem gesto desta ficha (só 'proximo-episodio'), lido
   * por `renderFicha` logo ao criar o player. Zerado a cada ficha. */
  var origemDoInicioDaFicha = '';
  function consumirOrigemDoInicio() {
    var o = origemDoInicioDaFicha;
    origemDoInicioDaFicha = '';
    return o;
  }

  function renderFicha(id, tocar, momento, jaEsperou) {
    /* Trocar de episódio — pela lista da série embaixo do vídeo, ou pelo
     * Shift+N — vem de uma ficha direto para outra, sem passar pela grade: sem
     * isto, o hls.js do título anterior continuaria puxando segmentos enquanto
     * o novo começa. */
    destruirPlayer();
    /* A chegada fica escondida (não apagada) atrás da ficha: o vídeo de fundo do destaque, se havia, sai agora. */
    soltarFundoDoDestaque();
    limpar(el.ficha);
    limpar(el.avisos);
    el.grade.hidden = true;
    el.ficha.hidden = false;
    marcarNav('');

    /* O player ainda descendo (ver `carregarPlayer`): a ficha espera por ele,
     * com prazo, e se desenha depois — com o pedido de tocar e o momento
     * intactos. Desenhar já com o iframe trocaria o player de quem abriu um
     * link direto de ficha. A espera fica vazia, e é curta: numa ficha aberta
     * pelo link o arquivo desce junto com o catálogo, e na chegada ele desce
     * logo depois da capa do destaque.
     *
     * Na volta, duas conferências: ninguém abriu outra ficha no meio
     * (`vezDaFicha`), e o endereço ainda é o desta ficha — voltar à chegada
     * não passa por aqui, e sem isso a ficha atrasada cairia por cima dela.
     * E `jaEsperou`: vencido o prazo, a ficha sai com o que houver, em vez de
     * esperar outro prazo inteiro. */
    var vez = ++vezDaFicha;
    var espera = jaEsperou ? null : playerATempo();
    if (espera) {
      espera.then(function () {
        var rota = App.rotaDaFicha(window.location.hash || '');
        if (vez === vezDaFicha && rota && rota.id === id) renderFicha(id, tocar, momento, true);
      });
      return;
    }

    /* Na mesa a ficha abre também título fora do ar: é nela que se revisa a
     * sinopse de quem ainda não foi publicado. */
    var item = App.porId(mesa.ligada ? estado.itens : App.publicaveis(estado.itens), id);
    if (!item) {
      el.ficha.appendChild(estadoVazio({
        icone: 'ausente',
        titulo: frase('fichaAusente'),
        texto: frase('fichaAusenteAjuda'),
        acoes: [
          { rotulo: tr('comum.voltarAoInicio'), href: '#/', primario: true },
          { rotulo: tr('site.buscarNoCatalogo'), aoClicar: abrirBusca }
        ]
      }));
      document.title = tr('site.naoEncontrado') + ' — ' + TITULO_BASE;
      return;
    }

    document.title = (item.titulo || tr('site.tituloPadrao')) + ' — ' + TITULO_BASE;

    var voltar = criar('a', 'voltar', tr('site.voltarAoCatalogo'));
    voltar.href = '#/';
    el.ficha.appendChild(voltar);

    var grade = criar('div', 'ficha');

    /* ---- o vídeo ---- */
    var coluna = criar('div', 'ficha-video');
    var caixa = criar('div', 'player');
    var midia = App.midiaDe(item);

    /* A quem a lista de capítulos vai falar: o player nosso ou o iframe. */
    var alvoCapitulos = null;

    /* Calculado antes do player porque ele precisa dos vizinhos para o
     * Shift+N / Shift+P do teclado. Eles saem da mesma lista que a ficha
     * desenha embaixo do vídeo (`App.paginaDaSerie`), então a tecla anda pela
     * ordem que a tela mostra. */
    var viz = App.vizinhos(estado.itens, item.id);

    /* O player nosso é o PADRÃO desde 03/09. As duas redes de segurança
     * continuam armadas, e é o que torna a virada barata de desfazer:
     *
     *   - `?player=embed` na URL devolve o iframe do Bunny, na hora;
     *   - se `criar()` devolver null por QUALQUER motivo — ou se o `player.js`
     *     nem tiver carregado, e aí `AppPlayer` é `undefined` —, o bloco
     *     seguinte assume e ninguém fica sem vídeo. */
    if (midia && playerNovoLigado()) {
      playerAtivo = AppPlayer.criar(item, estado.config, {
        anterior: viz.anterior, proximo: viz.proximo,
        abrirProximo: abrirProximoEpisodio,
        origemDoInicio: consumirOrigemDoInicio(),
        /* O deslize ↓ da fase 7, em tela cheia deitada: o player pede para ser
         * fechado, e quem sabe fazer isso é daqui.
         *
         * `renderFicha` do MESMO id é o caminho certo, e não um `location.hash`:
         * já estamos nessa rota, então trocar o hash para ele não dispara
         * `hashchange` e nada aconteceria. Ela começa por `destruirPlayer()`,
         * que mata a instância do hls.js — numa conexão lenta, parar de
         * puxar segmentos é metade do valor do gesto — e remonta a ficha com a
         * capa no lugar do vídeo, que é onde quem deslizou esperava parar. */
        aoFechar: function () { renderFicha(item.id); }
      });
      if (playerAtivo) {
        caixa.appendChild(playerAtivo.no);
        caixa.classList.add('player-nosso');
        alvoCapitulos = playerAtivo;
      }
    }

    if (midia && !alvoCapitulos && App.urlEmbed(midia)) {
      var iframe = document.createElement('iframe');
      iframe.src = App.urlEmbed(midia);
      iframe.title = tr('site.tituloDoPlayer', { titulo: item.titulo || '' });
      iframe.loading = 'lazy';
      /* `autoplay` fica DE FORA da permission policy de propósito: é a segunda
       * tranca contra o vídeo tocar sozinho, caso o parâmetro do player falhe. */
      iframe.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
      iframe.setAttribute('allowfullscreen', '');
      /* Só o embed que declara controle por postMessage entrega o script; sem
       * ele a lista de capítulos fica só como índice. */
      if (midia.embed && midia.embed.controle === 'playerjs' && midia.embed.scriptUrl) {
        iframe.setAttribute('data-controle-url', midia.embed.scriptUrl);
      }
      caixa.appendChild(iframe);
      alvoCapitulos = iframe;
    }

    if (!midia) {
      caixa.appendChild(criar('div', 'player-ausente',
        tr('site.videoEmProcessamento')));
    }
    coluna.appendChild(caixa);
    grade.appendChild(coluna);

    /* ---- a coluna do lado ----
     * A D6 arrumou esta coluna como o texto do destaque: a série em amarelo,
     * o título, e a duração, o ano e os capítulos numa linha. Abaixo de 900 px
     * ela desce para baixo do player — e é por isso que o TÍTULO vem logo
     * depois do vídeo no celular, e não depois de uma lista de 24 capítulos,
     * como até a D6. */
    var lado = criar('div', 'ficha-lado');
    lado.appendChild(campoDaFicha(criar('p', 'destaque-serie ficha-serie', serieDaFicha(item)), item, 'serie'));
    lado.appendChild(campoDaFicha(criar('h1', null, item.titulo || tr('comum.semTitulo')), item, 'titulo'));

    lado.appendChild(campoDaFicha(criar('p', 'ficha-meta', metaDaFicha(item)), item, 'meta'));

    /* O "CONTINUAR" DA FICHA (decisão de 24/09): quem já viu parte deste
     * título e volta a ele por qualquer caminho ganha o botão — sem o tempo
     * escrito, como pedido. NADA RETOMA SOZINHO: o vídeo continua em 0, e
     * retomar é o clique, que leva ao `?t=` do mesmo título e dá o play pelo
     * caminho do trecho da busca (`ligarAssistir`). Não aparece quando a ficha
     * já veio com um momento (`?t=`) ou com o pedido do "Assistir", nem na
     * mesa, nem no iframe — que não grava onde parou. E sai no primeiro play:
     * quem escolheu começar do zero não precisa dele na tela. */
    var ponto = playerAtivo && alvoCapitulos === playerAtivo && momento == null && !tocar && !mesa.ligada
      ? App.ondeParouDe(lerOndeParou(), item.id) : null;
    if (ponto) {
      var continuar = criar('a', 'botao botao-primario destaque-assistir ficha-continuar');
      continuar.href = ponto.link;
      continuar.appendChild(iconePlay());
      continuar.appendChild(document.createTextNode(tr('site.continuar')));
      ligarAssistir(continuar, item.id);
      lado.appendChild(continuar);
      playerAtivo.video.addEventListener('play', function () {
        if (continuar.parentNode) continuar.parentNode.removeChild(continuar);
      }, { once: true });
    }

    var guardarNaLista = botaoMinhaLista(item.id);
    if (guardarNaLista) lado.appendChild(guardarNaLista);

    if (item.pendencia) {
      lado.appendChild(campoDaFicha(aviso(App.rotuloPendencia(item.pendencia)), item, 'pendencia'));
    }

    if (item.sinopse) {
      lado.appendChild(campoDaFicha(criar('p', 'sinopse', item.sinopse), item, 'sinopse'));
    } else {
      /* Na mesa o parágrafo vazio vira campo: o texto de "não disponível" mora
       * no atributo, e o CSS o mostra só enquanto ninguém digitou. */
      var vazia = criar('p', 'sinopse sinopse-vazia', mesa.ligada ? '' : tr('site.sinopseAusente'));
      vazia.setAttribute('data-vazio', tr('site.sinopseAusente'));
      lado.appendChild(campoDaFicha(vazia, item, 'sinopse'));
    }

    /* Titularidade e nível de evidência SAÍRAM da ficha (04/09). São
     * classificação interna — quem responde pela obra e o quanto a origem foi
     * conferida —, e servem a quem cataloga, não a quem vai assistir. O lugar
     * delas é o /admin, onde continuam inteiras. Saíram também da projeção
     * pública da API: campo que o site não desenha não precisa viajar. */
    var dl = criar('dl', 'dados');
    linhaDados(dl, tr('site.dadoTema'), item.tema);
    linhaDados(dl, tr('site.dadoPublicoAlvo'), item.publico_alvo);
    linhaDados(dl, tr('site.dadoTags'), (item.tags || []).join(', '));
    if (dl.childNodes.length) lado.appendChild(dl);

    /* Capítulos: a linha do tempo segmentada e o título sob o ponteiro vêm do
     * Bunny quando o player é o embed, e do nosso player.js desde a fase 3.
     * Esta lista é a outra metade, e funciona igual nos dois casos.
     *
     * Ela mora na coluna do lado desde a D6, e não mais embaixo do player: no
     * computador fica AO LADO do vídeo, onde se clica num capítulo sem perder
     * o quadro de vista. O comportamento é o mesmo — quem a monta continua
     * sendo `listaCapitulos`, com o mesmo alvo. */
    if (alvoCapitulos) {
      var caps = listaCapitulos(item, alvoCapitulos);
      if (caps) lado.appendChild(caps);
    }

    grade.appendChild(lado);

    /* ---- a série, embaixo do vídeo ----
     * "Episódios da série" (D6), no lugar dos dois botões ← → que havia
     * embaixo do player. É a lista da página da série, com este título
     * marcado, e aparece quando há PARA ONDE ir: série de um título só não
     * ganha uma lista com uma linha, que seria ela mesma.
     *
     * Ela é o TERCEIRO filho da grade, e quem a põe no lugar é o CSS: no
     * computador, embaixo do player e na coluna dele, com a coluna do lado
     * descendo ao lado dos dois; no celular, depois do texto e dos
     * capítulos. Como seção solta depois da grade, ela começava embaixo da
     * coluna do lado — 749 px de altura contra os 497 do player, medido em
     * 1400 px —, com 370 px de vazio embaixo do vídeo e a próxima linha abaixo
     * da dobra.
     *
     * A navegação continua explícita: muda de episódio quem clica numa linha,
     * ou quem aperta Shift+N / Shift+P, que anda pela mesma ordem. Nada aqui
     * reage ao fim do vídeo. */
    var daSerie = App.paginaDaSerie(estado.itens, item.serie || semSerie(), estado.site);
    var outros = daSerie ? daSerie.itens.filter(function (i) { return i.id !== item.id; }).length : 0;
    if (outros) grade.appendChild(secaoEpisodios(daSerie, item.id));

    el.ficha.appendChild(grade);

    window.scrollTo(0, 0);

    /* O MOMENTO, antes do play: é para lá que o play vai. Pela entrada que a
     * lista de capítulos já usa — `irPara` no player nosso, `setCurrentTime`
     * pelo Player.js no embed —, e depois da lista montada, para ela acender o
     * capítulo em que o momento cai. Nenhuma entrada nova no player. */
    if (momento != null && alvoCapitulos) irAoMomento(alvoCapitulos, momento);

    /* O play do "Assistir", por último: com a ficha inteira na página. Só o
     * player nosso sabe atender — o iframe do `?player=embed` é a saída de
     * emergência, e continua esperando o clique no play dele. */
    if (tocar && playerAtivo) playerAtivo.tocar();
  }

  function irAoMomento(alvo, segundos) {
    if (alvo.irPara) { alvo.irPara(segundos); return; }
    conversaComEmbed(alvo).then(function (p) { p.setCurrentTime(segundos); }, function () {
      /* Sem Player.js o embed abre do começo — que é a ficha de antes da
       * busca, e não um defeito novo. */
    });
  }

  /* ------------------------------------------------------------------ rotas */

  /* A rota traz o id ou o nome CODIFICADO. Um endereço torto — um `%` solto,
   * colado de um aplicativo de mensagem — faz `decodeURIComponent` lançar, e o
   * roteador inteiro parava junto: tela vazia, sem aviso. Torto, o texto segue
   * como veio e cai no "não encontrado" de cada tela. */
  function decodificar(texto) {
    try {
      return decodeURIComponent(texto);
    } catch (e) {
      return texto;
    }
  }

  function rotear() {
    var hash = window.location.hash || '#/';
    avisarMesa({ tipo: 'rota', hash: hash });
    /* A ficha esconde a grade sem redesenhá-la: sem isto, o cartão aberto
     * ficaria lá dentro, escondido, com a prévia ainda baixando. */
    fecharPop();

    /* Trocar de TELA começa do alto. O cabeçalho é sticky e o "Séries" está
     * sempre à mão: sem isto, quem estava na oitava prateleira caía no fim da
     * página nova, com a rolagem da antiga. Redesenhar a MESMA tela — o Início
     * no mesmo endereço, um chip, uma letra na busca — não passa por aqui, ou
     * passa com o mesmo hash, e não mexe na rolagem. A ficha já sobe sozinha. */
    var trocouDeTela = hash !== estado.rota;
    estado.rota = hash;

    /* O pedido do "Assistir" vale para UMA troca de tela, e é consumido aqui
     * em todas, tocando ou não (ver `ligarAssistir`). */
    var pedido = pedidoDeTocar;
    pedidoDeTocar = '';
    var pedidoAutomatico = proximoAutomatico;
    proximoAutomatico = '';
    origemDoInicioDaFicha = '';

    /* `#/ep/<id>`, e `#/ep/<id>?t=<segundos>` desde a fase 2 da busca — o
     * link de um trecho. Quem separa o momento do id é o core
     * (`App.rotaDaFicha`), e o `t` que não é inteiro já chega como null. */
    var ficha = App.rotaDaFicha(hash);
    if (ficha) {
      /* A busca fica guardada — o botão de voltar do navegador devolve a
       * resposta —, mas o campo recolhe: a ficha é do vídeo. */
      marcarBusca(false);
      origemDoInicioDaFicha = pedidoAutomatico === ficha.id ? 'proximo-episodio' : '';
      renderFicha(ficha.id, pedido === ficha.id, ficha.t);
      return;
    }

    var indice = hash === '#/series';
    /* `#/serie/<nome>` — a página de uma série (D6). Era a grade dela até ali,
     * e a rota é a mesma de propósito: link guardado continua valendo. */
    var serie = hash.match(/^#\/serie\/(.+)$/);
    /* `#/tudo/<id da prateleira>` — a mesma lista da linha, em grade. */
    var tudo = hash.match(/^#\/tudo\/(.+)$/);

    /* Séries e "Ver tudo" são telas que não mostram a busca: chegar nelas é
     * deixar a busca para trás. Sem isto um termo esquecido filtraria a grade
     * de uma série em silêncio — no celular, com o campo recolhido e nada na
     * tela dizendo por quê. */
    if (indice || serie || tudo) esquecerBusca();

    var prateleira = tudo ? decodificar(tudo[1]) : '';
    var serieRota = serie ? decodificar(serie[1]) : '';
    /* O chip refina a resposta de UMA tela: trocar de lista o desfaz. */
    if (prateleira !== estado.prateleira || serieRota !== estado.serieRota ||
        indice !== estado.indiceSeries) {
      estado.serie = '';
    }
    estado.prateleira = prateleira;
    estado.serieRota = serieRota;
    estado.indiceSeries = indice;

    if (trocouDeTela) window.scrollTo(0, 0);
    renderGrade();
  }

  /* ----------------------------------------------------------------- início */

  /* Uma mudança do rascunho com a chegada ou a grade na tela: redesenha, e
   * devolve cada prateleira à rolagem de lado em que estava. */
  function redesenharPelaMesa() {
    var ficha = App.rotaDaFicha(window.location.hash);
    if (ficha && !el.ficha.hidden) { atualizarFichaNoLugar(ficha.id); return; }
    var laterais = {};
    var pistas = document.querySelectorAll('[data-mesa^="prateleira:"]');
    for (var i = 0; i < pistas.length; i++) {
      var p = pistas[i].parentNode.querySelector('.prateleira-pista');
      if (p) laterais[pistas[i].getAttribute('data-mesa')] = p.scrollLeft;
    }
    var topo = window.scrollY;
    /* A mesma porta do roteador: `renderGrade` desenha toda tela que não é a
     * ficha — a chegada, Séries, a série, o "Ver tudo" — a partir do estado. */
    renderGrade();
    pistas = document.querySelectorAll('[data-mesa^="prateleira:"]');
    for (var j = 0; j < pistas.length; j++) {
      var q = pistas[j].parentNode.querySelector('.prateleira-pista');
      var v = laterais[pistas[j].getAttribute('data-mesa')];
      if (q && v) q.scrollLeft = v;
    }
    window.scrollTo(0, topo);
  }

  /* Tudo o que só existe dentro da mesa, ligado uma vez. */
  function ligarMesa() {
    document.documentElement.classList.add('modo-mesa');
    marcarMesa(document.querySelector('.marca'), 'marca');
    marcarMesa(document.querySelector('.rodape'), 'rodape');

    window.addEventListener('message', function (ev) {
      if (ev.origin !== window.location.origin || ev.source !== window.parent) return;
      var m = ev.data;
      if (!m || m.app !== 'mesa') return;

      if (m.tipo === 'catalogo' && m.dados) {
        mesa.editavel = m.editavel !== false;
        receberDados(m.dados);
        if (mesa.aoPrimeiroCatalogo) {
          var primeiro = mesa.aoPrimeiroCatalogo;
          mesa.aoPrimeiroCatalogo = null;
          primeiro();
          return;
        }
        redesenharPelaMesa();
      } else if (m.tipo === 'selecao') {
        mesa.selecao = m.alvo || '';
        pintarSelecao();
      } else if (m.tipo === 'ir' && typeof m.hash === 'string' && m.hash.indexOf('#/') === 0) {
        window.location.hash = m.hash;
      } else if (m.tipo === 'rolar' && m.alvo) {
        rolarAteMesa(m.alvo);
      }
    });

    /* Um clique num marcado ESCOLHE, não navega. Link dentro de um marcado —
     * o "Ver tudo" no cabeçalho da prateleira — continua navegando, e o player
     * nunca é interceptado: na mesa ele toca, pausa e pula como no site. */
    document.addEventListener('click', function (ev) {
      if (ev.target.closest('.player')) return;
      var alvo = ev.target.closest('[data-mesa]');
      var link = ev.target.closest('a');
      if (!alvo || (link && link !== alvo)) return;
      if (!alvo.isContentEditable) ev.preventDefault();
      avisarMesa({ tipo: 'selecionar', alvo: alvo.getAttribute('data-mesa') });
    }, true);

    /* O duplo clique num cartão abre a ficha, como o clique abre no site — e a
     * linha de episódio da página da série é um cartão deitado (D6). */
    document.addEventListener('dblclick', function (ev) {
      var alvoCartao = ev.target.closest('a.card, a.pcard, a.ep');
      if (alvoCartao) window.location.hash = alvoCartao.getAttribute('href');
    });

    document.addEventListener('input', function (ev) {
      var no = ev.target;
      if (!no.isContentEditable || !no.hasAttribute('data-mesa-campo')) return;
      avisarMesa({
        tipo: 'editar',
        alvo: no.getAttribute('data-mesa'),
        campo: no.getAttribute('data-mesa-campo'),
        valor: no.textContent
      });
    });

    /* Título e sinopse são uma linha de texto para o catálogo: Enter termina a
     * edição em vez de quebrar o parágrafo. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.isContentEditable && ev.target.hasAttribute('data-mesa-campo')) {
        ev.preventDefault();
        ev.target.blur();
      }
    });
  }

  /* O SERVICE WORKER é OPCIONAL e mínimo (`recursos.pwaCacheDoShell`, desligado por padrão): guarda só a casca do
   * site para abrir com a rede ruim, e nunca toca em API, conta, mesa ou vídeo (ver o sw.js, gerado por
   * aplicar-config). Ligado: registra depois do `load`, para não disputar banda com a capa do destaque.
   * Desligado: se algum dia ele foi instalado, o sw.js "de desligar" apaga os caches e se desinstala — aqui só se
   * pede a ele que olhe o arquivo de novo. Na mesa nunca se registra nada. */
  function cuidarDoServiceWorker() {
    if (mesa.ligada || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    var ligado = !!(CONFIG_PUBLICA && CONFIG_PUBLICA.recursos && CONFIG_PUBLICA.recursos.pwaCacheDoShell === true);
    var agir = function () {
      if (ligado) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { /* o site segue sem ele */ });
      } else {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) {
            var a = r.active || r.waiting || r.installing;
            /* Só o NOSSO: o sw.js da raiz. Outro app no mesmo domínio tem o dele, e não é daqui mexer. */
            var nosso = false;
            try { nosso = !!a && new URL(a.scriptURL).pathname === '/sw.js'; } catch (e) { nosso = false; }
            if (nosso) r.update().catch(function () { /* ignora */ });
          });
        }).catch(function () { /* ignora */ });
      }
    };
    if (document.readyState === 'complete') agir();
    else window.addEventListener('load', agir, { once: true });
  }

  function iniciar() {
    /* O catálogo e o idioma descem JUNTOS; a primeira tela só é desenhada quando
     * os dois chegaram (um texto sem catálogo de idioma sairia como chave). */
    var idiomaPronto = carregarIdioma();
    if (mesa.ligada) ligarMesa();
    ligarTopo();
    ligarAbertura();

    /* A contagem da busca, dita a quem ouve a página. O nó nasce aqui,
     * vazio e escondido da vista, e é o mesmo por toda a visita. */
    busca.anuncio = criar('p', 'pular');
    busca.anuncio.setAttribute('role', 'status');
    busca.anuncio.setAttribute('aria-live', 'polite');
    el.conteudo.insertBefore(busca.anuncio, el.conteudo.firstChild);

    el.busca.addEventListener('input', aoDigitar);
    /* O arquivo da busca desce no FOCO, antes da primeira tecla: quando ela
     * vem, ele quase sempre já chegou. */
    el.busca.addEventListener('focus', prepararBusca);
    el.busca.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fecharBusca();
    });
    el.abrirBusca.addEventListener('click', abrirBusca);
    el.fecharBusca.addEventListener('click', fecharBusca);

    var inicios = document.querySelectorAll('[data-inicio]');
    for (var i = 0; i < inicios.length; i++) inicios[i].addEventListener('click', irAoInicio);

    /* O ATALHO DE PULAR não pode passar pelo roteador. Ele é um link para
     * #conteudo — um hash —, e numa ficha o roteador lia a troca como a
     * chegada: o player era destruído e o foco ia para o <body> (conferido em
     * 15/09). Aqui ele só leva o foco ao <main>, que tem `tabindex="-1"` para
     * isso, e o próximo Tab entra no conteúdo. */
    el.pular.addEventListener('click', function (ev) {
      ev.preventDefault();
      el.conteudo.focus();
    });

    window.addEventListener('hashchange', rotear);

    /* O esqueleto do index.html tem a forma da CHEGADA. Numa ficha, numa série
     * ou numa busca ele desenharia uma tela que não vem — melhor o vazio de
     * antes do que uma promessa errada. */
    var hash = window.location.hash;
    if (hash && hash !== '#/' && hash !== '#') limpar(el.grade);

    /* O player (ver `carregarPlayer`): o link de uma ficha o pede JÁ, junto
     * com o catálogo. O resto, depois do primeiro desenho (abaixo). */
    var comecaNaFicha = !!App.rotaDaFicha(hash || '');
    if (comecaNaFicha) carregarPlayer();

    Promise.all([idiomaPronto, carregar(idiomaPronto)]).then(function () {
      rotear();
      abrirChegada();
      carregarMinhaLista();
      cuidarDoServiceWorker();
      if (!comecaNaFicha) depoisDaCapaPrincipal(carregarPlayer);
    }).catch(function (erro) {
      /* O texto da falha precisa do idioma já carregado (ele nunca rejeita). */
      return idiomaPronto.then(function () { return erro; });
    }).then(function (erro) {
      if (!erro) return;
      soltarAbertura(false);
      estado.carregado = false;
      limpar(el.grade);
      el.ficha.hidden = true;
      el.grade.hidden = false;
      /* A mensagem técnica vai numa linha à parte, menor, e não no meio da
       * frase: o texto é editável na mesa, e um buraco no meio some na
       * primeira reescrita. Ela continua na tela porque é o que a equipe
       * técnica vai pedir a quem avisar.
       *
       * "Tentar de novo" RECARREGA a página, e não só refaz o pedido: se a
       * falha foi um deploy no meio do caminho, o app.js desta página pode
       * ser o velho. */
      el.grade.appendChild(estadoVazio({
        icone: 'rede',
        erro: true,
        titulo: frase('erroCatalogo'),
        texto: frase('erroCatalogoAjuda'),
        acoes: [{ rotulo: tr('site.tentarDeNovo'), primario: true, aoClicar: function () { window.location.reload(); } }],
        detalhe: tr('site.detalheTecnico', { mensagem: erro.message })
      }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
