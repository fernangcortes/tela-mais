/* guardiao.js — o GUARDIÃO: quem decide se um vídeo pode começar sem um gesto.
 *
 * REGRA 3 do AGENTS.md: nada toca sozinho sem passar por aqui. Há UM guardião,
 * `podeIniciarSozinho(contexto, config)`, e dois lugares do projeto que chamam
 * `.play()`:
 *   - `tocarPorGesto`    (player.js)        — a pessoa apertou play, tecla, toque;
 *   - `tocarAutomatico`  (player.js e destaque-fundo.js) — só depois do guardião.
 * Os testes (tests/player-guardiao.test.js) conferem as duas pontas.
 *
 * O que o guardião garante, para QUALQUER config:
 *   1. `autoplay.modo: 'nunca'` (o padrão) -> nenhum início sem gesto no player;
 *   2. nenhuma opção produz ÁUDIO sem gesto: toda decisão que deixa tocar sem
 *      gesto vem com `mudo: true`, exceto `com-som-apos-interacao` e o próximo
 *      episódio, que só valem DEPOIS de a pessoa já ter interagido com a página
 *      (`contexto.jaInteragiu`, vindo de um clique/tecla/toque de verdade);
 *   3. o vídeo de fundo do destaque é sempre mudo, nunca conta como reprodução, e
 *      nunca carrega com "reduzir movimento" ou economia de dados.
 *
 * Sem DOM, sem rede: o mesmo molde do player-core.js. Carregado como <script>
 * (window.AppGuardiao) e, nos testes, como módulo CommonJS. */
(function (raiz) {
  'use strict';

  var MODOS_AUTOPLAY = ['nunca', 'mudo', 'com-som-apos-interacao'];
  var MODOS_PROXIMO = ['nunca', 'perguntar', 'automatico'];
  var MODOS_RETOMAR = ['nunca', 'perguntar', 'automatico'];
  var TIPOS_FUNDO = ['capa', 'previa-animada', 'video-mudo'];

  /* O padrão É o comportamento de hoje: nada toca, nada avança, nada retoma. */
  var VELOCIDADES_PADRAO = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  function escolher(valor, lista, padrao) {
    return lista.indexOf(valor) >= 0 ? valor : padrao;
  }

  function inteiro(valor, min, max, padrao) {
    var n = typeof valor === 'number' ? valor : NaN;
    if (!isFinite(n)) return padrao;
    n = Math.round(n);
    return n < min ? min : n > max ? max : n;
  }

  function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  /* O bloco `player` de onde ele estiver: a config inteira (`{ player: {...} }`)
   * ou o próprio bloco. */
  function blocoPlayer(config) {
    var c = objeto(config);
    return objeto(c.player && typeof c.player === 'object' ? c.player : c);
  }

  /* Velocidades: números entre 0,25 e 4, sem repetir, em ordem, com o 1× sempre
   * presente (é a volta ao normal). Lista torta -> a de hoje. */
  function velocidades(bruto) {
    if (!Array.isArray(bruto)) return VELOCIDADES_PADRAO.slice();
    var v = [];
    bruto.forEach(function (n) {
      if (typeof n === 'number' && isFinite(n) && n >= 0.25 && n <= 4) {
        n = Math.round(n * 100) / 100;
        if (v.indexOf(n) < 0) v.push(n);
      }
    });
    if (v.length < 2) return VELOCIDADES_PADRAO.slice();
    if (v.indexOf(1) < 0) v.push(1);
    v.sort(function (a, b) { return a - b; });
    return v.slice(0, 12);
  }

  /* A config do player, com tudo no lugar. Aceita nomes antigos do esquema
   * (`desligado` = nunca; `sempre` = automatico). */
  function configDoPlayer(config) {
    var p = blocoPlayer(config);
    var a = objeto(p.autoplay);
    var n = objeto(p.proximoEpisodio);
    var r = objeto(p.retomar);
    var m = objeto(p.marcaDagua);
    var l = objeto(p.legenda);
    var d = objeto(p.download);
    var modoProximo = n.modo === 'desligado' ? 'nunca' : n.modo;
    var modoRetomar = r.modo === 'sempre' ? 'automatico' : r.modo;
    var texto = typeof m.texto === 'string' ? m.texto.trim().slice(0, 60) : '';
    var idioma = typeof l.idiomaPadrao === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l.idiomaPadrao)
      ? l.idiomaPadrao : null;
    return {
      autoplay: {
        modo: escolher(a.modo, MODOS_AUTOPLAY, 'nunca'),
        somenteDesktop: a.somenteDesktop !== false,
        respeitarEconomiaDeDados: a.respeitarEconomiaDeDados !== false
      },
      proximoEpisodio: {
        modo: escolher(modoProximo, MODOS_PROXIMO, 'nunca'),
        segundosDeContagem: inteiro(n.segundosDeContagem, 1, 60, 8),
        mostrarCartaoNosUltimosSeg: inteiro(n.mostrarCartaoNosUltimosSeg, 0, 120, 20)
      },
      retomar: {
        modo: escolher(modoRetomar, MODOS_RETOMAR, 'nunca'),
        guardarPosicao: r.guardarPosicao !== false
      },
      velocidades: velocidades(p.velocidades),
      legenda: { idiomaPadrao: idioma },
      marcaDagua: { ligada: m.ligada === true && texto !== '', texto: texto },
      download: { ligado: d.ligado === true }
    };
  }

  /* `automatico` sem autoplay não pode existir: avançar e tocar sozinho é
   * exatamente o que `autoplay.modo: 'nunca'` proíbe. Vira `perguntar`: o cartão
   * aparece e quem toca é o clique. */
  function proximoEfetivo(config) {
    var c = configDoPlayer(config);
    if (c.proximoEpisodio.modo === 'automatico' && c.autoplay.modo === 'nunca') return 'perguntar';
    return c.proximoEpisodio.modo;
  }

  /* O fundo do destaque. Aceita a config inteira (`home.destaque.fundo`), o
   * bloco `fundo` ou `destaque`. Nomes antigos do esquema: `imagem` e `nenhum`
   * viram `capa`. "Reduzir movimento" e economia de dados SEMPRE valem (o
   * esquema só aceita `true`); aqui nem se lê o campo. */
  function fundoDoDestaque(config) {
    var c = objeto(config);
    var f = c.home && c.home.destaque ? c.home.destaque.fundo
      : c.destaque ? c.destaque.fundo
      : c.fundo ? c.fundo : c;
    f = objeto(f);
    var tipo = f.tipo === 'imagem' || f.tipo === 'nenhum' ? 'capa' : f.tipo;
    return {
      tipo: escolher(tipo, TIPOS_FUNDO, 'capa'),
      atrasoMs: inteiro(f.atrasoMs, 0, 10000, 1200),
      somenteDesktop: f.somenteDesktop !== false,
      repeticoes: inteiro(f.repeticoes, 1, 5, 2),
      usarTrailer: f.usarTrailer !== false
    };
  }

  function recusa(motivo) { return { pode: false, mudo: true, motivo: motivo }; }

  /* A DECISÃO, com o porquê. `contexto`:
   *   origem              'autoplay' | 'proximo-episodio' | 'fundo-mudo'
   *   jaInteragiu         a pessoa já deu um clique/tecla/toque nesta página
   *   visivel             a página está à vista: aba visível e não é a prévia da mesa
 *                       (false = recusa)
   *   telaPequena         celular
   *   economiaDeDados     navigator.connection.saveData (ou conexão 2G)
   *   movimentoReduzido   prefers-reduced-motion: reduce
   * Devolve { pode, mudo, motivo }. Ausência de dado = o mais fechado. */
  function decisaoDeInicio(contexto, config) {
    var c = objeto(contexto);
    var origem = c.origem || 'autoplay';
    if (c.visivel === false) return recusa('aba-oculta');

    if (origem === 'fundo-mudo') {
      var f = fundoDoDestaque(config);
      /* Prévia animada também é movimento por conta própria: mesmo portão. */
      if (f.tipo === 'capa') return recusa('fundo-desligado');
      if (c.movimentoReduzido !== false) return recusa('movimento-reduzido');
      if (c.economiaDeDados !== false) return recusa('economia-de-dados');
      if (f.somenteDesktop && c.telaPequena !== false) return recusa('celular');
      return { pode: true, mudo: true, motivo: 'fundo' };
    }

    if (origem !== 'autoplay' && origem !== 'proximo-episodio') return recusa('origem-desconhecida');
    var p = configDoPlayer(config);
    var a = p.autoplay;
    if (a.modo === 'nunca') return recusa('autoplay-nunca');
    if (origem === 'proximo-episodio') {
      if (proximoEfetivo(config) !== 'automatico') return recusa('proximo-nao-automatico');
    } else {
      if (c.movimentoReduzido === true) return recusa('movimento-reduzido');
      if (a.somenteDesktop && c.telaPequena !== false) return recusa('celular');
      if (a.respeitarEconomiaDeDados && c.economiaDeDados !== false) return recusa('economia-de-dados');
    }
    var interagiu = c.jaInteragiu === true;
    if (a.modo === 'com-som-apos-interacao' && !interagiu) return recusa('sem-interacao');
    /* O som só sai com modo `com-som-apos-interacao` E interação anterior. */
    var comSom = a.modo === 'com-som-apos-interacao' && interagiu;
    return { pode: true, mudo: !comSom, motivo: origem };
  }

  /* O GUARDIÃO. Um booleano; quem precisa do "mudo" ou do motivo usa
   * `decisaoDeInicio`, que é a mesma regra. */
  function podeIniciarSozinho(contexto, config) {
    return decisaoDeInicio(contexto, config).pode === true;
  }

  /* -------------------------------------------------- próximo e retomar */

  /* O cartão do próximo episódio aparece nos últimos N segundos (ou no fim).
   * Só com próximo episódio, modo diferente de `nunca` e duração conhecida. */
  function cartaoDoProximoVisivel(t, duracao, config, temProximo) {
    if (!temProximo) return false;
    var modo = proximoEfetivo(config);
    if (modo === 'nunca') return false;
    if (!isFinite(duracao) || duracao <= 0 || !isFinite(t) || t <= 0) return false;
    var janela = configDoPlayer(config).proximoEpisodio.mostrarCartaoNosUltimosSeg;
    return duracao - t <= janela;
  }

  /* A contagem do próximo episódio É o tempo que falta para o fim do vídeo:
   * ela zera junto com ele, e pausar a congela. Devolve os segundos que faltam
   * (inteiro, para cima) quando a contagem já deve aparecer, ou null. Só no
   * modo `automatico`; em `perguntar` o cartão não conta nada. */
  function contagemDoProximo(t, duracao, config) {
    if (proximoEfetivo(config) !== 'automatico') return null;
    if (!isFinite(duracao) || duracao <= 0 || !isFinite(t) || t <= 0) return null;
    var n = configDoPlayer(config).proximoEpisodio.segundosDeContagem;
    var falta = duracao - t;
    if (falta > n) return null;
    return Math.max(0, Math.ceil(falta));
  }

  /* Retomar: devolve o segundo em que parou ou null. `ponto` é o que o core
   * guarda ({ t }). Nada de retomar com `modo: 'nunca'`, com momento pedido
   * (`?t=`) ou com o ponto no começo. */
  function pontoParaRetomar(ponto, config, momentoPedido) {
    var modo = configDoPlayer(config).retomar.modo;
    if (modo === 'nunca' || momentoPedido) return null;
    if (!ponto || typeof ponto.t !== 'number' || !isFinite(ponto.t) || ponto.t < 5) return null;
    return ponto.t;
  }

  var AppGuardiao = {
    MODOS_AUTOPLAY: MODOS_AUTOPLAY,
    MODOS_PROXIMO: MODOS_PROXIMO,
    MODOS_RETOMAR: MODOS_RETOMAR,
    TIPOS_FUNDO: TIPOS_FUNDO,
    VELOCIDADES_PADRAO: VELOCIDADES_PADRAO,
    configDoPlayer: configDoPlayer,
    fundoDoDestaque: fundoDoDestaque,
    proximoEfetivo: proximoEfetivo,
    decisaoDeInicio: decisaoDeInicio,
    podeIniciarSozinho: podeIniciarSozinho,
    cartaoDoProximoVisivel: cartaoDoProximoVisivel,
    contagemDoProximo: contagemDoProximo,
    pontoParaRetomar: pontoParaRetomar
  };

  raiz.AppGuardiao = AppGuardiao;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppGuardiao;
})(typeof globalThis !== 'undefined' ? globalThis : this);
