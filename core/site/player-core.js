/* player-core.js — as decisões do player nosso: sem DOM, sem rede, sem hls.js.
 *
 * Mesmo molde do catalogo-core.js, e pela mesma razão: os 51 testes do projeto
 * rodam em `node --test`, sem navegador. Um player é DOM puro — se a lógica
 * morar junto com o DOM, ela nasce sem teste.
 *
 * A divisão é esta, e vale para todas as fases do player:
 *   - AQUI mora o que DECIDE. "que estratégia de reprodução usar", "para que
 *     segundo ir", "que ação este gesto virou". Funções puras, entra dado e
 *     sai dado.
 *   - Em player.js mora o que TOCA no DOM. Fino e burro de propósito: recebe a
 *     decisão pronta e a aplica.
 *
 * Carregado de dois jeitos, sem etapa de build:
 *   - no navegador, como <script> comum, expondo window.AppPlayerCore;
 *   - nos testes, como módulo CommonJS (require('./player-core.js')).
 */
(function (raiz) {
  'use strict';

  /* A tradução (i18n.js): `tr` lê a instância global; sem o i18n.js devolve a chave. */
  var I18n = raiz.AppI18n || (typeof require === 'function' ? require('./i18n.js') : null);
  function tr(chave, params) { return I18n ? I18n.t(chave, params) : chave; }

  /* ================================================================ regras
   *
   * AS TRÊS REGRAS DE PRODUTO. Hoje elas são quatro parâmetros na URL do embed
   * do Bunny (`urlEmbed()` em catalogo-core.js), com teste em cima. Num player
   * nosso cada uma vira código nosso — e é por isso que este objeto existe
   * separado e congelado: ele é o lugar único onde as regras estão escritas, e
   * os testes apontam para cá.
   *
   * NÃO relaxe nenhuma delas para "facilitar" alguma fase seguinte. Se alguma
   * fase parecer exigir isso, a fase está errada.
   */
  var REGRAS = Object.freeze({
    /* 1. nada toca sozinho — nem `autoplay`, nem `.play()` que não venha de um
     *    clique/tecla/toque de quem está assistindo. */
    autoplay: false,

    /* 2. nada repete — o vídeo acaba e fica parado no fim. */
    loop: false,

    /* 3. nada avança sozinho — nenhum listener de `ended` navega para lugar
     *    nenhum. Trocar de episódio é só por clique explícito. */
    avancoAutomatico: false,

    /* Equivalente ao `preload=false` do embed: nada de rede antes do play.
     * Vale para o <video> E para o hls.js — ver `configHls()`. */
    preload: 'none',

    /* Era `lembrarPosicao: false`, o `rememberPosition=false` do embed. Desde a
     * a fase 6 (decisão de 23/09) o player GRAVA onde o
     * vídeo parou, para o "Continuar" da página da série — mas NUNCA retoma
     * sozinho: todo título aberto abre em 0, ou no `?t=` do link. Retomar é um
     * clique no "Continuar", e é a página da série quem lê a chave, não o
     * player. */
    retomarSozinho: false
  });

  /* Atributos que o <video> tem que receber para cumprir REGRAS.
   *
   * Devolvido como dado, não aplicado aqui, justamente para o teste poder
   * conferir sem DOM. Quem aplica é `montarVideo()` em player.js.
   */
  function atributosVideo() {
    return {
      autoplay: false,
      loop: false,
      preload: REGRAS.preload,

      /* Controles nativos DESLIGADOS: a barra é nossa a partir da fase 0. */
      controls: false,

      /* Sem isto o iPhone abre o vídeo em tela cheia nativa ao dar play e
       * engole todos os gestos e a barra inteira. É obrigatório. */
      playsInline: true,

      /* Para a fase 4 (Web Audio): sem `crossorigin`, o Safari tocando HLS
       * nativo entrega uma mídia "suja" e `createMediaElementSource` devolve
       * silêncio. A pull zone responde `Access-Control-Allow-Origin: *`
       * (conferido em 01/09), então pedir CORS aqui não custa nada — e o
       * cabeçalho `Referer` continua indo, que é o que a pull zone exige. */
      crossOrigin: 'anonymous'
    };
  }

  /* ================================================================ fontes */

  function hostPullzone(config) {
    var pullzone = config && config.pullzone;
    if (!pullzone) return null;
    return String(pullzone).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  /* HLS adaptativo da pull zone: 240p a 1080p, segmentos de 4 s.
   * Conferido em 01/09: responde 200 com `Access-Control-Allow-Origin: *`. */
  function urlHls(fonte, config) {
    var host = hostPullzone(config);
    if (!fonte || !fonte.videoId || !host) return null;
    if (fonte.tipo && fonte.tipo !== 'bunny') return null;
    return 'https://' + host + '/' + fonte.videoId + '/playlist.m3u8';
  }

  /* MP4 progressivo — rede de segurança, nunca o caminho principal.
   *
   * ARMADILHA: o MP4 não tem qualidade adaptativa. Num vídeo de 10 minutos o
   * 720p tem 130 MB e o 1080p tem 270 MB (medido em 01/09). Numa rede
   * compartilhada isso não se sustenta: por isso o padrão do fallback é 360p, e não
   * a melhor resolução disponível.
   */
  function urlMp4(fonte, config, resolucao) {
    var host = hostPullzone(config);
    if (!fonte || !fonte.videoId || !host) return null;
    if (fonte.tipo && fonte.tipo !== 'bunny') return null;
    return 'https://' + host + '/' + fonte.videoId + '/play_' + (resolucao || '360p') + '.mp4';
  }

  /* Qual caminho de reprodução TENTAR. Pura de propósito: quem descobre o
   * suporte do navegador é player.js, que passa o resultado para cá.
   *
   *   mseDisponivel — existe MediaSource no navegador. Checagem barata, feita
   *                   ANTES de baixar o hls.js: não adianta puxar 353 KB para
   *                   descobrir que não há MSE.
   *   hlsNativo     — o <video> diz que toca application/vnd.apple.mpegurl.
   *
   * ARMADILHA, medida em 01/09 e não suposta: **`canPlayType` mente**. O
   * Chromium 148 no Windows responde `"maybe"` para
   * `application/vnd.apple.mpegurl` e NÃO toca HLS coisa nenhuma — o vídeo
   * fica parado em `readyState: 0` para sempre. O Chrome do Android faz o
   * mesmo há anos.
   *
   * Por isso a ordem é esta e não a intuitiva: **o hls.js ganha sempre que
   * houver MSE**, e o caminho nativo é a RESERVA para quem não tem MSE — que
   * na prática é o iPhone, onde não existe MediaSource em <video> e o HLS
   * nativo do Safari é de verdade.
   *
   * Efeito colateral bom, que importa na fase 4: com o hls.js a mídia vem de
   * um `blob:` do MSE, que é mesma-origem. O grafo do Web Audio não esbarra
   * em CORS. No caminho nativo, esbarraria.
   */
  function estrategia(suporte) {
    var s = suporte || {};
    if (s.mseDisponivel) return 'hlsjs';
    if (s.hlsNativo) return 'nativo';
    /* Navegador velho demais para os dois: sobra o MP4 progressivo. */
    return 'mp4';
  }

  /* Configuração do hls.js.
   *
   * `autoStartLoad: false` é a REGRA 1 e o `preload` traduzidos para o hls.js:
   * sem ele, a biblioteca começa a puxar segmentos assim que é instanciada, e
   * abrir uma ficha passaria a gastar banda de quem só queria ler a sinopse.
   * Quem chama `startLoad()` é o primeiro play — e só ele.
   */
  function configHls() {
    return {
      autoStartLoad: false,
      /* A pull zone é protegida por Allowed Referrers: as requisições do
       * hls.js precisam sair com `Referer`, que é o que a política declarada
       * no <meta> do index.html garante. Não mexa. */
      xhrSetup: null,
      /* Buffer curto: acervo VOD numa rede compartilhada. Não
       * adianta encher 60 s de buffer para muita gente ao mesmo tempo. */
      maxBufferLength: 30,
      backBufferLength: 30,
      /* Começa modesto e sobe: com muita gente dando play junto, subir do
       * 360p é muito melhor do que travar tentando 1080p. */
      startLevel: -1,
      capLevelToPlayerSize: true
    };
  }

  /* ================================================================= tempo */

  /* Todo pulo do player passa por aqui — teclado, gesto, capítulo, barra.
   *
   * `duracao` pode ser NaN ou Infinity: antes do `loadedmetadata` o <video>
   * devolve NaN, e é exatamente nesse instante que um clique na lista de
   * capítulos chega. Nesse caso o limite de cima não existe ainda e só o
   * chão de 0 vale.
   */
  function limitarTempo(segundos, duracao) {
    var t = Number(segundos);
    if (!isFinite(t) || t < 0) t = 0;
    var d = Number(duracao);
    if (isFinite(d) && d > 0 && t > d) t = d;
    return t;
  }

  /* Pular N segundos a partir de onde está, sem passar das pontas. */
  function tempoRelativo(atual, delta, duracao) {
    return limitarTempo((Number(atual) || 0) + (Number(delta) || 0), duracao);
  }

  /* `0`–`9` do teclado: 0% a 90% da duração.
   *
   * Devolve null quando ainda não há duração — pular para "30% de NaN" mandaria
   * o vídeo para 0 sem que ninguém entendesse por quê.
   */
  function tempoPorDecimo(digito, duracao) {
    var n = Number(digito);
    if (!isFinite(n) || n < 0 || n > 9) return null;
    var d = Number(duracao);
    if (!isFinite(d) || d <= 0) return null;
    return limitarTempo((d * n) / 10, d);
  }


  /* ============================================================= capítulos
   *
   * Fase 3. Os 238 capítulos já vinham do KV desde 31/08 e a lista clicável
   * abaixo do player já funcionava — com o EMBED, quem desenhava os segmentos
   * na linha do tempo e mostrava o título sob o ponteiro era o Bunny, dentro
   * do iframe. Trocado o player, isso passa a ser nosso, e é o que esta seção
   * decide: onde cada segmento começa e termina, e para onde o Ctrl+seta vai.
   *
   * O QUE NÃO ESTÁ AQUI, de propósito: "qual capítulo está tocando". Essa
   * pergunta já tem dono desde 31/08 — `App.capituloEm`, em catalogo-core.js,
   * com teste. Quem chama daqui passa o índice já calculado. Duas respostas
   * para a mesma pergunta, em arquivos diferentes, é exatamente como uma
   * delas fica para trás sem ninguém perceber.
   */

  /* A barra é SEMPRE feita de segmentos: um só quando o título não tem
   * capítulos (22 dos 33 no ar), um por capítulo quando tem. Isso deixa um
   * caminho de desenho só no player.js — e garante que a barra de quem não
   * tem capítulo continue idêntica à de antes desta fase.
   *
   * `esquerda` e `largura` saem em PORCENTAGEM da duração, prontas para virar
   * estilo. O player.js não faz conta nenhuma: recebe o desenho pronto.
   *
   * Sem duração conhecida (NaN antes do `loadedmetadata`, num item sem
   * `duracao_seg` no catálogo) não dá para saber onde cortar — e a resposta
   * certa é a barra INTEIRA, não a barra vazia. Some o corte, nunca a barra.
   */
  function segmentosCapitulos(caps, duracao) {
    var d = Number(duracao);
    var util = isFinite(d) && d > 0;
    var inteira = [{
      indice: -1, inicio: 0, fim: util ? d : 0,
      titulo: null, esquerda: 0, largura: 100
    }];
    if (!util) return inteira;

    /* Capítulo que começa DEPOIS do fim do vídeo não tem onde ser desenhado.
     * Do lado do Node isso é ERRO e o script se recusa a gravar (há teste
     * desde 31/08); aqui é o contrário, e pela mesma razão que `App.capitulos`
     * é defensiva: a ficha tem que abrir com o vídeo mesmo com o catálogo
     * torto. O que não presta é descartado em silêncio.
     *
     * Descartar só do FIM é o que mantém os índices alinhados com a lista que
     * `App.capitulos` devolveu — e é dela que sai o índice de
     * `App.capituloEm`, que o player compara com o `indice` daqui. */
    var lista = [];
    (caps || []).forEach(function (c) {
      if (!c) return;
      var inicio = Number(c.inicio);
      if (!isFinite(inicio) || inicio < 0 || inicio >= d) return;
      lista.push({ inicio: inicio, titulo: c.titulo });
    });
    lista.sort(function (a, b) { return a.inicio - b.inicio; });
    if (!lista.length) return inteira;

    var segs = [];

    /* Nem todo vídeo começa em 0: o vídeo de abertura só tem fala a partir de 1:58, e o
     * primeiro capítulo dela começa lá. O trecho anterior é um segmento SEM
     * título — se ele não existisse, a barra abriria com um buraco no começo,
     * bem onde todo mundo olha primeiro. */
    if (lista[0].inicio > 0) {
      segs.push({ indice: -1, inicio: 0, fim: lista[0].inicio, titulo: null });
    }

    lista.forEach(function (c, i) {
      segs.push({
        indice: i,
        inicio: c.inicio,
        /* Cada capítulo fecha onde o seguinte começa; o último, na duração.
         * É a MESMA regra de `fecharCapitulos` do lado do Node, e pela mesma
         * razão: assim a linha do tempo fica contígua por construção e mover
         * um corte não obriga a mexer no vizinho. */
        fim: i + 1 < lista.length ? lista[i + 1].inicio : d,
        titulo: c.titulo
      });
    });

    segs.forEach(function (s) {
      s.esquerda = (s.inicio / d) * 100;
      s.largura = ((s.fim - s.inicio) / d) * 100;
    });
    return segs;
  }

  /* Quanto de UM segmento já foi tocado (ou já está em buffer), em %.
   *
   * Com a barra em pedaços, o preenchimento deixa de ser uma largura só e
   * passa a ser uma por segmento: os que ficaram para trás estão cheios, o de
   * agora está pela metade, os da frente estão vazios. */
  function fracaoNoSegmento(segmento, segundos) {
    if (!segmento) return 0;
    var dur = Number(segmento.fim) - Number(segmento.inicio);
    if (!isFinite(dur) || dur <= 0) return 0;
    var f = ((Number(segundos) || 0) - Number(segmento.inicio)) / dur;
    if (!isFinite(f) || f < 0) return 0;
    return (f > 1 ? 1 : f) * 100;
  }

  /* Qual SEGMENTO contém `segundos`, ou -1.
   *
   * Não é a mesma pergunta de `App.capituloEm`: os segmentos incluem o trecho
   * sem título antes do primeiro capítulo, e o último vai até a duração
   * INCLUSIVE — parar o vídeo no último quadro não pode apagar o realce do
   * capítulo final. */
  function segmentoEm(segmentos, segundos) {
    var t = Number(segundos);
    if (!isFinite(t)) return -1;
    var lista = segmentos || [];
    for (var i = 0; i < lista.length; i++) {
      if (t < lista[i].inicio) return -1;
      if (t < lista[i].fim || i === lista.length - 1) return i;
    }
    return -1;
  }

  /* Ctrl + seta, o item 28.
   *
   * O `->` vai para o começo do capítulo seguinte. O `<-` NÃO é o espelho
   * dele: é a convenção do botão "faixa anterior" de qualquer tocador de
   * áudio — no meio de uma faixa ele volta para o começo DELA; perto do
   * começo, aí sim vai para a anterior. Sem isso, quem perdeu o fio no meio de
   * um capítulo de quatro minutos é jogado para o capítulo inteiro anterior, e
   * precisa de duas teclas para voltar ao que estava vendo.
   *
   * `indice` vem pronto de `App.capituloEm` e pode ser -1 — o trecho antes do
   * primeiro capítulo é caso real (o vídeo de abertura). De lá a seta da direita vai
   * para o primeiro e a da esquerda não tem para onde ir.
   *
   * Devolve null quando não há alvo: quem chama mostra "Primeiro capítulo" ou
   * "Último capítulo" em vez de pular em silêncio para lugar nenhum.
   */
  var RECOMECO_CAPITULO_S = 3;

  function alvoDeCapitulo(caps, indice, atual, direcao) {
    var lista = caps || [];
    if (!lista.length) return null;

    var i = Number(indice);
    if (!isFinite(i) || i < -1) i = -1;
    if (i > lista.length - 1) i = lista.length - 1;

    var alvo;
    if (Number(direcao) > 0) {
      alvo = i + 1;                       /* de -1 (antes do primeiro) vai ao 0 */
      if (alvo > lista.length - 1) return null;
    } else {
      if (i < 0) return null;
      var dentro = (Number(atual) || 0) - lista[i].inicio;
      alvo = dentro > RECOMECO_CAPITULO_S ? i : i - 1;
      if (alvo < 0) return null;
    }
    return { indice: alvo, inicio: lista[alvo].inicio, titulo: lista[alvo].titulo };
  }

  /* Onde encostar a dica que segue o ponteiro na barra, em px a partir da
   * esquerda dela, para que ela não saia pela borda do player.
   *
   * Sem isto quem é cortado é justamente o título do PRIMEIRO capítulo (pela
   * esquerda) e o do ÚLTIMO (pela direita) — os dois que mais se procuram. A
   * dica é centrada no ponteiro; o que esta função faz é impedir que a
   * centralização a empurre para fora.
   */
  function posicaoDica(x, larguraBarra, larguraDica, margem) {
    var m = Number(margem) || 0;
    var largura = Number(larguraDica) || 0;
    var esquerda = (Number(x) || 0) - largura / 2;
    var maximo = (Number(larguraBarra) || 0) - largura - m;
    if (esquerda > maximo) esquerda = maximo;
    /* A margem ganha do limite de cima: com uma dica mais larga que a barra
     * (título comprido num celular estreito), sobra encostar na esquerda. */
    if (esquerda < m) esquerda = m;
    return esquerda;
  }
  /* =============================================================== legenda
   *
   * Fase 2. A parte pesada mora aqui porque é onde estão as armadilhas — e
   * armadilha sem teste volta.
   *
   * POR QUE UM PARSER NOSSO, E NÃO UM <track>: a pull zone serve o `.vtt` com
   * `Content-Type: application/octet-stream` (conferido em 01/09). O navegador
   * exige `text/vtt` e recusa o arquivo em silêncio — o `<track>` fica lá, sem
   * cue nenhuma, sem erro no console. Por isso a legenda é buscada por
   * `fetch()` e as cues são montadas na mão.
   */

  function urlLegenda(fonte, config, idioma) {
    var host = hostPullzone(config);
    if (!fonte || !fonte.videoId || !host) return null;
    if (fonte.tipo && fonte.tipo !== 'bunny') return null;
    return 'https://' + host + '/' + fonte.videoId + '/captions/' +
      (idioma || 'pt') + '.vtt';
  }

  /* "00:01:58.606" -> 118.606 · aceita "01:58.606" sem a hora. */
  function tempoVtt(texto) {
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(String(texto).trim());
    if (!m) return null;
    var h = m[1] ? Number(m[1]) : 0;
    /* ".6" é 600 ms, não 6 ms: o campo é preenchido à direita. */
    var ms = Number((m[4] + '00').slice(0, 3));
    return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
  }

  function limparTextoCue(texto) {
    return String(texto)
      /* `<v Fulano>`, `<c.amarelo>`, `<i>`: hoje o ASR do Bunny não gera
       * nenhuma, mas o acervo pode ser retranscrito, e tag crua na tela é
       * pior do que tag ignorada. */
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      /* `&amp;` por último, senão "&amp;lt;" viraria "<". */
      .replace(/&amp;/g, '&')
      .trim();
  }

  /* WEBVTT -> [{inicio, fim, texto}], em ordem, sem o que não presta.
   *
   * ARMADILHA 1, medida: **o arquivo começa com BOM** (`EF BB BF`). Em texto,
   * isso vira o caractere U+FEFF antes do "WEBVTT", e um
   * `texto.startsWith('WEBVTT')` devolve false — o parser desiste do arquivo
   * inteiro na primeira linha. É a mesma pedra que `scripts/lib/legenda.mjs`
   * já tinha encontrado do lado do Node.
   *
   * ARMADILHA 2, medida: **metade das legendas é ROLANTE**. No Série D,
   * 418 das 836 cues duram menos de 50 ms e repetem a linha da cue anterior.
   * Este parser NÃO mexe nisso: ele é fiel ao arquivo, e é o que os testes
   * cobram dele. Quem converte rolante em pop-on é `desenrolarLegenda()`,
   * num passo separado e com nome próprio — assim dá para ver, no player.js,
   * que a conversão está acontecendo.
   *
   * Nada aqui lança: legenda torta não pode derrubar o player. O que não
   * presta é descartado, e o pior caso é ficar sem legenda.
   */
  function analisarVtt(texto) {
    var t = String(texto == null ? '' : texto);
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);        /* o BOM */
    t = t.replace(/\r\n?/g, '\n');
    if (!/^\s*WEBVTT/.test(t)) return [];

    var cues = [];
    t.split(/\n{2,}/).forEach(function (bloco) {
      var linhas = bloco.split('\n');
      var iTempo = -1;
      for (var i = 0; i < linhas.length; i++) {
        if (linhas[i].indexOf('-->') >= 0) { iTempo = i; break; }
      }
      if (iTempo < 0) return;                              /* WEBVTT, NOTE, STYLE, REGION */

      var lados = linhas[iTempo].split('-->');
      if (lados.length !== 2) return;
      var inicio = tempoVtt(lados[0]);
      /* O lado direito pode trazer ajustes: "00:02.000 align:start position:10%" */
      var fim = tempoVtt(String(lados[1]).trim().split(/\s+/)[0]);
      if (inicio == null || fim == null) return;
      /* Cue de duração zero nunca aparece; deixá-la só atrapalha a busca. */
      if (fim <= inicio) return;

      var corpo = limparTextoCue(linhas.slice(iTempo + 1).join('\n'));
      if (!corpo) return;

      cues.push({ inicio: inicio, fim: fim, texto: corpo });
    });

    cues.sort(function (a, b) { return a.inicio - b.inicio; });
    return cues;
  }

  /* ---------------------------------------------- de rolante para pop-on
   *
   * Metade do acervo tem legenda ROLANTE, no formato que o ASR do Bunny
   * produz — medido no Série D, e regular do começo ao fim:
   *
   *   14.990 -> 15.000  (10 ms)  [A]
   *   15.000 -> 17.390  (2,4 s)  [A, B]
   *   17.390 -> 17.400  (10 ms)  [B]
   *   17.400 -> 19.189  (1,8 s)  [B, C]
   *
   * Exibido como está, isso ROLA: a linha de baixo sobe para o lugar da de
   * cima e uma linha nova entra embaixo. É a convenção de transmissão AO
   * VIVO, onde não se sabe o que vem depois — e em vídeo gravado ela confunde,
   * porque metade do que está na tela já foi lida.
   *
   * O padrão de vídeo gravado é POP-ON: o bloco aparece inteiro e é
   * SUBSTITUÍDO pelo próximo. É isso que esta função faz, em dois passos:
   *
   *   1. a cue-ponte de 10 ms é absorvida pela cue seguinte, que herda o
   *      começo dela — senão a primeira linha do vídeo teria 10 ms de tela;
   *   2. as linhas que a cue anterior já mostrou saem da seguinte, então cada
   *      bloco entra só com texto NOVO.
   *
   * O que ela NÃO faz, de propósito: juntar linhas para formar blocos maiores.
   * Seria mais confortável de ler e estaria ERRADO — a segunda linha apareceria
   * na tela antes de ser falada. Legenda não pode adiantar a fala.
   *
   * Em legenda normal (sem repetição, sem ponte) nada disto casa e a função
   * devolve as cues intactas. É um caminho só para os dois formatos.
   */

  /* Uma ponte é curta E encosta na cue seguinte: os dois critérios juntos,
   * para não fundir uma cue curta de verdade que só por acaso repita texto. */
  var PONTE_MAX_S = 0.5;

  function linhasDaCue(cue) {
    return String(cue && cue.texto || '').split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean);
  }

  function mesmasLinhas(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function ehPrefixo(curta, longa) {
    if (!curta.length || curta.length > longa.length) return false;
    return mesmasLinhas(curta, longa.slice(0, curta.length));
  }

  function desenrolarLegenda(cues) {
    var lista = (cues || []).map(function (c) {
      return { inicio: c.inicio, fim: c.fim, linhas: linhasDaCue(c) };
    });

    /* 1. a ponte de 10 ms some e a cue seguinte herda o começo dela. */
    var fundidas = [];
    for (var i = 0; i < lista.length; i++) {
      var c = lista[i];
      var prox = lista[i + 1];
      if (prox &&
          (c.fim - c.inicio) <= PONTE_MAX_S &&
          Math.abs(prox.inicio - c.fim) <= 0.05 &&
          ehPrefixo(c.linhas, prox.linhas)) {
        prox.inicio = c.inicio;
        continue;
      }
      fundidas.push(c);
    }

    /* 2. sai da cue o que a anterior já mostrou. */
    var saida = [];
    var anteriorCompleta = null;
    fundidas.forEach(function (c) {
      var novas = c.linhas;

      if (anteriorCompleta) {
        /* Corta o maior pedaço do começo desta que seja o FIM da anterior.
         * Comparar com o fim, e não "em qualquer lugar", evita apagar uma
         * frase curta legitimamente repetida mais adiante. */
        var corte = Math.min(novas.length, anteriorCompleta.length);
        while (corte > 0) {
          if (mesmasLinhas(novas.slice(0, corte),
                           anteriorCompleta.slice(anteriorCompleta.length - corte))) break;
          corte--;
        }
        novas = novas.slice(corte);
      }
      anteriorCompleta = c.linhas;

      if (!novas.length) {
        /* Cue que era só repetição. Some, mas o tempo dela vai para o bloco
         * anterior — senão a legenda pisca e some por um instante. */
        if (saida.length) saida[saida.length - 1].fim = Math.max(saida[saida.length - 1].fim, c.fim);
        return;
      }
      saida.push({ inicio: c.inicio, fim: c.fim, texto: novas.join('\n') });
    });

    return saida;
  }

  /* Índice da cue que está no ar em `segundos`, ou -1.
   *
   * Só é usada quando o navegador não dá `cuechange` — a régua normal é o
   * TextTrack nativo, que é preciso ao quadro. Aqui a busca é linear de
   * propósito: mesmo com 836 cues isso é irrelevante perto de decodificar
   * vídeo, e binária daria mais chance de errar do que de ganhar.
   *
   * Quando duas cues se sobrepõem, ganha a ÚLTIMA que começou — em legenda
   * rolante é a mais recente que interessa. Nos arquivos medidos em 01/09 não
   * há sobreposição nenhuma, mas o acervo pode ser retranscrito.
   */
  function cueEm(cues, segundos) {
    var t = Number(segundos);
    if (!isFinite(t)) return -1;
    var achado = -1;
    for (var i = 0; i < (cues || []).length; i++) {
      if (cues[i].inicio > t) break;
      if (t < cues[i].fim) achado = i;
    }
    return achado;
  }

  /* Corpo da legenda, em multiplicadores do tamanho base (teclas + e -). */
  var TAMANHOS_LEGENDA = [0.75, 0.875, 1, 1.25, 1.5, 2];

  /* =============================================================== teclado
   *
   * Fase 1. Esta é a parte que justifica o player-core existir: a decisão de
   * "que tecla virou que ação" é pura, entra um objeto simples e sai outro, e
   * está coberta por teste em `node --test` sem navegador nenhum. O arquivo do
   * DOM só executa o que sair daqui.
   */

  /* As mesmas do YouTube. Não é uma escala contínua de propósito: 1,25 e 1,5
   * são os degraus que a pessoa procura, e um passo de 0,1 obrigaria a apertar
   * a tecla cinco vezes para chegar em 1,5. */
  var VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  /* Anda um degrau numa lista de valores, parando nas pontas.
   *
   * Serve à velocidade (Shift + > / <) e ao corpo da legenda (+ / -), que têm
   * exatamente a mesma forma. Um valor que não está na lista cai no degrau
   * mais próximo antes de andar — caso real: o 2x temporário do gesto da fase
   * 5 deixa a velocidade fora dos degraus. */
  function andarNaLista(lista, atual, passo) {
    var n = Number(atual);
    var i = lista.indexOf(n);
    if (i < 0) {
      i = 0;
      for (var j = 1; j < lista.length; j++) {
        if (Math.abs(lista[j] - n) < Math.abs(lista[i] - n)) i = j;
      }
    }
    var alvo = i + (Number(passo) || 0);
    if (alvo < 0) alvo = 0;
    if (alvo > lista.length - 1) alvo = lista.length - 1;
    return lista[alvo];
  }

  function proximaVelocidade(atual, passo) {
    return andarNaLista(VELOCIDADES, atual, passo);
  }

  function proximoTamanhoLegenda(atual, passo) {
    return andarNaLista(TAMANHOS_LEGENDA, atual, passo);
  }

  /* =================================================================== som
   *
   * Fase 4. O grafo Web Audio resolve QUATRO itens de uma vez, e é por isso
   * que o áudio é uma fase inteira em vez de um detalhe do gesto de deslizar:
   *
   *   item 8   Volume Estável   — o compressor
   *   item 12  Volume Boost     — o ganho acima de 1
   *   item 10b volume por gesto — a fase 5 chama isto daqui
   *   item 22  ↑/↓ no iPhone    — onde `video.volume` é somente-leitura
   *
   * A topologia é `<video>` → ganho → compressor → saída, NESSA ordem, e a
   * ordem não é arbitrária: com o compressor DEPOIS do ganho ele vira o
   * limitador que segura o Boost, que é justamente o que impede 200% de
   * estourar. Invertido, o Boost multiplicaria a saída do compressor e
   * clipparia. */

  /* Teto do volume. Sem o grafo montado o teto é 1 e ponto: `video.volume`
   * não passa disso em navegador nenhum, e prometer 150% sem ter com que
   * entregar seria mentir no selo. */
  var VOLUME_MAX_GANHO = 2;

  /* Quanto o Volume Estável devolve do que o compressor tirou.
   *
   * `DynamicsCompressorNode` não tem makeup gain — ele só abaixa. Sem esta
   * compensação, ligar o Volume Estável deixaria o vídeo mais BAIXO, que é o
   * oposto do que a pessoa pediu ao ligar. */
  var COMPENSACAO_ESTAVEL = 1.9;

  /* Ninguém precisa de 400% de ganho, e um número absurdo aqui vira ruído de
   * fundo amplificado. 200% de volume com a compensação do estável chega a
   * 3,8 — o teto de 4 deixa isso passar e barra o resto. */
  var GANHO_MAX = 4;

  function proximoVolume(atual, passo, maximo) {
    var teto = Number(maximo);
    if (!isFinite(teto) || teto < 1) teto = 1;
    var v = Number(atual);
    if (!isFinite(v)) v = 1;
    v += Number(passo) || 0;
    if (v < 0) v = 0;
    if (v > teto) v = teto;
    /* Sem o arredondamento, somar 0,05 oito vezes dá 0,4000000000000001 e o
     * selo na tela mostra "40.00000000000001%". */
    return Math.round(v * 100) / 100;
  }

  /* Por onde o volume pedido tem que passar.
   *
   *   pedido          — 0 a 2
   *   grafoAtivo      — o grafo Web Audio já está montado?
   *   elementoObedece — `video.volume` aceitou a última escrita?
   *   grafoPossivel   — dá para montar o grafo, ou já falhou / não existe API?
   *
   * Devolve 'ganho' (escrever no GainNode), 'elemento' (escrever em
   * `video.volume`), 'montar' (é preciso montar o grafo antes) ou 'nenhuma'
   * (não há como mexer no volume — o iPhone sem Web Audio).
   *
   * A regra que importa: NUNCA montar o grafo para quem não precisa dele.
   * `createMediaElementSource` é irreversível — depois dele o áudio do vídeo
   * sai pelo grafo para sempre, e se o grafo falhar o vídeo fica MUDO. Num
   * desktop com o volume em 80% o `video.volume` resolve sozinho, e aí o
   * caminho mais seguro é não ter grafo nenhum. */
  function viaDoVolume(estado) {
    var e = estado || {};
    if (e.grafoAtivo) return 'ganho';

    var pedido = Number(e.pedido);
    if (!isFinite(pedido)) pedido = 1;

    /* Duas razões para precisar do grafo, e só duas: passar de 100% (o
     * elemento não vai), ou o elemento não obedecer (iPhone). */
    var precisa = pedido > 1 || e.elementoObedece === false;
    if (!precisa) return 'elemento';
    return e.grafoPossivel === false ? 'nenhuma' : 'montar';
  }

  /* NEUTRO é como se desliga um compressor que não dá para desconectar: razão
   * 1 é ausência de compressão. Reconectar nós com o vídeo tocando é o jeito
   * mais fácil de produzir um estalo, e não há nada a ganhar com isso — os dois
   * nós ficam sempre no caminho e o que muda são os números. */
  var NEUTRO = { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 };

  /* O NIVELADOR — o Volume Estável do item 8, e só ele.
   *
   * Joelho muito macio e razão baixa: a fala baixa sobe, o pico desce, e não
   * bombeia. Os números são conservadores de propósito — um compressor
   * agressivo em fala gravada chia no silêncio. O ataque é lento (20 ms)
   * porque nivelar é sobre a MÉDIA, não sobre o transiente; é justamente por
   * isso que ele não serve de limitador, e o limitador é outro nó. */
  function ajusteNivelador(estado) {
    var e = estado || {};
    if (!e.estavel) return NEUTRO;
    return { threshold: -24, knee: 24, ratio: 3, attack: 0.02, release: 0.35 };
  }

  /* O LIMITADOR — o que impede o Boost de estourar, e só isso.
   *
   * MEDIDO EM 02/09, e é a razão de ele existir separado: com um nó só,
   * 200% + Volume Estável dava pico 1,846 no analisador — clipe puro. O
   * nivelador não segurava porque o ataque de 20 ms deixa o transiente passar
   * inteiro, e num ganho de 3,8× o transiente é o que estoura. Ataque de 2 ms
   * e razão 20 pegam o que ele deixa passar.
   *
   * Ele NÃO é a garantia de teto — quem garante é o moldador, logo abaixo.
   * Um `DynamicsCompressorNode` ultrapassa cerca de 5 dB no transiente
   * (medido em 02/09), e baixar o teto até isso caber exigiria -10 dBFS, o que
   * deixaria o "200%" mais BAIXO que o volume normal em material alto. O
   * trabalho dele aqui é segurar o nível SUSTENTADO; o pico que escapa é do
   * moldador.
   *
   * Recebe o ganho DE SAÍDA (o de `ganhoDeSaida`, já com a compensação do
   * estável), e não o volume da tela: quem faz estourar é o que entra no nó,
   * e o estável sozinho já leva o ganho a 1,9 com o volume em 100%.
   *
   * Abaixo de 1 ele fica NEUTRO de propósito. Sem isso, o iPhone — que monta o
   * grafo só para ter volume (item 22), em volume normal — ganharia um
   * limitador que nunca pediu, e um vídeo masterizado perto de 0 dBFS soaria
   * diferente lá e aqui. */
  function ajusteLimitador(estado) {
    var e = estado || {};
    var ganho = Number(e.ganho);
    if (!isFinite(ganho) || ganho <= 1) return NEUTRO;
    return { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.1 };
  }

  /* O MOLDADOR — a garantia de que nada sai acima de 1, por construção.
   *
   * Por que ele existe, e por que tuning não bastava: MEDIDO em 02/09, contra
   * o player rodando. `DynamicsCompressorNode` ultrapassa MUITO no transiente
   * — cerca de 5 dB acima do que a razão prevê. Com o teto em -3 dBFS o pior
   * caso (200% + estável) ainda batia em 1,042: clipe. Baixar o teto até parar
   * de clipar exigia -10 dBFS, e aí o remédio virava a doença: o pico saía em
   * 0,61, ou seja, o "200%" ficaria mais BAIXO do que o volume normal em
   * material alto. Um reforço que abaixa o som não é reforço.
   *
   * A saída é a de qualquer cadeia de masterização: compressor, limitador e
   * por último um moldador. O limitador segura o nível sustentado; o moldador
   * arredonda o pico que escapa. Como ele é uma FUNÇÃO da amostra, e não um
   * envelope no tempo, não tem como ultrapassar — o teto é aritmética.
   *
   * `WaveShaperNode` mapeia a entrada [-1, 1] sobre a curva e prende o que
   * passa disso na ponta. Isso é exatamente o que se quer aqui: o que vier
   * acima de 1 sai no valor da última casa, que é o teto. */

  /* Abaixo deste valor a curva é a identidade — a amostra sai como entrou.
   * É o que garante que o moldador não colore o áudio normal: ele só existe
   * para o pico, e fala baixa e sala silenciosa passam intactas. */
  var JOELHO_MOLDADOR = 0.5;

  /* Quantas casas. 2048 dá passo de 0,001 na entrada, bem abaixo do que
   * qualquer conversor distingue. */
  var CASAS_MOLDADOR = 2048;

  /* A curva, como `Float32Array` pronta para o `WaveShaperNode`.
   *
   * Acima do joelho: `y = J + (1-J)·tanh((x-J)/(1-J))`. A escolha do tanh não
   * é estética — nesta forma a inclinação em x = J é exatamente 1, então a
   * curva ENCOSTA na identidade sem quina. Uma emenda com quina seria
   * distorção audível bem antes do pico. */
  function curvaSuave() {
    var n = CASAS_MOLDADOR;
    var c = new Float32Array(n);
    var J = JOELHO_MOLDADOR;
    for (var i = 0; i < n; i++) {
      /* De -1 a 1, inclusive nas duas pontas. */
      var x = (i / (n - 1)) * 2 - 1;
      var s = x < 0 ? -1 : 1;
      var a = Math.abs(x);
      c[i] = a <= J ? x : s * (J + (1 - J) * Math.tanh((a - J) / (1 - J)));
    }
    return c;
  }

  /* O teto que a curva impõe: J + (1-J)·tanh(1) ≈ 0,881, ou -1,1 dBFS. Existe
   * como função para o teste poder cobrar o número em vez de confiar nele. */
  function tetoMoldador() {
    var J = JOELHO_MOLDADOR;
    return J + (1 - J) * Math.tanh(1);
  }

  /* Quando o moldador entra. Pela MESMA razão do limitador: em volume normal
   * ele fica fora, e aí `curve = null` desliga o nó de verdade — o
   * `WaveShaperNode` passa a amostra adiante sem tocar nela. Sem isto, o
   * iPhone, que monta o grafo só para ter volume (item 22), ganharia uma
   * curva que ninguém pediu em cima de todo o áudio. */
  function precisaMoldador(estado) {
    var e = estado || {};
    var ganho = Number(e.ganho);
    return isFinite(ganho) && ganho > 1;
  }

  /* O valor que vai no GainNode — que não é o volume da tela.
   *
   * Com o Volume Estável ligado o compressor abaixou tudo, e é aqui que a
   * compensação entra. É também por isso que o selo mostra `volume` e não
   * `ganho`: quem lê a tela quer saber quanto pediu, não quanto de sinal
   * o grafo está empurrando. */
  function ganhoDeSaida(estado) {
    var e = estado || {};
    var v = Number(e.volume);
    if (!isFinite(v) || v < 0) v = 0;
    var g = v * (e.estavel ? COMPENSACAO_ESTAVEL : 1);
    if (g > GANHO_MAX) g = GANHO_MAX;
    return Math.round(g * 1000) / 1000;
  }

  /* O que o selo diz. Existe como função pura porque a mensagem do iPhone é
   * uma promessa do projeto — dizer a verdade em vez de mostrar "Volume 40%"
   * com o som parado no mesmo lugar — e promessa do projeto tem teste. */
  function rotuloVolume(estado) {
    var e = estado || {};
    if (e.via === 'nenhuma') return tr('player.volumeSoAparelho');
    var pct = Math.round((Number(e.volume) || 0) * 100);
    if (pct > 100) return tr('player.volumeReforco', { pct: pct });
    return tr('player.volumePct', { pct: pct });
  }

  /* Que ação uma tecla virou, ou null quando ela não é nossa.
   *
   * Recebe um objeto simples — não um KeyboardEvent — porque quem monta esse
   * objeto é o DOM, e é justamente o que precisa ficar de fora do teste:
   *
   *   key, shiftKey, ctrlKey, metaKey, altKey  — direto do evento
   *   digitando  — o foco está num campo de texto?
   *   emBotao    — o foco está num <button>?
   *
   * `digitando` é a trava mais importante da fase inteira: o site tem um campo
   * de busca no topo de TODAS as telas. Sem ela, digitar "futebol" no campo
   * silencia o vídeo (m), pula para 60% (6), muda a velocidade e entra em tela
   * cheia — tudo de uma vez.
   */
  function acaoDeTecla(evento) {
    var e = evento || {};
    if (e.digitando) return null;

    var k = e.key;
    if (typeof k !== 'string' || !k) return null;
    var t = k.length === 1 ? k.toLowerCase() : k;   /* CapsLock não pode desligar atalho */

    /* Espaço e Enter num botão focado pertencem ao botão: o navegador já vai
     * disparar o clique dele. Sem esta linha, apertar espaço com o foco no
     * play alterna DUAS vezes e nada parece acontecer. */
    if (e.emBotao && (k === ' ' || k === 'Enter')) return null;

    /* Ctrl + setas são os capítulos (fase 3) — o ÚNICO atalho nosso com
     * modificador que não seja o Shift.
     *
     * Vem ANTES da recusa geral logo abaixo, e exige que os outros
     * modificadores estejam FORA: Ctrl+Shift+seta é seleção por palavra e
     * Ctrl+Alt+seta gira a tela em alguns drivers de vídeo. Nenhum dos dois
     * pode virar pulo de capítulo pelas costas. */
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      if (t === 'ArrowRight') return { acao: 'capitulo', direcao: 1 };
      if (t === 'ArrowLeft') return { acao: 'capitulo', direcao: -1 };
    }

    /* O resto de Ctrl/Alt/Meta é do navegador ou de outras fases. Nada aqui os
     * usa — e isto também é o que impede Ctrl+Shift+N (janela anônima) de
     * virar "próximo episódio". */
    if (e.ctrlKey || e.metaKey || e.altKey) return null;

    /* Corpo da legenda. Vem ANTES do ramo de Shift porque `+` quase sempre
     * EXIGE Shift (Shift+= nos teclados US e ABNT2), mas o `+` do teclado
     * numérico não — as duas formas têm que funcionar. Idem `-` e `_`. */
    if (k === '+' || t === '=') return { acao: 'corpoLegenda', passo: 1 };
    if (k === '-' || k === '_') return { acao: 'corpoLegenda', passo: -1 };

    if (e.shiftKey) {
      /* Em teclado ABNT2 e US, Shift+. dá ">" e Shift+, dá "<". Aceitamos os
       * dois jeitos porque nem todo layout produz o caractere. */
      if (k === '>' || t === '.') return { acao: 'velocidade', passo: 1 };
      if (k === '<' || t === ',') return { acao: 'velocidade', passo: -1 };
      if (t === 'n') return { acao: 'episodio', direcao: 1 };
      if (t === 'p') return { acao: 'episodio', direcao: -1 };
      return null;                       /* nenhum outro atalho usa Shift */
    }

    switch (t) {
      case ' ':
      case 'k': return { acao: 'alternarPlay' };
      case 'j': return { acao: 'pular', segundos: -10 };
      case 'l': return { acao: 'pular', segundos: 10 };
      case 'ArrowLeft': return { acao: 'pular', segundos: -5 };
      case 'ArrowRight': return { acao: 'pular', segundos: 5 };
      case 'ArrowUp': return { acao: 'volume', passo: 0.05 };
      case 'ArrowDown': return { acao: 'volume', passo: -0.05 };
      case 'Home': return { acao: 'irPara', segundos: 0 };
      case 'End': return { acao: 'irParaFim' };
      case 'm': return { acao: 'alternarMudo' };
      case 'c': return { acao: 'alternarLegenda' };
      case 'f': return { acao: 'alternarTelaCheia' };
      case 't': return { acao: 'alternarTeatro' };
    }

    /* `t.length === 1` é obrigatório: sem ele, 'F1' passa na comparação de
     * string ('F' > '9' é falso… mas 'F1' >= '0' é verdadeiro) e vira um pulo. */
    if (t.length === 1 && t >= '0' && t <= '9') {
      return { acao: 'irParaDecimo', digito: Number(t) };
    }

    /* `,` e `.` sem Shift são o quadro a quadro (fase 9) e `i` é o miniplayer
     * (fase 7). Ainda não são nossos — devolver null deixa a tecla com o
     * navegador, que é o certo. */
    return null;
  }

  /* ================================================================ gestos
   *
   * Fase 5 — a camada de toque inteira, os itens que faltavam do celular:
   *
   *   item 1    toque duplo lateral     ±5 s
   *   item 2    dois dedos lateral      capítulo
   *   item 3    pressionar e segurar    2× enquanto o dedo estiver na tela
   *   item 9    bloqueio de tela
   *   item 10b  deslizar ↕ à direita    volume, pela canalização da fase 4
   *   (o item 10a — brilho à esquerda — SAIU em 09/09; ver o bloco abaixo)
   *   item 11   deslizar ↔              linha do tempo
   *
   * A máquina lá embaixo recebe pontos — `{id, x, y, t, tipo}`, em px a partir
   * do canto do quadro — e devolve UMA ação ou `null`, exatamente como
   * `acaoDeTecla` faz com as teclas. Quem escuta `pointerdown` é o player.js;
   * quem sabe o que aquilo significa é este arquivo.
   *
   * É a única forma de a fase ter teste, e é por isso que o projeto mandou
   * fazer assim antes de existir gesto nenhum: um gesto é uma SEQUÊNCIA no
   * tempo, e é na sequência que moram os erros — o toque duplo que também dá
   * play, o arrasto que começa parecendo toque, o segundo dedo que chega no
   * meio de um arrasto. Nada disso aparece olhando um evento de cada vez, e
   * nada disso precisa de navegador para ser provado.
   */

  /* As três faixas verticais do quadro: 30% de cada lado, 40% de centro.
   *
   * O centro é generoso de propósito. O toque simples do centro é play/pause,
   * e é o único gesto que todo mundo já tenta antes de aprender qualquer
   * outro — encolhê-lo para ganhar área de toque duplo seria trocar o gesto
   * que se conhece pelo que ninguém pediu ainda. Num telefone de 375 px cada
   * lado ainda fica com 112 px, folga de sobra para dois toques de polegar. */
  var ZONA_LADO = 0.3;

  function zonaDoToque(x, largura) {
    var L = Number(largura);
    /* Sem medida não há como saber onde o dedo caiu, e a resposta segura é o
     * centro: play/pause, o gesto que não estraga nada. */
    if (!isFinite(L) || L <= 0) return 'centro';
    var f = (Number(x) || 0) / L;
    if (f < ZONA_LADO) return 'esquerda';
    if (f > 1 - ZONA_LADO) return 'direita';
    return 'centro';
  }

  /* A faixa de cada borda onde o arrasto horizontal NÃO é nosso.
   *
   * É ali que mora o "voltar" do navegador do celular, e no iOS não há como
   * disputar: o gesto é do sistema e `touch-action` não alcança. Um arrasto
   * que COMEÇA a menos de 24 px da borda não vira linha do tempo — e quem
   * quiser procurar exatamente ali tem a barra, que é nossa, ganhou 325 px no
   * celular na fase 3 e já sabe arrastar. */
  var MARGEM_BORDA_PX = 24;

  function naBordaLateral(x, largura) {
    var L = Number(largura);
    if (!isFinite(L) || L <= 0) return false;
    var p = Number(x) || 0;
    return p < MARGEM_BORDA_PX || p > L - MARGEM_BORDA_PX;
  }

  /* Toque duplo (item 1). 300 ms é a janela que o próprio navegador usa para o
   * `dblclick`; 48 px é mais ou menos a polpa de um dedo — dois toques que
   * caem mais longe que isso são dois toques, não um gesto.
   *
   * A MESMA janela decide o duplo clique do mouse (tela cheia, 04/09), e ela
   * NÃO foi alargada para o ponteiro de propósito, mesmo o duplo clique do
   * sistema costumando ser mais folgado: com o mesmo clique dando play/pause,
   * uma janela larga transformaria "pausei e voltei a tocar logo em seguida"
   * em tela cheia sem querer. Errar para o lado estreito custa um clique
   * repetido; errar para o largo maximiza a tela na cara de quem não pediu. */
  var TOQUE_DUPLO_MS = 300;
  var TOQUE_DUPLO_PX = 48;

  /* ±5 s, e não os 10 s do YouTube. Está escolhido assim desde a matriz: o
   * acervo é de conteúdo falado, onde se volta para reouvir uma frase, não para pular
   * vinheta de abertura. É o mesmo passo das setas do teclado (item 15), e
   * isso é de propósito — o mesmo pulo, no dedo e na tecla. */
  var PULO_TOQUE_S = 5;

  /* Pressionar e segurar (item 3). Abaixo de meio segundo o 2× dispararia em
   * toque desajeitado; muito acima, parece que o gesto não funcionou. */
  var SEGURAR_MS = 500;
  var VELOCIDADE_SEGURAR = 2;

  /* Quanto o dedo precisa andar para deixar de ser um toque. O mesmo número
   * resolve as duas pontas do mesmo problema: abaixo disto um arrasto não
   * começa (a mão treme, e a tela lê a tremida), e acima disto um dedo parado
   * deixa de valer como segurar. */
  var MOVER_MIN_PX = 10;

  /* O desempate de dois dedos × pinça (itens 2 e 7). Dois
   * dedos que encostam e saem em menos de 250 ms SEM que a distância entre
   * eles mude mais de 10 px é toque; qualquer outra coisa é pinça.
   *
   * Este desempate nasceu na fase 5, quando a pinça ainda não fazia nada, e
   * mesmo assim precisava existir: sem ele uma pinça começando virava pulo de
   * capítulo. **Desde a fase 8 (04/09) a pinça amplia de verdade**, em tela
   * cheia, e aí o desempate deixou de ser precaução e virou a
   * fronteira entre dois gestos que fazem coisas opostas. */
  var DOIS_DEDOS_MS = 250;
  var DOIS_DEDOS_PX = 10;

  /* Um dedo que desceu e nunca subiu é um FANTASMA.
   *
   * Acontece de verdade: o `pointerup` se perde quando o navegador tira o
   * elemento do caminho no meio do gesto, e nem sempre há `pointercancel`
   * para avisar. O estrago é grande e silencioso — com um fantasma na lista,
   * o toque seguinte vira "dois dedos" e o player inteiro para de responder ao
   * dedo até alguém sair da ficha e voltar.
   *
   * A limpeza usa o relógio que já vem em todo evento: um dedo sem notícia há
   * mais de 5 s, no instante em que OUTRO desce, não existe mais. Ninguém
   * segura a tela por cinco segundos e espera que o próximo toque continue o
   * mesmo gesto. */
  var FANTASMA_MS = 5000;

  /* Quanto vale atravessar o quadro inteiro com o dedo.
   *
   * A conta é sempre uma FRAÇÃO da medida do quadro, nunca px por segundo:
   * assim o gesto tem o mesmo tato num telefone de 375 px e num tablet de
   * 1024, e continua o mesmo quando a tela vira.
   *
   * 120 s na largura toda dá cerca de 3 px por segundo num telefone — perto o
   * bastante para achar a frase que acabou de passar, e longe do que a barra
   * já faz melhor, que é atravessar o vídeo inteiro. Um arrasto proporcional à
   * DURAÇÃO é tentador e é pior: num título de 27 minutos daria 4 s por px, e
   * o gesto ficaria grosseiro justamente onde ele mais serve. */
  var ARRASTO_TEMPO_S = 120;

  /* ---------------------------------------------- a aceleração do arrasto
   *
   * Pedida em 03/09, depois do primeiro teste no dedo: o dedo rápido tem que
   * andar MUITO mais tempo, e o dedo lento tem que andar bem pouco.
   *
   * É a mesma ideia da aceleração do ponteiro do sistema, e ela resolve uma
   * tensão que a versão de 03/09 não tinha como resolver: com uma régua fixa,
   * ou o gesto é fino demais para atravessar um vídeo de 27 minutos, ou é
   * grosseiro demais para achar a frase que acabou de passar. Com aceleração,
   * o MESMO gesto faz as duas coisas — quem decide é a pressa da mão.
   *
   * A conta deixa de ser "onde o dedo está" e passa a ser a SOMA dos pedaços:
   * cada movimento contribui com a sua distância vezes o ganho da velocidade
   * daquele pedaço. Isso torna o arrasto dependente do CAMINHO — ir e voltar
   * não devolve o vídeo ao ponto de partida —, e é assim em todo controle
   * acelerado que existe. É o preço, e é o que se está pedindo ao pedir
   * aceleração.
   *
   * `VELOCIDADE_REF` é onde o ganho vale 1, ou seja, onde o gesto tem
   * exatamente o tato da versão anterior: 1 px por milissegundo, que é um
   * arrasto de telefone sem pressa (a largura de um quadro de 375 px em pouco
   * mais de um terço de segundo).
   *
   * Os dois limites existem para que nenhum extremo vire acidente: um dedo
   * quase parado ainda anda (0,25×, quatro vezes mais fino), e um arranco de
   * 6 px/ms não passa de 6× — sem o teto, um espasmo do pulso jogaria o vídeo
   * para o fim.
   *
   * São TRÊS números, e são o volante deste gesto: se o tato estiver errado no
   * aparelho, é aqui que se mexe, e o teste cobra os três. */
  var VELOCIDADE_REF_PX_MS = 1;
  var GANHO_ARRASTO_MIN = 0.25;

  /* O teto de quando NÃO SE SABE a duração — e só nesse caso. Desde 03/09 o
   * teto normal sai do comprimento do vídeo, logo abaixo. */
  var GANHO_ARRASTO_MAX = 6;

  function ganhoDoArrasto(dx, dt, teto) {
    var d = Math.abs(Number(dx) || 0);
    var t = Number(dt);
    /* Dois eventos no mesmo milissegundo dariam velocidade infinita. O piso de
     * 1 ms não inventa nada: o teto do ganho é quem apara o resultado. */
    if (!isFinite(t) || t < 1) t = 1;
    var teto0 = Number(teto);
    if (!isFinite(teto0) || teto0 <= 0) teto0 = GANHO_ARRASTO_MAX;
    var g = (d / t) / VELOCIDADE_REF_PX_MS;
    if (!isFinite(g) || g < GANHO_ARRASTO_MIN) return GANHO_ARRASTO_MIN;
    if (g > teto0) return teto0;
    return g;
  }

  /* ---------------------------------------- o teto sai do TAMANHO do vídeo
   *
   * Pedido em 03/09, e a razão é boa: "6 vezes" não quer dizer a mesma coisa
   * num vídeo de dois minutos e num de uma hora. No curto, um arranco
   * atravessava o título inteiro; no longo, mal saía do lugar.
   *
   * A regra passou a ser uma só: **um arranco de ponta a ponta do quadro anda
   * no máximo esta fração do vídeo**. Num de uma hora, a 1/3, são 20 minutos;
   * num de dois minutos, a 1/2, é um minuto.
   *
   * O padrão é 0,4 — o meio da faixa pedida para testar — e ele é ajustável no
   * `/admin`, porque o número certo é julgamento de mão e vai mudar com o uso.
   * Repare que num título curto o teto fica ABAIXO do ganho de referência, e
   * isso é o certo: num vídeo de 2:50, uma travessia do quadro no ritmo normal
   * já valeria 120 s, quase metade do título. */
  var FRACAO_TETO_PADRAO = 0.4;

  /* Os limites do que o `/admin` pode gravar. Abaixo de 5% o arrasto rápido
   * deixaria de existir; acima de 100% um arranco atravessaria o vídeo inteiro,
   * que é justamente o que se está tentando evitar. */
  var FRACAO_TETO_MIN = 0.05;
  var FRACAO_TETO_MAX = 1;

  function fracaoDoTeto(valor) {
    var f = Number(valor);
    if (!isFinite(f) || f <= 0) return FRACAO_TETO_PADRAO;
    if (f < FRACAO_TETO_MIN) return FRACAO_TETO_MIN;
    if (f > FRACAO_TETO_MAX) return FRACAO_TETO_MAX;
    return f;
  }

  function tetoDoGanho(duracao, fracao) {
    var d = Number(duracao);
    /* Sem duração não há de onde derivar, e aí vale o teto fixo de antes. */
    if (!isFinite(d) || d <= 0) return GANHO_ARRASTO_MAX;
    var g = fracaoDoTeto(fracao) * d / ARRASTO_TEMPO_S;
    /* O teto nunca pode cair abaixo do piso: num vídeo curtíssimo isso
     * congelaria o arrasto inteiro, inclusive o lento. */
    return g < GANHO_ARRASTO_MIN ? GANHO_ARRASTO_MIN : g;
  }

  /* ------------------------------------- quando os controles podem sumir
   *
   * Pedido em 03/09: a barra e os botões somem sozinhos depois de alguns
   * segundos sem toque, e voltam ao primeiro sinal de vida. É o que todo
   * player faz, e em tela cheia é o que separa "assistir" de "operar".
   *
   * As recusas abaixo são a parte que erra fácil, e por isso estão aqui e não
   * no `player.js`. Cada uma é um jeito de o player parecer quebrado:
   *
   *   parado          — controle sumido num vídeo pausado é a tela morta: não
   *                     há movimento nenhum que explique o que aconteceu, e
   *                     quem pausou geralmente pausou PARA mexer em alguma
   *                     coisa. É a convenção de todo player que existe.
   *   painel aberto   — o painel de som fica pendurado no botão de mudo;
   *                     sumir com o botão levaria o painel junto, no meio do
   *                     ajuste.
   *   arrastando      — o dedo está no meio de um gesto que usa a barra como
   *                     retorno de posição.
   *   foco dentro     — alguém chegou aos controles pelo Tab. Sumir com o
   *                     elemento focado deixa o teclado preso num controle
   *                     invisível, que é o pior resultado possível.
   */
  function podeEsconderControles(estado) {
    var e = estado || {};
    if (!e.tocando) return false;
    if (e.painelAberto) return false;
    if (e.arrastando) return false;
    if (e.focoDentro) return false;
    return true;
  }

  /* Quantos segundos de quietude até sumir. 3 é o padrão pedido; 0 é uma
   * escolha válida e quer dizer "nunca some". O teto de 30 existe para o campo
   * do `/admin` não virar um jeito de desligar o recurso por engano — quem
   * quiser desligar põe 0, que é explícito. */
  var SUMICO_PADRAO_S = 3;
  var SUMICO_MAX_S = 30;

  function segundosDeSumico(valor) {
    /* "Não configurado" tem que ser separado de `0` ANTES da conversão, e essa
     * linha é a razão de esta função existir: `Number(null)` é ZERO, e zero
     * aqui quer dizer "nunca some". Sem ela, um catálogo sem o ajuste — que é
     * o estado de todo catálogo até alguém abrir o /admin — desligaria o
     * sumiço em silêncio, e o padrão de 3 s nunca valeria para ninguém. */
    if (valor === null || valor === undefined || valor === '') return SUMICO_PADRAO_S;
    var s = Number(valor);
    if (!isFinite(s) || s < 0) return SUMICO_PADRAO_S;
    if (s === 0) return 0;
    if (s > SUMICO_MAX_S) return SUMICO_MAX_S;
    return s;
  }

  /* -------------------------------- cancelar o arrasto sem soltar o dedo
   *
   * A aceleração cobra um preço, e este é o troco. Como o arrasto depende do
   * CAMINHO, ir rápido e voltar devagar não devolve o vídeo ao ponto de
   * partida — e quem se arrependeu no meio do gesto ficava sem saída, porque
   * soltar já confirma.
   *
   * Jogar o dedo PARA BAIXO desfaz tudo: o vídeo volta para onde o movimento
   * começou, na hora, sem soltar e sem ter que acertar o caminho de volta.
   *
   * O limiar é uma fração da altura do quadro, com um piso em px: num quadro
   * deitado de 375 px de altura, um terço são 127 px; no quadro embutido, de
   * 195, são 66. Abaixo de 56 px o gesto dispararia no tremor de quem só está
   * arrastando na horizontal. */
  var CANCELAR_FRACAO = 0.34;
  var CANCELAR_MIN_PX = 56;

  function limiarDeCancelar(altura) {
    var A = Number(altura);
    if (!isFinite(A) || A <= 0) return CANCELAR_MIN_PX;
    var l = A * CANCELAR_FRACAO;
    return l < CANCELAR_MIN_PX ? CANCELAR_MIN_PX : l;
  }

  /* A altura toda percorre 100 pontos de volume — não os 200 do reforço. Quem
   * quer reforço passa pelo painel, onde ele está escrito e marcado em
   * amarelo; um deslize distraído não pode dobrar o volume de ninguém. O teto
   * de quem já estava em 150% continua sendo o da fase 4: o gesto SOMA, e quem
   * apara é `proximoVolume`. */
  var ARRASTO_VOLUME = 1;

  /* O ímã dos 100%. Com o reforço disponível o volume não acaba em 100%: o
   * teto é 200%, e por isso o dedo que sobe passa de "normal" para "reforço"
   * sem nada que avise — quem queria parar em 100% erra por um dedo, e
   * voltar exatamente para lá é pior. Nenhum controle de volume no celular
   * tem essa faixa de sobra, e é ela que pede o ímã.
   *
   * São 10% da ALTURA do quadro de arrasto além dos 100%: o volume fica em
   * 100% enquanto o dedo anda essa faixa, e só depois o reforço começa —
   * SEM salto, porque a faixa é descontada do que vem depois. O ímã é de UM
   * lado só: abaixo de 100% o volume segue o dedo do primeiro pixel, e quem
   * está em 100% e quer baixar não encontra zona morta. */
  var IMA_VOLUME = 0.1;

  /* O volume a que o arrasto chega, dado o de PARTIDA e o quanto o dedo
   * andou (`valor`, em pontos de volume).
   *
   * A régua é mapeada em dois pedaços: até 100% ela é a de sempre; acima, a
   * faixa do ímã é um degrau. A partida é levada para o espaço "com degrau"
   * antes de somar, e é isso que impede o salto de um vídeo que já começa em
   * 150%: ele sai de 150% e só encontra o degrau ao descer.
   *
   * Sem reforço (teto 1) não há nada para atravessar, e o resultado é o que
   * `proximoVolume` sempre deu. */
  function volumeDoArrasto(partida, valor, maximo) {
    var teto = Number(maximo);
    if (!isFinite(teto) || teto < 1) teto = 1;
    var v = Number(partida);
    if (!isFinite(v)) v = 1;
    var passo = Number(valor) || 0;
    if (teto <= 1) return proximoVolume(v, passo, teto);

    var base = v > 1 ? v + IMA_VOLUME : v;
    var alvo = base + passo;
    if (alvo > 1) alvo = alvo <= 1 + IMA_VOLUME ? 1 : alvo - IMA_VOLUME;
    return proximoVolume(alvo, 0, teto);
  }

  /* ------------------------------- os dois deslizes (itens 4 e 5, fase 7)
   *
   * Decididos em 09/09/2026, e eles são **duas metades de um gesto só**: ↑ é
   * "me dá mais tela", ↓ é "acabei". Qual das duas vale depende da ORIENTAÇÃO,
   * e é isso que impede as duas de disputarem o mesmo dedo:
   *
   *   em pé     ↑  deita a imagem, sem o usuário girar o telefone
   *   deitado   ↓  fecha o player e volta para a ficha, fora da tela cheia
   *
   * **A orientação sai das medidas que já existem** — `largura > altura` —, e
   * não de `screen.orientation`. Em tela cheia o quadro É a tela, então a
   * geometria responde a mesma coisa; e é a geometria que importa, porque é
   * ela que decide se ainda há tela a ganhar. Nada novo precisou entrar no
   * `medir()`.
   *
   * O limiar é uma FRAÇÃO da altura, com piso em pixels — a mesma forma do
   * `limiarDeCancelar`, e pelo mesmo motivo: em tela cheia deitada a altura é
   * menos da metade da de pé, e uma distância fixa seria fácil demais num modo
   * e exaustiva no outro. Num telefone de 375×812 dá **203 px em pé e 93,75
   * deitado**, que é o gesto proporcional nos dois.
   *
   * O piso de 64 px não é para telefone nenhum: ele só assume abaixo de 256 px
   * de altura, que é quadro de janela pequena no computador. Está aqui para
   * que uma caixa baixa não transforme o fechar do player num gesto de dez
   * pixels — e 64 é bem acima dos 10 que separam toque de arrasto, então
   * nenhuma tremida de mão fecha coisa nenhuma. */
  var DESLIZE_FRACAO = 0.25;
  var DESLIZE_MIN_PX = 64;

  function limiarDeDeslize(altura) {
    var A = Number(altura);
    if (!isFinite(A) || A <= 0) return DESLIZE_MIN_PX;
    var l = A * DESLIZE_FRACAO;
    return l < DESLIZE_MIN_PX ? DESLIZE_MIN_PX : l;
  }

  /* Para onde este deslize aponta, dado o quadro e o quanto o dedo andou.
   *
   * `null` é resposta legítima e o caso comum: ↓ em pé e ↑ deitado não fazem
   * nada. Em pé não há o que fechar por gesto — quem quiser sair tem o botão
   * de tela cheia, que continua onde sempre esteve; deitado não há mais tela a
   * ganhar. Devolver `null` em vez de inventar um segundo significado para
   * cada direção é o que mantém o gesto explicável numa frase. */
  function alvoDoDeslize(dy, medidas) {
    var L = Number(medidas && medidas.largura) || 0;
    var A = Number(medidas && medidas.altura) || 0;
    if (!L || !A) return null;
    var deitado = L > A;
    if (deitado) return dy > 0 ? 'fechar' : null;
    return dy < 0 ? 'deitar' : null;
  }

  /* O BRILHO SAIU em 09/09/2026 — o item 10a não existe mais.
   *
   * Ele nunca foi o brilho da tela: nenhum navegador mexe nisso, não há API, e
   * o que existia aqui era `filter: brightness()` sobre o vídeo. Escurecia e
   * clareava a IMAGEM, que é coisa diferente e resolve muito menos — o vídeo
   * estourado à noite, sim; enxergar o celular num pátio de sol, não.
   *
   * Decisão de quem usa o site: **um controle que promete o brilho e entrega
   * um filtro é pior do que não ter.** E ele custava caro no lugar errado — a
   * zona ESQUERDA do arrasto vertical em tela cheia, que é a única superfície
   * livre do player no celular. Ela fica reservada para os dois gestos da fase
   * 7 (arrastar ↑ e ↓), que fazem coisas reais.
   *
   * O volume continua na zona direita, e é agora o único arrasto vertical. */

  /* ------------------------------------------------- a pinça (item 7, fase 8)
   *
   * O zoom é da IMAGEM: `transform` no <video> e mais
   * nada. Não existe qualidade nova para revelar — ampliar 4× um quadro de
   * 240p mostra o 240p ampliado —, e mesmo assim é o que serve ao acervo, que
   * é cheio de slide com letra pequena.
   *
   * 4× é o teto da matriz. Abaixo de 1× não existe: encolher o vídeo dentro do
   * próprio quadro deixaria uma moldura preta que ninguém pediu, e o caminho
   * de quem quer ver menos é sair da tela cheia. */
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 4;

  function limitarZoom(escala) {
    var e = Number(escala);
    if (!isFinite(e)) return ZOOM_MIN;
    if (e < ZOOM_MIN) e = ZOOM_MIN;
    if (e > ZOOM_MAX) e = ZOOM_MAX;
    /* Duas casas, pelo mesmo motivo do volume: sem isto o selo
     * mostraria "Zoom 2,4000000000000004×". */
    return Math.round(e * 100) / 100;
  }

  /* O retângulo que a IMAGEM ocupa dentro do quadro — que NÃO é o quadro.
   * `object-fit: contain` centra o vídeo e deixa faixa preta na sobra: um
   * 16:9 numa tela de telefone deitada (20:9) fica com duas faixas largas dos
   * lados.
   *
   * A diferença aparece no limite do arrasto. Medindo pelo QUADRO, um vídeo
   * com faixa preta poderia ser puxado até a faixa ocupar meia tela — o dedo
   * anda e a imagem some. Medindo pela IMAGEM, a borda dela é o fim do
   * caminho, que é o que a mão espera de qualquer visualizador. */
  function retanguloDaImagem(largura, altura, videoLargura, videoAltura) {
    var L = Number(largura) || 0;
    var A = Number(altura) || 0;
    var vL = Number(videoLargura) || 0;
    var vA = Number(videoAltura) || 0;
    /* Antes do `loadedmetadata` não há proporção nenhuma para usar, e o
     * palpite seguro é o quadro: ele nunca deixa arrastar mais do que o
     * verdadeiro, só menos. Acerta-se sozinho na primeira medida depois. */
    if (vL <= 0 || vA <= 0 || L <= 0 || A <= 0) return { largura: L, altura: A };
    var f = Math.min(L / vL, A / vA);
    return { largura: vL * f, altura: vA * f };
  }

  /* Até onde a imagem pode ser arrastada sem descolar da borda: metade do que
   * sobra depois da ampliação. Uma imagem de 300 px ampliada 2× num quadro de
   * 375 mede 600, sobram 225, e ela anda 112 px para cada lado.
   *
   * Quando a imagem ampliada ainda CABE no quadro, não sobra nada e o limite é
   * zero — ela fica centrada. É isso que faz a pinça de volta ao 1× recentrar
   * o vídeo sozinha, sem nenhum caso especial: em 1× a imagem sempre cabe. */
  function limiteDeslocamento(quadro, imagem, escala) {
    var sobra = (Number(imagem) || 0) * escala - (Number(quadro) || 0);
    return sobra > 0 ? sobra / 2 : 0;
  }

  function limitarDeslocamentoZoom(ponto, escala, quadro, imagem) {
    var e = limitarZoom(escala);
    var lx = limiteDeslocamento(quadro && quadro.largura, imagem && imagem.largura, e);
    var ly = limiteDeslocamento(quadro && quadro.altura, imagem && imagem.altura, e);
    var x = Number(ponto && ponto.x) || 0;
    var y = Number(ponto && ponto.y) || 0;
    /* Inteiro: o destino é um `translate()` em pixels de tela, onde meio pixel
     * não muda nada e atrapalha a leitura de quem for depurar o gesto. */
    return {
      /* O `|| 0` não é enfeite: `Math.round(-0.4)` é MENOS zero, que aparece
       * como "-0px" no `translate()` e reprova um `deepStrictEqual` contra
       * zero. Zero negativo é uma armadilha de teste, não de tela. */
      x: Math.round(Math.max(-lx, Math.min(lx, x))) || 0,
      y: Math.round(Math.max(-ly, Math.min(ly, y))) || 0
    };
  }

  /* O selo da matriz — "2,4×", com a vírgula que este projeto usa em todo
   * número na tela. Em 1× ele não diz "1×": diz que o vídeo voltou ao tamanho
   * normal, que é a informação de quem acabou de desfazer a ampliação. */
  function rotuloZoom(escala) {
    var e = limitarZoom(escala);
    if (e === ZOOM_MIN) return tr('player.zoomNormal');
    /* O separador decimal segue o idioma (1,5× em pt-BR, 1.5× em en). */
    var texto = I18n ? I18n.numero(Math.round(e * 10) / 10, { maximumFractionDigits: 1 })
      : String(Math.round(e * 10) / 10);
    return tr('player.zoom', { escala: texto });
  }

  /* ----------------------------------------------------- a máquina de gestos
   *
   * `criarGestos()` devolve um objeto com um método por evento de ponteiro.
   * Cada um responde UMA ação ou `null`:
   *
   *   {acao:'alternarPlay'}                        já existe desde a fase 0
   *   {acao:'pular', segundos:±5}                  já existe desde a fase 1
   *   {acao:'capitulo', direcao:±1}                já existe desde a fase 3
   *   {acao:'velocidadeTemporaria', ligada:bool}   fase 5
   *   {acao:'arrastar', alvo, fase, valor}         fase 5
   *   {acao:'avisoTravado'} · {acao:'destravar'}   fase 5
   *   {acao:'zoom', fase, escala, x, y}            fase 8
   *
   * As três primeiras são de propósito as MESMAS do teclado: o `executar()` do
   * player.js já sabe fazê-las, e um gesto que pula 5 s tem que pular pelo
   * mesmo caminho que a seta pula — senão vira um segundo lugar de onde o
   * vídeo se move, com as próprias regras.
   *
   * `arrastar` tem três fases. `inicio` é quando o eixo ficou decidido; daí em
   * diante `valor` é o DELTA acumulado desde ali — segundos para o tempo,
   * pontos de volume. Quem soma isso ao valor de partida é o
   * player.js, que é quem sabe onde o vídeo estava. O delta conta a partir do
   * ponto em que o limiar foi vencido, e não de onde o dedo desceu: são os
   * 10 px de zona morta que impedem o vídeo de saltar no primeiro pixel.
   *
   * Não há relógio aqui dentro. O `t` vem de fora, em todo evento, e o único
   * gesto que precisa de tempo PASSANDO — o segurar — é uma pergunta que o
   * player.js faz quando o `setTimeout` dele acorda: `aoSegurar()`. Assim a
   * máquina continua pura, e o teste consegue segurar um dedo por 500 ms sem
   * esperar 500 ms.
   */
  function criarGestos() {
    var medidas = { largura: 0, altura: 0 };

    /* Deslizar ↕ só existe onde o vídeo é dono da tela — leia-se: em tela
     * cheia. Fora dela, no telefone, o quadro ocupa 211 px de uma tela de 812
     * e a ficha continua embaixo: roubar o arrasto vertical ali significa uma
     * página que não rola quando o polegar cai no vídeo, e trocar a rolagem da
     * página pelo volume é péssimo negócio. O player.js liga isto ao
     * entrar em tela cheia e desliga ao sair; o CSS acompanha com
     * `touch-action`. */
    var verticalPermitido = false;
    var travado = false;

    var dedos = {};         /* id -> ponto vivo */
    var ordem = [];         /* ids na ordem em que desceram */
    var eixo = null;        /* null | 'x' | 'y' | 'morto' */
    var arrasto = null;     /* {alvo, x, y, ultimo} — a origem, já sem o limiar */
    /* O deslize da fase 7 (itens 4 e 5). Guarda só de ONDE o dedo saiu: ao
     * contrário do arrasto, ele não tem valor corrente para acumular — o que
     * importa é a distância total no fim, e ela se mede do começo. */
    var deslize = null;     /* {y0} */
    var segurando = false;
    var doisDedos = null;   /* {t, dist, toque} */
    var ultimoToque = null; /* {x, y, t} do toque anterior, para o duplo */

    /* A pinça (item 7) só existe onde o quadro é dono da tela — leia-se: em
     * tela cheia, pelo mesmo motivo do deslizar ↕ logo acima, e por um a mais
     * que é do navegador: fora da tela cheia o CSS entrega a pinça para ELE,
     * que a usa para ampliar a PÁGINA. Esse zoom é acessibilidade e não se
     * disputa — quem precisa de letra maior no site inteiro tem que continuar
     * conseguindo em cima do vídeo. Em tela cheia não há página para ampliar,
     * e aí a pinça é nossa.
     *
     * O zoom SOBREVIVE aos dedos saírem — ele é estado do vídeo, não do gesto
     * —, e por isso não é zerado em `soltar()` nem em `cancelar()`. Quem o
     * zera é sair da tela cheia. */
    var pincaPermitida = false;
    var zoom = { escala: ZOOM_MIN, x: 0, y: 0 };
    /* A origem CONGELADA do gesto em curso: a escala e o deslocamento de onde
     * ele partiu, mais a distância e o meio dos dedos naquele instante. Tudo é
     * medido contra ela, e não contra o quadro anterior — somar quadro a
     * quadro acumularia o erro do arredondamento, que é a lição que o arrasto
     * da fase 6 já tinha aprendido. */
    var origem = null;
    var zoomAtivo = null;   /* null | 'pinca' | 'pan' */

    function ponto(p) {
      if (!p || p.id == null) return null;
      var x = Number(p.x) || 0;
      var y = Number(p.y) || 0;
      return {
        id: p.id,
        /* Só o mouse é mouse. Caneta é dedo para todo efeito: quem encosta a
         * caneta na tela do tablet espera os gestos do toque, não os do
         * ponteiro que passa por cima. */
        tipo: p.tipo === 'mouse' ? 'mouse' : 'toque',
        x: x, y: y, x0: x, y0: y,
        t: Number(p.t) || 0,
        /* Quando este dedo deu notícia pela última vez — é o que denuncia o
         * fantasma quando o `pointerup` dele nunca chega. */
        visto: Number(p.t) || 0,
        /* Um dedo consumido já virou outra coisa — toque duplo, arrasto,
         * segurar, dois dedos. O `subir` dele não pode virar play/pause. */
        consumido: false
      };
    }

    function distanciaEntreDedos() {
      var a = dedos[ordem[0]];
      var b = dedos[ordem[1]];
      if (!a || !b) return 0;
      return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    }

    /* Os DOIS eixos desde a fase 8: o capítulo só olha o x, mas a pinça amplia
     * em volta do ponto entre os dedos, e esse ponto tem altura. */
    function meioDosDedos() {
      var a = dedos[ordem[0]];
      var b = dedos[ordem[1]];
      if (!a) return { x: 0, y: 0 };
      if (!b) return { x: a.x, y: a.y };
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function imagemNoQuadro() {
      return retanguloDaImagem(medidas.largura, medidas.altura,
        medidas.videoLargura, medidas.videoAltura);
    }

    /* O ponto do vídeo que está SOB os dedos não pode escorregar: ampliar tem
     * que crescer em volta do que se está olhando, e não do meio do quadro —
     * senão o detalhe que se quer ver foge da tela justamente enquanto se
     * amplia.
     *
     * A conta sai da transformação que o player.js aplica — `tela = escala ×
     * (conteúdo − centro) + centro + deslocamento` — resolvida para o
     * deslocamento que mantém o mesmo ponto do conteúdo embaixo do meio dos
     * dedos.
     *
     * A MESMA conta serve para arrastar a imagem ampliada: ali a escala não
     * muda, o fator vira 1 e o que sobra é o deslocamento do dedo. Um caminho
     * só para as duas coisas, em vez de dois que precisariam concordar. */
    function aplicarZoom(escala, meioX, meioY) {
      var e = limitarZoom(escala);
      var cx = (Number(medidas.largura) || 0) / 2;
      var cy = (Number(medidas.altura) || 0) / 2;
      var base = origem || { meioX: meioX, meioY: meioY, escala: ZOOM_MIN, x: 0, y: 0 };
      var k = e / (base.escala || ZOOM_MIN);
      var d = limitarDeslocamentoZoom({
        x: meioX - cx - k * (base.meioX - cx - base.x),
        y: meioY - cy - k * (base.meioY - cy - base.y)
      }, e, medidas, imagemNoQuadro());
      zoom = { escala: e, x: d.x, y: d.y };
      return zoom;
    }

    function acaoZoom(fase) {
      return { acao: 'zoom', fase: fase, escala: zoom.escala, x: zoom.x, y: zoom.y };
    }

    function encerrarZoom() {
      zoomAtivo = null;
      origem = null;
      return acaoZoom('fim');
    }

    function marcarConsumidos() {
      for (var i = 0; i < ordem.length; i++) {
        if (dedos[ordem[i]]) dedos[ordem[i]].consumido = true;
      }
    }

    /* Consome UM ponto novo do arrasto e devolve o total desde o começo dele.
     *
     * O tempo é acumulado pedaço a pedaço, com o ganho da velocidade de cada
     * pedaço; o volume continua absoluto — ali a régua fixa é a
     * qualidade, não o defeito: a altura toda percorre a faixa toda, sempre,
     * e um volume que dependesse da pressa da mão seria uma armadilha. */
    function valorDoArrasto(d) {
      if (!arrasto || !d) return 0;
      if (arrasto.alvo === 'tempo') {
        var L = Number(medidas.largura) || 1;
        var dx = d.x - arrasto.x;
        var dt = d.visto - arrasto.t;
        /* A origem anda junto: o próximo pedaço parte daqui. */
        arrasto.x = d.x;
        arrasto.t = d.visto;
        arrasto.acumulado += dx / L * ARRASTO_TEMPO_S * ganhoDoArrasto(dx, dt, arrasto.teto);
        /* Arredonda só a SAÍDA. O acumulado fica inteiro, senão o erro do
         * arredondamento se somaria a cada quadro e o vídeo escorregaria. */
        return Math.round(arrasto.acumulado * 100) / 100;
      }
      var A = Number(medidas.altura) || 1;
      /* Para cima é mais: o eixo y da tela cresce para baixo, o volume não. */
      var f = -(d.y - arrasto.y) / A;
      /* Desde 09/09 o volume é o ÚNICO arrasto vertical — o brilho saiu. A
       * escolha de faixa que existia aqui virou uma constante, e o `alvo`
       * continua no objeto porque o player.js o usa para saber o que desenhar
       * no selo. */
      return Math.round(f * ARRASTO_VOLUME * 1000) / 1000;
    }

    /* Desmancha o que UM dedo estava fazendo e devolve o fim do gesto, para o
     * player.js poder desfazer o que estiver na tela. Chamado quando um
     * segundo dedo chega no meio de um arrasto: o gesto de um dedo acaba ali. */
    function encerrarUmDedo() {
      var saida = null;
      if (zoomAtivo) {
        saida = encerrarZoom();
      } else if (deslize) {
        /* O deslize morre SEM fazer nada, mesmo que a distância já bastasse.
         * Um segundo dedo chegando é o começo de outro gesto — pinça ou
         * capítulo —, e fechar o player no meio dele seria o pior desfecho
         * possível: destrutivo e não pedido. O `progresso: 0` do `alvo: null`
         * é o que apaga o aviso da tela. */
        deslize = null;
        saida = { acao: 'deslize', alvo: null, fase: 'fim', progresso: 0, feito: false };
      } else if (arrasto) {
        saida = { acao: 'arrastar', alvo: arrasto.alvo, fase: 'fim', valor: arrasto.ultimo };
        arrasto = null;
      } else if (segurando) {
        segurando = false;
        saida = { acao: 'velocidadeTemporaria', ligada: false };
      }
      eixo = null;
      return saida;
    }

    function soltar(id) {
      if (dedos[id]) delete dedos[id];
      var i = ordem.indexOf(id);
      if (i >= 0) ordem.splice(i, 1);
      if (!ordem.length) {
        eixo = null; arrasto = null; segurando = false; doisDedos = null;
        /* O GESTO acaba; a ampliação não. Tirar os dedos da tela não desfaz o
         * zoom, do mesmo jeito que soltar a barra não devolve o vídeo ao
         * segundo em que ele estava. */
        zoomAtivo = null; origem = null;
      }
    }

    /* Ver FANTASMA_MS. Só é chamada quando um dedo NOVO desce: é o único
     * momento em que existe um relógio confiável para comparar, e é também o
     * único em que um fantasma faz estrago. */
    function limparFantasmas(agora) {
      for (var i = ordem.length - 1; i >= 0; i--) {
        var d = dedos[ordem[i]];
        if (!d || (agora - d.visto) > FANTASMA_MS) {
          delete dedos[ordem[i]];
          ordem.splice(i, 1);
        }
      }
      if (!ordem.length) {
        eixo = null; arrasto = null; segurando = false; doisDedos = null;
        zoomAtivo = null; origem = null;
      }
    }

    function descer(p) {
      var pt = ponto(p);
      if (!pt) return null;
      /* O mesmo id descendo duas vezes sem subir seria um dedo contado em
       * dobro, e a partir daí a máquina acharia que há dois na tela. */
      if (dedos[pt.id]) soltar(pt.id);
      limparFantasmas(pt.t);
      dedos[pt.id] = pt;
      ordem.push(pt.id);

      /* O segundo dedo. O que o primeiro estava fazendo acaba aqui, e passa a
       * valer a pergunta do desempate: toque de dois dedos, ou pinça? */
      if (ordem.length === 2) {
        var saida = encerrarUmDedo();
        doisDedos = { t: pt.t, dist: distanciaEntreDedos(), toque: true };
        /* A origem da pinça é congelada AQUI, antes de se saber se vai haver
         * pinça. Quando a distância mudar o bastante para desempatar, o gesto
         * já terá andado, e medir a partir dali faria a imagem saltar. */
        if (pincaPermitida) {
          var m = meioDosDedos();
          origem = {
            dist: doisDedos.dist, meioX: m.x, meioY: m.y,
            escala: zoom.escala, x: zoom.x, y: zoom.y
          };
        }
        marcarConsumidos();
        return saida;
      }
      /* Três dedos não são gesto nenhum neste player. */
      if (ordem.length > 2) {
        doisDedos = null;
        marcarConsumidos();
        return encerrarUmDedo();
      }

      var duplo = !!ultimoToque &&
        (pt.t - ultimoToque.t) <= TOQUE_DUPLO_MS &&
        Math.abs(pt.x - ultimoToque.x) <= TOQUE_DUPLO_PX &&
        Math.abs(pt.y - ultimoToque.y) <= TOQUE_DUPLO_PX;

      /* Guardado ANTES de decidir, e mantido depois de um duplo: é o que faz o
       * terceiro toque valer outros 5 s, como no YouTube. */
      ultimoToque = { x: pt.x, y: pt.y, t: pt.t };
      if (!duplo) return null;

      if (travado) {
        /* O único gesto que a tela bloqueada aceita (item 9). Vale para o dedo
         * e para o mouse: em tela cheia o cadeado existe também no computador,
         * e sem isto a única saída de lá seria o Esc. */
        pt.consumido = true;
        ultimoToque = null;
        return { acao: 'destravar' };
      }

      /* O MOUSE (04/09, a pedido): dois cliques rápidos maximizam, e
       * maximizado desfazem. É o gesto que todo player de computador tem, e
       * até hoje este não tinha — o comentário que estava aqui dizia que não
       * estava entre os 29 itens da matriz, o que era verdade e deixou de ser
       * razão no dia em que foi pedido.
       *
       * O vídeo NÃO pode mudar de estado. O primeiro clique já alternou o
       * play/pause — na hora, que é o que mantém o clique simples rápido —, e
       * quem desfaz é ESTE evento: a ação diz "tela cheia E desfaz o play/pause
       * do clique anterior", e o ponteiro sai CONSUMIDO para o `subir()` não
       * alternar de novo.
       *
       * ISSO JÁ FOI FEITO DO JEITO ERRADO, e o site no ar mostrou (04/09): a
       * versão anterior não consumia o clique e deixava o `subir()` do segundo
       * desfazer o do primeiro. Dois eventos, duas alternâncias, saldo zero —
       * no papel. Só que entrar em tela cheia remexe a página inteira e um
       * `pointercancel` engole o `pointerup` que viria: sobrava UMA alternância,
       * e a tela cheia entrava com o vídeo pausado. A regra que fica: efeito que
       * precisa acontecer não pode depender de um evento que ainda não chegou,
       * ainda mais quando o próprio efeito ao lado sacode a página.
       *
       * A alternativa — segurar todo play/pause por 300 ms esperando um possível
       * segundo clique — continua recusada: deixaria TODO clique lento, para
       * todo mundo, por causa de um gesto ocasional.
       *
       * `ultimoToque` zera aqui, e isso fecha o par: o terceiro clique começa
       * outro duplo em vez de desmaximizar sozinho. É o que o `dblclick` do
       * navegador faz, e é o que a mão espera. */
      if (pt.tipo === 'mouse') {
        pt.consumido = true;
        ultimoToque = null;
        return { acao: 'telaCheiaNoDuploClique' };
      }

      var zona = zonaDoToque(pt.x, medidas.largura);
      if (zona === 'centro') {
        /* No centro, dois toques são dois play/pause — o segundo desfaz o
         * primeiro e o vídeo fica como estava. Deixar assim é melhor do que
         * inventar uma terceira coisa para o centro: o gesto se explica
         * sozinho e não surpreende ninguém. */
        return null;
      }
      pt.consumido = true;
      return { acao: 'pular', segundos: zona === 'esquerda' ? -PULO_TOQUE_S : PULO_TOQUE_S };
    }

    function mover(p) {
      if (!p || p.id == null) return null;
      var d = dedos[p.id];
      if (!d) return null;
      d.x = Number(p.x) || 0;
      d.y = Number(p.y) || 0;
      if (p.t != null) d.visto = Number(p.t) || 0;

      /* Dois dedos: ou é o toque que pula capítulo, ou é a pinça. */
      if (ordem.length >= 2) {
        /* Três dedos não são gesto nenhum, e o `descer` já zerou o `doisDedos`. */
        if (!doisDedos) return null;
        var dist = distanciaEntreDedos();
        if (Math.abs(dist - doisDedos.dist) > DOIS_DEDOS_PX) doisDedos.toque = false;
        /* Fora da tela cheia o desempate para exatamente onde parava antes da
         * fase 8: a pinça é do navegador, e o único efeito de dois dedos que se
         * afastam continua sendo deixar de ser um toque de capítulo. */
        if (!pincaPermitida || !origem || travado) return null;
        var comecou = false;
        if (zoomAtivo !== 'pinca') {
          /* Enquanto ainda puder ser um toque de capítulo, não é pinça. O
           * desempate NÃO ganhou um segundo número: os mesmos 10 px do desempate que
           * tiram o capítulo são os que ligam o zoom. */
          if (doisDedos.toque) return null;
          zoomAtivo = 'pinca';
          comecou = true;
        }
        var meio = meioDosDedos();
        aplicarZoom(origem.escala * (origem.dist > 0 ? dist / origem.dist : 1),
          meio.x, meio.y);
        return acaoZoom(comecou ? 'inicio' : 'mover');
      }

      if (d.tipo === 'mouse' || travado) return null;

      /* O deslize em andamento, pela mesma razão que o arrasto logo abaixo: o
       * dedo está consumido, e a recusa por `consumido` lá embaixo congelaria
       * o gesto no primeiro movimento. */
      if (deslize) return acaoDeslize(d, 'mover');

      /* O arrasto em andamento vem ANTES de qualquer recusa: o dedo que
       * arrasta está marcado como consumido — foi ele que virou o arrasto —, e
       * uma recusa por `consumido` aqui em cima congelaria o gesto no primeiro
       * movimento. */
      if (arrasto) {
        if (arrasto.alvo === 'tempo') {
          /* A porta de saída: jogar o dedo para baixo desfaz o arrasto inteiro.
           * `arrasto.y` é a altura em que o eixo foi decidido e não anda no
           * meio do gesto — é dela que a queda é medida. */
          var limiar = limiarDeCancelar(medidas.altura);
          var caiu = d.y - arrasto.y;
          if (caiu > limiar) {
            arrasto = null;
            eixo = 'morto';
            d.consumido = true;
            /* `valor: 0` é o que devolve o vídeo ao ponto de partida: quem
             * executa soma o valor ao tempo de onde o arrasto começou. */
            return { acao: 'arrastar', alvo: 'tempo', fase: 'fim', valor: 0, cancelado: true };
          }
          arrasto.ultimo = valorDoArrasto(d);
          return {
            acao: 'arrastar', alvo: 'tempo', fase: 'mover', valor: arrasto.ultimo,
            /* Quanto do caminho até o cancelamento já foi andado, de 0 a 1. É
             * o que deixa a tela avisar antes de acontecer — um gesto que
             * ninguém descobre sozinho precisa se anunciar. */
            descarte: Math.round(Math.max(0, Math.min(1, caiu / limiar)) * 100) / 100
          };
        }
        arrasto.ultimo = valorDoArrasto(d);
        return { acao: 'arrastar', alvo: arrasto.alvo, fase: 'mover', valor: arrasto.ultimo };
      }

      /* Com a imagem AMPLIADA, o dedo arrasta a IMAGEM — não a linha do tempo,
       * não o volume. É a regra de todo visualizador que amplia,
       * e ela se explica sozinha: só há o que arrastar quando há mais imagem do
       * que quadro. Quem quiser procurar no vídeo ampliado tem a barra, que é
       * nossa e sabe arrastar desde a fase 0.
       *
       * Está aqui em cima pela mesma razão que o arrasto: o dedo que sobra de
       * uma pinça está CONSUMIDO, e continuar arrastando com ele depois de
       * tirar o outro é o que a mão faz — uma recusa por `consumido` lá embaixo
       * mataria justamente esse caminho. */
      if (zoomAtivo === 'pan') {
        aplicarZoom(zoom.escala, d.x, d.y);
        return acaoZoom('mover');
      }
      if (zoom.escala > ZOOM_MIN && !segurando && eixo !== 'morto') {
        if (Math.abs(d.x - d.x0) < MOVER_MIN_PX &&
          Math.abs(d.y - d.y0) < MOVER_MIN_PX) return null;
        zoomAtivo = 'pan';
        /* A origem é onde o dedo ESTÁ, e não onde ele desceu: os 10 px da zona
         * morta não podem virar um salto da imagem no primeiro quadro. */
        origem = {
          dist: 0, meioX: d.x, meioY: d.y,
          escala: zoom.escala, x: zoom.x, y: zoom.y
        };
        d.consumido = true;
        aplicarZoom(zoom.escala, d.x, d.y);
        return acaoZoom('inicio');
      }

      /* Daqui para baixo é a decisão de COMEÇAR alguma coisa, e é aí que
       * `consumido` importa: o dedo que sobrou de um toque de dois dedos, ou o
       * que acabou de pular 5 s, não recomeça como arrasto.
       *
       * Segurando o 2×, mexer o dedo também não muda nada. Quem está segurando
       * sabe o que está fazendo, e cancelar o 2× por causa de um deslize
       * transformaria o gesto num teste de firmeza de pulso. */
      if (segurando || eixo === 'morto' || d.consumido) return null;

      var dx = d.x - d.x0;
      var dy = d.y - d.y0;
      if (Math.abs(dx) < MOVER_MIN_PX && Math.abs(dy) < MOVER_MIN_PX) return null;

      /* O EIXO decide a ação; a ZONA decide qual das duas verticais. Empate em
       * 45° vai para o horizontal, que é o gesto que existe nos dois modos —
       * em tela cheia e fora dela. */
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (naBordaLateral(d.x0, medidas.largura)) { eixo = 'morto'; return null; }
        eixo = 'x';
        arrasto = {
          alvo: 'tempo', x: d.x, y: d.y, t: d.visto, acumulado: 0, ultimo: 0,
          /* O teto é fixado no COMEÇO do gesto e não muda no meio dele: um
           * `loadedmetadata` chegando com a duração de verdade não pode trocar
           * a escala com o dedo na tela. */
          teto: tetoDoGanho(medidas.duracao, medidas.fracaoTeto)
        };
      } else {
        if (!verticalPermitido) { eixo = 'morto'; return null; }
        eixo = 'y';
        /* A DIREITA é o volume, e continua sendo. O resto do quadro — a
         * esquerda que era o brilho e o centro, que nunca teve vertical — é o
         * deslize da fase 7.
         *
         * São 70% da largura para um gesto e 30% para o outro, e a diferença
         * não é descuido: o volume tem o painel e as setas do teclado como
         * outros caminhos, e o deslize não tem nenhum. Um alvo estreito para o
         * único caminho de uma função é o que faz gesto não ser descoberto. */
        if (zonaDoToque(d.x0, medidas.largura) === 'direita') {
          arrasto = { alvo: 'volume', x: d.x, y: d.y, ultimo: 0 };
          d.consumido = true;
          return { acao: 'arrastar', alvo: 'volume', fase: 'inicio', valor: 0 };
        }
        deslize = { y0: d.y0 };
        d.consumido = true;
        return acaoDeslize(d, 'inicio');
      }
      d.consumido = true;
      return { acao: 'arrastar', alvo: arrasto.alvo, fase: 'inicio', valor: 0 };
    }

    /* O deslize, traduzido para a tela, em qualquer uma das três fases.
     *
     * Ele SEMPRE se anuncia enquanto acontece, e isso não é enfeite: é um
     * gesto que ninguém descobre sozinho — a mesma condição que o `descarte`
     * do arrasto horizontal resolveu no projeto original. O `progresso` de 0 a 1 deixa a
     * tela dizer o que vai acontecer ANTES de acontecer, e some se o dedo
     * voltar. Sem isso, fechar o player seria uma surpresa.
     *
     * `alvo: null` — ↓ em pé, ↑ deitado — continua devolvendo ação, com
     * progresso zerado. Quem executa precisa saber que o gesto acabou para
     * tirar o aviso da tela; devolver `null` aqui deixaria o selo pendurado. */
    function acaoDeslize(d, fase) {
      var dy = d.y - deslize.y0;
      var alvo = alvoDoDeslize(dy, medidas);
      var limiar = limiarDeDeslize(medidas.altura);
      var andado = alvo ? Math.abs(dy) : 0;
      var progresso = Math.round(Math.max(0, Math.min(1, andado / limiar)) * 100) / 100;
      return {
        acao: 'deslize', alvo: alvo, fase: fase, progresso: progresso,
        /* Só o `fim` decide. Nas outras fases isto é sempre falso, e é o que
         * impede a tela de agir no meio do gesto — a lição do `pointerup`
         * engolido: o efeito acontece no evento que está na mão. */
        feito: fase === 'fim' && !!alvo && progresso >= 1
      };
    }

    function subir(p) {
      if (!p || p.id == null) return null;
      var d = dedos[p.id];
      if (!d) return null;
      if (p.x != null) d.x = Number(p.x) || 0;
      if (p.y != null) d.y = Number(p.y) || 0;
      /* O último pedaço do arrasto também tem velocidade, e é ela que decide
       * o quanto o gesto ainda anda ao soltar. */
      if (p.t != null) d.visto = Number(p.t) || 0;

      var saida = null;

      if (doisDedos) {
        /* O desempate fecha aqui: a distância não mudou (senão `toque` já
         * seria falso) E os dois dedos saíram rápido. */
        var toque = doisDedos.toque && (Number(p.t) || 0) - doisDedos.t <= DOIS_DEDOS_MS;
        var meio = meioDosDedos();
        doisDedos = null;
        marcarConsumidos();
        /* A pinça acaba no primeiro dedo que sai. Os dois ramos nunca disputam:
         * foi a distância mudando que ligou a pinça, e é a mesma distância
         * mudando que já tinha desligado o `toque`. */
        if (zoomAtivo === 'pinca') {
          saida = encerrarZoom();
        } else if (toque && !travado) {
          /* Metade a metade, e não as faixas de 30%: um toque de dois dedos no
           * meio do quadro tem que fazer alguma coisa. Ele já é um gesto que
           * ninguém descobre sozinho — o projeto diz isso com todas as
           * letras —, e uma zona morta no centro só pioraria. */
          var L = Number(medidas.largura) || 0;
          saida = { acao: 'capitulo', direcao: meio.x < L / 2 ? -1 : 1 };
        }
      } else if (zoomAtivo === 'pan') {
        saida = encerrarZoom();
      } else if (deslize) {
        saida = acaoDeslize(d, 'fim');
        deslize = null;
      } else if (arrasto) {
        arrasto.ultimo = valorDoArrasto(d);
        saida = { acao: 'arrastar', alvo: arrasto.alvo, fase: 'fim', valor: arrasto.ultimo };
        arrasto = null;
      } else if (segurando) {
        segurando = false;
        saida = { acao: 'velocidadeTemporaria', ligada: false };
      } else if (!d.consumido && !eixo) {
        if (travado) saida = { acao: 'avisoTravado' };
        else if (d.tipo === 'mouse') {
          /* Clique de mouse: play/pause em qualquer lugar do quadro, como era
           * antes desta fase. Só não vale se o ponteiro andou — arrastar de
           * uma ponta à outra do vídeo e soltar não é um clique. */
          if (Math.abs(d.x - d.x0) < MOVER_MIN_PX && Math.abs(d.y - d.y0) < MOVER_MIN_PX) {
            saida = { acao: 'alternarPlay' };
          }
        } else if (zonaDoToque(d.x0, medidas.largura) === 'centro') {
          /* No toque, só o centro dá play/pause. Nas laterais um toque sozinho
           * não faz NADA, de propósito: elas são a área do toque duplo, e um
           * play/pause que dispara e é desfeito 200 ms depois pisca a tela
           * inteira a cada pulo de 5 s. O botão de play está a 44 px dali,
           * sempre visível, e é o caminho de quem só quer pausar. */
          saida = { acao: 'alternarPlay' };
        }
      }

      soltar(p.id);
      return saida;
    }

    function cancelar() {
      var saida = encerrarUmDedo();
      dedos = {}; ordem = [];
      eixo = null; segurando = false; doisDedos = null; ultimoToque = null;
      deslize = null;
      /* O gesto morre; a ampliação fica. O navegador tomar o dedo para si não é
       * motivo para o vídeo voltar ao tamanho normal na cara de quem estava
       * lendo o slide. */
      zoomAtivo = null; origem = null;
      return saida;
    }

    /* Chamado pelo `setTimeout` de SEGURAR_MS que o player.js arma no
     * `pointerdown`. Todas as razões para o 2× NÃO valer são checadas aqui, e
     * não lá: elas são a decisão, e decisão tem teste. */
    function aoSegurar() {
      if (travado || segurando || arrasto || eixo || zoomAtivo ||
        ordem.length !== 1) return null;
      var d = dedos[ordem[0]];
      if (!d || d.tipo === 'mouse' || d.consumido) return null;
      /* Andou: era um arrasto começando devagar, não um dedo parado. */
      if (Math.abs(d.x - d.x0) >= MOVER_MIN_PX || Math.abs(d.y - d.y0) >= MOVER_MIN_PX) return null;
      segurando = true;
      d.consumido = true;
      return { acao: 'velocidadeTemporaria', ligada: true };
    }

    return {
      /* As medidas de que o gesto precisa, e são quatro: o quadro (que muda ao
       * girar o telefone e ao entrar em tela cheia), o comprimento do vídeo e a
       * fração que o `/admin` escolheu — as duas últimas porque o teto do
       * arranco sai delas. */
      medir: function (m) {
        medidas = {
          largura: Number(m && m.largura) || 0,
          altura: Number(m && m.altura) || 0,
          duracao: Number(m && m.duracao) || 0,
          fracaoTeto: m && m.fracaoTeto,
          /* O tamanho de VERDADE do vídeo, que não é o do quadro. É dele que
           * sai o retângulo da imagem, e é o retângulo — não o quadro — que
           * limita o arrasto da imagem ampliada. Zero antes do
           * `loadedmetadata`, e aí vale o quadro. */
          videoLargura: Number(m && m.videoLargura) || 0,
          videoAltura: Number(m && m.videoAltura) || 0
        };
        /* Girar o aparelho em tela cheia troca o quadro debaixo de uma imagem
         * que já está ampliada, e o deslocamento que estava encostado na borda
         * passa a mostrar faixa preta. Reaparar aqui conserta os dois casos de
         * uma vez, porque toda remedida passa por este ponto — a que vem do
         * `resize` e a que vem do `loadedmetadata`, que é quando a proporção
         * de verdade chega e o palpite do quadro cai. */
        if (zoom.escala > ZOOM_MIN) {
          var d = limitarDeslocamentoZoom(zoom, zoom.escala, medidas, imagemNoQuadro());
          zoom = { escala: zoom.escala, x: d.x, y: d.y };
        }
      },
      /* Para o player.js reaplicar a transformação depois de uma remedida: a
       * máquina sabe o número certo, e a tela precisa dele. */
      zoomAtual: function () {
        return { escala: zoom.escala, x: zoom.x, y: zoom.y };
      },
      permitirVertical: function (sim) { verticalPermitido = !!sim; },
      /* Ligada e desligada pela tela cheia, como a vertical. Desligar ZERA a
       * ampliação de propósito: sair da tela cheia com o vídeo ampliado
       * deixaria a ficha com um pedaço de imagem dentro de uma caixa de 211 px
       * e nenhum gesto à mão para desfazer — fora da tela cheia a pinça é do
       * navegador. */
      permitirPinca: function (sim) {
        pincaPermitida = !!sim;
        if (!pincaPermitida) {
          zoomAtivo = null; origem = null;
          zoom = { escala: ZOOM_MIN, x: 0, y: 0 };
        }
      },
      travar: function (sim) { travado = !!sim; },
      descer: descer,
      mover: mover,
      subir: subir,
      cancelar: cancelar,
      aoSegurar: aoSegurar,
      /* Só para o teste e para o console: a máquina por dentro, sem ninguém
       * precisar adivinhar em que estado ela ficou. */
      estado: function () {
        return {
          dedos: ordem.length,
          eixo: eixo,
          arrasto: arrasto ? arrasto.alvo : null,
          deslize: !!deslize,
          segurando: segurando,
          travado: travado,
          vertical: verticalPermitido,
          pinca: pincaPermitida,
          zoomAtivo: zoomAtivo,
          zoom: zoom.escala,
          zoomX: zoom.x,
          zoomY: zoom.y
        };
      }
    };
  }

  /* ============================================================= exportação */

  var AppPlayerCore = {
    REGRAS: REGRAS,
    atributosVideo: atributosVideo,
    urlHls: urlHls,
    urlMp4: urlMp4,
    estrategia: estrategia,
    configHls: configHls,
    limitarTempo: limitarTempo,
    tempoRelativo: tempoRelativo,
    tempoPorDecimo: tempoPorDecimo,
    VELOCIDADES: VELOCIDADES,
    proximaVelocidade: proximaVelocidade,
    proximoVolume: proximoVolume,
    VOLUME_MAX_GANHO: VOLUME_MAX_GANHO,
    COMPENSACAO_ESTAVEL: COMPENSACAO_ESTAVEL,
    GANHO_MAX: GANHO_MAX,
    viaDoVolume: viaDoVolume,
    ajusteNivelador: ajusteNivelador,
    ajusteLimitador: ajusteLimitador,
    JOELHO_MOLDADOR: JOELHO_MOLDADOR,
    curvaSuave: curvaSuave,
    tetoMoldador: tetoMoldador,
    precisaMoldador: precisaMoldador,
    ganhoDeSaida: ganhoDeSaida,
    rotuloVolume: rotuloVolume,
    acaoDeTecla: acaoDeTecla,
    urlLegenda: urlLegenda,
    tempoVtt: tempoVtt,
    analisarVtt: analisarVtt,
    desenrolarLegenda: desenrolarLegenda,
    cueEm: cueEm,
    TAMANHOS_LEGENDA: TAMANHOS_LEGENDA,
    proximoTamanhoLegenda: proximoTamanhoLegenda,
    segmentosCapitulos: segmentosCapitulos,
    fracaoNoSegmento: fracaoNoSegmento,
    segmentoEm: segmentoEm,
    RECOMECO_CAPITULO_S: RECOMECO_CAPITULO_S,
    alvoDeCapitulo: alvoDeCapitulo,
    posicaoDica: posicaoDica,
    ZONA_LADO: ZONA_LADO,
    zonaDoToque: zonaDoToque,
    MARGEM_BORDA_PX: MARGEM_BORDA_PX,
    naBordaLateral: naBordaLateral,
    TOQUE_DUPLO_MS: TOQUE_DUPLO_MS,
    TOQUE_DUPLO_PX: TOQUE_DUPLO_PX,
    PULO_TOQUE_S: PULO_TOQUE_S,
    SEGURAR_MS: SEGURAR_MS,
    VELOCIDADE_SEGURAR: VELOCIDADE_SEGURAR,
    MOVER_MIN_PX: MOVER_MIN_PX,
    DOIS_DEDOS_MS: DOIS_DEDOS_MS,
    DOIS_DEDOS_PX: DOIS_DEDOS_PX,
    ARRASTO_TEMPO_S: ARRASTO_TEMPO_S,
    VELOCIDADE_REF_PX_MS: VELOCIDADE_REF_PX_MS,
    GANHO_ARRASTO_MIN: GANHO_ARRASTO_MIN,
    GANHO_ARRASTO_MAX: GANHO_ARRASTO_MAX,
    ganhoDoArrasto: ganhoDoArrasto,
    FRACAO_TETO_PADRAO: FRACAO_TETO_PADRAO,
    FRACAO_TETO_MIN: FRACAO_TETO_MIN,
    FRACAO_TETO_MAX: FRACAO_TETO_MAX,
    fracaoDoTeto: fracaoDoTeto,
    tetoDoGanho: tetoDoGanho,
    podeEsconderControles: podeEsconderControles,
    SUMICO_PADRAO_S: SUMICO_PADRAO_S,
    SUMICO_MAX_S: SUMICO_MAX_S,
    segundosDeSumico: segundosDeSumico,
    DESLIZE_FRACAO: DESLIZE_FRACAO,
    DESLIZE_MIN_PX: DESLIZE_MIN_PX,
    limiarDeDeslize: limiarDeDeslize,
    alvoDoDeslize: alvoDoDeslize,
    CANCELAR_FRACAO: CANCELAR_FRACAO,
    CANCELAR_MIN_PX: CANCELAR_MIN_PX,
    limiarDeCancelar: limiarDeCancelar,
    ARRASTO_VOLUME: ARRASTO_VOLUME,
    IMA_VOLUME: IMA_VOLUME,
    volumeDoArrasto: volumeDoArrasto,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    limitarZoom: limitarZoom,
    retanguloDaImagem: retanguloDaImagem,
    limitarDeslocamentoZoom: limitarDeslocamentoZoom,
    rotuloZoom: rotuloZoom,
    criarGestos: criarGestos
  };

  raiz.AppPlayerCore = AppPlayerCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppPlayerCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
