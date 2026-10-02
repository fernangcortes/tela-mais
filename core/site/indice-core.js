/* indice-core.js — o que monta o índice da busca: a leitura da legenda, a
 * condensação em blocos e, a partir da fase 3, a linha da fala e o hash de
 * cada conjunto. Sem DOM, sem rede.
 *
 * Carregado de quatro jeitos, sem etapa de build:
 *   - na mesa, como <script> comum, expondo window.AppIndice — é a mesa que lê o
 *     .srt do envio, condensa e manda os blocos prontos;
 *   - pelas funções de /api/busca, num import que o Pages empacota;
 *   - pelo script `scripts/indice-busca.mjs`, e pelo `scripts/lib/legenda.mjs`,
 *     que reexporta a leitura para o `capitulos.mjs`;
 *   - pelos testes, como CommonJS.
 *
 * POR QUE A LEITURA MORA AQUI, e não em `scripts/lib/legenda.mjs`, onde ela
 * nasceu em 31/08: são três caminhos que escrevem no índice — a mesa no envio,
 * a mesa depois do Publicar e o script —, e um código só para os três é o que
 * impede a mesa de condensar de um jeito e o script de outro. Medido em 21/09,
 * ler e condensar a legenda rolante mais longa custa 5,3 ms — metade dos 10 ms
 * que a função tem no plano gratuito. Por isso quem condensa é QUEM CHAMA a
 * rota, e a função recebe os blocos prontos.
 *
 * O `analisarVtt` do `player-core.js` NÃO serve para isto, e não é descuido
 * ter dois: ele recusa arquivo sem `WEBVTT` — o player só toca o que o Bunny
 * serve —, e a mesa manda `.srt`. Este aceita os dois formatos, com BOM e com
 * CRLF.
 */
(function (raiz) {
  'use strict';

  /* '00:01:02.930' -> 62.93  ·  '01:02.930' também vale (VTT permite sem hora)
   * ·  '00:01:02,930' é o carimbo do .srt, com vírgula. */
  function paraSegundos(carimbo) {
    var m = String(carimbo).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    var h = m[1] ? Number(m[1]) : 0;
    var min = Number(m[2]);
    var s = Number(m[3]);
    var ms = m[4] ? Number((m[4] + '00').slice(0, 3)) : 0;
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  /* 62.93 -> '1:02'  ·  3723 -> '1:02:03' — o mesmo formato do resto do site. */
  function paraCarimbo(segundos) {
    var t = Math.max(0, Math.floor(Number(segundos) || 0));
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var dois = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + dois(m) + ':' + dois(s) : m + ':' + dois(s);
  }

  var BOM = '﻿';

  /* ARMADILHA 1 — o arquivo do Bunny começa com BOM. Os bytes são
   * `EF BB BF 57 45 42 56 54 54` (conferido em 31/08/2026 no vídeo de 27 min):
   * `U+FEFF` e só depois `WEBVTT`. Um `texto.startsWith('WEBVTT')` devolve
   * `false` e o parser morre na primeira linha. Por isso o BOM sai antes de
   * qualquer outra coisa.
   *
   * ARMADILHA 3 — a legenda é ASR cru. As falas vêm quebradas no meio
   * ("Vai" / "logo! Vai logo!") e a pontuação não é confiável. Nada aqui tenta
   * adivinhar assunto.
   *
   * Devolve [{ inicio, fim, texto }] em segundos. Cue sem `-->` legível é
   * ignorada em silêncio: uma linha torta no meio de 385 não pode derrubar a
   * leitura do arquivo inteiro. O .srt passa pelo mesmo caminho: o número da
   * cue fica antes da linha do tempo e é descartado com ela. */
  function analisarVtt(bruto) {
    var texto = String(bruto == null ? '' : bruto);
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    texto = texto.replace(/\r\n?/g, '\n');

    var cues = [];
    texto.split(/\n{2,}/).forEach(function (bloco) {
      var linhas = bloco.split('\n').filter(function (l) { return l.trim() !== ''; });
      if (!linhas.length) return;
      if (/^WEBVTT/.test(linhas[0]) || /^(NOTE|STYLE|REGION)\b/.test(linhas[0])) return;

      var iTempo = -1;
      for (var i = 0; i < linhas.length; i++) {
        if (linhas[i].indexOf('-->') >= 0) { iTempo = i; break; }
      }
      if (iTempo < 0) return;

      var lados = linhas[iTempo].split('-->');
      var inicio = paraSegundos((lados[0] || '').trim());
      /* o lado direito pode trazer ajustes de posição depois do tempo */
      var fim = paraSegundos((lados[1] || '').trim().split(/\s+/)[0]);
      if (inicio == null || fim == null) return;

      var corpo = linhas.slice(iTempo + 1).join(' ')
        .replace(/<[^>]*>/g, '')     /* <v Fulano>, <i>, <00:00:01.000> */
        .replace(/\s+/g, ' ')
        .trim();
      if (!corpo) return;

      cues.push({ inicio: inicio, fim: fim, texto: corpo });
    });
    return cues.sort(function (a, b) { return a.inicio - b.inicio; });
  }

  /* ARMADILHA 4, achada em 31/08/2026: metade das legendas é ROLANTE. O
   * AssemblyAI devolveu dois formatos diferentes conforme o vídeo, e nas
   * legendas rolantes cada cue repete o fim da anterior:
   *
   *     cue 12  "Esse aí sou eu e dá para notar que eu me"
   *     cue 13  "Esse aí sou eu e dá para notar que eu me envolvi numa aventura"
   *     cue 14  "envolvi numa aventura das grandes. Mas como vim parar"
   *
   * Concatenar isso na marra triplica o texto e o transcrito fica ilegível —
   * foi o que aconteceu na primeira leitura do Série D (836 cues) e do
   * Título X (856 cues).
   *
   * Junta dois trechos descontando a maior sobreposição entre o fim de um e o
   * começo do outro. Compara por palavra, não por caractere: por caractere,
   * qualquer 'a' final casaria com um 'a' inicial e comeria texto bom. */
  function juntarSemRepetir(acumulado, novo) {
    var a = String(acumulado || '').trim();
    var b = String(novo || '').trim();
    if (!a) return b;
    if (!b) return a;

    var pa = a.split(' ');
    var pb = b.split(' ');
    var chave = function (s) { return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); };

    /* Da maior para a menor: a sobreposição correta é sempre a mais longa. O
     * teto de 60 palavras é folga sobre a maior janela rolante observada. */
    var teto = Math.min(60, pa.length, pb.length);
    for (var k = teto; k > 0; k--) {
      var bate = true;
      for (var i = 0; i < k; i++) {
        if (chave(pa[pa.length - k + i]) !== chave(pb[i])) { bate = false; break; }
      }
      if (bate) return pb.length === k ? a : a + ' ' + pb.slice(k).join(' ');
    }
    return a + ' ' + b;
  }

  /* Junta cues vizinhas em blocos de ~`janela` segundos.
   *
   * É isto que torna a legenda legível: centenas de cues de duas palavras
   * viram algumas dezenas de blocos de frase inteira, cada um com o tempo em
   * que começa. Foi feito para quem escreve os capítulos lendo o transcrito
   * (`capitulos.mjs --transcricao`), e é o mesmo bloco que a busca pela fala
   * guarda: um trecho de 30 s é o que o clique leva a assistir. */
  function condensar(cues, janela) {
    var passo = typeof janela === 'number' && janela > 0 ? janela : 30;
    var blocos = [];
    var atual = null;
    (cues || []).forEach(function (cue) {
      if (!atual || cue.inicio - atual.inicio >= passo) {
        atual = { inicio: cue.inicio, fim: cue.fim, texto: cue.texto };
        blocos.push(atual);
      } else {
        atual.fim = Math.max(atual.fim, cue.fim);
        atual.texto = juntarSemRepetir(atual.texto, cue.texto);
      }
    });
    return blocos;
  }

  /* -------------------------------------------------- os conjuntos (fase 3)
   *
   * Um vídeo entra na busca com TRÊS conjuntos, e cada um é trocado inteiro:
   *   - `fala`: os blocos de 30 s da legenda, [[início, texto], …];
   *   - `capitulos`: [[início, título], …], do catálogo;
   *   - `sinopse`: um texto só — o título e a sinopse juntos (`textoDaFicha`).
   *
   * O conjunto é a UNIDADE da troca: a mesa manda a fala inteira de um vídeo
   * novo, o Publicar manda a sinopse revisada, o script manda o que mudou. Não
   * há "acrescentar um bloco" — um vídeo com a legenda trocada ganha a fala
   * nova inteira, e o que sumiu dela sai junto. */

  /* Os blocos de uma legenda, na forma que o índice guarda: o início em
   * segundos inteiros e o texto. Dois blocos nunca caem no mesmo segundo — o
   * `condensar` só abre um bloco novo 30 s depois do anterior. */
  function blocosDaLegenda(texto, janela) {
    return condensar(analisarVtt(texto), janela || 30).map(function (b) {
      return [Math.floor(b.inicio), b.texto];
    });
  }

  /* O texto do vetor da SINOPSE (fase 4): o título e a sinopse juntos. O
   * título entra porque é ele que diz do que o vídeo é quando a sinopse é
   * curta, e o institucional nem sinopse tem. */
  function textoDaFicha(item) {
    var titulo = String((item && item.titulo) || '').replace(/\s+/g, ' ').trim();
    var sinopse = String((item && item.sinopse) || '').replace(/\s+/g, ' ').trim();
    return [titulo, sinopse].filter(Boolean).join('. ');
  }

  /* Os dois conjuntos que saem do CATÁLOGO — a fala sai da legenda. Os
   * capítulos pelo mesmo `App.capitulos` da ficha: o trecho que o sentido
   * devolve tem de ser o capítulo que a lista mostra. */
  function conjuntosDoItem(item) {
    var G = raiz.App || (typeof require === 'function' ? require('./catalogo-core.js') : null);
    return {
      capitulos: G.capitulos(item).map(function (c) { return [c.inicio, c.titulo]; }),
      sinopse: textoDaFicha(item)
    };
  }

  /* Um hash curto (FNV-1a, 32 bits), para saber se um conjunto MUDOU sem
   * guardá-lo duas vezes. Não é segurança — é só "é o mesmo texto?". */
  function hash(texto) {
    var s = String(texto == null ? '' : texto);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function hashConjunto(valor) {
    return hash(JSON.stringify(valor == null ? null : valor));
  }

  /* ------------------------------------------------- a linha da fala (fase 3)
   *
   * O índice da fala mora numa chave só do KV, `busca:fala`: uma LINHA POR
   * VÍDEO, `<videoId>\t[[início, "texto"], …]`. A chave é o `videoId`, e não o
   * id do título, por dois motivos: a mesa manda a legenda ANTES de o
   * título existir no catálogo, e o vídeo trocado de um título leva a fala
   * junto.
   *
   * O índice guarda TODO vídeo que já foi lido — também o que está fora do
   * ar. Quem filtra é o GET, pelo catálogo da hora (`linhasNoAr`): o título
   * tirado do ar some da fala no mesmo instante, sem rodar nada, e o que volta
   * ao ar volta com ela. */
  function linhaDaFala(videoId, blocos) {
    return videoId + '\t' + JSON.stringify(blocos);
  }

  function videoDaLinha(linha) {
    var tab = linha.indexOf('\t');
    return tab > 0 ? linha.slice(0, tab) : '';
  }

  /* O índice com a linha deste vídeo trocada — no lugar em que ela estava, ou
   * no fim. Sem blocos, a linha sai: vídeo sem fala não ocupa o índice. */
  function trocarLinha(texto, videoId, blocos) {
    var linhas = String(texto || '').split('\n').filter(function (l) { return l; });
    var nova = blocos && blocos.length ? linhaDaFala(videoId, blocos) : null;
    var achou = false;
    var saida = [];
    linhas.forEach(function (l) {
      if (videoDaLinha(l) !== videoId) { saida.push(l); return; }
      if (!achou && nova) saida.push(nova);
      achou = true;
    });
    if (!achou && nova) saida.push(nova);
    return saida.join('\n');
  }

  /* O id do vídeo no provedor, nos dois formatos de `fonte` (ver `migrarFonte`
   * em catalogo-core.js, que é quem manda; esta é a mesma leitura, sem trazer o
   * arquivo inteiro para cá). */
  function idDoVideo(item) {
    var f = item && item.fonte;
    if (!f) return null;
    var id = 'id' in f || 'provedor' in f || 'extras' in f ? f.id : f.videoId;
    return id == null || id === '' ? null : String(id);
  }

  /* Os ids de vídeo dos títulos no ar, pelo catálogo como está no KV. */
  function videosNoAr(catalogo) {
    var mapa = Object.create(null);
    ((catalogo && catalogo.itens) || []).forEach(function (i) {
      if (i && i.publicar === true && idDoVideo(i)) mapa[idDoVideo(i)] = true;
    });
    return mapa;
  }

  /* Só as linhas de vídeo que está no ar. Não abre o JSON de linha nenhuma:
   * o `videoId` está antes do tab, e é por ele que se decide — 0,5 ms para o
   * índice inteiro, medido em 21/09. */
  function linhasNoAr(texto, noAr) {
    return String(texto || '').split('\n').filter(function (l) {
      var v = videoDaLinha(l);
      return v && noAr[v] === true;
    }).join('\n');
  }

  /* -------------------------------------------------- o pedido de indexar
   *
   * `POST /api/busca/indexar` recebe { videoId, vetores?, fala?, capitulos?,
   * sinopse?, fim?, sentido? }:
   *   - `vetores`: até `LIMITES.vetores` (10) textos para virar vetor AGORA —
   *     [[tipo, início, texto], …], com o tipo `f` (fala), `c` (capítulo) ou
   *     `s` (sinopse). É a fase 4; o tamanho do lote é a alavanca do CPU
   *    , e o número está medido logo abaixo;
   *   - `fala`, `capitulos`, `sinopse`: os conjuntos inteiros, só com
   *     `fim: true` — a chamada que fecha o vídeo grava a fala no índice, o
   *     manifesto, e apaga os vetores do que sumiu;
   *   - `sentido: true`: os vetores dos conjuntos desta chamada foram todos
   *     mandados, nesta e nas anteriores. É o que o manifesto guarda.
   *
   * A validação é de FORMA, e é daqui que a rota a tira: um pedido torto não
   * pode gravar lixo no índice que todo visitante baixa. */
  /* `vetores` é o LOTE, e é a alavanca do CPU da rota. O plano
   * começou em 20; a medida no ar em 22/09 (tail do deploy de produção, com
   * o isolate quente) deu 4 a 12 ms por chamada de 20 vetores, 4 a 7 ms com
   * 10 e 2 a 5 ms com 5, contra os 10 ms do plano gratuito. Fica 10: cabe com
   * folga, e a carga inteira dá ~175 chamadas em vez de ~90 — nada, perto dos
   * 100 mil pedidos por dia. */
  var LIMITES = { vetores: 10, blocos: 600, capitulos: 300, texto: 4000, sinopse: 5000 };
  var TIPOS_DE_VETOR = ['f', 'c', 's'];

  function inteiroValido(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0 && n < 1000000 && Math.floor(n) === n;
  }

  function textoValido(t, max) {
    return typeof t === 'string' && t.trim().length > 0 && t.length <= max;
  }

  /* Um conjunto de [início, texto], ou a frase do erro. Início repetido é
   * erro: os ids dos vetores saem do início, e dois iguais seriam um só. */
  function conjuntoValido(lista, maxItens, maxTexto) {
    if (!Array.isArray(lista) || lista.length > maxItens) return 'no máximo ' + maxItens + ' por vídeo';
    var vistos = Object.create(null);
    for (var i = 0; i < lista.length; i++) {
      var b = lista[i];
      if (!Array.isArray(b) || !inteiroValido(b[0]) || !textoValido(b[1], maxTexto)) return 'cada item é [início inteiro, texto]';
      if (vistos[b[0]]) return 'início repetido: ' + b[0];
      vistos[b[0]] = true;
    }
    return '';
  }

  /* O formato do id vem do ADAPTADOR do provedor (`padraoId`); sem ele vale o
   * padrão antigo, que aceita o guid do Bunny e recusa o que muda um caminho. */
  var PADRAO_ID_ANTIGO = /^[A-Za-z0-9-]{8,64}$/;

  function validarPedido(corpo, padraoId) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: 'esperado um objeto JSON' };
    var videoId = typeof corpo.videoId === 'string' ? corpo.videoId : '';
    if (!(padraoId || PADRAO_ID_ANTIGO).test(videoId)) return { erro: 'informe um `videoId` válido' };
    var pedido = { videoId: videoId, vetores: [], fim: corpo.fim === true, sentido: corpo.sentido === true };

    if (corpo.vetores != null) {
      if (!Array.isArray(corpo.vetores) || corpo.vetores.length > LIMITES.vetores) {
        return { erro: '`vetores`: até ' + LIMITES.vetores + ' por pedido' };
      }
      for (var i = 0; i < corpo.vetores.length; i++) {
        var v = corpo.vetores[i];
        if (!Array.isArray(v) || TIPOS_DE_VETOR.indexOf(v[0]) < 0 || !inteiroValido(v[1]) || !textoValido(v[2], LIMITES.texto)) {
          return { erro: 'cada vetor é [tipo f, c ou s, início inteiro, texto]' };
        }
      }
      pedido.vetores = corpo.vetores.map(function (x) { return [x[0], x[1], x[2]]; });
    }

    var erro;
    if (corpo.fala !== undefined) {
      if ((erro = conjuntoValido(corpo.fala, LIMITES.blocos, LIMITES.texto))) return { erro: '`fala`: ' + erro };
      pedido.fala = corpo.fala.map(function (b) { return [b[0], b[1]]; });
    }
    if (corpo.capitulos !== undefined) {
      if ((erro = conjuntoValido(corpo.capitulos, LIMITES.capitulos, LIMITES.texto))) return { erro: '`capitulos`: ' + erro };
      pedido.capitulos = corpo.capitulos.map(function (b) { return [b[0], b[1]]; });
    }
    if (corpo.sinopse !== undefined) {
      if (typeof corpo.sinopse !== 'string' || corpo.sinopse.length > LIMITES.sinopse) return { erro: '`sinopse`: um texto de até ' + LIMITES.sinopse + ' caracteres' };
      pedido.sinopse = corpo.sinopse.replace(/\s+/g, ' ').trim();
    }

    var temConjunto = pedido.fala !== undefined || pedido.capitulos !== undefined || pedido.sinopse !== undefined;
    if (temConjunto && !pedido.fim) return { erro: 'os conjuntos só vão na chamada que fecha o vídeo, com `fim: true`' };
    if (!pedido.fim && !pedido.vetores.length) return { erro: 'nada a fazer: mande `vetores` ou `fim`' };
    return pedido;
  }

  /* O id de um vetor. Determinístico, e é por isso que reindexar SOBRESCREVE
   * em vez de duplicar. Um bloco de fala: `f:<videoId>:<início>`. */
  function idDoVetor(tipo, videoId, inicio) {
    return tipo === 's' ? 's:' + videoId : tipo + ':' + videoId + ':' + inicio;
  }

  /* O MANIFESTO (`busca:estado`): por vídeo, o hash e os inícios de cada
   * conjunto, e se os vetores dele foram feitos. É por ele que o script pula
   * o que não mudou, que a mesa vê quem ficou fora da busca, e que a troca de
   * um conjunto sabe QUAIS vetores sumiram e têm de sair do índice.
   *
   * Puro: devolve o manifesto novo e os ids a apagar, e quem grava é a rota. */
  function manifestoNovo(manifesto, pedido, em) {
    var m = manifesto && typeof manifesto === 'object' ? JSON.parse(JSON.stringify(manifesto)) : {};
    if (!m.videos || typeof m.videos !== 'object') m.videos = {};
    var v = m.videos[pedido.videoId] || {};
    var apagar = [];
    /* A fala MUDOU? É o que diz se a chave de ~500 KB precisa ser reescrita —
     * a parte cara da chamada que fecha o vídeo — e se a versão da fala (a do
     * ETag) anda. Reindexar a mesma legenda não mexe em nenhuma das duas. */
    var falaMudou = pedido.fala !== undefined && (!v.fala || v.fala.hash !== hashConjunto(pedido.fala));

    [['fala', 'f'], ['capitulos', 'c']].forEach(function (par) {
      var campo = par[0];
      if (pedido[campo] === undefined) return;
      var novos = pedido[campo].map(function (b) { return b[0]; });
      var velhos = (v[campo] && Array.isArray(v[campo].inicios)) ? v[campo].inicios : [];
      velhos.forEach(function (ini) {
        if (novos.indexOf(ini) < 0) apagar.push(idDoVetor(par[1], pedido.videoId, ini));
      });
      v[campo] = { hash: hashConjunto(pedido[campo]), n: novos.length, inicios: novos, sentido: pedido.sentido };
    });

    if (pedido.sinopse !== undefined) {
      if (!pedido.sinopse && v.sinopse && v.sinopse.hash !== hash('')) apagar.push(idDoVetor('s', pedido.videoId));
      v.sinopse = { hash: hash(pedido.sinopse), sentido: pedido.sentido };
    }

    v.em = em;
    m.videos[pedido.videoId] = v;
    m.versao = (Number(m.versao) || 0) + 1;
    /* A versão DA FALA anda só quando a fala muda: é ela que o `GET
     * /api/busca/fala` põe no ETag. Com a versão geral, cada sinopse revisada
     * na mesa faria toda visita baixar de novo os ~430 KB da fala, que não
     * mudou. */
    if (falaMudou) m.versaoDaFala = m.versao;
    m.atualizado_em = em;
    return { manifesto: m, apagar: apagar, falaMudou: falaMudou };
  }

  /* QUEM FICOU FORA DA BUSCA.
   * A mesa mostra isto na visão geral, e é o que pega o que não chegou ao
   * índice: o envio cuja indexação falhou, o título que nunca passou pela
   * rota, a sinopse revisada cujo vetor não foi refeito, a restauração de uma
   * versão antiga pelo histórico.
   *
   * O QUE ELE NÃO VÊ: a legenda trocada fora da mesa, pelo
   * `capas-legendas.mjs`. O manifesto guarda o hash da fala que a rota
   * recebeu, e não sabe o que o Bunny guarda agora. Quem acha essa é o
   * `indice-busca.mjs`, que baixa a legenda e compara.
   *
   *   - `semFala`: título NO AR cujo vídeo o manifesto não registra — nunca
   *     passou pela rota. O vídeo sem legenda passou: está no manifesto com
   *     zero bloco, e fora do índice da fala, que não guarda linha vazia;
   *   - `desatualizados`: com a busca por sentido ligada, o título cujos
   *     vetores não existem (`sentido` falso) ou cujo texto mudou desde que
   *     eles foram feitos — a sinopse revisada, o capítulo novo.
   *
   * Pura: recebe o catálogo e o manifesto, e devolve as duas listas. */
  function foraDaBusca(itens, manifesto, comSentido) {
    var videos = (manifesto && manifesto.videos) || {};
    var semFala = [];
    var desatualizados = [];
    (itens || []).forEach(function (item) {
      if (!item || item.publicar !== true) return;
      var v = idDoVideo(item);
      if (!v) return;
      var m = videos[v];
      if (!m || !m.fala) { semFala.push(item); return; }
      if (!comSentido) return;
      var conj = conjuntosDoItem(item);
      var falta = m.fala.sentido !== true ||
        !m.capitulos || m.capitulos.sentido !== true || m.capitulos.hash !== hashConjunto(conj.capitulos) ||
        !m.sinopse || m.sinopse.sentido !== true || m.sinopse.hash !== hash(conj.sinopse);
      if (falta) desatualizados.push(item);
    });
    return { semFala: semFala, desatualizados: desatualizados };
  }

  /* Uma lista em lotes — os vetores por chamada (`LIMITES.vetores`). */
  function lotes(lista, tamanho) {
    var n = tamanho || LIMITES.vetores;
    var saida = [];
    for (var i = 0; i < (lista || []).length; i += n) saida.push(lista.slice(i, i + n));
    return saida;
  }

  /* Os vetores de um vídeo, na ordem em que vão: fala, capítulos, sinopse. */
  function vetoresDosConjuntos(conj) {
    var saida = [];
    (conj.fala || []).forEach(function (b) { saida.push(['f', b[0], b[1]]); });
    (conj.capitulos || []).forEach(function (b) { saida.push(['c', b[0], b[1]]); });
    if (conj.sinopse) saida.push(['s', 0, conj.sinopse]);
    return saida;
  }

  /* As duas chaves do KV da busca, ao lado do `catalogo`: o índice da fala e
   * o manifesto. Um nome só para as três rotas de /api/busca. */
  var CHAVES = { fala: 'busca:fala', estado: 'busca:estado' };

  /* ------------------------------------------------------ o sentido (fase 4)
   *
   * O modelo é o `bge-m3` do Workers AI (decisão de projeto): multilíngue, 1.024
   * dimensões. A resposta dele, conferida em 21/09 num `pages dev` com o
   * binding de verdade, é { shape: [n, 1024], data: [[…], …], pooling:
   * 'cls' } — um vetor por texto, na ordem dos textos. */
  var MODELO = '@cf/baai/bge-m3';
  var DIMENSOES = 1024;

  /* Os vetores de uma resposta do modelo, conferidos: um por texto, cada um
   * com as 1.024 dimensões. Resposta torta LANÇA — gravar um vetor de tamanho
   * errado no índice o estragaria para sempre, em silêncio. */
  function vetoresDaResposta(resposta, quantos) {
    var dados = resposta && (resposta.data || resposta.response);
    if (!Array.isArray(dados) || dados.length !== quantos) {
      throw new Error('o modelo devolveu ' + (Array.isArray(dados) ? dados.length : 'nada') + ' vetores para ' + quantos + ' textos');
    }
    dados.forEach(function (v) {
      if (!Array.isArray(v) || v.length !== DIMENSOES) throw new Error('vetor com ' + (v && v.length) + ' dimensões, e não ' + DIMENSOES);
    });
    return dados;
  }

  /* O CORTE. A busca por sentido sempre devolve os mais próximos —
   * até para "asdfgh". Sem corte, o "Nada encontrado" nunca mais aparece.
   *
   * O NÚMERO É MEDIDO, em 22/09, no índice de verdade (`indice-busca.mjs
   * --provar`, e os números estão no registro de medições):
   *
   *   - das nove perguntas SEM resposta no acervo, sete pararam abaixo dele:
   *     "asdfgh" 0,41, "receita de bolo de chocolate" 0,44, "qwerty" 0,48,
   *     "lorem ipsum dolor sit amet" 0,508. "fração", que o acervo não trata,
   *     para em 0,480 — e é por isso que ela responde "Nada encontrado" em
   *     vez de trazer o que passou perto;
   *   - DUAS PASSARAM: "previsão do tempo para amanhã", 0,583 num bloco que
   *     dizia só "no futuro." — o bloco curto, que a junção do busca-core.js
   *     ignora —, e "criptomoedas e bitcoin", 0,548 num capítulo, que chega
   *     no fim da resposta, como "Sobre o assunto";
   *   - as perguntas COM resposta ficam bem acima (de 0,595 a 0,746 na
   *     medição feita);
   *   - na prova dos 461 capítulos, o trecho certo tem mediana 0,594, e um
   *     quarto dos acertos fica abaixo de 0,547.
   *
   * 0,52 corta o ruído e guarda 334 dos 374 acertos da prova (89,3%). Subir
   * até tirar o bitcoin custaria um quarto dos acertos — por uma pergunta que
   * o acervo não trata. */
  var CORTE = 0.52;

  /* A pergunta como ela vai ao modelo e à chave do cache: em minúsculas, sem
   * espaço sobrando, com no máximo 120 caracteres. O ACENTO FICA: ele diz
   * alguma coisa ao modelo ("pé" não é "pe"), e a busca literal, que ignora
   * acento, é outra. */
  function consultaDoSentido(texto) {
    return String(texto == null ? '' : texto).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  /* Com 3 letras ou mais: abaixo disso não há sentido a comparar, e a
   * pergunta custaria um vetor e uma consulta à toa. */
  function consultaValida(q) {
    return (String(q || '').match(/[\p{L}\p{N}]/gu) || []).length >= 3;
  }

  /* O que volta do Vectorize, como o cache guarda: [videoId, tipo, início,
   * nota], na ordem da nota. E o que sai para o navegador: SÓ o que está no
   * ar e acima do corte, sem texto nenhum — o texto o navegador já tem. */
  function brutosDoVectorize(resposta) {
    return ((resposta && resposta.matches) || []).filter(function (m) {
      return m && m.metadata && typeof m.metadata.videoId === 'string';
    }).map(function (m) {
      return [m.metadata.videoId, m.metadata.tipo, Number(m.metadata.inicio) || 0, Math.round(Number(m.score) * 10000) / 10000];
    });
  }

  function filtrarSentido(brutos, noAr, corte) {
    var minimo = typeof corte === 'number' ? corte : CORTE;
    return (brutos || []).filter(function (b) {
      return noAr[b[0]] === true && b[3] >= minimo;
    }).map(function (b) {
      return { videoId: b[0], tipo: b[1], inicio: b[2], nota: b[3] };
    });
  }

  var AppIndice = {
    BOM: BOM,
    CHAVES: CHAVES,
    LIMITES: LIMITES,
    MODELO: MODELO,
    DIMENSOES: DIMENSOES,
    CORTE: CORTE,
    vetoresDaResposta: vetoresDaResposta,
    consultaDoSentido: consultaDoSentido,
    consultaValida: consultaValida,
    brutosDoVectorize: brutosDoVectorize,
    filtrarSentido: filtrarSentido,
    paraSegundos: paraSegundos,
    paraCarimbo: paraCarimbo,
    analisarVtt: analisarVtt,
    juntarSemRepetir: juntarSemRepetir,
    condensar: condensar,
    blocosDaLegenda: blocosDaLegenda,
    textoDaFicha: textoDaFicha,
    conjuntosDoItem: conjuntosDoItem,
    hash: hash,
    hashConjunto: hashConjunto,
    linhaDaFala: linhaDaFala,
    trocarLinha: trocarLinha,
    videosNoAr: videosNoAr,
    linhasNoAr: linhasNoAr,
    validarPedido: validarPedido,
    idDoVideo: idDoVideo,
    idDoVetor: idDoVetor,
    manifestoNovo: manifestoNovo,
    foraDaBusca: foraDaBusca,
    lotes: lotes,
    vetoresDosConjuntos: vetoresDosConjuntos
  };

  raiz.AppIndice = AppIndice;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppIndice;
})(typeof globalThis !== 'undefined' ? globalThis : this);
