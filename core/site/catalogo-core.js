/* catalogo-core.js — funções puras do catálogo: sem DOM, sem rede.
 *
 * Carregado de dois jeitos, sem etapa de build:
 *   - no navegador, como <script> comum, expondo window.App;
 *   - nos testes, como módulo CommonJS (require('./catalogo-core.js')).
 */
(function (raiz) {
  'use strict';

  /* Prefixo das chaves de armazenamento do navegador. Padrão 'tm'; para mudar,
   * defina window.APP_PREFIXO antes de carregar este arquivo (letras, números,
   * _ ou -, até 12 caracteres). */
  var PREFIXO = (raiz && typeof raiz.APP_PREFIXO === 'string' &&
    /^[A-Za-z0-9_-]{1,12}$/.test(raiz.APP_PREFIXO)) ? raiz.APP_PREFIXO : 'tm';

  /* A tradução (i18n.js): `t()` lê a instância global, que o app.js (site), a mesa
   * ou o Worker/teste (pt-BR embutido) já preencheram. Quem usa este arquivo sem
   * o i18n.js carregado recebe a própria chave de volta — feio, mas sem quebrar. */
  var I18n = raiz.AppI18n || (typeof require === 'function' ? require('./i18n.js') : null);
  function tr(chave, params) { return I18n ? I18n.t(chave, params) : chave; }
  /* Os blocos da home (home-blocos.js): puros, e recebem daqui as primitivas de que precisam. No
   * navegador o <script> vem antes deste; no Worker e nos testes, o require. */
  var Home = raiz.AppHome || (typeof require === 'function' ? require('./home-blocos.js') : null);
  function idiomaAtual() { return I18n ? I18n.idioma() : 'pt-BR'; }
  /* Tabelas de rótulos como objeto: cada leitura `TABELA[chave]` resolve o texto
   * NA HORA, no idioma de agora (getter), então a troca de idioma vale sem
   * recarregar e o código antigo, que lia `ROTULO[x]`, segue igual. */
  function tabelaT(prefixo, chaves) {
    var tabela = {};
    chaves.forEach(function (k) {
      Object.defineProperty(tabela, k, { enumerable: true, get: function () { return tr(prefixo + k); } });
    });
    return tabela;
  }
  /* O nome de quem não tem série: é rótulo de tela E chave de agrupamento, por
   * isso vem sempre desta função. */
  function semSerie() { return tr('catalogo.semSerie'); }

  /* Rótulos de triagem — não são séries de verdade, vão para o fim da grade. */
  var SERIES_AO_FIM = ['A classificar', 'A identificar']; /* i18n-ignorar: nome de série (dado do acervo) */

  var ROTULO_PENDENCIA = tabelaT('pendencia.', [
    'audio_sem_trilha', 'sem_identificacao', 'direitos_a_verificar', 'piloto_decidir',
    'material_bruto', 'versao_duplicada', 'nao_e_conteudo'
  ]);

  /* ---------------------------------------------------------------- texto */

  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /* "00:10:14" -> "10:14";  "01:02:03" -> "1:02:03" */
  function formatarDuracao(item) {
    var seg = item && typeof item.duracao_seg === 'number' ? item.duracao_seg : null;
    if (seg == null) return item && item.duracao ? String(item.duracao) : '';
    var h = Math.floor(seg / 3600);
    var m = Math.floor((seg % 3600) / 60);
    var s = seg % 60;
    var dois = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
  }

  /* "T1 · E2", "E2" ou "" */
  function rotuloEpisodio(item) {
    if (!item) return '';
    var partes = [];
    if (item.temporada != null) partes.push('T' + item.temporada);
    if (item.episodio != null) partes.push('E' + item.episodio);
    return partes.join(' · ');
  }

  function rotuloPendencia(pendencia) {
    if (!pendencia) return '';
    return ROTULO_PENDENCIA[pendencia] || String(pendencia).replace(/_/g, ' ');
  }

  /* Mini-sinopse do cartão da grade: uma linha só de texto, cortada na palavra.
   * O corte fino para 2 ou 3 linhas é do CSS (`line-clamp`), que conhece a
   * largura real do cartão; aqui a única função é não despejar sinopses de
   * 2 000 caracteres no DOM 33 vezes e não deixar quebra de linha vazar.
   *
   * Devolve '' quando não há sinopse — há título publicado sem ela
   * (`inst-video-geral-2025-master`), e o cartão tem que aguentar. */
  function resumoSinopse(item, limite) {
    var texto = item && typeof item.sinopse === 'string' ? item.sinopse : '';
    texto = texto.replace(/\s+/g, ' ').trim();
    if (!texto) return '';
    var max = typeof limite === 'number' && limite > 0 ? limite : 190;
    if (texto.length <= max) return texto;
    var corte = texto.slice(0, max);
    var espaco = corte.lastIndexOf(' ');
    if (espaco > max * 0.6) corte = corte.slice(0, espaco);
    return corte.replace(/[\s.,;:!?—–-]+$/, '') + '…';
  }

  /* Título do CARTÃO da prateleira — o nome inteiro repete o que já está
   * escrito ali em cima.
   *
   * Duas podas, e as duas nasceram dos dados de 10/09, não de gosto:
   *
   * 1. O PREFIXO "Algo: ", em 43 dos 66. Dentro da prateleira *De Olho no
   *    Futuro*, "Série A: Título X" diz duas vezes o nome
   *    da linha. Mas ele só sai quando BATE COM A SÉRIE, e a comparação é por
   *    início do nome normalizado, nesta direção: a série tem que começar
   *    pelo prefixo.
   *      "Série A"  = a série            -> corta
   *      "Série B"        começa "Série B com Fulano" -> corta
   *      "Série"              começa "Séries"       -> corta
   *      "Natureza e Técnica"   na série Série D -> FICA
   *      "Abertura Geral"  na série A classificar -> FICA
   *    A direção contrária (prefixo começando pela série) ficou de fora de
   *    propósito: nenhum dos 66 precisa dela, e ela cortaria informação que
   *    a linha da prateleira não mostra — "Série F de campo: X" viraria "X".
   *
   * 2. O SUFIXO "(Episódio N)" / "(Parte N)", em 28 dos 66.
   *
   * A poda 2 CRIA COLISÃO, e isso é sabido e aceito: sobram cinco
   * "Tema Comum" no *Série B* e três "Português" na
   * *Série E*. O que desfaz a colisão é a linha de baixo do cartão, e é para
   * ela que serve `rotuloNumero`. Quem desenhar um cartão sem essa linha
   * reabre a colisão. */
  function tituloCurto(item) {
    var titulo = String((item && item.titulo) || '').trim();
    if (!titulo) return '';
    var serie = (item && item.serie) || '';

    var m = titulo.match(/^([^:]{2,60}):\s*(\S.*)$/);
    if (m && serie && normalizar(serie).indexOf(normalizar(m[1])) === 0) {
      titulo = m[2].trim();
    }
    titulo = titulo.replace(/\s*\((?:epis[oó]dio|parte)\s+[^)]*\)\s*$/i, '').trim();

    /* Poda que come o título inteiro devolve o original: um cartão sem nome é
     * pior do que um cartão repetindo a série. */
    return titulo || String((item && item.titulo) || '').trim();
  }

  /* O tamanho de uma série somada, para gente: "2 h 10 min", e não "130 min".
   * Arredonda para o minuto mais perto, com piso em 1 — um vídeo de 20 s não é
   * "0 min". Sem duração conhecida, devolve '' e o cartão fica só com a
   * contagem. */
  function formatarMinutos(segundos) {
    var s = Number(segundos);
    if (segundos == null || !isFinite(s) || s <= 0) return '';
    var min = Math.max(1, Math.round(s / 60));
    /* "5 min", "1 h 5 min": as unidades vêm do Intl, no idioma de agora. */
    return I18n ? I18n.formatarDuracao(min * 60, idiomaAtual()) : min + ' min';
  }

  /* "Parte 3", "Episódio 2" — o número que `tituloCurto` tirou do nome.
   *
   * A PALAVRA sai do título, não do campo: o *Série B* é numerado em
   * "Parte" e o resto em "Episódio", e mostrar "E3" onde o vídeo diz "Parte
   * 3" troca o nome das coisas para quem procura o episódio certo. Sem sufixo
   * no nome, cai no campo `episodio`, que é de onde vem a numeração dos
   * outros. */
  function rotuloNumero(item) {
    var m = String((item && item.titulo) || '')
      .match(/\((epis[oó]dio|episode|parte|part)\s+([^)]+)\)\s*$/i);
    if (m) {
      return tr(/^part/.test(normalizar(m[1])) ? 'catalogo.parte' : 'catalogo.episodio', { n: m[2].trim() });
    }
    if (item && item.episodio != null) return tr('catalogo.episodio', { n: item.episodio });
    return '';
  }

  /* ------------------------------------------------------------ capítulos */

  /* 62 -> '1:02'  ·  3723 -> '1:02:03'. Mesmo formato de `formatarDuracao`,
   * mas a partir de um número solto — o capítulo não é um item do catálogo. */
  function formatarTempo(segundos) {
    var t = Math.max(0, Math.floor(Number(segundos) || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var dois = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
  }

  /* Lista de capítulos do item, saneada, pronta para desenhar.
   *
   * Defensiva de propósito: os capítulos vêm do KV, que é editado pela tela de
   * admin e por script. Um `inicio` que virou texto, um título vazio ou dois
   * capítulos no mesmo segundo não podem derrubar a ficha inteira — a ficha
   * tem que abrir com o vídeo mesmo quando os capítulos estiverem tortos.
   * Por isso aqui nada lança: o que não presta é descartado em silêncio.
   *
   * Devolve [] quando não há nada aproveitável, e quem chama trata [] como
   * "esse título não tem capítulos" — que é o caso de 22 dos 33 no ar. */
  function capitulos(item) {
    var bruto = item && Array.isArray(item.capitulos) ? item.capitulos : [];
    var limpos = [];
    bruto.forEach(function (c) {
      if (!c) return;
      var inicio = Number(c.inicio);
      if (!isFinite(inicio) || inicio < 0) return;
      var titulo = String(c.titulo == null ? '' : c.titulo).replace(/\s+/g, ' ').trim();
      if (!titulo) return;
      limpos.push({ inicio: Math.floor(inicio), titulo: titulo });
    });

    limpos.sort(function (a, b) { return a.inicio - b.inicio; });

    /* Dois capítulos no mesmo segundo viram um: o player não consegue
     * desenhar um segmento de largura zero, e a lista mostraria o mesmo
     * horário duas vezes. Fica o primeiro. */
    var saida = [];
    limpos.forEach(function (c) {
      if (saida.length && saida[saida.length - 1].inicio === c.inicio) return;
      saida.push(c);
    });
    return saida;
  }

  /* Índice do capítulo que contém `segundos`, ou -1.
   *
   * É o que destaca a linha certa na lista enquanto o vídeo anda. -1 antes do
   * primeiro capítulo é caso real: nem todo vídeo começa em 0 (o vídeo de abertura só
   * tem fala a partir de 1:58), e o primeiro capítulo pode ser escrito depois
   * do começo. */
  function capituloEm(lista, segundos) {
    var t = Number(segundos);
    if (!isFinite(t)) return -1;
    var achado = -1;
    for (var i = 0; i < (lista || []).length; i++) {
      if (lista[i].inicio <= t) achado = i;
      else break;
    }
    return achado;
  }

  /* ------------------------------------------------------------ a ficha */

  /* A ROTA DA FICHA: `#/ep/<id>`, e desde a fase 2 da busca `#/ep/<id>?t=<segundos>` — o link de um TRECHO, que abre o vídeo
   * naquele momento.
   *
   * O `?t=` é separado ANTES de decodificar o id: o id vai codificado na URL,
   * e um `?` dentro dele chegaria como `%3F`, nunca como separador. `t` que
   * não é número inteiro é IGNORADO — `?t=abc`, `?t=1.5`, `?t=-3` abrem a
   * ficha do começo, como um link sem `t`. E o que a URL não leva é o pedido
   * de tocar: quem abre um link colado vê o vídeo PARADO no momento, com o
   * play à mão (a regra de 04/09: um link não toca sozinho).
   *
   * Um `%` solto no id — colado de um aplicativo de mensagem — faria o
   * `decodeURIComponent` lançar; o id segue como veio e cai no "não
   * encontrado" da ficha. Devolve { id, t } — `t` null quando não há — ou
   * null quando o endereço não é de ficha. */
  function rotaDaFicha(hash) {
    var m = /^#\/ep\/([^?]+)(?:\?(.*))?$/.exec(String(hash || ''));
    if (!m) return null;
    var id;
    try { id = decodeURIComponent(m[1]); } catch (e) { id = m[1]; }
    var t = null;
    String(m[2] || '').split('&').forEach(function (par) {
      var kv = par.split('=');
      if (kv[0] === 't' && /^\d{1,6}$/.test(kv[1] || '')) t = Number(kv[1]);
    });
    return { id: id, t: t };
  }

  /* O link de um título — e de um momento dele, com `segundos`. */
  function linkDaFicha(id, segundos) {
    var t = Math.floor(Number(segundos));
    return '#/ep/' + encodeURIComponent(id) + (segundos != null && isFinite(t) && t >= 0 ? '?t=' + t : '');
  }

  /* --------------------------------------------------------------- player */

  /* ------------------------------------------------ a fonte do vídeo (M4)
   *
   * O item guarda `fonte: { provedor, id, extras }`: o provedor (`bunny`,
   * `cloudflare-stream`, `hls-generico`), o id do vídeo NO provedor e o que mais
   * o provedor precisa que não é segredo (`extras`, ex.: `{ libraryId }` no
   * Bunny). O formato de antes do M4 era `{ tipo, libraryId, videoId }`.
   *
   * `migrarFonte` é PURA, idempotente e a única que conhece os dois formatos;
   * o Worker a roda ao LER o catálogo e ao GRAVAR (o KV migra aos poucos), e
   * os scripts de carga a usam para ler KV e arquivo local sem se importar com
   * a idade do dado. A ordem das chaves é fixa (provedor, id, extras, com as
   * chaves de extras em ordem alfabética): comparar fonte por JSON, como o
   * histórico faz, só funciona assim.
   *
   * O navegador NÃO monta URL nenhuma a partir disto: ele recebe `item.midia`
   * pronto do servidor (ver provedores/contrato.js). */
  var PROVEDOR_DO_FORMATO_ANTIGO = 'bunny';   /* o formato antigo só existia para o Bunny */

  function textoOuNulo(v) { return v == null || v === '' ? null : String(v); }

  function migrarFonte(fonte) {
    var f = fonte && typeof fonte === 'object' && !Array.isArray(fonte) ? fonte : {};
    var novo = 'provedor' in f || 'id' in f || 'extras' in f;
    var extras = {};
    if (novo) {
      if (f.extras && typeof f.extras === 'object' && !Array.isArray(f.extras)) {
        Object.keys(f.extras).forEach(function (k) { extras[k] = f.extras[k]; });
      }
    } else {
      /* Formato antigo: libraryId vira extra; o que mais houver (campo que um
       * script gravou) também, para nada se perder na migração. */
      Object.keys(f).forEach(function (k) {
        if (k === 'tipo' || k === 'videoId') return;
        if (f[k] != null && f[k] !== '') extras[k] = f[k];
      });
    }
    var ordenados = {};
    Object.keys(extras).sort().forEach(function (k) { if (extras[k] !== undefined) ordenados[k] = extras[k]; });
    var provedor = novo ? textoOuNulo(f.provedor) : (textoOuNulo(f.tipo) || PROVEDOR_DO_FORMATO_ANTIGO);
    var id = novo ? f.id : f.videoId;
    return { provedor: provedor, id: textoOuNulo(id), extras: ordenados };
  }

  /* O id do vídeo no provedor, ou null. Aceita o item, e lê os dois formatos. */
  function idDoVideo(item) {
    return item && item.fonte ? migrarFonte(item.fonte).id : null;
  }

  /* O item com a `fonte` migrada (o mesmo objeto se já estava), sem `midia`:
   * `midia` é calculada pelo servidor a cada resposta e nunca é gravada. */
  function itemMigrado(item) {
    if (!item || typeof item !== 'object') return item;
    var copia = null;
    var alvo = migrarFonte(item.fonte);
    if (JSON.stringify(alvo) !== JSON.stringify(item.fonte)) { copia = Object.assign({}, item); copia.fonte = alvo; }
    if ('midia' in item) { copia = copia || Object.assign({}, item); delete copia.midia; }
    return copia || item;
  }

  function catalogoMigrado(catalogo) {
    if (!catalogo || !Array.isArray(catalogo.itens)) return catalogo;
    var mudou = false;
    var itens = catalogo.itens.map(function (i) { var n = itemMigrado(i); if (n !== i) mudou = true; return n; });
    return mudou ? Object.assign({}, catalogo, { itens: itens }) : catalogo;
  }

  /* --------------------------------------------------------------- player
   *
   * O servidor entrega `item.midia` (ver provedores/contrato.js):
   *   { hls, mp4: { '240p', '360p', '720p' }, capa, previa, legendas: [{ idioma, rotulo, url }],
   *     embed: { url, scriptUrl, controle }, expiraEm }
   * Tudo aqui só LÊ esse objeto. Nenhum host de provedor existe no navegador. */

  /* A mídia utilizável do item, ou null: sem `hls`, `mp4` nem `embed` não há o
   * que tocar (vídeo ainda não enviado, ou provedor sem credencial). */
  function midiaDe(item) {
    var m = item && item.midia;
    if (!m || typeof m !== 'object') return null;
    return (m.hls || m.mp4 || (m.embed && m.embed.url)) ? m : null;
  }

  /* ARMADILHA CENTRAL DO PROJETO: o autoplay do player embutido pode ser `true`
   * por padrão (é no Bunny). Quem monta a URL do embed é o ADAPTADOR do
   * provedor, que desliga autoplay, loop, preload e rememberPosition; a suíte
   * de contrato confere que nenhuma URL liga autoplay. */
  function urlEmbed(midia) {
    return midia && midia.embed && typeof midia.embed.url === 'string' ? midia.embed.url : null;
  }

  /* A capa já vem final do servidor (provedor, arquivo com hash e versão
   * contra cache, tudo resolvido lá). */
  function urlCapa(item) {
    return item && item.midia && typeof item.midia.capa === 'string' && item.midia.capa ? item.midia.capa : null;
  }

  /* O catálogo com a capa nova de UM vídeo — a gravação que `/api/midia` faz
   * logo depois de o provedor aceitar a capa (22/09). Todo título com aquele
   * `videoId` leva os dois campos, e só eles: é uma publicação de dois campos,
   * e vai pela mesma porta do PUT, com a mesma conferência e o mesmo rastro.
   *
   * Devolve null quando nenhum título do catálogo usa o vídeo — o título novo,
   * que ainda nem foi gravado, e cuja capa continua indo pelo rascunho. */
  function comCapa(catalogo, videoId, arquivo, versao) {
    var itens = (catalogo && Array.isArray(catalogo.itens)) ? catalogo.itens : [];
    var achou = false;
    var novos = itens.map(function (i) {
      if (!i || idDoVideo(i) !== videoId) return i;
      achou = true;
      return Object.assign({}, i, { capa_arquivo: arquivo, capa_versao: versao });
    });
    return achou ? Object.assign({}, catalogo, { itens: novos }) : null;
  }

  /* Trecho animado que o provedor gera amostrando o vídeo (WebP animado, no
   * Bunny). É o que a grade mostra no lugar da capa enquanto o ponteiro está
   * sobre o cartão — sem um segundo player na página e sem decodificar vídeo.
   *
   * ARMADILHA, com o número MEDIDO no Bunny em 14/09, nos 66 títulos: a
   * mediana é de **1,13 MB**, a menor 454 KB e a maior 3,1 MB, e os 66 somam
   * **82,2 MB**. Carregar os 66 junto com a chegada são 82 MB, e a tela morre
   * no celular. Quem chama isto tem obrigação de pedir a imagem SÓ no
   * `mouseenter` e descartá-la no `mouseleave`. Há teste cobrindo isso em
   * tests/catalogo.test.js. */
  function urlPreview(item) {
    return item && item.midia && typeof item.midia.previa === 'string' && item.midia.previa ? item.midia.previa : null;
  }

  /* A faixa de legenda do item (a do idioma pedido; sem pedido, a primeira):
   * { idioma, rotulo, url }, ou null. A URL é a que o provedor serve. */
  function faixaDeLegenda(item, idioma) {
    var lista = item && item.midia && Array.isArray(item.midia.legendas) ? item.midia.legendas : [];
    var achada = idioma ? lista.filter(function (l) { return l && l.idioma === idioma; })[0] : lista[0];
    return achada && typeof achada.url === 'string' && achada.url ? achada : null;
  }

  function urlLegenda(item, idioma) {
    var f = faixaDeLegenda(item, idioma);
    return f ? f.url : null;
  }

  /* MP4 direto, usado pelo seletor de capa da tela de admin e como rede de
   * segurança do player. Sem a resolução pedida, cai na mais próxima que
   * houver (o provedor pode não oferecer todas). */
  var RESOLUCOES_MP4 = ['240p', '360p', '720p'];

  function urlMp4(item, resolucao) {
    var mp4 = item && item.midia && item.midia.mp4;
    if (!mp4 || typeof mp4 !== 'object') return null;
    var pedida = resolucao || '720p';
    if (mp4[pedida]) return mp4[pedida];
    var alvo = RESOLUCOES_MP4.indexOf(pedida);
    var melhor = null;
    RESOLUCOES_MP4.forEach(function (r, k) {
      if (mp4[r] && (melhor === null || Math.abs(k - alvo) < Math.abs(melhor.k - alvo))) melhor = { k: k, url: mp4[r] };
    });
    return melhor ? melhor.url : null;
  }

  /* ------------------------------------------------------------- listagem */

  function publicaveis(itens) {
    return (itens || []).filter(function (i) { return i && i.publicar === true; });
  }

  function chaveSerie(serie) {
    var nome = serie || semSerie();
    var atrasa = SERIES_AO_FIM.indexOf(nome) >= 0 ? 1 : 0;
    return atrasa + '' + normalizar(nome);
  }

  /* Ordena por série, temporada, episódio e título.
   * Nunca por nome de arquivo: "V1"/"MASTER" bagunçam a ordem alfabética. */
  function ordenar(itens) {
    var alto = Number.MAX_SAFE_INTEGER;
    return (itens || []).slice().sort(function (a, b) {
      var sa = chaveSerie(a.serie), sb = chaveSerie(b.serie);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var ta = a.temporada == null ? alto : a.temporada;
      var tb = b.temporada == null ? alto : b.temporada;
      if (ta !== tb) return ta - tb;
      var ea = a.episodio == null ? alto : a.episodio;
      var eb = b.episodio == null ? alto : b.episodio;
      if (ea !== eb) return ea - eb;
      return normalizar(a.titulo).localeCompare(normalizar(b.titulo), idiomaAtual());
    });
  }

  /* A ORDEM DA TABELA DA MESA — quando alguém bate no cabeçalho de uma coluna.
   *
   * `ordenar()` continua sendo o padrão da tela e o DESEMPATE de todas as
   * colunas: a lista já entra na ordem do acervo, e o `sort` do navegador, que
   * é estável desde o ES2019, só mexe no que a coluna sabe comparar. Dois
   * títulos de 12:30 seguem lado a lado dentro da série deles, e não na ordem
   * em que o KV devolveu — que muda sozinha na próxima gravação.
   *
   * Duas decisões valem para todas as colunas:
   *
   *   1. o que está VAZIO vai para o fim NAS DUAS DIREÇÕES. Um título sem
   *      duração não é "o mais curto", e virar a ordem não pode trazer a falta
   *      de dado para o alto da tela;
   *   2. as colunas de estado — sinopse, pendência, no ar — sobem pelo que
   *      pede trabalho: a primeira batida põe no topo as sinopses vazias, as
   *      pendências e o que está no ar. Numa mesa de curadoria é para isso que
   *      se clica nelas. */
  var CHAVE_ORDEM = {
    titulo: function (i) { return normalizar(i.titulo) || null; },

    /* "T1 · E2" numa chave só, com a regra de `ordenar`: o número que falta vem
     * depois do que existe. Temporada e episódio são inteiros pequenos, e
     * 10000 é folga de sobra para pôr os dois no mesmo número. */
    episodio: function (i) {
      if (i.temporada == null && i.episodio == null) return null;
      return (i.temporada == null ? 9999 : i.temporada) * 10000 +
        (i.episodio == null ? 9999 : i.episodio);
    },

    duracao: function (i) { return typeof i.duracao_seg === 'number' ? i.duracao_seg : null; },

    /* A mesma leitura que a coluna mostra: vazia, automática, revisada. */
    sinopse: function (i) { return !i.sinopse ? 0 : i.sinopse_origem === 'auto' ? 1 : 2; },

    /* Também pelo que a coluna mostra: a pendência, ou "sem vídeo" quando não
     * há pendência e falta o vídeo, ou nada. O dígito na frente separa os dois
     * casos antes de os rótulos se compararem entre si; quem não tem problema
     * nenhum é o vazio da regra 1, e nunca sobe acima de quem tem. */
    pendencia: function (i) {
      if (i.pendencia) return '0 ' + normalizar(rotuloPendencia(i.pendencia));
      if (!idDoVideo(i)) return '1';
      return null;
    },

    'no-ar': function (i) { return i.publicar === true ? 0 : 1; }
  };

  /* As colunas que este arquivo sabe comparar. A tabela da mesa monta o
   * cabeçalho dela com esta lista na mão: uma coluna com chave que não está
   * aqui desenharia um botão que não ordena nada, e não avisaria ninguém. */
  var COLUNAS_ORDENAVEIS = Object.keys(CHAVE_ORDEM);

  function ordenarPor(itens, coluna, decrescente) {
    var chave = CHAVE_ORDEM[coluna];
    var lista = ordenar(itens);
    if (!chave) return lista;
    var sinal = decrescente ? -1 : 1;
    return lista.sort(function (a, b) {
      var ka = chave(a), kb = chave(b);
      if (ka == null || kb == null) return ka == null ? (kb == null ? 0 : 1) : -1;
      return sinal * (typeof ka === 'string' ? ka.localeCompare(kb, idiomaAtual()) : ka - kb);
    });
  }

  function agrupar(itens) {
    var grupos = [];
    var indice = Object.create(null);
    ordenar(itens).forEach(function (item) {
      var nome = item.serie || semSerie();
      if (!(nome in indice)) {
        indice[nome] = grupos.length;
        grupos.push({ serie: nome, itens: [] });
      }
      grupos[indice[nome]].itens.push(item);
    });
    return grupos;
  }

  /* ------------------------------------------------ a estrutura do site (M4)
   *
   * O nome e a ordem das prateleiras, de que lado cada série cai, o título em
   * destaque e os textos fixos nasceram escritos no código — e mudar qualquer
   * um deles era mudar este arquivo e publicar o site. A M4
   * põe os quatro num campo de topo do catálogo, `site`, que a mesa edita.
   *
   * O PADRÃO CONTINUA AQUI. O dado é uma camada POR CIMA, e só do que alguém
   * escolheu: catálogo sem `site` — ou com `site` pela metade — desenha a
   * chegada de hoje, linha por linha. Duas consequências que valem o preço:
   *
   *   - voltar ao padrão é APAGAR a entrada, nunca gravar o valor do código.
   *     Quem não escolheu nada anda junto quando o padrão mudar;
   *   - um dado torto não derruba o site: o saneador descarta o que não tem a
   *     forma certa, como o `ajustes()` da API já fazia com o número do arrasto.
   *
   * O `site` que chega ao navegador passa por `siteSaneado` no SERVIDOR (o GET
   * público) e é saneado de novo aqui, porque a mesa lê o documento cru pelo
   * `?completo=1`. */

  var CLASSES_SERIE = ['pedagogica', 'curta', 'institucional'];

  /* O rodapé e os cinco estados do B8 do briefing — "sem capa", a busca vazia,
   * o selo de vídeo indisponível, a ficha que não existe e a falha de rede.
   * Três deles têm título e ajuda, e por isso são nove chaves.
   *
   * OS TEXTOS FORAM REESCRITOS NA D7 (23/09) — o B8 dizia que os de antes "são
   * de programador". A regra da reescrita: dizer o que aconteceu na língua de
   * quem está assistindo, e o que fazer em seguida. "Remova o filtro de série"
   * saiu porque o filtro só oferece série que ESTÁ na resposta (D8): com ele
   * ligado a busca nunca fica vazia, e a frase mandava fazer o impossível.
   *
   * O termo buscado, a mensagem técnica do erro (`erro.message`) e os botões
   * NÃO moram aqui: o `app.js` os põe em linha própria. Um texto editável com
   * um buraco no meio é um texto que a próxima pessoa reescreve sem o buraco,
   * e aí o detalhe some. */
  var TEXTOS_PADRAO = tabelaT('site.', [
    'rodape', 'semCapa', 'videoIndisponivel', 'buscaVazia', 'buscaVaziaAjuda',
    'fichaAusente', 'fichaAusenteAjuda', 'erroCatalogo', 'erroCatalogoAjuda'
  ]);

  /* Texto de tela, não de artigo: o maior padrão tem 118 caracteres. O limite
   * é o que impede que um `paste` de uma página inteira vá para o KV e volte
   * em toda visita ao site. */
  var LIMITE_TEXTO = 300;

  function textoAparado(valor) {
    return typeof valor === 'string' ? valor.trim().slice(0, LIMITE_TEXTO) : '';
  }

  function mapaSimples(valor) {
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
  }

  /* A forma conferida, sempre com as cinco chaves — quem lê não precisa de
   * guarda. As chaves dos mapas saem ORDENADAS: o rascunho compara valor por
   * `JSON.stringify`, e um mapa com as mesmas entradas em outra ordem contaria
   * como mudança que ninguém fez. */
  function siteSaneado(site) {
    var cru = mapaSimples(site);
    var saida = {
      destaque: typeof cru.destaque === 'string' && cru.destaque ? cru.destaque : null,
      prateleiras: {},
      classes: {},
      textos: {},
      series: {}
    };

    var ps = mapaSimples(cru.prateleiras);
    Object.keys(ps).sort().forEach(function (id) {
      var p = mapaSimples(ps[id]);
      var limpa = {};
      var titulo = textoAparado(p.titulo);
      if (titulo) limpa.titulo = titulo;
      /* Número é número e `true` é `true`: o saneador confere a FORMA e não
       * adivinha a intenção. Um `'nao'` coagido para verdadeiro esconderia uma
       * prateleira sem ninguém entender de onde veio. */
      if (typeof p.ordem === 'number' && isFinite(p.ordem)) limpa.ordem = p.ordem;
      if (p.escondida === true) limpa.escondida = true;
      if (Object.keys(limpa).length) saida.prateleiras[id] = limpa;
    });

    var cs = mapaSimples(cru.classes);
    Object.keys(cs).sort().forEach(function (serie) {
      if (CLASSES_SERIE.indexOf(cs[serie]) >= 0) saida.classes[serie] = cs[serie];
    });

    var ts = mapaSimples(cru.textos);
    Object.keys(ts).sort().forEach(function (chave) {
      if (!(chave in TEXTOS_PADRAO)) return;
      var texto = textoAparado(ts[chave]);
      if (texto) saida.textos[chave] = texto;
    });

    var ss = mapaSimples(cru.series);
    Object.keys(ss).sort().forEach(function (nome) {
      if (!nome.trim()) return;
      var s = serieSaneada(ss[nome]);
      if (s) saida.series[nome] = s;
    });

    /* A home por blocos (M6): três chaves OPCIONAIS — só existem quando alguém escolheu. Ausente é "vale o
     * config/site.json, e sem ele o padrão do código"; por isso não nascem vazias, e um `site` sem elas é
     * o mesmo de antes dos blocos. Lista vazia de blocos é uma escolha (a chegada sem nada). */
    var blocos = Home.blocosSaneados(cru.blocos);
    if (blocos) saida.blocos = blocos;
    var colecoes = Home.colecoesSaneadas(cru.colecoes);
    if (colecoes) saida.colecoes = colecoes;
    if (Home.MODELOS.indexOf(cru.modeloDeConteudo) >= 0) saida.modeloDeConteudo = cru.modeloDeConteudo;

    return saida;
  }

  /* --------------------------------------- a apresentação da série
   *
   * `site.series[nome] = { sobre, origem, comeco, momentos, temas }` — o texto
   * "Sobre a série", os três destaques da página dela, e de onde o texto veio.
   * Quem escreve é o `scripts/series.mjs` (com Claude, a partir das sinopses,
   * dos capítulos e da fala) e a mesa.
   *
   * Duas camadas, como o resto do `site`:
   *
   *   - `siteSaneado` confere a FORMA, sem o catálogo na mão: texto é texto,
   *     `inicio` é inteiro, no máximo cinco momentos e cinco temas;
   *   - `apresentacaoDaSerie` confere o SENTIDO, com os itens: o `comeco` tem
   *     de ser um título no ar DESTA série, e o momento tem de cair no começo
   *     de um capítulo que existe. O capítulo que sumiu — um `capitulos.mjs`
   *     rodado de novo, um título tirado do ar — some da página sozinho, e a
   *     página não quebra. O dado fica como está: a mesa mostra o que caiu.
   *
   * `origem` é `auto` ou `revisada`, como a `sinopse_origem`. O script NUNCA
   * sobrescreve `revisada`, e por isso o valor desconhecido vira `auto` e não
   * o contrário: um `revisada` inventado pelo saneador trancaria o texto do
   * script para sempre, sem ninguém ter lido. VOLTAR AO GERADO É APAGAR A
   * ENTRADA: o script escreve de novo. */

  /* Um parágrafo ou dois — a maior sinopse do catálogo tem 377 caracteres, e o
   * texto da série fala de vários títulos. O teto é o do `paste` da página
   * inteira, como o `LIMITE_TEXTO`. */
  var LIMITE_SOBRE = 1500;
  var MAXIMO_MOMENTOS = 5;
  var MAXIMO_TEMAS = 5;
  var LIMITE_TEMA = 40;

  function serieSaneada(valor) {
    var cru = mapaSimples(valor);
    var saida = {};

    var sobre = typeof cru.sobre === 'string' ? cru.sobre.trim().slice(0, LIMITE_SOBRE) : '';
    if (sobre) saida.sobre = sobre;

    if (typeof cru.comeco === 'string' && cru.comeco) saida.comeco = cru.comeco;

    var momentos = [];
    var vistos = Object.create(null);
    (Array.isArray(cru.momentos) ? cru.momentos : []).forEach(function (m) {
      if (momentos.length >= MAXIMO_MOMENTOS) return;
      var mm = mapaSimples(m);
      if (typeof mm.id !== 'string' || !mm.id) return;
      /* Inteiro de verdade, como o `?t=` da rota da ficha: `'90'` e `1.5` não
       * são um segundo de capítulo, e o saneador não adivinha. */
      if (typeof mm.inicio !== 'number' || !isFinite(mm.inicio) || mm.inicio < 0 ||
          Math.floor(mm.inicio) !== mm.inicio) return;
      var chave = mm.id + '@' + mm.inicio;
      if (vistos[chave]) return;
      vistos[chave] = true;
      momentos.push({ id: mm.id, inicio: mm.inicio });
    });
    if (momentos.length) saida.momentos = momentos;

    /* Os temas servem também à busca, e "Profissões" e "profissões " são o
     * mesmo tema: fica o primeiro, na grafia dele. */
    var temas = [];
    var temasVistos = Object.create(null);
    (Array.isArray(cru.temas) ? cru.temas : []).forEach(function (t) {
      if (temas.length >= MAXIMO_TEMAS || typeof t !== 'string') return;
      var tema = t.replace(/\s+/g, ' ').trim().slice(0, LIMITE_TEMA).trim();
      var chave = normalizar(tema);
      if (!tema || temasVistos[chave]) return;
      temasVistos[chave] = true;
      temas.push(tema);
    });
    if (temas.length) saida.temas = temas;

    /* A origem só é guardada ao lado de alguma coisa: uma entrada com a origem
     * e nada mais não diz nada, e contaria como "alguém escolheu". */
    if (!Object.keys(saida).length) return null;
    saida.origem = cru.origem === 'revisada' ? 'revisada' : 'auto';
    return saida;
  }

  /* O que a página da série desenha: a entrada conferida contra os itens, ou
   * null quando não há nada a mostrar. Os momentos vêm com o título, o
   * capítulo e o link da ficha naquele segundo — o mesmo caminho do trecho da
   * busca. `comeco` sem escolha válida é null: quem desenha decide se cai no
   * primeiro episódio. */
  function apresentacaoDaSerie(itens, nome, site) {
    if (!nome) return null;
    var dado = siteSaneado(site).series[nome];
    if (!dado) return null;
    var daSerie = publicaveis(itens).filter(function (i) { return (i.serie || semSerie()) === nome; });
    if (!daSerie.length) return null;

    var comeco = dado.comeco ? porId(daSerie, dado.comeco) : null;

    var momentos = [];
    (dado.momentos || []).forEach(function (m) {
      var item = porId(daSerie, m.id);
      if (!item) return;
      var caps = capitulos(item);
      var i = capituloEm(caps, m.inicio);
      if (i < 0 || caps[i].inicio !== m.inicio) return;
      momentos.push({ item: item, inicio: m.inicio, capitulo: caps[i].titulo, link: linkDaFicha(item.id, m.inicio) });
    });

    var saida = {
      sobre: dado.sobre || '',
      origem: dado.origem,
      comeco: comeco || null,
      momentos: momentos,
      temas: (dado.temas || []).slice()
    };
    if (!saida.sobre && !saida.comeco && !saida.momentos.length && !saida.temas.length) return null;
    return saida;
  }

  /* OS TEMAS DA SÉRIE NA BUSCA: o tema da página abre a
   * busca por ele, e a busca tem de responder. Cada título da série ganha os
   * temas dela junto das `tags` — numa CÓPIA: o dado do título não muda, e o
   * que a mesa grava continua sendo só o do título. Sem tema nenhum, devolve
   * a própria lista, para o índice da busca não ser refeito à toa. */
  function comTemasDasSeries(itens, site) {
    var series = siteSaneado(site).series;
    var algum = Object.keys(series).some(function (n) { return (series[n].temas || []).length; });
    if (!algum) return itens || [];
    return (itens || []).map(function (i) {
      var s = i && series[i.serie || semSerie()];
      if (!s || !(s.temas || []).length) return i;
      var copia = Object.assign({}, i);
      copia.tags = (Array.isArray(i.tags) ? i.tags : []).concat(s.temas);
      return copia;
    });
  }

  /* ----------------------------------- a memória de onde parou (fase 6)
   *
   * Uma decisão de projeto (23/09): o "Continuar" da página da série leva ao
   * último episódio visto DELA, no ponto — e para isso o navegador passa a
   * guardar onde o vídeo parou. Até ali o player não guardava, e era regra
   * (`rememberPosition=false` do embed).
   *
   * O que continua regra: NADA RETOMA SOZINHO. Quem grava é o player; quem lê
   * é só a página da série, e o que ela faz com isso é um link que a pessoa
   * clica. A ficha aberta por outro caminho abre em 0 (ou no `?t=` do link),
   * como sempre — o player nem sabe ler esta chave.
   *
   * Um mapa `{ id: { t, d, q } }` — segundo, duração, quando —, com os 50
   * mais recentes. Não guarda o começo (menos de 10 s não é "parou no meio")
   * nem o fim (a partir dos últimos 30 s, ou 5% nos longos: quem viu os
   * créditos terminou); nos dois casos a entrada SAI, que é o "apaga ao chegar
   * perto do fim". */
  var CHAVE_ONDE_PAROU = PREFIXO + ':onde-parou';
  var ONDE_PAROU_MAXIMO = 50;
  var ONDE_PAROU_COMECO = 10;

  function pertoDoFim(t, d) {
    if (!(d > 0)) return false;
    return t >= d - Math.max(30, d * 0.05);
  }

  function ondeParouSaneado(mapa) {
    var saida = {};
    var m = mapaSimples(mapa);
    Object.keys(m).forEach(function (id) {
      var e = mapaSimples(m[id]);
      if (typeof e.t === 'number' && isFinite(e.t) && e.t >= 0 &&
          typeof e.q === 'number' && isFinite(e.q)) {
        saida[id] = { t: Math.floor(e.t), d: typeof e.d === 'number' && isFinite(e.d) && e.d > 0 ? Math.floor(e.d) : 0, q: e.q };
      }
    });
    return saida;
  }

  /* Devolve o mapa NOVO com a posição de `id` anotada — ou retirada, no começo
   * e no fim. Pura: quem lê e grava o `localStorage` é o player. */
  function lembrarOndeParou(mapa, id, t, duracao, quando) {
    var novo = ondeParouSaneado(mapa);
    if (!id) return novo;
    var seg = Math.floor(Number(t));
    var d = Math.floor(Number(duracao)) || 0;
    delete novo[id];
    if (isFinite(seg) && seg >= ONDE_PAROU_COMECO && !pertoDoFim(seg, d)) {
      novo[id] = { t: seg, d: d, q: Number(quando) || 0 };
    }
    var ids = Object.keys(novo).sort(function (a, b) { return novo[b].q - novo[a].q; });
    ids.slice(ONDE_PAROU_MAXIMO).forEach(function (velho) { delete novo[velho]; });
    return novo;
  }

  /* Onde ESTE título parou, ou null — o "Continuar" da ficha (decisão de
   * 24/09: a ficha aberta por outro caminho OFERECE continuar, sem mostrar o
   * tempo; não retoma sozinha). */
  function ondeParouDe(mapa, id) {
    var e = ondeParouSaneado(mapa)[id];
    if (!e || pertoDoFim(e.t, e.d)) return null;
    return { t: e.t, link: linkDaFicha(id, e.t) };
  }

  /* O "Continuar" de uma série: o título NO AR dela visto por último, no
   * segundo em que parou, ou null. */
  function continuarDaSerie(itens, nome, mapa) {
    var m = ondeParouSaneado(mapa);
    var melhor = null;
    publicaveis(itens).forEach(function (i) {
      if ((i.serie || semSerie()) !== nome) return;
      var e = m[i.id];
      if (!e || pertoDoFim(e.t, e.d)) return;
      if (!melhor || e.q > melhor.q) melhor = { item: i, t: e.t, q: e.q, link: linkDaFicha(i.id, e.t) };
    });
    return melhor;
  }

  /* A fileira "Continue de onde parou": os títulos NO AR que a pessoa parou no meio, o visto por último
   * primeiro. Só lê o mapa — quem grava é o player, e nada retoma sozinho: a fileira leva à ficha, no
   * segundo em que parou, e a pessoa clica. */
  function continuarAssistindo(itens, mapa, limite) {
    var m = ondeParouSaneado(mapa);
    var achados = [];
    publicaveis(itens).forEach(function (i) {
      var e = m[i.id];
      if (!e || pertoDoFim(e.t, e.d)) return;
      achados.push({ item: i, q: e.q });
    });
    achados.sort(function (a, b) { return b.q - a.q; });
    return achados.slice(0, limite || 12).map(function (x) { return x.item; });
  }

  /* A escrita da mesa. `mudanca` null APAGA a entrada — é o "Voltar ao
   * gerado". Os campos que ela não traz ficam como estavam, a origem também:
   * editar na mesa é revisar, e é a mesa quem manda `origem: 'revisada'`
   * junto, porque é ela quem sabe que uma pessoa leu. */
  function comSerie(site, nome, mudanca) {
    var novo = siteSaneado(site);
    if (!nome || !String(nome).trim()) return novo;
    var atual = novo.series[nome] || {};
    delete novo.series[nome];
    if (mudanca == null) return siteSaneado(novo);
    var junto = {};
    ['sobre', 'comeco', 'momentos', 'temas', 'origem'].forEach(function (k) {
      if (k in mudanca) junto[k] = mudanca[k];
      else if (k in atual) junto[k] = atual[k];
    });
    novo.series[nome] = junto;
    return siteSaneado(novo);
  }

  /* Estrutura vazia NÃO É DADO: um `site` com as quatro chaves vazias diz
   * exatamente o que a ausência dele já dizia — "ninguém escolheu nada". O PUT
   * apaga o campo nesse caso, senão a projeção do GET voltaria no PUT e
   * inventaria um campo (e uma linha no histórico) que ninguém pediu. */
  function siteVazio(site) {
    var s = siteSaneado(site);
    return !s.destaque && !Object.keys(s.prateleiras).length &&
      !Object.keys(s.classes).length && !Object.keys(s.textos).length &&
      !Object.keys(s.series).length && !('blocos' in s) && !('colecoes' in s) &&
      !('modeloDeConteudo' in s);
  }

  /* De que lado a série cai. O dado da mesa (`site.classes`) vence; sem ele, a coleção exclusiva que
   * lista a série (curta ou institucional); sem coleção nenhuma, pedagógica — o site não esconde
   * título por lista desatualizada, e quem avisa continua sendo o teste. As coleções são
   * `site.colecoes` (mesa ou config) ou, se ninguém escolheu, as duas de sempre (`Home.colecoesPadrao`). */
  function classeDaSerie(nome, site) {
    var s = siteSaneado(site);
    var escolhida = s.classes[nome];
    if (escolhida) return escolhida;
    return Home.classeDasColecoes(nome, Home.colecoesEfetivas(s));
  }

  /* Texto vazio é o PADRÃO, não o silêncio: um campo limpo sem querer não pode
   * apagar da tela o aviso que explica o que houve. */
  function textoDoSite(site, chave) {
    if (!(chave in TEXTOS_PADRAO)) return '';
    return siteSaneado(site).textos[chave] || TEXTOS_PADRAO[chave];
  }

  /* As escritas da mesa. Todas puras, todas devolvendo um `site` NOVO: o
   * rascunho guarda o valor inteiro do campo como "antes", e mexer no objeto
   * que a tela está mostrando apagaria o lado de lá da comparação. */
  function comPrateleira(site, id, mudanca) {
    var novo = siteSaneado(site);
    var atual = novo.prateleiras[id] || {};
    var limpa = {
      titulo: 'titulo' in mudanca ? textoAparado(mudanca.titulo) : atual.titulo,
      ordem: 'ordem' in mudanca ? mudanca.ordem : atual.ordem,
      escondida: 'escondida' in mudanca ? mudanca.escondida === true : atual.escondida === true
    };
    delete novo.prateleiras[id];
    var guardar = {};
    if (limpa.titulo) guardar.titulo = limpa.titulo;
    if (typeof limpa.ordem === 'number' && isFinite(limpa.ordem)) guardar.ordem = limpa.ordem;
    if (limpa.escondida) guardar.escondida = true;
    if (Object.keys(guardar).length) novo.prateleiras[id] = guardar;
    return siteSaneado(novo);
  }

  function comOrdemPrateleiras(site, ids) {
    var novo = site;
    (ids || []).forEach(function (id, i) { novo = comPrateleira(novo, id, { ordem: i }); });
    return siteSaneado(novo);
  }

  function comClasse(site, serie, classe) {
    var novo = siteSaneado(site);
    delete novo.classes[serie];
    if (CLASSES_SERIE.indexOf(classe) >= 0) novo.classes[serie] = classe;
    return siteSaneado(novo);
  }

  function comTexto(site, chave, valor) {
    var novo = siteSaneado(site);
    delete novo.textos[chave];
    if (chave in TEXTOS_PADRAO) {
      var texto = textoAparado(valor);
      if (texto) novo.textos[chave] = texto;
    }
    return siteSaneado(novo);
  }

  /* ----------------------------------------------------------- prateleiras */

  /* "Pedagógico" e "institucional" NÃO EXISTEM COMO DADO no acervo: os campos que serviriam — tema,
   * público-alvo, tags — costumam estar vazios, e preenchê-los é trabalho de catalogação. Por isso a
   * divisão é feita por COLEÇÕES LIVRES (`colecoes`, no config ou na mesa), cada uma com a lista das
   * séries dela e uma `classe`:
   *
   *   pedagogica   uma seleção; as séries continuam nas fileiras por série (o padrão de quem não está
   *                em coleção nenhuma);
   *   curta        séries de UM título, de poucos minutos cada. Juntas viram uma fileira; em "Mais séries"
   *                elas afogariam as outras;
   *   institucional  o que não é conteúdo de aprendizado (eventos, bastidores): sai das fileiras por
   *                série, de "Mais séries" e de "Até 5 minutos".
   *
   * Sem `colecoes`, valem as duas de sempre (`Home.colecoesPadrao`), com nomes de série de EXEMPLO:
   * cada instalação troca pela sua lista, ou reclassifica a série na mesa (`site.classes`). Em produção
   * uma série que não está em coleção nenhuma é tratada como pedagógica e aparece em "Mais séries" — o
   * site não esconde título por lista desatualizada. Quem avisa é o teste, não a tela. */

  /* Abaixo disto a série não vira linha própria: vai para "Mais séries".
   *
   * É a mesma decisão que tirou os blocos por série da grade, e o comentário
   * do `renderGrade` conta como ela foi tomada — os blocos "deixavam um cartão
   * sozinho por faixa e a tela inteira vazia à direita". Rolar de lado resolve
   * a SOBRA das séries grandes; não salva uma linha de uma capa só. Nove das
   * 23 séries têm um título, cinco têm dois. */
  var MINIMO_PRATELEIRA = 3;

  /* Cinco minutos: o tamanho de um vídeo para ver de relance. É o
   * único corte transversal que o catálogo já tem — duração é dado, tema não. */
  var SEGUNDOS_CURTO = 300;

  /* As duas perguntas passam pela `classeDaSerie`: o padrão são as coleções, e o `site.classes` do
   * catálogo é quem manda quando existe. */
  function ehInstitucional(item, site) {
    return classeDaSerie((item && item.serie) || '', site) === 'institucional';
  }

  function ehCurta(item, site) {
    return classeDaSerie((item && item.serie) || '', site) === 'curta';
  }

  /* As primitivas que o home-blocos.js usa — e só elas. Ele não importa este arquivo. */
  function primitivasDaHome() {
    return {
      publicaveis: publicaveis,
      ordenar: ordenar,
      normalizar: normalizar,
      semSerie: semSerie,
      tr: tr,
      idiomaAtual: idiomaAtual,
      idiomaPadrao: function () { return (I18n && I18n.instancia && I18n.instancia().padrao) || 'pt-BR'; },
      escolhasDaMesa: comEscolhasDaMesa,
      continuarAssistindo: continuarAssistindo,
      MINIMO_PRATELEIRA: MINIMO_PRATELEIRA
    };
  }

  /* A chegada resolvida: os blocos, a sequência do que se desenha (destaque, fileiras, textos, busca) e
   * as fileiras. `contexto`: { logado, ondeParou, minhaLista, ignorarVisibilidade }. */
  function home(itens, site, contexto) {
    return Home.resolver(itens, siteSaneado(site), contexto || {}, primitivasDaHome());
  }

  /* A chegada, em linhas que rolam de lado. Pura: devolve a lista pronta e quem desenha é o app.js.
   *
   * Cada prateleira é { id, titulo, itens }. O `id` é o que o "Ver tudo" usa para achar a mesma
   * prateleira de novo e virar grade — uma fonte só da verdade, sem repetir a regra do lado do desenho.
   *
   * QUEM DECIDE A LISTA são os blocos (home-blocos.js): `site.blocos`, o `home.blocos` do config ou, sem
   * nenhum dos dois, o padrão — "Até 5 minutos", as séries grandes da maior para a menor (empate pelo nome,
   * para a ordem não depender da ordem em que o catálogo veio), "Mais séries" e as coleções curtas e
   * institucional. Com a config padrão o resultado é idêntico ao de antes dos blocos (tests/home-blocos.test.js).
   *
   * TODO TÍTULO APARECE PELO MENOS UMA VEZ, e só a fileira transversal (duração, novidades...) repete: é a
   * garantia do bloco `prateleira-restante` — e o primeiro teste desta função. */
  function prateleiras(itens, site, contexto) {
    return home(itens, site, contexto).prateleiras;
  }

  /* O modelo de conteúdo: 'seriado' (séries com temporada e episódio; o padrão) ou 'avulso' (filmes, aulas
   * soltas: sem "T1 E3", sem página de série). Vem de `site.modeloDeConteudo` — a mesa, ou o `catalogo.
   * modeloDeConteudo` do config, que o servidor põe por baixo. */
  function modeloDeConteudo(site) {
    return Home.modeloDe(siteSaneado(site));
  }

  /* O nome, a ordem e o "escondida" escolhidos na mesa, por cima da lista que o
   * código acabou de montar (M4).
   *
   * A ordem: quem tem `ordem` escolhida vai na frente, na ordem dela; quem não
   * tem fica atrás, na ordem do código. Uma série nova que cruze os três
   * títulos vira prateleira meses depois de alguém ter arrumado a chegada — e
   * entra no FIM, que é previsível, em vez de brotar no meio.
   *
   * A escondida CONTINUA NA LISTA, com a marca. Quem some com ela da tela é o
   * site (`prateleirasVisiveis`); aqui ela fica, porque o "Ver tudo", o painel
   * da mesa e o teste de que todo título aparece em algum lugar leem daqui. */
  function comEscolhasDaMesa(lista, site) {
    var cfg = siteSaneado(site);
    var comIndice = lista.map(function (p, i) {
      var escolha = cfg.prateleiras[p.id] || {};
      if (escolha.titulo) p.titulo = escolha.titulo;
      if (escolha.escondida) p.escondida = true;
      return { p: p, i: i, ordem: typeof escolha.ordem === 'number' ? escolha.ordem : null };
    });
    comIndice.sort(function (a, b) {
      if (a.ordem === null && b.ordem === null) return a.i - b.i;
      if (a.ordem === null) return 1;
      if (b.ordem === null) return -1;
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.i - b.i;
    });
    return comIndice.map(function (x) { return x.p; });
  }

  /* O que a chegada desenha. */
  function prateleirasVisiveis(itens, site, contexto) {
    return prateleiras(itens, site, contexto).filter(function (p) { return !p.escondida; });
  }

  /* Quem some da CHEGADA se as prateleiras escondidas ficarem como estão — o
   * aviso que a mesa mostra antes de alguém esconder uma linha. Não é perda de
   * título: eles continuam na busca, na página da série e no link direto. */
  function titulosSoEmEscondidas(itens, site, contexto) {
    var todas = prateleiras(itens, site, contexto);
    var visiveis = Object.create(null);
    todas.forEach(function (p) {
      if (p.escondida) return;
      p.itens.forEach(function (i) { visiveis[i.id] = true; });
    });
    var perdidos = [];
    var vistos = Object.create(null);
    todas.forEach(function (p) {
      if (!p.escondida) return;
      p.itens.forEach(function (i) {
        if (visiveis[i.id] || vistos[i.id]) return;
        vistos[i.id] = true;
        perdidos.push(i);
      });
    });
    return perdidos;
  }

  /* O título do DESTAQUE da chegada. Um só, e nunca nenhum quando há catálogo.
   *
   * Quem escolhe é a mesa, e desde a M4 ela grava o ID em `site.destaque`. A
   * marca `destaque` no próprio título é o LEGADO — o que o /admin de 14/09
   * gravou e o que está no KV até a primeira publicação da mesa, que apaga as
   * marcas ao escrever o id. Ela continua valendo até lá, e por isso a ordem
   * de consulta abaixo é id, marca, padrão.
   *
   * As defesas contra o dado torto ficam, porque a tela não é a única coisa
   * que escreve no KV:
   *
   *   - escolhido mas NÃO PUBLICADO não vale — o destaque é a primeira coisa
   *     que a chegada mostra, e mostrar um título despublicado é vazá-lo. Vale
   *     para o id do `site` e para a marca antiga;
   *   - DOIS marcados não quebram nada: fica o primeiro pela ordem de
   *     `ordenar()`, que é estável. Sem isso o destaque dependeria da ordem em
   *     que os itens estão no KV, e mudaria sozinho na próxima gravação.
   *
   * Sem escolha nenhuma, o padrão é o primeiro título da MAIOR SÉRIE
   * PEDAGÓGICA — e ele sai da própria `prateleiras()`, cuja primeira linha de
   * série já é a maior. Repetir aqui o critério de "maior série" criaria duas
   * regras que envelheceriam separadas. Prateleira escondida não entra nessa
   * conta: destacar a primeira capa de uma linha que ninguém vê é estranho. */
  function destaque(itens, site) {
    var pub = publicaveis(itens);
    if (!pub.length) return null;

    var escolhido = siteSaneado(site).destaque;
    if (escolhido) {
      var doSite = porId(pub, escolhido);
      if (doSite) return doSite;
    }

    var marcados = pub.filter(function (i) { return i.destaque === true; });
    if (marcados.length) return ordenar(marcados)[0];

    var deSerie = prateleirasVisiveis(itens, site).find(function (p) {
      return p.id.indexOf('serie:') === 0;
    });
    if (deSerie && deSerie.itens.length) return deSerie.itens[0];

    /* Catálogo sem nenhuma série grande o bastante para virar linha: o
     * primeiro da ordem, que é melhor do que nenhum destaque. */
    return ordenar(pub)[0];
  }

  /* A prateleira de um `id`, para o "Ver tudo" e para a rota que ele abre.
   * Deriva da mesma `prateleiras()`: a regra não é escrita duas vezes. Acha
   * também a escondida — o link dela continua funcionando, que é a diferença
   * entre esconder da chegada e tirar do ar. */
  function prateleiraPorId(itens, id, site, contexto) {
    return prateleiras(itens, site, contexto).find(function (p) { return p.id === id; }) || null;
  }

  /* Os dois lados de uma série, pelas MESMAS listas das prateleiras: o que é
   * para as séries em geral (pedagógicas e curtas) e o que é institucional.
   * A página Séries agrupa por eles, e a página de uma série diz de que lado
   * ela está — um nome só para as duas telas. */
  function gruposDeSerie() {
    return [
      { id: 'series', titulo: tr('catalogo.series') },
      { id: 'institucional', titulo: tr('catalogo.institucional') }
    ];
  }

  function grupoDaSerie(nome, site) {
    return gruposDeSerie()[classeDaSerie(nome, site) === 'institucional' ? 1 : 0];
  }

  /* Abaixo disto a série não tem página própria — uma decisão de
   * projeto. O número é o da prateleira, e pelo mesmo motivo: uma página
   * com uma ou duas linhas é um clique a mais para chegar à ficha, que já
   * mostra a série inteira embaixo do vídeo. Mas são DUAS decisões, e cada uma
   * tem a sua constante: mexer no tamanho da prateleira não pode tirar a
   * página de série nenhuma sem ninguém perceber. */
  var MINIMO_PAGINA_SERIE = 3;

  /* A PÁGINA SÉRIES (D5) — para onde os chips da chegada foram (decisão D8).
   *
   * Dois grupos, os de `grupoDaSerie`. Uma série que não está em lista
   * nenhuma cai do lado das séries, pela mesma razão da chegada: o site não
   * esconde título por causa de uma lista desatualizada — quem avisa é o teste
   * "toda série está em exatamente uma das três listas".
   *
   * Cada série é { nome, itens, segundos, temPagina }. Os itens vêm na ordem
   * de `ordenar()`, e o primeiro deles é a capa do cartão — a mesma que a
   * página da série usa no alto. `temPagina` diz para onde o cartão leva: a
   * página da série, ou direto a ficha do primeiro título (D7). Dentro do
   * grupo a ordem é a de `series()`: alfabética, com a triagem ("A
   * classificar") no fim. */
  function gruposDeSeries(itens, site) {
    var porNome = Object.create(null);
    var nomes = [];
    ordenar(publicaveis(itens)).forEach(function (i) {
      var nome = i.serie || semSerie();
      if (!(nome in porNome)) {
        porNome[nome] = { nome: nome, itens: [], segundos: 0, temPagina: false };
        nomes.push(nome);
      }
      porNome[nome].itens.push(i);
      if (typeof i.duracao_seg === 'number' && i.duracao_seg > 0) porNome[nome].segundos += i.duracao_seg;
    });

    var porGrupo = gruposDeSerie().map(function (g) { return { id: g.id, titulo: g.titulo, series: [] }; });
    nomes.forEach(function (nome) {
      var s = porNome[nome];
      s.temPagina = s.itens.length >= MINIMO_PAGINA_SERIE;
      porGrupo[grupoDaSerie(nome, site).id === 'institucional' ? 1 : 0].series.push(s);
    });
    return porGrupo.filter(function (g) { return g.series.length; });
  }

  /* A PÁGINA DE UMA SÉRIE (D6) — `#/serie/<nome>`, a rota que a D5 abriu como
   * a grade da série e que agora é a página dela. A mesma
   * lista serve à "Episódios da série", embaixo do vídeo na ficha.
   *
   * Devolve { nome, grupo, itens, segundos, anos, temporadas, temPagina }, ou
   * null quando a série não tem título publicado — aí a tela diz que ela não
   * existe mais. Título fora do ar não entra na lista nem na conta.
   *
   * A ORDEM É A DE `ordenar()`, e é ela que o Shift+N / Shift+P percorre:
   * `vizinhos()` nasce DAQUI, e não de uma segunda leitura da série. Se as
   * duas discordassem, o Shift+N levaria a um episódio que a lista mostra em
   * outro lugar.
   *
   * `temporadas` é a lista cortada onde a temporada muda — a ordem já as deixa
   * juntas. Quem desenha só põe título de temporada quando há mais de uma: é o
   * *Série B*, com as cinco partes da T1 e o episódio da T2. Uma série de
   * temporada única, ou sem temporada nenhuma, é uma lista só.
   *
   * `temPagina` é a D7: a rota vale para QUALQUER série — link guardado não
   * quebra —, mas só a de 3 ou mais títulos é oferecida como página. */
  function paginaDaSerie(itens, nome, site) {
    if (!nome) return null;
    var lista = ordenar(filtrarPorSerie(publicaveis(itens), nome));
    if (!lista.length) return null;

    var segundos = 0;
    var anos = [];
    var temporadas = [];
    lista.forEach(function (i) {
      if (typeof i.duracao_seg === 'number' && i.duracao_seg > 0) segundos += i.duracao_seg;
      /* O ano vem do KV como número, e já veio como texto: "2024" conta, e o
       * campo vazio não vira o ano zero. */
      var ano = i.ano == null || i.ano === '' ? NaN : Number(i.ano);
      if (isFinite(ano)) anos.push(ano);
      var t = i.temporada == null ? null : i.temporada;
      var ultima = temporadas[temporadas.length - 1];
      if (!ultima || ultima.temporada !== t) temporadas.push({ temporada: t, itens: [] });
      temporadas[temporadas.length - 1].itens.push(i);
    });

    return {
      nome: nome,
      grupo: grupoDaSerie(nome, site),
      itens: lista,
      segundos: segundos,
      anos: anos.length ? { de: Math.min.apply(null, anos), ate: Math.max.apply(null, anos) } : null,
      temporadas: temporadas,
      temPagina: lista.length >= MINIMO_PAGINA_SERIE
    };
  }

  /* "Temporada 2". O grupo sem número existe quando uma série mistura título
   * com temporada e sem: ele vem por último, pela ordem de `ordenar()`, e o
   * nome diz o que ele é em vez de inventar um número. */
  function rotuloTemporada(temporada) {
    return temporada == null ? tr('catalogo.semTemporada') : tr('catalogo.temporada', { n: temporada });
  }

  /* "2023 a 2025", ou "2024" quando é um ano só. */
  function formatarAnos(anos) {
    if (!anos) return '';
    return anos.de === anos.ate ? String(anos.de) : tr('catalogo.anos', { de: anos.de, ate: anos.ate });
  }

  function series(itens) {
    var vistas = Object.create(null);
    var nomes = [];
    ordenar(itens).forEach(function (i) {
      var nome = i.serie || semSerie();
      if (!vistas[nome]) { vistas[nome] = true; nomes.push(nome); }
    });
    return nomes;
  }

  /* Os chips do FILTRO POR SÉRIE, que saíram do cabeçalho na D5 e moram na
   * grade da resposta — busca e "Ver tudo".
   *
   * Recebe a resposta ANTES do filtro de série e oferece só as séries que
   * estão nela: os 23 chips de antes, sobre uma busca de 3 resultados, eram 21
   * caminhos para "Nada encontrado". Uma série só não pede filtro — não há o
   * que escolher —, e aí a lista volta vazia e a linha nem é desenhada.
   *
   * A série LIGADA fica sempre, mesmo quando a resposta não a tem mais: é o
   * botão que desfaz o filtro. */
  function seriesDoFiltro(itens, ativa) {
    var nomes = series(itens);
    if (ativa && nomes.indexOf(ativa) < 0) nomes.push(ativa);
    return nomes.length >= 2 || ativa ? nomes : [];
  }

  function textoBusca(item) {
    return normalizar([
      item.titulo, item.serie, item.sinopse, item.tema, item.publico_alvo,
      item.ano, rotuloEpisodio(item), (item.tags || []).join(' ')
    ].join(' '));
  }

  /* Busca por todos os termos (AND), acento-insensível. */
  function buscar(itens, termo) {
    var alvo = normalizar(termo);
    if (!alvo) return (itens || []).slice();
    var termos = alvo.split(/\s+/);
    return (itens || []).filter(function (item) {
      var texto = textoBusca(item);
      return termos.every(function (t) { return texto.indexOf(t) >= 0; });
    });
  }

  function filtrarPorSerie(itens, serie) {
    if (!serie) return (itens || []).slice();
    return (itens || []).filter(function (i) { return (i.serie || semSerie()) === serie; });
  }

  function porId(itens, id) {
    return (itens || []).find(function (i) { return i.id === id; }) || null;
  }

  /* Vizinhos dentro da mesma série, para a navegação EXPLÍCITA — o Shift+N e o
   * Shift+P do player. Nunca use isto para avançar sozinho ao fim do vídeo — é
   * proibido pelo produto.
   *
   * Os irmãos são a lista de `paginaDaSerie()`, a mesma que a ficha desenha
   * embaixo do vídeo (D6): a tecla anda pela ordem que a tela mostra. E o
   * título sem série fica entre os sem série — antes daqui, o nome vazio
   * chegava ao `filtrarPorSerie`, que o lê como "sem filtro", e os vizinhos
   * dele eram o catálogo inteiro. */
  function vizinhos(itens, id) {
    var atual = porId(itens, id);
    if (!atual) return { anterior: null, proximo: null };
    var pagina = paginaDaSerie(itens, atual.serie || semSerie());
    var irmaos = pagina ? pagina.itens : [];
    var pos = irmaos.findIndex(function (i) { return i.id === id; });
    if (pos < 0) return { anterior: null, proximo: null };
    return {
      anterior: pos > 0 ? irmaos[pos - 1] : null,
      proximo: pos < irmaos.length - 1 ? irmaos[pos + 1] : null
    };
  }

  /* ---------------------------------------------------------------- admin */

  function slug(texto) {
    var s = normalizar(texto)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/, '');
    return s || 'sem-titulo';
  }

  function idUnico(itens, titulo) {
    var base = slug(titulo);
    var usados = Object.create(null);
    (itens || []).forEach(function (i) { usados[i.id] = true; });
    if (!usados[base]) return base;
    for (var n = 2; n < 1000; n++) {
      if (!usados[base + '-' + n]) return base + '-' + n;
    }
    return base + '-' + Date.now();
  }

  function precisaRevisao(item) {
    return !!item && item.sinopse_origem === 'auto';
  }

  /* -------------------------------------------------------- filas de trabalho
   *
   * M3: três filas que a mesa oferece para andar item por item, sempre na
   * mesma ordem de `ordenar` — senão "3 de 56" mudaria de sentido a cada
   * redesenho. Puras: não sabem de tela, só filtram e ordenam. */

  function filaSinopses(itens) {
    return ordenar((itens || []).filter(precisaRevisao));
  }

  function filaSemSinopse(itens) {
    return ordenar((itens || []).filter(function (i) { return !!i && i.publicar === true && !i.sinopse; }));
  }

  function filaPendencias(itens) {
    return ordenar((itens || []).filter(function (i) { return !!i && !!i.pendencia; }));
  }

  /* "curta-exemplo-2024-v1" e "curta-exemplo-2024-master" têm a mesma base —
   * é a convenção de nome que separa duas versões do mesmo material . Não é um vínculo gravado no dado, é o único sinal que
   * existe hoje para achar a "outra versão" de uma pendência `versao_duplicada`. */
  function baseIdSemVersao(id) {
    return String(id || '').replace(/-(v\d+|master)$/i, '');
  }

  function outraVersaoDuplicada(itens, item) {
    if (!item) return null;
    var base = baseIdSemVersao(item.id);
    return (itens || []).find(function (i) { return i && i.id !== item.id && baseIdSemVersao(i.id) === base; }) || null;
  }

  /* -------------------------------------------------------- rascunho da mesa
   *
   * O rascunho é uma lista de mudanças campo a campo — { alvo, campo, antes,
   * depois } —, e o alvo é o id de um título ou 'ajustes'. Tudo aqui é puro:
   * quem guarda a lista (no navegador) e quem grava (o Publicar) são da mesa.
   */

  /* O que a mesa edita. `id`, `fonte` e `rev` ficam de fora: um `fonte` trocado
   * aponta a ficha para outro vídeo, e o `rev` é a trava de concorrência. */
  var CAMPOS_ITEM_MESA = ['titulo', 'serie', 'temporada', 'episodio', 'ano', 'sinopse',
    'sinopse_origem', 'tema', 'publico_alvo', 'tags', 'pendencia', 'publicar',
    'titularidade', 'nivel_evidencia', 'capa_arquivo', 'capa_versao', 'nota_curadoria',
    'destaque'];
  var CAMPOS_AJUSTES_MESA = ['arrastoTeto', 'controlesEspera'];

  /* O alvo `site` da M4. Os quatro campos são os objetos INTEIROS — e não "a
   * prateleira X" ou "o texto Y" — porque é assim que o Publicar confere contra
   * a leitura fresca do servidor: duas pessoas arrumando a chegada ao mesmo
   * tempo têm de brigar, e não gravar uma por cima da outra em silêncio. O
   * preço é um conflito a mais quando as duas mexem em prateleiras diferentes,
   * e ele é barato: a mesa mostra os dois valores e deixa escolher. */
  var CAMPOS_SITE_MESA = ['destaque', 'prateleiras', 'classes', 'textos', 'series', 'blocos', 'colecoes', 'modeloDeConteudo'];

  function campoDaMesa(alvo, campo) {
    if (alvo === 'ajustes') return CAMPOS_AJUSTES_MESA.indexOf(campo) >= 0;
    if (alvo === 'site') return CAMPOS_SITE_MESA.indexOf(campo) >= 0;
    return CAMPOS_ITEM_MESA.indexOf(campo) >= 0;
  }

  /* Igual por valor: `tags` é lista, e ausente vale o mesmo que nulo. */
  function mesmoValor(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  /* Mudar o mesmo campo de novo guarda o `antes` da PRIMEIRA vez — é contra ele
   * que o Publicar confere se outra tela mexeu. Voltar ao original tira a
   * mudança da lista. Devolve uma lista nova. */
  function registrarMudanca(lista, m) {
    var saida = [];
    var achou = false;
    (lista || []).forEach(function (x) {
      if (x.alvo !== m.alvo || x.campo !== m.campo) { saida.push(x); return; }
      achou = true;
      if (!mesmoValor(x.antes, m.depois)) {
        saida.push({ alvo: x.alvo, campo: x.campo, antes: x.antes, depois: m.depois });
      }
    });
    if (!achou && !mesmoValor(m.antes, m.depois)) {
      saida.push({ alvo: m.alvo, campo: m.campo, antes: m.antes, depois: m.depois });
    }
    return saida;
  }

  function valorNoCatalogo(catalogo, alvo, campo) {
    if (alvo === 'ajustes') {
      return { existe: true, valor: catalogo && catalogo.ajustes ? catalogo.ajustes[campo] : undefined };
    }
    /* O `site` pode não existir no documento, e isso não é "campo sumido": é o
     * catálogo que nunca teve estrutura escolhida. O `undefined` é o valor de
     * antes, e é contra ele que o Publicar confere. */
    if (alvo === 'site') {
      return { existe: true, valor: catalogo && catalogo.site ? catalogo.site[campo] : undefined };
    }
    var item = porId(catalogo && catalogo.itens, alvo);
    return item ? { existe: true, valor: item[campo] } : { existe: false };
  }

  /* O catálogo com o rascunho por cima, numa cópia: a mesa guarda o original
   * para mostrar o "antes" e o site no ar. Campo fora da lista é ignorado. */
  function aplicarRascunho(catalogo, lista) {
    var copia = JSON.parse(JSON.stringify(catalogo || {}));
    var destacado = null;
    (lista || []).forEach(function (m) {
      if (!campoDaMesa(m.alvo, m.campo)) return;
      if (m.alvo === 'ajustes') {
        copia.ajustes = copia.ajustes || {};
        copia.ajustes[m.campo] = m.depois;
        return;
      }
      if (m.alvo === 'site') {
        copia.site = copia.site || {};
        copia.site[m.campo] = m.depois;
        return;
      }
      var item = porId(copia.itens, m.alvo);
      if (!item) return;
      /* Desmarcar é APAGAR o campo, como o /admin fazia: `false`, `null` e a
       * ausência são a mesma coisa para quem lê (`paraPublico`). */
      if (m.campo === 'destaque') {
        if (m.depois === true) { item.destaque = true; destacado = item; } else delete item.destaque;
        return;
      }
      item[m.campo] = m.depois;
    });

    /* O DESTAQUE É UM (D4), e a regra é aplicada AQUI, sobre a leitura fresca
     * do Publicar — não confiada ao rascunho. Se outra tela marcou um terceiro
     * título enquanto este rascunho esperava, a conferência campo a campo não
     * veria: são campos diferentes. Então quem o rascunho destaca apaga a marca
     * de todos os outros, na mesma gravação. E título fora do ar não fica com
     * a marca, mesmo que o rascunho mande. */
    if (destacado && destacado.publicar !== true) {
      /* Fora do ar não recebe a marca — e a de hoje fica onde está: a chegada
       * não perde o destaque por causa de um pedido que não vale. */
      delete destacado.destaque;
    } else if (destacado) {
      (copia.itens || []).forEach(function (i) { if (i !== destacado && i.destaque === true) delete i.destaque; });
    }
    return copia;
  }

  /* Conflito é o MESMO campo mudado por outra tela desde o começo do rascunho.
   * Se o servidor já tem o `depois`, alguém fez a mesma mudança: não é
   * conflito. Título que sumiu do catálogo é conflito — gravar nele seria
   * gravar no vazio. */
  function conflitosRascunho(catalogo, lista) {
    var saida = [];
    (lista || []).forEach(function (m) {
      var atual = valorNoCatalogo(catalogo, m.alvo, m.campo);
      if (!atual.existe) { saida.push({ alvo: m.alvo, campo: m.campo, sumiu: true }); return; }
      if (mesmoValor(atual.valor, m.antes) || mesmoValor(atual.valor, m.depois)) return;
      saida.push({ alvo: m.alvo, campo: m.campo, antes: m.antes, depois: m.depois, noServidor: atual.valor });
    });
    return saida;
  }


  /* ----------------------------------------------------------- histórico (M5)
   *
   * Cada publicação deixa dois rastros no KV, ao lado do catálogo:
   *
   *   - `historico:<chave>` — o que mudou, campo a campo, com o resumo nos
   *     METADADOS da chave. A linha do tempo sai de UMA listagem, sem abrir
   *     registro nenhum;
   *   - `versao:<rev>` — a cópia inteira, para ver como estava e restaurar. As
   *     30 últimas; a mais velha sai a cada publicação.
   *
   * A CHAVE DO HISTÓRICO É INVERTIDA, e isso não é firula. A listagem do KV é
   * sempre ASCENDENTE e não tem "ordem inversa": com a rev crua na chave, mostrar
   * as 20 publicações mais novas exigiria percorrer TODAS as páginas até o fim —
   * e o histórico cresce para sempre. Guardando `LIMITE_REV - rev`, a primeira
   * página da listagem já é o topo da linha do tempo, com uma operação só. */
  var LIMITE_REV = 1000000000;

  function chaveHistorico(rev) {
    var n = Math.max(0, Math.min(LIMITE_REV, Math.floor(Number(rev) || 0)));
    return 'historico:' + String(LIMITE_REV - n).padStart(10, '0');
  }

  function revDaChaveHistorico(chave) {
    var m = /^historico:(\d{10})$/.exec(String(chave || ''));
    return m ? LIMITE_REV - Number(m[1]) : null;
  }

  /* A cópia usa a rev CRUA, com zeros à esquerda: a listagem ascendente devolve
   * a mais velha primeiro, que é justamente a que sai quando passam de 30. */
  function chaveVersao(rev) {
    var n = Math.max(0, Math.floor(Number(rev) || 0));
    return 'versao:' + String(n).padStart(10, '0');
  }

  function revDaChaveVersao(chave) {
    var m = /^versao:(\d{10})$/.exec(String(chave || ''));
    return m ? Number(m[1]) : null;
  }

  /* De que tipo foram as mudanças de uma publicação. Vai nos metadados da
   * chave — que têm 1 KB e não aguentam a lista inteira —, e é o que a linha do
   * tempo mostra sem abrir o registro. */
  function contarMudancasPorAlvo(difs) {
    var conta = { total: 0, titulos: 0, campos: 0, estrutura: 0, ajustes: 0, novos: 0, removidos: 0 };
    var vistos = Object.create(null);
    (difs || []).forEach(function (d) {
      if (!d) return;
      conta.total++;
      if (d.alvo === 'site' || d.alvo === 'catalogo') { conta.estrutura++; return; }
      if (d.alvo === 'ajustes') { conta.ajustes++; return; }
      if (d.tipo === 'novo') { conta.novos++; }
      else if (d.tipo === 'removido') { conta.removidos++; }
      else { conta.campos++; }
      if (!vistos[d.alvo]) { vistos[d.alvo] = true; conta.titulos++; }
    });
    return conta;
  }

  /* A frase da linha do tempo. Some com o que é zero: "3 títulos · estrutura"
   * diz mais do que "3 títulos, 0 ajustes, 0 novos, 0 removidos". */
  function resumoDeMudancas(conta) {
    if (!conta || !conta.total) return tr('catalogo.nadaMudou');
    var partes = [];
    if (conta.titulos) partes.push(tr('catalogo.resumoTitulos', { n: conta.titulos }));
    if (conta.novos) partes.push(tr('catalogo.resumoNovos', { n: conta.novos }));
    if (conta.removidos) partes.push(tr('catalogo.resumoRemovidos', { n: conta.removidos }));
    if (conta.estrutura) partes.push(tr('catalogo.resumoEstrutura'));
    if (conta.ajustes) partes.push(tr('catalogo.resumoPlayer'));
    return partes.join(' · ') || tr('catalogo.resumoAlteracoes', { n: conta.total });
  }

  /* DESFAZER É UM RASCUNHO NOVO: a mesa monta a mudança contrária e ela
   * passa pelo mesmo Publicar, pela mesma conferência de conflito e pela mesma
   * permissão. Não existe um caminho de gravação "do histórico".
   *
   * O que NÃO dá para desfazer assim é título criado ou removido: o rascunho
   * mexe em campo, não em existência. A função diz não em vez de fingir. */
  function desfazerMudanca(dif) {
    if (!dif || !dif.campo || dif.campo === '*') return null;
    if (!campoDaMesa(dif.alvo === 'site' || dif.alvo === 'ajustes' ? dif.alvo : 'item', dif.campo)) return null;
    return { alvo: dif.alvo, campo: dif.campo, valor: dif.antes === undefined ? null : dif.antes };
  }

  /* ------------------------------------------------------ contas e permissões
   *
   * O superadmin é a senha do ambiente e pode tudo. As outras contas moram no
   * KV, e o superadmin escolhe para cada uma quais destas permissões valem —
   * uma, várias ou todas.
   *
   * A conferência de verdade é no SERVIDOR, campo a campo: o PUT compara o
   * catálogo velho com o novo e recusa o que a conta não pode mudar. Esconder
   * botão na tela é conveniência; segurança é isto aqui. */
  var PERMISSOES = ['conteudo', 'no-ar', 'enviar', 'estrutura', 'player', 'historico'];

  var ROTULO_PERMISSAO = tabelaT('permissao.', PERMISSOES);

  var AJUDA_PERMISSAO = tabelaT('permissaoAjuda.', PERMISSOES);

  /* Os campos de um título que a permissão `conteudo` cobre. `publicar`,
   * `destaque` e os ajustes têm permissão própria; o resto — `fonte`, `id`,
   * `capitulos`, `framerate`, `duracao` — é só do superadmin, porque não sai
   * da mesa: sai de script. */
  var CAMPOS_CONTEUDO = ['titulo', 'serie', 'temporada', 'episodio', 'ano', 'sinopse',
    'sinopse_origem', 'tema', 'publico_alvo', 'tags', 'pendencia', 'titularidade',
    'nivel_evidencia', 'capa_arquivo', 'capa_versao', 'nota_curadoria'];

  function permissaoDoCampo(alvo, campo) {
    if (alvo === 'ajustes') return CAMPOS_AJUSTES_MESA.indexOf(campo) >= 0 ? 'player' : null;
    /* O "Sobre" das séries é texto sobre os vídeos, como a sinopse — é de
     * quem cuida do conteúdo, não de quem arruma a chegada. */
    if (alvo === 'site' && campo === 'series') return 'conteudo';
    if (alvo === 'site') return CAMPOS_SITE_MESA.indexOf(campo) >= 0 ? 'estrutura' : null;
    if (campo === 'publicar') return 'no-ar';
    if (campo === 'destaque') return 'estrutura';
    return CAMPOS_CONTEUDO.indexOf(campo) >= 0 ? 'conteudo' : null;
  }

  /* Campos de topo que toda gravação reescreve, e que não são mudança de
   * ninguém: o servidor os recalcula no PUT. */
  var TOPO_IGNORADO = ['rev', 'total', 'atualizado_em', 'versao', 'config', 'itens', 'ajustes', 'site'];

  /* O que mudou entre dois catálogos, campo a campo, com a permissão que cada
   * diferença exige. É o que o PUT usa para recusar, e é a mesma lista que o
   * histórico da M5 vai guardar. */
  function diferencasDoCatalogo(antes, depois) {
    var saida = [];
    var velhos = Object.create(null);
    ((antes && antes.itens) || []).forEach(function (i) { if (i && i.id) velhos[i.id] = i; });
    var vistos = Object.create(null);

    ((depois && depois.itens) || []).forEach(function (novo) {
      if (!novo || !novo.id) return;
      vistos[novo.id] = true;
      var velho = velhos[novo.id];
      if (!velho) {
        saida.push({ alvo: novo.id, campo: '*', tipo: 'novo', permissao: 'enviar' });
        if (novo.publicar === true) saida.push({ alvo: novo.id, campo: 'publicar', antes: null, depois: true, permissao: 'no-ar' });
        if (novo.destaque === true) saida.push({ alvo: novo.id, campo: 'destaque', antes: null, depois: true, permissao: 'estrutura' });
        return;
      }
      var campos = Object.create(null);
      Object.keys(velho).forEach(function (k) { campos[k] = true; });
      Object.keys(novo).forEach(function (k) { campos[k] = true; });
      Object.keys(campos).forEach(function (campo) {
        if (campo === 'id' || campo === 'midia') return;   /* `midia` é do servidor, nunca é mudança de ninguém */
        /* O formato antigo e o novo de `fonte` são o mesmo dado: não é mudança. */
        if (campo === 'fonte' ? mesmoValor(migrarFonte(velho.fonte), migrarFonte(novo.fonte)) : mesmoValor(velho[campo], novo[campo])) return;
        saida.push({ alvo: novo.id, campo: campo, antes: velho[campo], depois: novo[campo], permissao: permissaoDoCampo(novo.id, campo) });
      });
    });

    Object.keys(velhos).forEach(function (id) {
      if (!vistos[id]) saida.push({ alvo: id, campo: '*', tipo: 'removido', permissao: null });
    });

    var ajA = (antes && antes.ajustes) || {};
    var ajD = (depois && depois.ajustes) || {};
    var chavesAjuste = Object.create(null);
    Object.keys(ajA).concat(Object.keys(ajD)).forEach(function (k) { chavesAjuste[k] = true; });
    Object.keys(chavesAjuste).forEach(function (campo) {
      if (mesmoValor(ajA[campo], ajD[campo])) return;
      saida.push({ alvo: 'ajustes', campo: campo, antes: ajA[campo], depois: ajD[campo], permissao: permissaoDoCampo('ajustes', campo) });
    });

    /* A ESTRUTURA sai campo a campo, e não como "o campo `site` mudou" (M5): é
     * o que faz o histórico dizer QUAL parte da chegada mexeu, e é o que
     * permite desfazer uma delas sem desfazer as outras. Os nomes são os
     * mesmos do rascunho — `site` como alvo, os quatro campos —, então a
     * mudança contrária cabe no rascunho sem tradução nenhuma. */
    /* Os dois lados SANEADOS: o PUT guarda a forma conferida (com `series: {}`, `classes: {}`...), e comparar esse
     * valor com o `site` ausente de um catálogo que nunca teve estrutura contaria cinco "mudanças" que ninguém
     * fez — e a primeira publicação de quem só tem a permissão `estrutura` seria recusada por causa de `series`,
     * que é de `conteudo` (achado ao testar os blocos da M6). Ausente e vazio são a mesma coisa para quem lê. */
    var siteA = siteSaneado(antes && antes.site);
    var siteD = siteSaneado(depois && depois.site);
    var camposSite = Object.create(null);
    Object.keys(siteA).concat(Object.keys(siteD)).forEach(function (k) { camposSite[k] = true; });
    Object.keys(camposSite).forEach(function (campo) {
      if (mesmoValor(siteA[campo], siteD[campo])) return;
      saida.push({ alvo: 'site', campo: campo, antes: siteA[campo], depois: siteD[campo], permissao: permissaoDoCampo('site', campo) });
    });

    var topo = Object.create(null);
    Object.keys(antes || {}).concat(Object.keys(depois || {})).forEach(function (k) { topo[k] = true; });
    Object.keys(topo).forEach(function (campo) {
      if (TOPO_IGNORADO.indexOf(campo) >= 0) return;
      if (mesmoValor((antes || {})[campo], (depois || {})[campo])) return;
      saida.push({ alvo: 'catalogo', campo: campo, permissao: null });
    });

    return saida;
  }

  function contaPode(conta, permissao) {
    if (!conta) return false;
    if (conta.super === true) return true;
    if (!permissao) return false;
    return (conta.permissoes || []).indexOf(permissao) >= 0;
  }

  /* As diferenças que esta conta NÃO pode gravar. Diferença sem permissão
   * (`fonte`, um título removido) é só do superadmin, de propósito. */
  function proibidas(conta, diferencas) {
    if (conta && conta.super === true) return [];
    return (diferencas || []).filter(function (d) { return !contaPode(conta, d.permissao); });
  }

  /* Usuário é minúsculo, sem acento e sem ponto: ele vai dentro do token, e o
   * ponto é o separador de lá. `superadmin` é reservado. */
  function usuarioValido(usuario) {
    return typeof usuario === 'string' && /^[a-z0-9][a-z0-9_-]{2,31}$/.test(usuario) &&
      usuario !== 'superadmin' && usuario !== 'admin';
  }

  var SENHA_MINIMA = 12;

  function senhaValida(senha) {
    return typeof senha === 'string' && senha.length >= SENHA_MINIMA;
  }

  function permissoesValidas(lista) {
    return Array.isArray(lista) && lista.every(function (p) { return PERMISSOES.indexOf(p) >= 0; });
  }

  /* O limite de envio é do superadmin para outra conta (M2+): quantos vídeos
   * ela pode subir, a duração máxima de cada um (em segundos), e se cada envio
   * espera aprovação manual antes de ir ao Bunny. `null` num campo é "sem
   * limite" — o padrão de uma conta nova. */
  function limiteEnvioValido(l) {
    if (l == null) return true;
    if (typeof l !== 'object') return false;
    var inteiroOuNulo = function (v) { return v == null || (Number.isFinite(v) && v >= 0 && Math.floor(v) === v); };
    if (!inteiroOuNulo(l.maxVideos)) return false;
    if (!inteiroOuNulo(l.maxDuracaoSeg)) return false;
    if (l.autorizacaoManual != null && typeof l.autorizacaoManual !== 'boolean') return false;
    return true;
  }

  /* Item novo criado pela tela de admin, no mesmo esquema do seed. */
  function itemNovo(campos) {
    var c = campos || {};
    return {
      id: c.id || '',
      arquivo: c.arquivo || '',
      caminho_local: '',
      titulo: c.titulo || '',
      serie: c.serie || 'A classificar', /* i18n-ignorar: nome de série (dado do acervo) */
      temporada: c.temporada == null ? null : Number(c.temporada),
      episodio: c.episodio == null ? null : Number(c.episodio),
      duracao: c.duracao || '',
      duracao_seg: c.duracao_seg == null ? null : Number(c.duracao_seg),
      tamanho_mb: c.tamanho_mb == null ? null : Number(c.tamanho_mb),
      ano: c.ano || '',
      data_publicacao_original: '',
      sinopse: c.sinopse || '',
      tema: c.tema || '',
      publico_alvo: c.publico_alvo || '',
      tags: Array.isArray(c.tags) ? c.tags : [],
      capa_local: null,
      legenda_local: null,
      titularidade: c.titularidade || 'INCONCLUSIVO',
      nivel_evidencia: c.nivel_evidencia || 'SEM EVIDÊNCIA', /* i18n-ignorar: valor de dado, não texto de tela */
      registro: '',
      link_origem: '',
      /* `campos.fonte` é o que o servidor devolveu no upload-token; `videoId` e
       * `libraryId` são o formato de antes do M4, ainda aceito. */
      fonte: migrarFonte(c.fonte || { tipo: 'bunny', libraryId: c.libraryId, videoId: c.videoId }),
      pendencia: c.pendencia || null,
      publicar: c.publicar === true,
      piloto: false,
      sinopse_origem: c.sinopse_origem || (c.sinopse ? 'manual' : '')
    };
  }

  var App = {
    PREFIXO: PREFIXO,
    normalizar: normalizar,
    formatarDuracao: formatarDuracao,
    rotuloEpisodio: rotuloEpisodio,
    rotuloPendencia: rotuloPendencia,
    resumoSinopse: resumoSinopse,
    tituloCurto: tituloCurto,
    formatarMinutos: formatarMinutos,
    rotuloNumero: rotuloNumero,
    formatarTempo: formatarTempo,
    capitulos: capitulos,
    capituloEm: capituloEm,
    rotaDaFicha: rotaDaFicha,
    linkDaFicha: linkDaFicha,
    migrarFonte: migrarFonte,
    idDoVideo: idDoVideo,
    itemMigrado: itemMigrado,
    catalogoMigrado: catalogoMigrado,
    midiaDe: midiaDe,
    urlEmbed: urlEmbed,
    urlCapa: urlCapa,
    comCapa: comCapa,
    urlPreview: urlPreview,
    faixaDeLegenda: faixaDeLegenda,
    urlLegenda: urlLegenda,
    urlMp4: urlMp4,
    publicaveis: publicaveis,
    ordenar: ordenar,
    ordenarPor: ordenarPor,
    COLUNAS_ORDENAVEIS: COLUNAS_ORDENAVEIS,
    agrupar: agrupar,
    prateleiras: prateleiras,
    home: home,
    modeloDeConteudo: modeloDeConteudo,
    continuarAssistindo: continuarAssistindo,
    blocosEfetivos: function (site) { return Home.blocosEfetivos(siteSaneado(site)); },
    colecoesEfetivas: function (site) { return Home.colecoesEfetivas(siteSaneado(site)); },
    siteComPadroes: Home.siteComPadroes,
    padroesDaConfig: Home.padroesDaConfig,
    prateleirasVisiveis: prateleirasVisiveis,
    titulosSoEmEscondidas: titulosSoEmEscondidas,
    prateleiraPorId: prateleiraPorId,
    destaque: destaque,
    CLASSES_SERIE: CLASSES_SERIE,
    TEXTOS_PADRAO: TEXTOS_PADRAO,
    siteSaneado: siteSaneado,
    siteVazio: siteVazio,
    classeDaSerie: classeDaSerie,
    textoDoSite: textoDoSite,
    comPrateleira: comPrateleira,
    comOrdemPrateleiras: comOrdemPrateleiras,
    comClasse: comClasse,
    comSerie: comSerie,
    apresentacaoDaSerie: apresentacaoDaSerie,
    comTemasDasSeries: comTemasDasSeries,
    CHAVE_ONDE_PAROU: CHAVE_ONDE_PAROU,
    lembrarOndeParou: lembrarOndeParou,
    continuarDaSerie: continuarDaSerie,
    ondeParouDe: ondeParouDe,
    comTexto: comTexto,
    MINIMO_PRATELEIRA: MINIMO_PRATELEIRA,
    series: series,
    gruposDeSerie: gruposDeSerie,
    semSerie: semSerie,
    grupoDaSerie: grupoDaSerie,
    MINIMO_PAGINA_SERIE: MINIMO_PAGINA_SERIE,
    gruposDeSeries: gruposDeSeries,
    paginaDaSerie: paginaDaSerie,
    rotuloTemporada: rotuloTemporada,
    formatarAnos: formatarAnos,
    seriesDoFiltro: seriesDoFiltro,
    buscar: buscar,
    filtrarPorSerie: filtrarPorSerie,
    porId: porId,
    vizinhos: vizinhos,
    slug: slug,
    idUnico: idUnico,
    precisaRevisao: precisaRevisao,
    filaSinopses: filaSinopses,
    filaSemSinopse: filaSemSinopse,
    filaPendencias: filaPendencias,
    baseIdSemVersao: baseIdSemVersao,
    outraVersaoDuplicada: outraVersaoDuplicada,
    itemNovo: itemNovo,
    CAMPOS_ITEM_MESA: CAMPOS_ITEM_MESA,
    CAMPOS_AJUSTES_MESA: CAMPOS_AJUSTES_MESA,
    CAMPOS_SITE_MESA: CAMPOS_SITE_MESA,
    registrarMudanca: registrarMudanca,
    aplicarRascunho: aplicarRascunho,
    conflitosRascunho: conflitosRascunho,
    PERMISSOES: PERMISSOES,
    ROTULO_PERMISSAO: ROTULO_PERMISSAO,
    AJUDA_PERMISSAO: AJUDA_PERMISSAO,
    CAMPOS_CONTEUDO: CAMPOS_CONTEUDO,
    SENHA_MINIMA: SENHA_MINIMA,
    permissaoDoCampo: permissaoDoCampo,
    diferencasDoCatalogo: diferencasDoCatalogo,
    chaveHistorico: chaveHistorico,
    revDaChaveHistorico: revDaChaveHistorico,
    chaveVersao: chaveVersao,
    revDaChaveVersao: revDaChaveVersao,
    contarMudancasPorAlvo: contarMudancasPorAlvo,
    resumoDeMudancas: resumoDeMudancas,
    desfazerMudanca: desfazerMudanca,
    contaPode: contaPode,
    proibidas: proibidas,
    usuarioValido: usuarioValido,
    senhaValida: senhaValida,
    permissoesValidas: permissoesValidas,
    limiteEnvioValido: limiteEnvioValido
  };

  raiz.App = App;
  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof globalThis !== 'undefined' ? globalThis : this);
