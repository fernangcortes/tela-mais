/* mesa-base.js — o chão da mesa: utilidades, sessão, API, estado e rascunho.
 *
 * A mesa é o /admin em três colunas. Este arquivo não
 * desenha nada; quem desenha são mesa-painel.js, mesa-telas.js e mesa.js.
 *
 * A AccessKey do Bunny não chega aqui: o envio de vídeo usa a assinatura de uso
 * único de /api/upload-token, como o /admin sempre usou. Se algum dia ela
 * aparecer nesta tela, é bug grave. */
(function () {
  'use strict';
  var M = window.MESA = window.MESA || {};

  /* ------------------------------------------------------------ utilidades */

  M.$ = function (id) { return document.getElementById(id); };

  /* h('div', { class: 'x', text: 'y', onclick: fn }, filho, [filhos]) */
  M.h = function (tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'tabIndex' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) anexar(el, arguments[i]);
    return el;
  };
  function anexar(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { anexar(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }

  /* Ícone é <path> em currentColor: sem fonte de ícone, sem CDN. */
  var ICONES = {
    site: 'M3 5h18v14H3z M3 9h18', tabela: 'M3 5h18v14H3z M3 10h18 M9 10v9',
    enviar: 'M12 16V4 M7 9l5-5 5 5 M4 20h16', player: 'M8 5l11 7-11 7z',
    computador: 'M3 5h18v11H3z M8 20h8 M12 16v4', tablet: 'M6 3h12v18H6z M11 18h2', celular: 'M8 3h8v18H8z M11 18h2',
    x: 'M6 6l12 12 M18 6 6 18', dir: 'M9 5l7 7-7 7', esq: 'M15 5l-7 7 7 7',
    menu: 'M4 7h16 M4 12h16 M4 17h16', painel: 'M3 5h18v14H3z M15 5v14', recolher: 'M11 6l-6 6 6 6 M19 6l-6 6 6 6',
    desfazer: 'M9 7 4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3', check: 'M5 12l5 5 9-10',
    imagem: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4', busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
    alerta: 'M12 4 21 19H3z M12 10v4 M12 16.8v.2', olho: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    sair: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10', abrir: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
    contas: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20c0-3.4 3-5.2 7-5.2s7 1.8 7 5.2 M17 4.8a3.5 3.5 0 0 1 0 6.4 M18 15c2.4.5 4 2.2 4 5',
    conta: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M5 20c0-3.6 3-5.5 7-5.5s7 1.9 7 5.5',
    recarregar: 'M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5',
    estrutura: 'M3 5h18 M3 10h12 M3 15h16 M3 20h9'
  };
  M.ic = function (nome) {
    var span = document.createElement('span');
    span.className = 'ic';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONES[nome] + '"/></svg>';
    return span;
  };

  var tempoAviso = 0;
  M.toast = function (msg, acao) {
    var t = M.$('aviso');
    t.textContent = '';
    t.appendChild(M.h('span', { text: msg }));
    if (acao) {
      t.appendChild(M.h('button', { type: 'button', class: 'aviso-acao', text: acao.rotulo,
        onclick: function () { t.hidden = true; acao.fazer(); } }));
    }
    t.hidden = false;
    clearTimeout(tempoAviso);
    tempoAviso = setTimeout(function () { t.hidden = true; }, acao ? 7000 : 3500);
  };

  /* ---------------------------------------------------------------- sessão */

  var CHAVE_SESSAO = App.PREFIXO + '_admin_token';

  /* Quem está na mesa. O superadmin é a senha do ambiente e pode tudo; as
   * outras contas trazem do login as permissões que o superadmin escolheu.
   * O usuário é parte da chave do rascunho: duas pessoas no mesmo navegador
   * não veem o rascunho uma da outra. */
  M.sessao = { token: null, expira: 0, usuario: 'superadmin', nome: 'Superadmin', super: true, permissoes: [] };

  M.guardarSessao = function (dados) {
    M.sessao.token = dados.token;
    M.sessao.expira = dados.expira;
    M.sessao.usuario = dados.usuario || 'superadmin';
    M.sessao.nome = dados.nome || M.sessao.usuario;
    M.sessao.super = dados.super === true;
    M.sessao.permissoes = dados.permissoes || [];
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(dados)); } catch (e) { /* aba anônima: só em memória */ }
  };

  M.recuperarSessao = function () {
    try {
      var dados = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
      if (!dados || !dados.token || dados.expira <= Math.floor(Date.now() / 1000)) return false;
      M.guardarSessao(dados);
      return true;
    } catch (e) { return false; }
  };

  /* As permissões vêm do login, mas podem ter mudado desde então: o superadmin
   * tira uma permissão e a mesa aberta continuaria mostrando o botão. A mesa
   * relê a conta ao abrir; quem recusa de verdade continua sendo o servidor. */
  M.confirmarConta = function () {
    return M.api('/api/conta').then(function (c) {
      M.sessao.usuario = c.usuario;
      M.sessao.nome = c.nome || c.usuario;
      M.sessao.super = c.super === true;
      M.sessao.permissoes = c.permissoes || [];
      return c;
    });
  };

  M.pode = function (permissao) {
    return App.contaPode({ super: M.sessao.super, permissoes: M.sessao.permissoes }, permissao);
  };

  M.encerrarSessao = function () {
    M.sessao.token = null;
    M.sessao.expira = 0;
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) {}
    if (M.aoSair) M.aoSair();
  };

  M.api = function (caminho, opcoes) {
    var o = opcoes || {};
    var cabecalhos = Object.assign({ Accept: 'application/json' }, o.headers || {});
    if (M.sessao.token) cabecalhos.Authorization = 'Bearer ' + M.sessao.token;
    if (o.body && typeof o.body === 'string' && !cabecalhos['content-type']) cabecalhos['content-type'] = 'application/json';
    return fetch(caminho, Object.assign({}, o, { headers: cabecalhos })).then(function (r) {
      if (r.status === 401 && M.sessao.token) {
        M.encerrarSessao();
        throw new Error('A sessão expirou. Entre de novo; o rascunho continua guardado.');
      }
      return r.json().catch(function () { return {}; }).then(function (corpo) {
        if (!r.ok) {
          var e = new Error(corpo.erro || ('erro ' + r.status));
          e.status = r.status;
          e.corpo = corpo;
          throw e;
        }
        return corpo;
      });
    });
  };

  /* ---------------------------------------------------------------- estado */

  M.st = {
    servidor: null,        /* o último catálogo lido por ?completo=1 */
    rascunho: [],          /* { alvo, campo, antes, depois } */
    conflitos: [],
    versao: 0,             /* sobe a cada mudança: invalida o catálogo efetivo guardado */
    publicando: false,
    tela: 'site',
    sel: '',               /* 'item:<id>' · 'prateleira:<id>' · 'marca' · 'rodape' */
    aba: 'editar',
    disp: 'computador',
    rota: '#/',
    semRascunho: false,    /* a prévia mostra o site no ar */
    verRascunho: false,
    filtro: 'todos',
    ordem: '',             /* coluna batida no cabeçalho; '' = a ordem do acervo */
    ordemDesc: false,
    busca: '',
    marcados: {},
    rail: false
  };

  var efetivoGuardado = { versao: -1, valor: null };
  M.efetivo = function () {
    if (!M.st.servidor) return null;
    if (efetivoGuardado.versao !== M.st.versao) {
      efetivoGuardado = { versao: M.st.versao, valor: App.aplicarRascunho(M.st.servidor, M.st.rascunho) };
    }
    return efetivoGuardado.valor;
  };

  M.item = function (id, doServidor) {
    var cat = doServidor ? M.st.servidor : M.efetivo();
    return cat ? App.porId(cat.itens, id) : null;
  };

  /* A estrutura da chegada (M4), já com o rascunho por cima e SANEADA — é a
   * mesma forma que o site recebe do servidor, então a tela nunca mostra um
   * estado que o site não desenharia. */
  M.site = function (doServidor) {
    var cat = doServidor ? M.st.servidor : M.efetivo();
    return App.siteSaneado(cat && cat.site);
  };

  /* Uma escrita da estrutura é UMA mudança no rascunho, com o objeto inteiro —
   * `prateleiras`, `classes` e `textos` são mapas, e é contra o mapa que o
   * Publicar confere. As funções que montam o mapa novo são puras e moram no
   * core (`comPrateleira`, `comClasse`, `comTexto`, `comOrdemPrateleiras`). */
  M.mudarSite = function (campo, valor, opcoes) {
    M.mudar('site', campo, valor, opcoes);
  };

  /* As escritas da estrutura. Moram aqui, e não na tela, porque são as MESMAS
   * para os dois caminhos: a prateleira clicada na prévia (painel da direita) e
   * a lista inteira da tela Estrutura. Montar o mapa em dois lugares era o
   * jeito de as duas telas discordarem com o tempo.
   *
   * O `.prateleiras` (e o `.classes`, e o `.textos`) no fim de cada linha NÃO
   * é enfeite: as funções do core recebem e devolvem o `site` INTEIRO, para se
   * compor umas com as outras, e o rascunho guarda UM CAMPO. Sem isso o campo
   * `prateleiras` guardava um `site` dentro dele, o `aplicarRascunho` montava
   * `site.prateleiras.prateleiras` e a prévia não mudava — sem erro nenhum na
   * tela. Foi o defeito que a conferência no runtime achou na M4. */
  M.renomearPrateleira = function (id, titulo, opcoes) {
    M.mudarSite('prateleiras', App.comPrateleira(M.site(), id, { titulo: titulo }).prateleiras, opcoes || { semPainel: true });
  };

  M.esconderPrateleira = function (id, esconder) {
    M.mudarSite('prateleiras', App.comPrateleira(M.site(), id, { escondida: esconder }).prateleiras);
  };

  /* Mover grava a ordem de TODAS as prateleiras. Gravar só as duas que
   * trocaram poria as duas na frente de todas as outras — quem tem ordem
   * escolhida vem antes de quem não tem (App.prateleiras). */
  M.moverPrateleira = function (id, passo) {
    var ids = App.prateleiras(M.efetivo().itens, M.site()).map(function (p) { return p.id; });
    var i = ids.indexOf(id), j = i + passo;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids[i] = ids[j];
    ids[j] = id;
    M.mudarSite('prateleiras', App.comOrdemPrateleiras(M.site(), ids).prateleiras);
  };

  M.padraoDaPrateleira = function (id) {
    M.mudarSite('prateleiras', App.comPrateleira(M.site(), id, { titulo: '', ordem: null, escondida: false }).prateleiras);
  };

  M.mudarClasseDaSerie = function (serie, classe) {
    M.mudarSite('classes', App.comClasse(M.site(), serie, classe).classes);
  };

  /* A APRESENTAÇÃO DA SÉRIE. Mexer nela pela mesa
   * é REVISÁ-LA — o texto, o começo, os momentos ou os temas: é uma pessoa
   * escolhendo, e o `series.mjs` nunca escreve por cima de `revisada`. A
   * exceção é o texto que volta a ser o do servidor, que devolve a origem que
   * ele tinha — a mesma regra da sinopse (`M.mudarSinopse`). */
  M.mudarSerie = function (nome, mudanca, opcoes) {
    var noServidor = M.site(true).series[nome] || {};
    var m = Object.assign({}, mudanca);
    if (!('origem' in m)) {
      var soTexto = Object.keys(m).length === 1 && 'sobre' in m;
      var voltou = soTexto && String(m.sobre || '').trim() === String(noServidor.sobre || '').trim();
      m.origem = voltou && noServidor.origem ? noServidor.origem : 'revisada';
    }
    M.mudarSite('series', App.comSerie(M.site(), nome, m).series, opcoes || { semPainel: true, semCentro: true });
  };

  /* "Voltar ao gerado" APAGA a entrada: a
   * página volta a ser a de antes, e o script escreve de novo na próxima vez. */
  M.voltarSerieAoGerado = function (nome) {
    M.mudarSite('series', App.comSerie(M.site(), nome, null).series);
  };

  M.mudarTextoDoSite = function (chave, valor, opcoes) {
    M.mudarSite('textos', App.comTexto(M.site(), chave, valor).textos, opcoes || { semPainel: true });
  };

  /* -------------------------------------------------------- filas (M3)
   *
   * Cada fila é uma "tela" (M.st.tela) a mais: 'fila-sinopses' e
   * 'fila-semsinopse' abrem a ficha do site no quadro (mesa.js trata como
   * NO_QUADRO); 'fila-pendencias' é tela própria, porque pode mostrar duas
   * fichas lado a lado — não cabe no quadro de uma só. */
  M.FILAS = {
    'fila-sinopses': { rotulo: 'Sinopses a revisar', icone: 'busca', permissao: 'conteudo',
      itens: function (itens) { return App.filaSinopses(itens); } },
    'fila-pendencias': { rotulo: 'Pendências', icone: 'alerta', permissao: 'conteudo',
      itens: function (itens) { return App.filaPendencias(itens); } },
    'fila-semsinopse': { rotulo: 'Sem sinopse', icone: 'imagem', permissao: 'conteudo',
      itens: function (itens) { return App.filaSemSinopse(itens); } }
  };

  M.filaItens = function (tipo) {
    var def = M.FILAS[tipo], cat = M.efetivo();
    return def && cat ? def.itens(cat.itens) : [];
  };

  /* A posição vem da SELEÇÃO atual (`M.st.sel`), não de um índice guardado à
   * parte — assim ela nunca desalinha do que está de fato aberto no quadro. */
  M.filaPosicao = function (tipo) {
    if (!M.FILAS[tipo]) return null;
    var lista = M.filaItens(tipo);
    var id = M.st.sel.indexOf('item:') === 0 ? M.st.sel.slice(5) : '';
    var indice = lista.findIndex(function (i) { return i.id === id; });
    return { tipo: tipo, lista: lista, indice: indice };
  };

  M.carregarServidor = function () {
    return M.api('/api/catalogo?completo=1').then(function (d) {
      d.itens = Array.isArray(d.itens) ? d.itens : [];
      d.ajustes = d.ajustes || {};
      M.st.servidor = d;
      M.st.versao++;
      return d;
    });
  };

  /* ----------------------------------------------------------------- busca
   *
   * A MESA PÕE OS TÍTULOS NA BUSCA SOZINHA: no envio de um título novo, com o `.srt` que ela acabou de
   * ler, e depois do Publicar, para o título cuja sinopse ou cujo nome
   * mudaram — é a sinopse que o sentido compara. Ninguém aperta nada.
   *
   * Quem condensa é AQUI, e não a função: ler e condensar a legenda mais
   * longa custa metade dos 10 ms de CPU que ela tem. O código é o mesmo do
   * script (`indice-core.js`).
   *
   * UM VÍDEO POR VEZ, com um segundo entre um e o seguinte: a chamada que
   * fecha um vídeo grava duas chaves do KV, e cada chave aceita uma escrita
   * por segundo. Por isso a fila. */
  M.busca = {
    manifesto: null,   /* o que o GET /api/busca/indexar devolveu */
    sentido: false,    /* o Workers AI e o Vectorize estão ligados neste ambiente? */
    lendo: false,
    erro: '',
    fila: Promise.resolve(),
    andando: ''        /* o que a fila está fazendo, para a tela dizer */
  };

  M.carregarBusca = function () {
    if (M.busca.lendo) return Promise.resolve(M.busca.manifesto);
    M.busca.lendo = true;
    return M.api('/api/busca/indexar').then(function (r) {
      M.busca.manifesto = r;
      M.busca.sentido = r.sentido === true;
      M.busca.erro = '';
    }).catch(function (e) {
      M.busca.manifesto = null;
      M.busca.erro = e.message;
    }).then(function () {
      M.busca.lendo = false;
      if (M.aoMudar) M.aoMudar({ semCentro: true });
      return M.busca.manifesto;
    });
  };

  /* A legenda de um vídeo, lida DIRETO da pull zone: ela responde
   * `Access-Control-Allow-Origin: *`, e a mesa está no domínio permitido —
   * é o mesmo caminho do MP4 do seletor de capa. `null` quando o vídeo não
   * tem legenda (404), que é caso previsto. */
  M.legendaDoVideo = function (videoId) {
    var pz = (M.st.servidor.config || {}).pullzone;
    if (!pz) return Promise.reject(new Error('o catálogo não trouxe a pull zone'));
    var host = String(pz).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return fetch('https://' + host + '/' + encodeURIComponent(videoId) + '/captions/pt.vtt').then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('a legenda respondeu ' + r.status);
      return r.text();
    });
  };

  /* Põe um vídeo na busca: os vetores em lotes de `AppIndice.LIMITES.vetores` (10,
   * medido no ar) e, por fim, a chamada
   * que grava a fala e o manifesto. Entra na fila; devolve a promessa deste
   * vídeo, e a fila continua mesmo se ele falhar. */
  M.indexarBusca = function (videoId, conjuntos) {
    var fazer = function () {
      var passo = Promise.resolve();
      if (M.busca.sentido) {
        AppIndice.lotes(AppIndice.vetoresDosConjuntos(conjuntos), AppIndice.LIMITES.vetores).forEach(function (lote) {
          passo = passo.then(function () {
            return M.api('/api/busca/indexar', { method: 'POST', body: JSON.stringify({ videoId: videoId, vetores: lote }) });
          });
        });
      }
      return passo.then(function () {
        var corpo = { videoId: videoId, fim: true, sentido: M.busca.sentido };
        ['fala', 'capitulos', 'sinopse'].forEach(function (k) {
          if (conjuntos[k] !== undefined) corpo[k] = conjuntos[k];
        });
        return M.api('/api/busca/indexar', { method: 'POST', body: JSON.stringify(corpo) });
      });
    };
    var meu = M.busca.fila.then(fazer, fazer);
    M.busca.fila = meu.catch(function () { /* o próximo da fila não paga pelo erro deste */ })
      .then(function () { return new Promise(function (pronto) { setTimeout(pronto, 1100); }); });
    return meu;
  };

  /* O botão da visão geral: põe na busca quem ficou fora, e refaz os vetores
   * de quem mudou. A legenda vem da pull zone; a sinopse e os capítulos, do
   * catálogo no ar. */
  M.porNaBusca = function () {
    if (M.busca.andando) return Promise.resolve(null);
    var conta = AppIndice.foraDaBusca(M.st.servidor.itens, M.busca.manifesto, M.busca.sentido);
    var lista = conta.semFala.concat(conta.desatualizados);
    if (!lista.length) { M.toast('Nada fora da busca.'); return Promise.resolve(null); }

    var feitos = 0;
    var falhas = [];
    var andar = function (i) {
      if (i >= lista.length) return Promise.resolve();
      var item = lista[i];
      var videoId = item.fonte.videoId;
      M.busca.andando = 'Pondo na busca: ' + (i + 1) + ' de ' + lista.length;
      if (M.aoMudar) M.aoMudar({ semCentro: true });
      var guardado = ((M.busca.manifesto && M.busca.manifesto.videos) || {})[videoId] || {};
      /* A fala só é relida quando falta, ou quando os vetores dela não
       * existem: baixar 67 legendas para trocar uma sinopse seria absurdo. */
      var precisaDaFala = !guardado.fala || (M.busca.sentido && guardado.fala.sentido !== true);
      return (precisaDaFala ? M.legendaDoVideo(videoId) : Promise.resolve(undefined))
        .then(function (legenda) {
          var conjuntos = AppIndice.conjuntosDoItem(item);
          if (precisaDaFala) conjuntos.fala = legenda ? AppIndice.blocosDaLegenda(legenda) : [];
          return M.indexarBusca(videoId, conjuntos);
        })
        .then(function () { feitos++; }, function (e) { falhas.push(item.titulo + ': ' + e.message); })
        .then(function () { return andar(i + 1); });
    };

    return andar(0).then(function () {
      M.busca.andando = '';
      return M.carregarBusca();
    }).then(function () {
      M.toast(feitos + (feitos === 1 ? ' título entrou' : ' títulos entraram') + ' na busca' +
        (falhas.length ? ' · ' + falhas.length + ' falharam: ' + falhas[0] : '.'));
    });
  };

  /* -------------------------------------------------------------- rascunho
   *
   * Guardado no navegador, por usuário: fechar a aba não perde nada, e o KV
   * só é tocado ao publicar. */

  function chaveRascunho() { return App.PREFIXO + '_mesa_rascunho:' + M.sessao.usuario; }

  M.lerRascunhoGuardado = function () {
    try {
      var lista = JSON.parse(localStorage.getItem(chaveRascunho()) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (e) { return []; }
  };

  M.guardarRascunho = function () {
    try {
      if (M.st.rascunho.length) localStorage.setItem(chaveRascunho(), JSON.stringify(M.st.rascunho));
      else localStorage.removeItem(chaveRascunho());
    } catch (e) { /* sem storage: o rascunho vive enquanto a aba viver */ }
  };

  /* O nada, para o rascunho. O mapa VAZIO entra na conta desde a M4: apagar a
   * única escolha da estrutura devolve `{}`, e o campo no servidor é a
   * ausência — sem esta linha, desfazer à mão deixaria "1 alteração" presa no
   * rascunho, sem nada para publicar. */
  function vazio(v) {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return !v.length;
    return typeof v === 'object' && !Object.keys(v).length;
  }

  /* Quantas alterações uma PESSOA fez. Editar a sinopse grava dois campos — o
   * texto e a origem "revisada" —, e trocar a capa grava o arquivo e a versão;
   * cada par é uma alteração só para quem olha a barra. */
  M.contarAlteracoes = function (lista) {
    lista = lista || M.st.rascunho;
    /* Desde a M4 a escolha do destaque mora em `site.destaque`, e vem com a
     * limpeza das marcas antigas nos títulos; as duas coisas são UMA ação. */
    var destacou = lista.some(function (x) { return x.alvo === 'site' && x.campo === 'destaque'; });
    return lista.filter(function (m) {
      if (m.campo === 'capa_versao') return false;
      if (m.campo === 'sinopse_origem') {
        return !lista.some(function (x) { return x.alvo === m.alvo && x.campo === 'sinopse'; });
      }
      /* Trocar o destaque é UMA ação: as marcas que saem acompanham o id que
       * entra, e elas são de outro alvo (o título), não do `site`. */
      if (m.alvo !== 'site' && m.campo === 'destaque' && destacou) return false;
      return true;
    }).length;
  };

  M.valorNoServidor = function (alvo, campo) {
    if (!M.st.servidor) return undefined;
    if (alvo === 'ajustes') return (M.st.servidor.ajustes || {})[campo];
    /* O `site` pode não existir no documento: é o catálogo que nunca teve
     * estrutura escolhida, e o "antes" dele é a ausência (M4). */
    if (alvo === 'site') return (M.st.servidor.site || {})[campo];
    var it = App.porId(M.st.servidor.itens, alvo);
    return it ? it[campo] : undefined;
  };

  function registrar(alvo, campo, depois) {
    var antes = M.valorNoServidor(alvo, campo);
    /* Apagar um campo que já era vazio não é mudança: '' e null são o mesmo
     * nada, e sem isto um foco num campo vazio sujaria o rascunho. */
    if (vazio(depois) && vazio(antes)) depois = antes;
    M.st.rascunho = App.registrarMudanca(M.st.rascunho, { alvo: alvo, campo: campo, antes: antes, depois: depois });
  }

  /* pares: [[campo, valor], …] de um mesmo alvo, desenhados uma vez só. */
  M.mudarVarios = function (alvo, pares, opcoes) {
    pares.forEach(function (par) { registrar(alvo, par[0], par[1]); });
    M.st.versao++;
    M.guardarRascunho();
    if (M.aoMudar) M.aoMudar(opcoes || {});
  };

  /* O destaque é UM (D4), e desde a M4 ele é o ID em `site.destaque`.
   *
   * A marca `destaque` no próprio título é o que o /admin de 14/09 gravou, e o
   * que ainda está no KV. Escolher pela mesa APAGA todas as marcas no mesmo
   * rascunho: enquanto uma sobrar, ela é quem vale para quem não escolheu nada
   * (é a ordem de consulta do `App.destaque`), e duas fontes para a mesma
   * coisa envelhecem separadas. Uma publicação e a dúvida acaba.
   *
   * Tirar o destaque é gravar `null`: aí vale o padrão, que é o primeiro
   * título da maior série. Nunca fica sem nenhum. */
  M.destacar = function (id, ligar) {
    M.efetivo().itens.forEach(function (i) {
      if (i.destaque === true) registrar(i.id, 'destaque', null);
    });
    registrar('site', 'destaque', ligar ? id : null);
    M.st.versao++;
    M.guardarRascunho();
    if (M.aoMudar) M.aoMudar({});
  };

  M.mudar = function (alvo, campo, valor, opcoes) { M.mudarVarios(alvo, [[campo, valor]], opcoes); };

  M.desfazerMudanca = function (alvo, campo) {
    M.st.rascunho = M.st.rascunho.filter(function (x) { return x.alvo !== alvo || x.campo !== campo; });
    M.st.conflitos = M.st.conflitos.filter(function (x) { return x.alvo !== alvo || x.campo !== campo; });
    M.st.versao++;
    M.guardarRascunho();
    if (M.aoMudar) M.aoMudar({});
  };

  M.descartarRascunho = function () {
    M.st.rascunho = [];
    M.st.conflitos = [];
    M.st.verRascunho = false;
    M.st.versao++;
    M.guardarRascunho();
    if (M.aoMudar) M.aoMudar({});
  };

  /* Conflito resolvido: "o meu" passa a partir do valor que está no site; "o do
   * site" tira a mudança do rascunho. */
  M.resolverConflito = function (alvo, campo, ficarComOMeu) {
    var conf = M.st.conflitos.find(function (c) { return c.alvo === alvo && c.campo === campo; });
    if (!conf) return;
    if (ficarComOMeu && !conf.sumiu) {
      M.st.rascunho = M.st.rascunho.map(function (x) {
        return x.alvo === alvo && x.campo === campo
          ? { alvo: x.alvo, campo: x.campo, antes: conf.noServidor, depois: x.depois } : x;
      });
      M.st.conflitos = M.st.conflitos.filter(function (c) { return c !== conf; });
      M.st.versao++;
      M.guardarRascunho();
      if (M.aoMudar) M.aoMudar({});
    } else {
      M.desfazerMudanca(alvo, campo);
    }
  };

  /* Publicar é o salvarCatalogo(mutar) de sempre, com o conflito explicado:
   * relê o catálogo, confere campo a campo, aplica e grava com o `rev` lido.
   * Um 409 — outra tela gravou entre a leitura e a gravação — ganha mais duas
   * voltas, e cada volta confere os campos de novo. */

  /* ------------------------------------------------------------ histórico (M5)
   *
   * A linha do tempo vem dos METADADOS das chaves, numa listagem só; o registro
   * de uma publicação e a cópia inteira vêm sob demanda, quando alguém abre.
   *
   * DESFAZER NÃO TEM CAMINHO PRÓPRIO: a mudança contrária entra no rascunho de
   * sempre, e vai pelo Publicar — mesma conferência de conflito, mesma
   * permissão, e ela mesma vira uma linha nova no histórico. */
  M.hist = { linha: [], carregando: false, erro: '', rev: null, registro: null, temCopia: false, fim: true, cursor: null };

  M.carregarHistorico = function (mais) {
    if (M.hist.carregando) return Promise.resolve();
    M.hist.carregando = true;
    M.hist.erro = '';
    var caminho = '/api/historico' + (mais && M.hist.cursor ? '?cursor=' + encodeURIComponent(M.hist.cursor) : '');
    return M.api(caminho).then(function (d) {
      M.hist.linha = mais ? M.hist.linha.concat(d.linha || []) : (d.linha || []);
      M.hist.fim = d.fim !== false;
      M.hist.cursor = d.cursor || null;
    }).catch(function (e) {
      M.hist.erro = e.message;
    }).then(function () {
      M.hist.carregando = false;
      if (M.aoMudar) M.aoMudar({ semPainel: true });
    });
  };

  M.abrirPublicacao = function (rev) {
    if (M.hist.rev === rev) { M.hist.rev = null; M.hist.registro = null; if (M.aoMudar) M.aoMudar({ semPainel: true }); return Promise.resolve(); }
    M.hist.rev = rev;
    M.hist.registro = null;
    M.hist.erro = '';
    if (M.aoMudar) M.aoMudar({ semPainel: true });
    return M.api('/api/historico?rev=' + encodeURIComponent(rev)).then(function (d) {
      if (M.hist.rev !== rev) return;   /* já clicaram em outra */
      M.hist.registro = d.registro;
      M.hist.temCopia = !!d.temCopia;
    }).catch(function (e) {
      M.hist.erro = e.message;
    }).then(function () {
      if (M.aoMudar) M.aoMudar({ semPainel: true });
    });
  };

  /* A mudança contrária, no rascunho. O "antes" dela é o valor que está NO
   * SERVIDOR agora — quem cuida disso é o `registrar` de sempre —, e não o que
   * o registro do histórico diz: entre a publicação antiga e agora, o campo
   * pode ter mudado de novo, e é esse conflito que o Publicar tem de ver. */
  M.desfazerDoHistorico = function (dif) {
    var m = App.desfazerMudanca(dif);
    if (!m) return M.toast('Esta mudança não se desfaz pela tela: título criado ou removido sai por script.');
    M.mudar(m.alvo, m.campo, m.valor);
    M.toast('Está no rascunho. Publique para valer no site.');
  };

  /* Restaurar é uma PUBLICAÇÃO nova, feita pelo servidor a partir da cópia — e
   * não um rascunho: a volta pode mexer em centenas de campos de uma vez, e
   * mandar isso pelo rascunho do navegador seria pedir para quem confere ler
   * quinhentas linhas. Quem confere é o servidor, campo a campo, como sempre. */
  M.restaurarVersao = function (rev) {
    if (M.st.rascunho.length) {
      return Promise.resolve(M.toast('Publique ou descarte o rascunho antes de restaurar: a volta é uma publicação.'));
    }
    return M.api('/api/historico', {
      method: 'POST',
      body: JSON.stringify({ restaurar: rev, rev: M.st.servidor.rev })
    }).then(function (r) {
      return M.carregarServidor().then(function () {
        return M.carregarHistorico();
      }).then(function () {
        M.hist.rev = null;
        M.hist.registro = null;
        M.toast('Catálogo de volta à rev ' + rev + ' · agora é a rev ' + r.rev + ' · ' + r.mudancas + (r.mudancas === 1 ? ' campo' : ' campos'));
        if (M.aoMudar) M.aoMudar({});
      });
    }).catch(function (e) {
      var barradas = e.corpo && e.corpo.barradas;
      if (e.status === 403 && barradas && barradas.length) {
        M.toast('Esta conta não pode restaurar: ' + barradas.slice(0, 2).map(function (d) {
          return (M.CAMPO[d.campo] || d.campo) + ' pede "' + (App.ROTULO_PERMISSAO[d.permissao] || d.permissao) + '"';
        }).join('; '));
        return;
      }
      M.toast(e.message);
    });
  };

  /* DEPOIS DO PUBLICAR, a busca por sentido do que mudou de TEXTO (a decisão
   * 6 estendida): o vetor da ficha é o título mais a sinopse, e a fila
   * de revisão de sinopses é a mais longa da mesa — cada sinopse revisada
   * muda o texto que o sentido compara. A fala não: ela vem da legenda, que
   * o Publicar não toca.
   *
   * Em segundo plano e sem barulho: se falhar, a visão geral mostra o título
   * como desatualizado, e o botão de lá conserta. */
  function atualizarBuscaDoPublicado(mexidos) {
    if (!M.busca.sentido || !mexidos.length) return;
    mexidos.forEach(function (id) {
      var item = M.item(id, true);
      if (!item || !(item.fonte && item.fonte.videoId)) return;
      var conj = AppIndice.conjuntosDoItem(item);
      M.indexarBusca(item.fonte.videoId, { capitulos: conj.capitulos, sinopse: conj.sinopse })
        .then(function () { return M.carregarBusca(); }, function () { /* a visão geral mostra */ });
    });
  }

  M.publicar = function () {
    if (!M.st.rascunho.length || M.st.publicando) return Promise.resolve(null);
    M.st.publicando = true;
    if (M.aoMudar) M.aoMudar({ soBarra: true });
    var quantas = M.contarAlteracoes();
    /* Quem mexeu no texto que o sentido compara, antes de o rascunho sumir. */
    var mexidos = [];
    M.st.rascunho.forEach(function (m) {
      if ((m.campo !== 'titulo' && m.campo !== 'sinopse') || m.alvo === 'site' || m.alvo === 'ajustes') return;
      if (mexidos.indexOf(m.alvo) < 0) mexidos.push(m.alvo);
    });

    function volta(n) {
      return M.api('/api/catalogo?completo=1').then(function (atual) {
        atual.itens = Array.isArray(atual.itens) ? atual.itens : [];
        M.st.servidor = atual;
        M.st.versao++;
        var conflitos = App.conflitosRascunho(atual, M.st.rascunho);
        if (conflitos.length) return { conflitos: conflitos };
        var novo = App.aplicarRascunho(atual, M.st.rascunho);
        /* O que veio no GET volta no PUT, menos o `config` — ele vem do
         * ambiente. Os `ajustes` voltam inteiros (ESTADO, rev 85). */
        delete novo.config;
        return M.api('/api/catalogo', { method: 'PUT', body: JSON.stringify(novo) });
      }).catch(function (e) {
        if (e.status === 409 && n < 2) return volta(n + 1);
        throw e;
      });
    }

    return volta(0).then(function (r) {
      if (r && r.conflitos) {
        M.st.conflitos = r.conflitos;
        M.st.verRascunho = true;
        M.toast(r.conflitos.length === 1 ? 'Um campo mudou em outra tela. Escolha qual fica.' : r.conflitos.length + ' campos mudaram em outra tela. Escolha quais ficam.');
        return r;
      }
      M.st.rascunho = [];
      M.st.conflitos = [];
      M.st.verRascunho = false;
      M.guardarRascunho();
      return M.carregarServidor().then(function () {
        M.toast('Publicado no site · rev ' + M.st.servidor.rev + ' · ' + quantas + (quantas === 1 ? ' alteração' : ' alterações'));
        atualizarBuscaDoPublicado(mexidos);
        return r;
      });
    }).catch(function (e) {
      /* 403: o servidor recusou campo a campo (M2). Dizer QUAL campo e QUAL
       * permissão faltou é a diferença entre "não deu" e saber o que pedir ao
       * superadmin. */
      var barradas = e.corpo && e.corpo.barradas;
      if (e.status === 403 && barradas && barradas.length) {
        var quais = barradas.slice(0, 3).map(function (d) {
          var nome = M.CAMPO[d.campo] || d.campo;
          return nome + (d.permissao ? ' (precisa de “' + (App.ROTULO_PERMISSAO[d.permissao] || d.permissao) + '”)' : ' (só o superadmin)');
        }).join('; ');
        M.toast('Não publicou: ' + quais + (barradas.length > 3 ? ' e mais ' + (barradas.length - 3) : '') +
          '. O que a sua conta pode continua no rascunho.');
        return null;
      }
      M.toast(e.status === 500
        ? 'O servidor não gravou (' + e.message + '). Se foram dois Publicar colados, espere um segundo e tente de novo.'
        : 'Não publicou: ' + e.message);
      return null;
    }).then(function (r) {
      M.st.publicando = false;
      if (M.aoMudar) M.aoMudar({});
      return r;
    });
  };
})();
