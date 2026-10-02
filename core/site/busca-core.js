/* busca-core.js — a busca do site: o índice por palavra, a relevância, o
 * plural e o erro de digitação. Sem DOM, sem rede.
 *
 * Carregado de dois jeitos, sem etapa de build:
 *   - no navegador, como <script> comum, expondo window.AppBusca — e SÓ QUANDO
 *     ALGUÉM VAI BUSCAR: o app.js o pede no foco do campo, nunca na chegada;
 *   - nos testes, como módulo CommonJS (require('./busca-core.js')).
 *
 * UM ARQUIVO À PARTE, e não mais funções no catalogo-core.js, como o projeto previa: o core é baixado por toda visita, e se decidiu que a
 * chegada não ganha nenhum byte com a busca nova. Quem nunca busca nunca baixa
 * isto.
 *
 * A BUSCA DA MESA NÃO É ESTA. A tabela "Todos os títulos" continua com a
 * `App.buscar` do core, e de propósito (decidido em 21/09): ela ordena por
 * coluna e edita em lote. Ali a tolerância poria na lista título sem o termo,
 * e a relevância brigaria com a coluna.
 */
(function (raiz) {
  'use strict';

  var App = raiz.App || (typeof require === 'function' ? require('./catalogo-core.js') : null);

  /* ------------------------------------------------------------ palavras */

  /* O texto em palavras, sem acento e em minúsculas — a mesma normalização da
   * `App.buscar`, cortada no que não é letra nem número. "bem-estar" vira duas
   * palavras, dos dois lados: na consulta e no texto. */
  function palavras(texto) {
    return App.normalizar(texto).match(/[a-z0-9]+/g) || [];
  }

  /* As palavras distintas de um texto: a lista, para percorrer, e o mapa, para
   * perguntar "tem esta?" sem percorrer. */
  function conjunto(texto) {
    var lista = [];
    var mapa = Object.create(null);
    palavras(texto).forEach(function (p) {
      if (mapa[p]) return;
      mapa[p] = true;
      lista.push(p);
    });
    return { lista: lista, mapa: mapa };
  }

  /* As palavras que não dizem o assunto. "o que é fração" procura FRAÇÃO: com
   * "o", "que" e "é" valendo como termo, o "todos os termos" exigiria um
   * "que" na sinopse, e um título sobre frações cuja sinopse não tem "que"
   * sumiria da resposta. Uma consulta feita SÓ delas continua valendo inteira
   * — quem digita "de" quer ver alguma coisa. */
  var VAZIAS = Object.create(null);
  ('a o as os e de da do das dos em no na nos nas um uma uns umas que com ' +
    'por para pra pro ao aos se ou sobre como').split(' ').forEach(function (p) { VAZIAS[p] = true; });

  /* Os termos da consulta, sem repetição e sem as palavras vazias. */
  function termos(consulta) {
    var todos = conjunto(consulta).lista;
    var uteis = todos.filter(function (t) { return !VAZIAS[t]; });
    return uteis.length ? uteis : todos;
  }

  /* ---------------------------------------------------------------- plural */

  /* A RAIZ LEVE DO PORTUGUÊS: o singular provável de uma palavra já
   * normalizada (sem acento). É o que faz "bombeiros" achar "bombeiro" e
   * "profissões" achar "profissão" — plural e singular contam como a mesma
   * palavra (regra do projeto).
   *
   * Não é um lematizador: não mexe em verbo, gênero nem grau. As regras são
   * as do plural regular, na ordem em que uma não engole a outra:
   *   -ões, -ães -> -ão        profissões, capitães
   *   -ais -> -al, -éis -> -el animais, papéis — só com 5 letras ou mais:
   *                            "mais" viraria "mal", e "seis", "sel"
   *   -ns -> -m                jovens, imagens
   *   -res, -zes -> -r, -z     mulheres, luzes
   *   -ses -> a raiz de -s     meses -> mês, países -> país
   *   -s -> nada               bombeiros, aulas
   *
   * O que ela erra, ela erra DOS DOIS LADOS do mesmo jeito — "Brasil" e
   * "brasil" viram os dois "brasi" —, e é isso que importa: a consulta e o texto
   * passam pela mesma função. O erro que sobra é o de duas palavras
   * diferentes que dão a mesma raiz, e as 8.253 palavras do acervo — sinopses,
   * capítulos e a fala dos 80 vídeos com legenda — foram conferidas atrás
   * disso em 21/09. Caíam em outra: "mães", que as regras dariam como "mão", e
   * dois números, "seis" e "dois", que perdendo o -s viram "sei" e "dói" — as
   * duas existem no acervo. Elas são a exceção escrita, com "três" junto, para
   * os números não virarem outra coisa.
   *
   * Palavra de menos de 4 letras não muda: "mês", "gás" e "mas" já são
   * singulares, ou curtas demais para adivinhar. */
  var EXCECOES_RAIZ = { maes: 'mae', seis: 'seis', dois: 'dois', tres: 'tres' };

  function raizDe(p) {
    if (EXCECOES_RAIZ[p]) return EXCECOES_RAIZ[p];
    if (p.length < 4 || /^\d+$/.test(p)) return p;
    var fim3 = p.slice(-3);
    if (fim3 === 'oes' || fim3 === 'aes') return p.slice(0, -3) + 'ao';
    if (p.length >= 5 && fim3 === 'ais') return p.slice(0, -3) + 'al';
    if (p.length >= 5 && fim3 === 'eis') return p.slice(0, -3) + 'el';
    if (p.slice(-2) === 'ns') return p.slice(0, -2) + 'm';
    if (p.slice(-2) === 'es') {
      var antes = p.charAt(p.length - 3);
      if (antes === 'r' || antes === 'z') return p.slice(0, -2);
      if (antes === 's') return raizDe(p.slice(0, -2));
    }
    if (p.slice(-1) === 's') return p.slice(0, -1);
    return p;
  }

  /* ------------------------------------------------------- erro de digitação */

  /* Quantas trocas levam de `a` a `b`: letra a mais, a menos, trocada — e DUAS
   * VIZINHAS INVERTIDAS CONTAM COMO UMA (Damerau, na versão restrita): "bmobeiro"
   * está a 1 de "bombeiro", como está no teclado de quem digitou.
   *
   * Com `teto`, desiste assim que passa dele e devolve `teto + 1`: a pergunta
   * que a busca faz é "está perto?", e não "a quanto está?". Uma palavra de 12
   * letras contra outra de 5 nem entra na conta. */
  function distancia(a, b, teto) {
    var max = typeof teto === 'number' ? teto : Infinity;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var antes2 = null, antes = [], agora;
    for (var j = 0; j <= lb; j++) antes[j] = j;
    for (var i = 1; i <= la; i++) {
      agora = [i];
      var menor = i;
      for (j = 1; j <= lb; j++) {
        var custo = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(antes[j] + 1, agora[j - 1] + 1, antes[j - 1] + custo);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          v = Math.min(v, antes2[j - 2] + 1);
        }
        agora[j] = v;
        if (v < menor) menor = v;
      }
      if (menor > max) return max + 1;
      antes2 = antes;
      antes = agora;
    }
    return antes[lb] <= max ? antes[lb] : max + 1;
  }

  /* Só se corrige palavra de 4 letras ou mais, e nunca número: em "rua", "ano"
   * ou "3" uma letra de diferença já é outra palavra. Uma letra de distância;
   * duas a partir de 8 letras, onde um erro duplo ainda deixa a palavra
   * reconhecível ("bonbeiros"). */
  function tetoDaCorrecao(termo) {
    if (termo.length < 4 || /^\d+$/.test(termo)) return 0;
    return termo.length >= 8 ? 2 : 1;
  }

  /* --------------------------------------------------------------- índice */

  /* O peso de cada campo, na ordem do projeto: título > série e "Episódio N" >
   * capítulo > tema, público e tags > sinopse > fala. Para cada termo conta o
   * MELHOR campo em que ele casou, e não a soma dos campos: um título que diz
   * "bombeiro" três vezes na sinopse não passa na frente do que tem a palavra
   * no nome. */
  var PESOS = { titulo: 100, serie: 60, numero: 60, capitulo: 40, tema: 25, sinopse: 15, fala: 5 };

  /* Os campos que são do TÍTULO — os de cima, menos o capítulo, que é de um
   * trecho do vídeo. É neles que se procura o CONTEXTO de um trecho (ver
   * `procurar`). */
  var CAMPOS_DO_TITULO = ['titulo', 'serie', 'numero', 'tema', 'sinopse'];

  /* Até quantos segundos um capítulo e um bloco da fala são o MESMO momento
   * (ver `procurar`). Um terço do bloco de 30 s. */
  var PERTO = 10;

  /* E o quanto vale o JEITO de casar, dentro do campo: palavra inteira (ou o
   * plural dela) vale mais que começo de palavra, que vale mais que pedaço. A
   * palavra corrigida vale um pouco menos que a exata — é o que põe o
   * resultado exato na frente quando os dois aparecem. */
  var INTEIRA = 1;
  var CORRIGIDA = 0.8;
  var COMECO = 0.6;
  var PEDACO = 0.3;

  /* Os campos de um título, cada um com as suas palavras. Os mesmos da
   * `App.buscar` (`textoBusca`): título, série, sinopse, tema, público, ano,
   * "T1 · E2" e tags — e mais o "Episódio N", que é como o cartão escreve o
   * número. */
  function camposDoItem(item) {
    return {
      titulo: conjunto(item.titulo),
      serie: conjunto(item.serie),
      numero: conjunto([App.rotuloNumero(item), App.rotuloEpisodio(item)].join(' ')),
      tema: conjunto([item.tema, item.publico_alvo, item.ano, (item.tags || []).join(' ')].join(' ')),
      sinopse: conjunto(item.sinopse)
    };
  }

  /* O ÍNDICE DA FALA, como o `GET /api/busca/fala` o manda: uma linha por
   * vídeo, `<videoId>\t[[início, "texto"], …]` (quem escreve a linha é o
   * `AppIndice.linhaDaFala`, do lado do servidor). Devolve { videoId: blocos }.
   *
   * Linha torta é pulada, e bloco torto também: um vídeo com a linha
   * estragada fica sem fala na busca, e a busca continua para os outros. */
  function lerFala(texto) {
    var fala = Object.create(null);
    String(texto || '').split('\n').forEach(function (linha) {
      var tab = linha.indexOf('\t');
      if (tab <= 0) return;
      var blocos;
      try { blocos = JSON.parse(linha.slice(tab + 1)); } catch (e) { return; }
      if (!Array.isArray(blocos)) return;
      fala[linha.slice(0, tab)] = blocos.filter(function (b) {
        return Array.isArray(b) && typeof b[0] === 'number' && isFinite(b[0]) && typeof b[1] === 'string';
      });
    });
    return fala;
  }

  /* O índice de uma lista de títulos. Montado UMA vez por catálogo — quem
   * chama guarda —, e a cada tecla só a consulta anda. `fala` é o que o
   * `lerFala` devolveu, quando já chegou; sem ela, os títulos e os capítulos
   * respondem sozinhos.
   *
   * `vocabulario` é toda palavra que existe no índice, com a raiz de cada uma.
   * É por ele que um termo vira as palavras que ele acha: "bomb" acha
   * "bombeiro" uma vez, no vocabulário, e não uma vez por título. E é ele o
   * dicionário do erro de digitação: um termo só é corrigido para uma palavra
   * que EXISTE no catálogo — ou na fala, depois que ela chega. */
  function indice(itens, fala) {
    var raizes = Object.create(null);
    var junta = function (c) { c.lista.forEach(function (p) { if (!raizes[p]) raizes[p] = raizDe(p); }); };

    var docs = App.ordenar(itens || []).map(function (item, pos) {
      var campos = camposDoItem(item);
      Object.keys(campos).forEach(function (k) { junta(campos[k]); });
      /* Os capítulos pelo MESMO `App.capitulos` da ficha e do player: o
       * trecho que a busca oferece tem de ser o capítulo que a lista da ficha
       * mostra, no mesmo segundo. */
      var caps = App.capitulos(item).map(function (c) {
        var palavrasDoCap = conjunto(c.titulo);
        junta(palavrasDoCap);
        return { inicio: c.inicio, titulo: c.titulo, palavras: palavrasDoCap };
      });
      /* A fala do VÍDEO do título, pela `videoId`: é essa a chave do índice
       * da fala, e não o id do título. */
      var videoId = App.idDoVideo(item);
      var blocos = (fala && videoId && fala[videoId]) || [];
      var falas = blocos.map(function (b) {
        var palavrasDoBloco = conjunto(b[1]);
        junta(palavrasDoBloco);
        return { inicio: Math.floor(b[0]), texto: b[1], palavras: palavrasDoBloco };
      });
      return { item: item, pos: pos, campos: campos, capitulos: caps, falas: falas };
    });

    return { docs: docs, vocabulario: Object.keys(raizes), raizes: raizes };
  }

  /* ------------------------------------------------------------- consulta */

  /* As palavras do vocabulário que um termo acha, cada uma com o quanto vale.
   *
   * O erro de digitação entra SÓ quando o termo não acha nada — nem inteiro,
   * nem como começo, nem como pedaço. "bomb" é começo de "bombeiro", e não um
   * erro; "bonbeiro" não é nada, e aí vira as palavras a uma letra dele. A
   * troca é em silêncio: a tela não diz "você quis dizer". */
  function casar(ind, termo) {
    var mapa = Object.create(null);
    var lista = [];
    var poe = function (p, q) {
      if (!(p in mapa)) { lista.push(p); mapa[p] = q; }
      else if (q > mapa[p]) mapa[p] = q;
    };
    var r = raizDe(termo);
    ind.vocabulario.forEach(function (p) {
      if (p === termo || ind.raizes[p] === r) poe(p, INTEIRA);
      else if (termo.length >= 2 && p.indexOf(termo) === 0) poe(p, COMECO);
      else if (termo.length >= 3 && p.indexOf(termo) > 0) poe(p, PEDACO);
    });

    var corrigido = false;
    var teto = tetoDaCorrecao(termo);
    if (!lista.length && teto) {
      /* As achadas levam o plural junto: "bonbeiro" acha "bombeiro", e
       * "bombeiro" traz "bombeiros". */
      var raizesAchadas = Object.create(null);
      ind.vocabulario.forEach(function (p) {
        if (distancia(termo, p, teto) <= teto) raizesAchadas[ind.raizes[p]] = true;
      });
      ind.vocabulario.forEach(function (p) {
        if (raizesAchadas[ind.raizes[p]]) poe(p, CORRIGIDA);
      });
      corrigido = lista.length > 0;
    }
    return { termo: termo, lista: lista, mapa: mapa, corrigido: corrigido };
  }

  /* A PALAVRA DE 3 LETRAS COM ERRO, corrigida pela VIZINHA (23/09).
   *
   * Quem usa buscou "carro de boj" e não veio nada, com "carro de boi"
   * respondendo. O `tetoDaCorrecao` não corrige palavra de 3 letras, e está
   * certo SOZINHO: medido no acervo (rev 122, 8.027 palavras), um erro de uma
   * letra numa palavra de 3 fica a uma letra de 3,0 palavras em média, e só 24%
   * têm um candidato único. "boj" está a 1 de "bom", "boa" e "boi" — e "bom"
   * está em 70 trechos do acervo.
   *
   * O que separa o certo é o vizinho: dos candidatos, fica só quem aparece NO
   * MESMO TRECHO — um campo, um capítulo, um bloco da fala — que uma palavra
   * que outro termo da consulta achou. "boi" aparece junto de "carro" em 3
   * trechos; "bom" e "boa", em nenhum. Sem vizinho que casou, nada muda: "boj"
   * sozinho continua sem resposta, porque não há como saber qual das três.
   *
   * Só roda quando um termo curto não achou nada, e só percorre os trechos: é
   * o caminho raro, e a consulta comum não paga por ele. */
  function trechosDoDoc(d) {
    var lista = CAMPOS_DO_TITULO.map(function (k) { return d.campos[k]; });
    d.capitulos.forEach(function (c) { lista.push(c.palavras); });
    d.falas.forEach(function (b) { lista.push(b.palavras); });
    return lista;
  }

  function corrigirPelaVizinha(ind, casadas) {
    casadas.forEach(function (c) {
      if (c.lista.length || c.termo.length !== 3 || /\d/.test(c.termo)) return;
      var vizinhas = casadas.filter(function (o) { return o !== c && o.lista.length; });
      if (!vizinhas.length) return;

      /* Os candidatos, pela raiz: "boi" traz "bois" junto, como no `casar`. */
      var candidatas = Object.create(null);
      var algum = false;
      ind.vocabulario.forEach(function (p) {
        if (distancia(c.termo, p, 1) <= 1) { candidatas[ind.raizes[p]] = true; algum = true; }
      });
      if (!algum) return;

      var aceitas = Object.create(null);
      ind.docs.forEach(function (d) {
        trechosDoDoc(d).forEach(function (t) {
          var comVizinha = t.lista.some(function (p) {
            return vizinhas.some(function (o) { return p in o.mapa; });
          });
          if (!comVizinha) return;
          t.lista.forEach(function (p) {
            if (candidatas[ind.raizes[p]]) aceitas[ind.raizes[p]] = true;
          });
        });
      });

      ind.vocabulario.forEach(function (p) {
        if (!aceitas[ind.raizes[p]] || p in c.mapa) return;
        c.lista.push(p);
        c.mapa[p] = CORRIGIDA;
      });
      c.corrigido = c.lista.length > 0;
    });
    return casadas;
  }

  /* O quanto o termo vale NESTE campo: a melhor das palavras dele que estão
   * aqui. Percorre o menor dos dois lados. */
  function qualidade(campo, casadas) {
    var melhor = 0;
    if (casadas.lista.length <= campo.lista.length) {
      for (var i = 0; i < casadas.lista.length; i++) {
        if (campo.mapa[casadas.lista[i]] && casadas.mapa[casadas.lista[i]] > melhor) melhor = casadas.mapa[casadas.lista[i]];
      }
      return melhor;
    }
    for (var j = 0; j < campo.lista.length; j++) {
      var q = casadas.mapa[campo.lista[j]];
      if (q > melhor) melhor = q;
    }
    return melhor;
  }

  /* O melhor que um termo achou numa lista de trechos de um título — os
   * capítulos, ou os blocos da fala. */
  function qualidadeNosTrechos(trechos, casadas) {
    var melhor = 0;
    for (var i = 0; i < trechos.length && melhor < INTEIRA; i++) {
      var q = qualidade(trechos[i].palavras, casadas);
      if (q > melhor) melhor = q;
    }
    return melhor;
  }

  /* O TRECHO: um pedaço do vídeo que responde à pergunta — um capítulo (fase
   * 2) ou, com a fala carregada, um bloco de 30 s do que é falado (fase 3).
   *
   * A regra: pelo menos UM termo tem de estar no texto do próprio trecho, e
   * cada um dos outros, ou no trecho também, ou no CONTEXTO — os campos do
   * título a que o trecho pertence. "bombeiro escada" acha o capítulo
   * "Termo Raro" do *Título X*: "escada" está no capítulo, e
   * "bombeiro", no nome do vídeo. Sem o contexto, só um capítulo que dissesse
   * as duas palavras responderia — e capítulo tem três ou quatro.
   *
   * O contexto é SÓ o título, e não os outros trechos do mesmo vídeo: se
   * fosse o vídeo inteiro, qualquer termo que aparecesse uma vez na fala
   * valeria para todos os capítulos, e "resgate escada" traria os doze.
   *
   * A nota: 10 para cada termo no texto do trecho, vezes o jeito de casar, e 1
   * para cada termo que veio do contexto. Mais termos no próprio trecho, mais
   * na frente. O capítulo vale um pouco mais que a fala (`bonus`): ele foi
   * escrito por gente para dizer do que aquele pedaço trata. Devolve null
   * quando o trecho não responde. */
  function notaDoTrecho(palavrasDoTrecho, casadas, contexto, bonus) {
    var nota = 0, noTexto = 0;
    for (var k = 0; k < casadas.length; k++) {
      var q = qualidade(palavrasDoTrecho, casadas[k]);
      if (q) { noTexto++; nota += 10 * q; }
      else if (contexto[k]) nota += 1;
      else return null;
    }
    return noTexto ? { nota: nota * bonus, todos: noTexto === casadas.length } : null;
  }

  /* OS TERMOS JUNTOS valem mais que espalhados. Achado ao medir a fala em
   * 21/09: "mercado de trabalho" punha na frente o *Série C: Art déco
   * e Mercado Municipal* — o prédio do mercado no nome, e "trabalho" solto na
   * fala — e deixava atrás o *Técnico integrado*, que tem um capítulo chamado
   * "O técnico abre as portas do mercado de trabalho". Somar termo a termo não
   * vê que os dois estão no mesmo lugar.
   *
   * O título ganha, UMA vez, o peso do lugar mais forte em que TODOS os termos
   * aparecem juntos: um campo dele, um capítulo, um bloco da fala. Com um termo
   * só, não há o que juntar. */
  function juntosNosCampos(d, casadas) {
    var melhor = 0;
    for (var i = 0; i < CAMPOS_DO_TITULO.length; i++) {
      var campo = CAMPOS_DO_TITULO[i];
      if (PESOS[campo] <= melhor) continue;
      var todos = true;
      for (var k = 0; k < casadas.length && todos; k++) todos = qualidade(d.campos[campo], casadas[k]) > 0;
      if (todos) melhor = PESOS[campo];
    }
    return melhor;
  }

  /* A busca: todos os termos (AND), cada um podendo casar num campo diferente.
   *
   * A NOTA de um título é a soma, termo a termo, do melhor campo em que ele
   * casou: o peso do campo vezes o jeito de casar. É o que põe "Título X
   * militar" antes do título que só fala de bombeiros na sinopse. Empate fica
   * na ordem de `App.ordenar` — a de hoje, por série —, e é por isso que a
   * lista vazia e a consulta vazia saem exatamente como saíam.
   *
   * Os TRECHOS (ver `notaDoTrecho`) saem só de título que respondeu, e vêm do
   * melhor para o pior; empate fica na ordem em que o título dele saiu, e
   * dentro do vídeo, no tempo.
   *
   * Devolve { termos, casadas, titulos: [{ item, nota }], trechos: [{ item,
   * tipo, inicio, texto, capitulo, nota }] }. `casadas` é o que cada termo
   * achou — é com elas que a tela marca a palavra no trecho. */
  function procurar(ind, consulta) {
    var ts = termos(consulta);
    var casadas = corrigirPelaVizinha(ind, ts.map(function (t) { return casar(ind, t); }));
    var titulos = [];
    var achados = [];

    ind.docs.forEach(function (d) {
      var nota = 0;
      var contexto = [];
      for (var k = 0; k < casadas.length; k++) {
        var melhor = 0, doTitulo = 0;
        for (var i = 0; i < CAMPOS_DO_TITULO.length; i++) {
          var campo = CAMPOS_DO_TITULO[i];
          var q = qualidade(d.campos[campo], casadas[k]);
          if (q > doTitulo) doTitulo = q;
          if (PESOS[campo] * q > melhor) melhor = PESOS[campo] * q;
        }
        if (melhor < PESOS.capitulo) {
          var nosCaps = PESOS.capitulo * qualidadeNosTrechos(d.capitulos, casadas[k]);
          if (nosCaps > melhor) melhor = nosCaps;
        }
        /* A fala só é percorrida quando o de cima vale menos do que ela pode
         * valer: é o menor peso, e percorrer os blocos para somar 5 a quem já
         * tem 100 é conta à toa. */
        if (melhor < PESOS.fala) {
          var naFala = PESOS.fala * qualidadeNosTrechos(d.falas, casadas[k]);
          if (naFala > melhor) melhor = naFala;
        }
        if (!melhor) return;
        contexto.push(doTitulo);
        nota += melhor;
      }
      var titulo = { item: d.item, nota: nota, pos: d.pos };
      titulos.push(titulo);
      if (!casadas.length) return;

      var juntos = casadas.length > 1 ? juntosNosCampos(d, casadas) : 0;
      var capsAchados = [];

      d.capitulos.forEach(function (c) {
        var n = notaDoTrecho(c.palavras, casadas, contexto, 1.2);
        if (!n) return;
        if (n.todos && casadas.length > 1 && PESOS.capitulo > juntos) juntos = PESOS.capitulo;
        var trecho = { item: d.item, tipo: 'capitulo', inicio: c.inicio, texto: c.titulo, capitulo: c.titulo, nota: n.nota };
        capsAchados.push(trecho);
        achados.push(trecho);
      });

      /* Os blocos da fala (fase 3), com o capítulo em que cada um cai — é o
       * que diz, na linha do trecho, de que parte do vídeo aquela frase é.
       *
       * O CAPÍTULO E O BLOCO QUE COMEÇAM JUNTOS são o mesmo momento, e isso é
       * comum: os capítulos foram escritos lendo estes mesmos blocos de 30 s
       * (`capitulos.mjs --transcricao`). Medido em 21/09: "mercado de
       * trabalho" mostrava duas linhas em 2:42 no mesmo vídeo, e "vestibular",
       * uma em 1:48 (o bloco) e outra em 1:50 (o capítulo "Os 13
       * vestibulares", acertado no segundo por quem o escreveu). A até
       * `PERTO` segundos um do outro, fica um trecho só: no segundo do
       * CAPÍTULO, que foi escolhido por gente, com a frase do bloco e a nota
       * do melhor dos dois. */
      d.falas.forEach(function (b) {
        var n = notaDoTrecho(b.palavras, casadas, contexto, 1);
        if (!n) return;
        if (n.todos && casadas.length > 1 && PESOS.fala > juntos) juntos = PESOS.fala;
        var mesmo = null;
        capsAchados.forEach(function (c) {
          var dist = Math.abs(c.inicio - b.inicio);
          if (c.tipo === 'capitulo' && dist <= PERTO && (!mesmo || dist < Math.abs(mesmo.inicio - b.inicio))) mesmo = c;
        });
        if (mesmo) {
          mesmo.tipo = 'fala';
          mesmo.texto = b.texto;
          if (n.nota > mesmo.nota) mesmo.nota = n.nota;
          return;
        }
        var ic = App.capituloEm(d.capitulos, b.inicio);
        achados.push({
          item: d.item, tipo: 'fala', inicio: b.inicio, texto: b.texto,
          capitulo: ic >= 0 ? d.capitulos[ic].titulo : '', nota: n.nota
        });
      });

      titulo.nota += juntos;
    });

    titulos.sort(function (a, b) { return b.nota - a.nota || a.pos - b.pos; });
    var lugar = Object.create(null);
    titulos.forEach(function (t, i) { lugar[t.item.id] = i; });
    achados.sort(function (a, b) {
      return b.nota - a.nota || lugar[a.item.id] - lugar[b.item.id] || a.inicio - b.inicio;
    });

    return {
      termos: ts,
      casadas: casadas,
      titulos: titulos.map(function (t) { return { item: t.item, nota: t.nota }; }),
      trechos: achados
    };
  }

  /* ------------------------------------------------------ a junção (fase 4)
   *
   * O que o SENTIDO devolveu — [{ videoId, tipo, inicio, nota }], do mais
   * perto para o mais longe, já sem o que está fora do ar e sem o que ficou
   * abaixo do corte (o servidor faz os dois) — junto com a resposta por
   * palavra, na FUSÃO POR POSIÇÃO (RRF):
   *
   *   - o que casou por palavra vem PRIMEIRO, sempre. Dentro dele, a ordem é
   *     a soma de 1/(60 + posição) nas duas listas: quem as duas põem no alto
   *     sobe. O 60 é o da RRF de sempre, e é ele que deixa uma posição a mais
   *     ou a menos pesar pouco;
   *   - o que SÓ casou por sentido vem DEPOIS, na ordem do sentido, com
   *     `porSentido` — a tela escreve "Sobre o assunto" e não marca palavra
   *     nenhuma, porque não há palavra a marcar.
   *
   * Nos títulos, vale a primeira aparição de cada vídeo em qualquer tipo —
   * fala, capítulo ou sinopse. Nos trechos, só a fala e o capítulo: a sinopse
   * é do vídeo inteiro, e não tem momento. O trecho do sentido a até `PERTO`
   * segundos de um trecho por palavra do mesmo vídeo é o MESMO momento, e não
   * vira outra linha.
   *
   * Sem sentido — o teto do mês, o binding desligado, a rede —, devolve a
   * resposta por palavra do jeito que ela chegou: é o "a busca literal é
   * idêntica" da prova da fase. */
  var K_RRF = 60;

  /* A pergunta ao sentido como o SERVIDOR a lê (`AppIndice.consultaDoSentido`, no
   * indice-core.js — há teste amarrando as duas): em minúsculas, sem espaço
   * sobrando, com no máximo 120 caracteres, e o acento fica. É a chave da
   * memória da tela: "Fração" e "fração " são a mesma pergunta. `null`
   * quando não há 3 letras — abaixo disso não se pergunta. */
  function perguntaDoSentido(termo) {
    var q = String(termo == null ? '' : termo).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    return (q.match(/[\p{L}\p{N}]/gu) || []).length >= 3 ? q : null;
  }

  function trechoDoSentido(d, h) {
    var i;
    if (h.tipo === 'c') {
      for (i = 0; i < d.capitulos.length; i++) {
        var c = d.capitulos[i];
        if (c.inicio === h.inicio) return { item: d.item, tipo: 'capitulo', inicio: c.inicio, texto: c.titulo, capitulo: c.titulo };
      }
      return null;
    }
    if (h.tipo === 'f') {
      /* Sem a fala carregada o bloco não tem texto para mostrar: ele entra
       * quando ela chegar, no redesenho. */
      for (i = 0; i < d.falas.length; i++) {
        var b = d.falas[i];
        if (b.inicio !== h.inicio) continue;
        var ic = App.capituloEm(d.capitulos, b.inicio);
        return { item: d.item, tipo: 'fala', inicio: b.inicio, texto: b.texto, capitulo: ic >= 0 ? d.capitulos[ic].titulo : '' };
      }
    }
    return null;
  }

  /* O BLOCO CURTO DEMAIS NÃO DIZ ASSUNTO. Achado ao medir o corte em 22/09:
   * "previsão do tempo para amanhã" passou do corte com 0,583 num bloco que
   * dizia só "no futuro." — o fim de um vídeo. Um vetor de duas palavras é
   * genérico e parece com muita coisa. São 10 dos 995 blocos no ar, todos
   * despedidas ("Até a próxima!"), e o sentido os ignora; a busca por
   * palavra continua achando-os. */
  var POUCAS_PALAVRAS = 8;

  function blocoCurto(d, h) {
    if (h.tipo !== 'f') return false;
    for (var i = 0; i < d.falas.length; i++) {
      if (d.falas[i].inicio === h.inicio) return d.falas[i].palavras.lista.length < POUCAS_PALAVRAS;
    }
    return false;
  }

  function perto(lista, id, inicio) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].item.id === id && Math.abs(lista[i].inicio - inicio) <= PERTO) return i;
    }
    return -1;
  }

  function juntar(ind, literal, sentido) {
    if (!sentido || !sentido.length) return literal;
    var porVideo = Object.create(null);
    ind.docs.forEach(function (d) {
      var v = App.idDoVideo(d.item);
      if (v) porVideo[v] = d;
    });

    /* A posição de cada título e de cada trecho na lista do sentido. */
    var lugarDoTitulo = Object.create(null);
    var titulosDoSentido = [];
    var trechosDoSentido = [];
    sentido.forEach(function (h) {
      var d = porVideo[h.videoId];
      if (!d || blocoCurto(d, h)) return;
      if (!(d.item.id in lugarDoTitulo)) {
        lugarDoTitulo[d.item.id] = titulosDoSentido.length + 1;
        titulosDoSentido.push(d);
      }
      var t = trechoDoSentido(d, h);
      if (t && perto(trechosDoSentido, t.item.id, t.inicio) < 0) trechosDoSentido.push(t);
    });

    var rrf = function (lugarPalavra, lugarSentido) {
      return 1 / (K_RRF + lugarPalavra) + (lugarSentido ? 1 / (K_RRF + lugarSentido) : 0);
    };

    var jaTem = Object.create(null);
    var titulos = literal.titulos.map(function (t, i) {
      jaTem[t.item.id] = true;
      return { t: t, i: i, n: rrf(i + 1, lugarDoTitulo[t.item.id]) };
    }).sort(function (a, b) { return b.n - a.n || a.i - b.i; }).map(function (x) { return x.t; });
    titulosDoSentido.forEach(function (d) {
      if (!jaTem[d.item.id]) titulos.push({ item: d.item, nota: 0, porSentido: true });
    });

    var usados = [];
    var trechos = literal.trechos.map(function (t, i) {
      var j = perto(trechosDoSentido, t.item.id, t.inicio);
      if (j >= 0) usados[j] = true;
      return { t: t, i: i, n: rrf(i + 1, j >= 0 ? j + 1 : 0) };
    }).sort(function (a, b) { return b.n - a.n || a.i - b.i; }).map(function (x) { return x.t; });
    trechosDoSentido.forEach(function (t, j) {
      if (!usados[j]) trechos.push({ item: t.item, tipo: t.tipo, inicio: t.inicio, texto: t.texto, capitulo: t.capitulo, nota: 0, porSentido: true });
    });

    return { termos: literal.termos, casadas: literal.casadas, titulos: titulos, trechos: trechos };
  }

  /* --------------------------------------------------------------- a marca */

  /* A palavra, como o TEXTO a escreve: com acento, maiúscula e hífen. Corta
   * onde a `palavras()` corta, para as duas contarem as mesmas palavras. */
  var ESCRITAS = /[\p{L}\p{M}\p{N}]+/gu;

  function casouAlguma(p, casadas) {
    for (var i = 0; i < casadas.length; i++) if (casadas[i].mapa[p]) return true;
    return false;
  }

  /* As palavras de um texto que a consulta achou, para a tela marcar.
   * Devolve PEDAÇOS — [{ texto, marca }] — e quem desenha põe cada um num nó
   * de texto ou num <mark>. Nunca HTML: a fala é texto de ASR, e um "<" dito
   * pela legenda não pode virar tag na página. Marca a palavra
   * inteira, também quando ela casou pelo começo ou por um pedaço. */
  function marcar(texto, casadas) {
    var s = String(texto == null ? '' : texto);
    var pedacos = [];
    var ultimo = 0;
    if (casadas && casadas.length) {
      ESCRITAS.lastIndex = 0;
      var m;
      while ((m = ESCRITAS.exec(s))) {
        var formas = palavras(m[0]);
        var casou = false;
        for (var i = 0; i < formas.length && !casou; i++) casou = casouAlguma(formas[i], casadas);
        if (!casou) continue;
        if (m.index > ultimo) pedacos.push({ texto: s.slice(ultimo, m.index), marca: false });
        pedacos.push({ texto: m[0], marca: true });
        ultimo = m.index + m[0].length;
      }
    }
    if (ultimo < s.length || !pedacos.length) pedacos.push({ texto: s.slice(ultimo), marca: false });
    return pedacos;
  }

  /* A FRASE DO TRECHO DA FALA: ~120 caracteres em volta da primeira palavra
   * marcada, cortados na palavra, com reticências onde cortou. Um bloco
   * de 30 s tem até 763 caracteres — o maior, medido em 21/09 —, e a linha do
   * trecho mostra o pedaço que responde. Sem marca nenhuma (o trecho que só
   * casou por sentido, na fase 4), o começo do bloco.
   *
   * Devolve pedaços, como o `marcar`: nada de HTML. */
  function frase(texto, casadas, largura) {
    var s = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    var max = typeof largura === 'number' && largura > 0 ? largura : 120;
    var pedacos = marcar(s, casadas);
    if (s.length <= max) return pedacos;

    var alvo = -1, fimAlvo = -1, pos = 0;
    for (var i = 0; i < pedacos.length; i++) {
      if (pedacos[i].marca) { alvo = pos; fimAlvo = pos + pedacos[i].texto.length; break; }
      pos += pedacos[i].texto.length;
    }

    /* Um terço antes da palavra e o resto depois: é o que dá contexto sem
     * esconder a palavra atrás de uma frase inteira que veio antes. */
    var ini = alvo < 0 ? 0 : Math.max(0, alvo - Math.round(max / 3));
    var fim = Math.min(s.length, ini + max);
    if (fim - ini < max) ini = Math.max(0, fim - max);
    if (fimAlvo > fim) fim = fimAlvo;
    if (ini > 0) {
      var esp = s.indexOf(' ', ini);
      if (esp >= 0 && (alvo < 0 || esp < alvo)) ini = esp + 1;
    }
    if (fim < s.length) {
      var esp2 = s.lastIndexOf(' ', fim);
      if (esp2 > ini && esp2 >= fimAlvo) fim = esp2;
    }

    var saida = [];
    var poe = function (t, m) {
      if (!t) return;
      var ultimo = saida[saida.length - 1];
      if (ultimo && !ultimo.marca && !m) ultimo.texto += t;
      else saida.push({ texto: t, marca: m });
    };
    if (ini > 0) poe('…', false);
    pos = 0;
    pedacos.forEach(function (p) {
      var a = pos, b = pos + p.texto.length;
      pos = b;
      var x = Math.max(a, ini), y = Math.min(b, fim);
      if (x < y) poe(p.texto.slice(x - a, y - a), p.marca);
    });
    if (fim < s.length) poe('…', false);
    return saida;
  }

  /* Os trechos AGRUPADOS POR VÍDEO, até `porVideo` à mostra em cada um — o
   * resto fica atrás do "mais N neste vídeo". Os grupos saem na ordem do
   * melhor trecho de cada um. À mostra ficam os melhores, e na tela eles vêm
   * na ORDEM DO VÍDEO: é assim que se lê "onde, neste vídeo, falam disso". O
   * que só casou por sentido (fase 4) vem depois do que casou por palavra, no
   * mesmo vídeo. */
  function agruparTrechos(trechos, porVideo) {
    var n = typeof porVideo === 'number' && porVideo > 0 ? porVideo : 3;
    var grupos = [];
    var porId = Object.create(null);
    (trechos || []).forEach(function (t) {
      var g = porId[t.item.id];
      if (!g) {
        g = porId[t.item.id] = { item: t.item, todos: [] };
        grupos.push(g);
      }
      g.todos.push(t);
    });
    var naTela = function (a, b) { return (a.porSentido ? 1 : 0) - (b.porSentido ? 1 : 0) || a.inicio - b.inicio; };
    return grupos.map(function (g) {
      return {
        item: g.item,
        total: g.todos.length,
        visiveis: g.todos.slice(0, n).sort(naTela),
        resto: g.todos.slice(n).sort(naTela),
        /* Os mesmos, todos juntos e na ordem da tela — é o que o "mais N"
         * abre. */
        todos: g.todos.slice().sort(naTela)
      };
    });
  }

  var AppBusca = {
    PESOS: PESOS,
    palavras: palavras,
    termos: termos,
    raiz: raizDe,
    distancia: distancia,
    lerFala: lerFala,
    indice: indice,
    procurar: procurar,
    perguntaDoSentido: perguntaDoSentido,
    juntar: juntar,
    marcar: marcar,
    frase: frase,
    agruparTrechos: agruparTrechos
  };

  raiz.AppBusca = AppBusca;
  if (typeof module !== 'undefined' && module.exports) module.exports = AppBusca;
})(typeof globalThis !== 'undefined' ? globalThis : this);
