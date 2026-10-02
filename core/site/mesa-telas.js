/* mesa-telas.js — o que o meio da mesa mostra quando não é o site: a tabela do
 * catálogo, o envio de vídeo, o seletor de capa, as contas, a fila de
 * pendências e a estrutura da chegada. O envio e a capa vieram do
 * admin.js de antes, com as mesmas armadilhas documentadas. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr;

  function chip(texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); }
  function topo(titulo, sub, extra) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null), extra || null);
  }

  /* ------------------------------------------------------------- catálogo */

  var FILTROS = [
    ['todos', tr('telas.todos'), function () { return true; }],
    ['no-ar', tr('mesa.noAr'), function (i) { return i.publicar === true; }],
    ['fora', tr('telas.foraDoAr'), function (i) { return i.publicar !== true; }],
    ['auto', tr('telas.sinopseAutomatica'), function (i) { return !!i.sinopse && i.sinopse_origem === 'auto'; }],
    ['vazia', tr('telas.semSinopse'), function (i) { return i.publicar === true && !i.sinopse; }],
    ['pendencia', tr('telas.comPendencia'), function (i) { return !!i.pendencia; }],
    ['semvideo', tr('telas.semVideo'), function (i) { return !App.idDoVideo(i); }],
    ['triagem', tr('telas.serieDeTriagem'), function (i) { return i.serie === 'A classificar' || i.serie === 'A identificar' /* i18n-ignorar: nomes de série (dado do acervo) */; }]
  ];
  M.FILTROS = FILTROS;

  /* As colunas da tabela, na ordem do <thead>. `ordem` é a chave que
   * `App.ordenarPor` conhece — sem ela a coluna não ordena, que é o caso da
   * primeira, onde só mora a caixinha de marcar. */
  var COLUNAS = [
    { rotulo: '', ordem: '' },
    { rotulo: tr('telas.titulo'), ordem: 'titulo' },
    { rotulo: tr('telas.colunaTE'), ordem: 'episodio' },
    { rotulo: tr('telas.duracao'), ordem: 'duracao', num: true },
    { rotulo: tr('telas.sinopse'), ordem: 'sinopse' },
    { rotulo: tr('telas.pendencia'), ordem: 'pendencia' },
    { rotulo: tr('mesa.noAr'), ordem: 'no-ar' }
  ];
  M.COLUNAS = COLUNAS;

  M.linhasCatalogo = function (cat) {
    var st = M.st;
    var regra = (FILTROS.find(function (f) { return f[0] === st.filtro; }) || FILTROS[0])[2];
    var lista = App.ordenarPor(App.buscar(cat.itens, st.busca).filter(regra), st.ordem, st.ordemDesc);
    var tbody = h('tbody', { id: 'cat-linhas' });
    lista.forEach(function (it) {
      var capa = App.urlCapa(it);
      var mudou = st.rascunho.some(function (m) { return m.alvo === it.id; });
      tbody.appendChild(h('tr', { class: (st.sel === 'item:' + it.id ? 'sel' : '') + (it.publicar ? '' : ' fantasma'), 'data-alvo': 'item:' + it.id, tabindex: '0' },
        h('td', { class: 'col-marca' }, h('input', { type: 'checkbox', id: 'mc-' + it.id, 'data-acao': 'marcar', 'data-id': it.id, checked: !!st.marcados[it.id], 'aria-label': tr('telas.marcarTitulo', { titulo: it.titulo || it.id }) })),
        h('td', null, h('div', { class: 't-titulo' },
          h('span', { class: 't-capa' }, capa ? h('img', { src: capa, alt: '', loading: 'lazy', width: '640', height: '360' }) : null),
          h('span', { class: 't-texto' }, h('b', null, it.titulo || tr('telas.semTitulo'), mudou ? h('span', { class: 'ponto ponto-ouro', title: tr('telas.temAlteracaoNoRascunho') }) : null),
            h('small', { text: it.serie || tr('telas.semSerie') })))),
        h('td', { class: 'mono', text: App.rotuloEpisodio(it) || '—' }),
        h('td', { class: 'mono num', text: App.formatarDuracao(it) || '—' }),
        h('td', null, !it.sinopse ? chip('vazia', 'chip-erro') : it.sinopse_origem === 'auto' ? chip(tr('telas.automatica'), 'chip-alerta') : chip('revisada', 'chip-ok')),
        h('td', null, it.pendencia ? chip(App.rotuloPendencia(it.pendencia), 'chip-alerta') : !App.idDoVideo(it) ? chip(tr('telas.semVideo2'), 'chip-erro') : h('span', { class: 'fraco', text: '—' })),
        h('td', null, h('label', { class: 'interruptor interruptor-so', for: 'pb-' + it.id },
          h('span', { class: 'so-leitor', text: tr(it.publicar ? 'telas.tirarDoArTitulo' : 'telas.porNoArTitulo', { titulo: it.titulo || it.id }) }),
          h('input', { type: 'checkbox', id: 'pb-' + it.id, 'data-acao': 'no-ar', 'data-id': it.id, checked: it.publicar === true, disabled: !M.pode('no-ar') }),
          h('span', { class: 'trilho' })))));
    });
    if (!lista.length) tbody.appendChild(h('tr', null, h('td', { colspan: '7', class: 'vazio-linha', text: tr('telas.nenhumTituloComEssesFiltros') })));
    return { tbody: tbody, n: lista.length };
  };

  /* O cabeçalho ordena, e por isso o rótulo é um BOTÃO — não um <th> com um
   * ouvinte de clique em cima. É o que dá foco, tecla e nome ao controle; ao
   * <th> cabe o `aria-sort`, que é onde o leitor de tela procura a ordem.
   *
   * O id existe para o redesenho: `redesenhar()` devolve o foco pelo id do
   * elemento, e sem ele a batida no cabeçalho jogaria quem usa teclado de
   * volta para o começo da tela. */
  function cabecalho(c) {
    if (!c.ordem) return h('th', { scope: 'col', class: 'col-marca' }, h('span', { class: 'so-leitor', text: tr('telas.marcar') }));
    var st = M.st, ativa = st.ordem === c.ordem;
    return h('th', { scope: 'col', class: c.num ? 'num' : '', 'aria-sort': ativa ? (st.ordemDesc ? 'descending' : 'ascending') : 'none' },
      h('button', {
        type: 'button', id: 'co-' + c.ordem, class: 'th-ordem' + (ativa ? ' ativa' : ''),
        'data-acao': 'ordenar', 'data-coluna': c.ordem,
        title: !ativa ? tr('telas.ordenarPor', { coluna: c.rotulo }) : st.ordemDesc ? tr('telas.voltarOrdemAcervo') : tr('telas.inverterOrdem')
      }, c.rotulo, h('span', { class: 'th-seta', 'aria-hidden': 'true', text: ativa ? (st.ordemDesc ? '↓' : '↑') : '↕' })));
  }

  M.telaCatalogo = function (cat) {
    var st = M.st, r = M.linhasCatalogo(cat);
    var marcados = Object.keys(st.marcados).filter(function (k) { return st.marcados[k]; });
    var no = App.publicaveis(cat.itens).length;
    return h('div', { class: 'a' },
      topo(tr('mesa.todosOsTitulos'), tr('telas.resumoTabela', { noAr: no, fora: cat.itens.length - no, rev: M.st.servidor.rev })),
      h('div', { class: 'a-filtros' },
        h('label', { class: 'a-busca', for: 'cat-busca' }, M.ic('busca'), h('span', { class: 'so-leitor', text: tr('telas.buscarNoCatalogo') }),
          h('input', { type: 'search', id: 'cat-busca', placeholder: tr('telas.tituloSerieTemaOuTag'), value: st.busca })),
        h('div', { class: 'seg seg-filtros', role: 'group', 'aria-label': tr('telas.filtrar') }, FILTROS.map(function (f) {
          var n = cat.itens.filter(f[2]).length;
          return h('button', { type: 'button', id: 'cf-' + f[0], 'aria-pressed': String(st.filtro === f[0]), 'data-acao': 'filtro', 'data-filtro': f[0] },
            f[1], h('span', { class: 'mono fraco', text: ' ' + n }));
        })),
        h('span', { class: 'a-conta mono', id: 'cat-conta', text: tr('comum.titulos', { n: r.n }) })),
      marcados.length && M.pode('no-ar') ? h('div', { class: 'a-lote', role: 'region', 'aria-label': tr('telas.acoesEmLote') },
        h('b', { text: tr('telas.marcadosN', { n: marcados.length }) }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-publicar', text: tr('telas.porNoAr') }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-tirar', text: tr('telas.tirarDoAr') }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-limpar', text: tr('telas.desmarcar') }),
        h('span', { class: 'p-nota', text: tr('telas.vaiParaORascunho') })) : null,
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela' },
        h('thead', null, h('tr', null, COLUNAS.map(cabecalho))), r.tbody)));
  };

  /* ---------------------------------------------------------------- envio */

  var TAMANHO_PEDACO = 50 * 1024 * 1024;   /* 50 MB por PATCH: progresso fino e retomada barata */

  M.envio = { upload: null, videoId: null, fonte: null, arquivo: null, titulo: '', fase: 'parado', enviados: 0, total: 0, registro: [], encoding: '', erro: '', pedidoId: null, duracaoEstimadaSeg: null };

  /* O que o provedor desta instalação sabe fazer, lido uma vez do servidor. A tela decide por CAPACIDADE
   * (enviar arquivo, ou colar o endereço de um vídeo que já está num servidor), nunca pelo nome do provedor.
   * `undefined` = ainda não pedi; `null` = pedindo; falha vale "envia arquivo", o caminho de sempre. */
  M.video = undefined;
  function carregarCapacidades() {
    if (M.video !== undefined) return;
    M.video = null;
    M.api('/api/midia?capacidades=1').then(function (c) { M.video = c || {}; }, function () { M.video = {}; }).then(function () {
      if (M.st.tela === 'enviar') M.aoMudar({});
    });
  }
  function cadastroPorEndereco() { return !!(M.video && M.video.fontePorUrl === true && M.video.envio !== true); }

  /* Estimativa lida no navegador, do arquivo local, ANTES de enviar — é o que
   * o limite de duração por conta confere: o servidor só sabe a duração real
   * depois que o Bunny termina de codificar (upload-token.js). */
  function estimarDuracao(arquivo, aoTerminar) {
    try {
      var video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = function () {
        URL.revokeObjectURL(video.src);
        aoTerminar(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
      };
      video.onerror = function () { aoTerminar(null); };
      video.src = URL.createObjectURL(arquivo);
    } catch (e) { aoTerminar(null); }
  }

  function registrar(msg) {
    M.envio.registro.push(M.I18n.data(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ' + msg);
    var pre = M.$('env-registro');
    if (pre) { pre.textContent = M.envio.registro.join('\n'); pre.scrollTop = pre.scrollHeight; }
  }
  M.pctEnvio = function () { return M.envio.total ? M.envio.enviados / M.envio.total * 100 : 0; };

  function atualizarProgresso() {
    var pct = M.pctEnvio();
    var barra = M.$('env-barra'), texto = M.$('env-progresso');
    if (barra) barra.style.width = pct.toFixed(1) + '%';
    if (texto) texto.textContent = pct.toFixed(1) + '%  ·  ' + M.I18n.bytes(M.envio.enviados) + ' / ' + M.I18n.bytes(M.envio.total);
    if (M.aoProgressoEnvio) M.aoProgressoEnvio();
  }

  /* Cadastro por endereço: o vídeo já está no servidor do cliente (HLS). O servidor confere os endereços
   * (https, host liberado na config, extensão) e lê o playlist; daí em diante é o mesmo painel de metadados. */
  function telaEnviarPorEndereco() {
    var e = M.envio, u = e.url = e.url || { hls: '', mp4: '', capa: '', legenda: '', idioma: 'pt' };
    var ocupado = e.fase === 'verificando';
    var campo = function (rotulo, id, valor, extra) {
      return h('div', { class: 'campo' }, h('label', { for: id, text: rotulo }),
        h('input', Object.assign({ type: 'text', id: id, value: valor, disabled: ocupado || e.fase === 'enviado', autocomplete: 'off', spellcheck: 'false' }, extra || {})));
    };
    return h('div', { class: 'a' },
      topo(tr('telas.enviarTituloPorEndereco'), tr('telas.oVideoJaEstaNoSeuServidor')),
      h('div', { class: 'envio' },
        campo(tr('telas.tituloDeExibicao'), 'env-titulo', e.titulo, { placeholder: tr('telas.exTituloDoVideo') }),
        campo(tr('telas.enderecoDoPlaylist'), 'env-url-hls', u.hls, { inputmode: 'url', placeholder: 'https://' }),
        campo(tr('telas.enderecoDoMp4Opcional'), 'env-url-mp4', u.mp4, { inputmode: 'url' }),
        campo(tr('telas.enderecoDaCapaOpcional'), 'env-url-capa', u.capa, { inputmode: 'url' }),
        campo(tr('telas.enderecoDaLegendaOpcional'), 'env-url-legenda', u.legenda, { inputmode: 'url' }),
        campo(tr('telas.idiomaDaLegenda'), 'env-url-idioma', u.idioma, { maxlength: '12' }),
        h('div', { class: 'botoes-linha' },
          e.fase === 'enviado' ? null : h('button', { type: 'button', class: 'botao botao-verde', id: 'env-validar-url', disabled: ocupado, text: tr('telas.verificarEContinuar') })),
        e.erro ? h('p', { class: 'estado estado-erro', role: 'alert', text: e.erro }) : null,
        e.encoding ? h('p', { class: 'estado', text: e.encoding }) : null,
        h('pre', { class: 'registro', id: 'env-registro', text: e.registro.join('\n') })),
      h('ol', { class: 'passos' }, [
        tr('telas.passoColeOEndereco'),
        tr('telas.passoOSiteConfereOPlaylist'),
        tr('telas.passoMetadadosDoTitulo'),
        tr('telas.porNoArPeloRascunho')
      ].map(function (t, k) {
        var passo = e.fase === 'enviado' ? 2 : 0;
        return h('li', { class: k < passo ? 'feito' : k === passo ? 'agora' : '' }, h('span', { class: 'passo-n mono', text: String(k + 1) }), h('span', { text: t }));
      })));
  }

  function mensagemDeEndereco(erro) {
    var m = /^([a-z0-9]+):([a-z-]+)$/.exec((erro && erro.corpo && erro.corpo.detalhe) || '');
    var campos = { hls: tr('telas.campoPlaylist'), mp4: tr('telas.campoMp4'), capa: tr('telas.campoCapa'), legenda: tr('telas.campoLegenda') };
    var motivos = {
      'invalida': tr('telas.motivoInvalida'), 'sem-https': tr('telas.motivoSemHttps'),
      'host-nao-permitido': tr('telas.motivoHostNaoPermitido'), 'extensao': tr('telas.motivoExtensao')
    };
    if (!m || !campos[m[1]] || !motivos[m[2]]) return erro.message;
    return tr('telas.enderecoRecusado', { campo: campos[m[1]], motivo: motivos[m[2]] });
  }

  M.cadastrarPorEndereco = function () {
    var e = M.envio, u = e.url = e.url || {};
    var lido = function (id) { var n = M.$(id); return n ? n.value.trim() : ''; };
    u.hls = lido('env-url-hls'); u.mp4 = lido('env-url-mp4'); u.capa = lido('env-url-capa');
    u.legenda = lido('env-url-legenda'); u.idioma = lido('env-url-idioma') || 'pt';
    e.titulo = lido('env-titulo');
    e.erro = '';
    if (!u.hls) { e.erro = tr('telas.informeOEnderecoDoPlaylist'); return M.aoMudar({}); }
    if (!e.titulo) { e.erro = tr('telas.informeOTitulo'); return M.aoMudar({}); }
    e.fase = 'verificando';
    e.encoding = tr('telas.verificandoOEndereco');
    M.aoMudar({});
    var corpo = { hls: u.hls };
    if (u.mp4) corpo.mp4 = u.mp4;
    if (u.capa) corpo.capa = u.capa;
    if (u.legenda) corpo.legendas = [{ idioma: u.idioma, url: u.legenda }];
    M.api('/api/midia?tipo=fonte', { method: 'POST', body: JSON.stringify(corpo) }).then(function (r) {
      e.encoding = '';
      if (r.falhou) { e.fase = 'parado'; e.erro = tr('telas.playlistInvalido'); return M.aoMudar({}); }
      e.fonte = r.fonte;
      e.videoId = r.fonte.id;
      e.arquivo = null;
      e.fase = 'enviado';
      registrar(tr('telas.enderecoVerificadoRegistro', { id: r.fonte.id }));
      /* Playlist sem a marca de fim: o encoder ainda escreve. O título entra fora do ar, e só se põe no ar pronto. */
      e.encoding = r.pronto ? tr('telas.playlistVerificado') : tr('telas.playlistIncompleto');
      M.aoMudar({});
    }).catch(function (erro) {
      e.fase = 'parado';
      e.encoding = '';
      e.erro = mensagemDeEndereco(erro);
      M.aoMudar({});
    });
  };

  M.telaEnviar = function () {
    carregarCapacidades();
    if (cadastroPorEndereco()) return telaEnviarPorEndereco();
    var e = M.envio, pct = M.pctEnvio();
    var ocupado = e.fase === 'enviando' || e.fase === 'aguardando-autorizacao';
    return h('div', { class: 'a' },
      topo(tr('telas.enviarTitulo'), tr('telas.oArquivoVaiDoNavegador')),
      h('div', { class: 'envio' },
        h('div', { class: 'campo' }, h('label', { for: 'env-arquivo' }, tr('telas.arquivo'), h('span', { class: 'fraco', text: tr('telas.oMp4DoMaster') })),
          h('input', { type: 'file', id: 'env-arquivo', accept: 'video/*', disabled: ocupado })),
        h('div', { class: 'campo' }, h('label', { for: 'env-titulo', text: tr('telas.tituloDeExibicao') }),
          h('input', { type: 'text', id: 'env-titulo', value: e.titulo, placeholder: tr('telas.exTituloDoVideo'), disabled: ocupado })),
        h('div', { class: 'botoes-linha' },
          e.fase === 'enviado' || e.fase === 'aguardando-autorizacao' ? null : h('button', { type: 'button', class: 'botao botao-verde', id: 'env-enviar', disabled: ocupado, text: e.fase === 'pausado' ? tr('telas.retomarEnvio') : tr('telas.enviarVideo') }),
          e.fase === 'enviando' ? h('button', { type: 'button', class: 'botao botao-leve', id: 'env-pausar', text: tr('telas.pausar') }) : null),
        e.fase === 'aguardando-autorizacao' ? h('p', { class: 'estado', text: tr('telas.estaContaExigeAutorizacaoManual') }) : null,
        e.total ? h('div', { class: 'progresso', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-label': tr('telas.envioDoVideo') },
          h('i', { id: 'env-barra', style: 'width:' + pct.toFixed(1) + '%' })) : null,
        e.total ? h('p', { class: 'p-nota mono', id: 'env-progresso' }) : null,
        e.erro ? h('p', { class: 'estado estado-erro', text: e.erro }) : null,
        e.encoding ? h('p', { class: 'estado', text: e.encoding }) : null,
        h('pre', { class: 'registro', id: 'env-registro', text: e.registro.join('\n') })),
      h('ol', { class: 'passos' }, [
        tr('telas.passoSobeParaOProvedor'),
        tr('telas.oBunnyCodificaEmFila'),
        tr('telas.metadadosCapaELegendaA'),
        tr('telas.porNoArPeloRascunho')
      ].map(function (t, k) {
        var passo = e.fase === 'enviado' ? 2 : e.total ? 0 : -1;
        return h('li', { class: k < passo ? 'feito' : k === passo ? 'agora' : '' }, h('span', { class: 'passo-n mono', text: String(k + 1) }), h('span', { text: t }));
      })));
  };

  M.escolherArquivo = function (arquivo) {
    if (!arquivo) return;
    M.envio.arquivo = arquivo;
    M.envio.pedidoId = null;
    M.envio.duracaoEstimadaSeg = null;
    estimarDuracao(arquivo, function (segundos) { M.envio.duracaoEstimadaSeg = segundos; });
    if (!M.envio.titulo) {
      /* SERIE_S01E01_TITULO_2025_MASTER.mp4 -> "Serie s01e01 titulo 2025 master" */
      var base = arquivo.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      M.envio.titulo = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
      var campoTitulo = M.$('env-titulo');
      if (campoTitulo) campoTitulo.value = M.envio.titulo;
    }
    registrar(tr('telas.arquivoEscolhido', { nome: arquivo.name, mb: (arquivo.size / 1048576).toFixed(0) }));
  };

  /* Enquanto a autorização não chega, a pergunta se repete sozinha — é o mesmo
   * padrão de acompanharCodificacao(), só que perguntando a /api/autorizacoes. */
  function acompanharAutorizacao(pedidoId) {
    var tentativas = 0;
    (function checar() {
      tentativas++;
      M.api('/api/autorizacoes?id=' + encodeURIComponent(pedidoId)).then(function (r) {
        if (M.envio.pedidoId !== pedidoId) return;
        var status = r.pedido && r.pedido.status;
        if (status === 'aprovado') {
          registrar(tr('telas.autorizacaoAprovadaRetomandoOEnvio'));
          M.envio.fase = 'parado';
          M.comecarEnvio();
        } else if (status === 'recusado') {
          M.envio.fase = 'erro';
          M.envio.pedidoId = null;
          M.envio.erro = tr('telas.superadminRecusouEnvio');
          registrar(tr('telas.autorizacaoRecusada'));
          M.aoMudar({});
        } else if (tentativas < 240) {
          setTimeout(checar, 15000);
        }
      }).catch(function (erro) { registrar(tr('telas.erroConsultarAutorizacao', { mensagem: erro.message })); });
    })();
  }

  M.comecarEnvio = function () {
    var e = M.envio;
    e.erro = '';
    if (!e.arquivo) { e.erro = tr('telas.escolhaOArquivoDeVideo'); return M.aoMudar({}); }
    if (!e.titulo.trim()) { e.erro = tr('telas.informeOTitulo'); return M.aoMudar({}); }
    if (typeof window.tus === 'undefined') { e.erro = tr('telas.aBibliotecaDeEnvioTus'); return M.aoMudar({}); }
    if (e.fase === 'pausado' && e.upload) {
      e.fase = 'enviando';
      registrar(tr('telas.retomandoOEnvio'));
      e.upload.start();
      return M.aoMudar({});
    }
    e.fase = 'enviando';
    M.aoMudar({});
    var corpoPedido = e.pedidoId ? { pedidoId: e.pedidoId } : { titulo: e.titulo.trim(), duracaoEstimadaSeg: e.duracaoEstimadaSeg, tamanhoBytes: e.arquivo.size };
    M.api('/api/upload-token', { method: 'POST', body: JSON.stringify(corpoPedido) }).then(function (t) {
      if (t.aguardando) {
        e.fase = 'aguardando-autorizacao';
        e.pedidoId = t.pedidoId;
        registrar(tr('telas.envioAguardandoAutorizacaoDoSuperadmin'));
        M.aoMudar({});
        acompanharAutorizacao(t.pedidoId);
        return;
      }
      e.pedidoId = null;
      e.videoId = t.id;
      e.fonte = t.fonte || null;
      /* O PLANO DE UPLOAD vem do servidor (o adaptador do provedor o monta):
       * endereço, cabeçalhos de uso único e metadados. O navegador não escreve
       * endereço de provedor nenhum. */
      if (t.protocolo !== 'tus') {
        e.fase = 'erro';
        e.erro = tr('telas.protocoloDeEnvioNaoSuportado', { protocolo: String(t.protocolo) });
        M.aoMudar({});
        return;
      }
      registrar(tr('telas.videoCriado', { id: t.id, ate: M.I18n.data(t.expiraEm * 1000, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }));
      var upload = new window.tus.Upload(e.arquivo, Object.assign({
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
        chunkSize: t.pedacoBytes || TAMANHO_PEDACO,
        headers: t.cabecalhos || {},
        metadata: Object.assign({ filetype: e.arquivo.type || 'video/mp4', title: e.titulo.trim() }, t.metadados || {}),
        onProgress: function (enviados, total) { e.enviados = enviados; e.total = total; atualizarProgresso(); },
        onError: function (erro) { e.fase = 'erro'; e.erro = tr('telas.falhaNoEnvio', { mensagem: erro.message }); registrar(tr('telas.erroNoRegistro', { mensagem: erro.message })); M.aoMudar({}); },
        onSuccess: function () {
          e.fase = 'enviado';
          e.enviados = e.total;
          registrar(tr('telas.envioConcluidoOBunnyEsta'));
          M.toast(tr('telas.videoEnviadoPreenchaOsMetadados'));
          acompanharCodificacao(e.videoId);
          M.aoMudar({});
        }
      }, t.modo === 'url-pronta' ? { uploadUrl: t.url } : { endpoint: t.url }));
      e.upload = upload;
      /* Se a conexão caiu num envio anterior, o TUS retoma de onde parou. */
      upload.findPreviousUploads().then(function (anteriores) {
        if (anteriores.length) { upload.resumeFromPreviousUpload(anteriores[0]); registrar(tr('telas.retomandoEnvioInterrompido')); }
        upload.start();
      });
    }).catch(function (erro) {
      e.fase = 'parado';
      e.erro = erro.message;
      M.aoMudar({});
    });
  };

  M.pausarEnvio = function () {
    if (M.envio.upload) M.envio.upload.abort();
    M.envio.fase = 'pausado';
    registrar(tr('telas.envioPausado'));
    M.aoMudar({});
  };

  /* Armadilha 4 do ESTADO: vídeo em fila embeda e não toca. Só se põe no ar com
   * a codificação pronta — por isso o título novo nasce fora do ar. */
  function acompanharCodificacao(videoId) {
    var tentativas = 0;
    (function checar() {
      tentativas++;
      M.api('/api/midia?videoId=' + encodeURIComponent(videoId)).then(function (s) {
        if (M.envio.videoId !== videoId) return;
        if (s.pronto) { M.envio.encoding = tr('telas.codificacaoConcluidaJaPodePor'); registrar(tr('telas.codificacaoConcluida')); }
        else if (s.falhou) { M.envio.encoding = tr('telas.aCodificacaoFalhouNoBunny'); registrar(tr('telas.codificacaoFalhou')); }
        else {
          M.envio.encoding = tr('telas.codificando', { progresso: s.progresso != null ? s.progresso + '%' : '…' });
          if (tentativas < 120) setTimeout(checar, 15000);
        }
        if (M.st.tela === 'enviar') M.aoMudar({ semPainel: true });
      }).catch(function (erro) { registrar(tr('telas.erroConsultarCodificacao', { mensagem: erro.message })); });
    })();
  }

  M.painelEnvio = function (cat) {
    var e = M.envio;
    var cabecalho = h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.tituloNovo') }), h('h2', { class: 'p-cab-titulo', text: tr('telas.metadados') }));
    if (e.fase !== 'enviado') {
      return { cab: cabecalho, corpo: h('div', { class: 'p-corpo-in' }, h('p', { class: 'p-nota', text: cadastroPorEndereco() ? tr('telas.osMetadadosAbremAquiQuandoEndereco') : tr('telas.osMetadadosAbremAquiQuando') })) };
    }
    var campo = function (rot, id, entrada) { return h('div', { class: 'campo' }, h('label', { for: id, text: rot }), entrada); };
    return { cab: cabecalho, corpo: h('div', { class: 'p-corpo-in' }, h('div', { class: 'p-form' },
      h('p', { class: 'p-nota mono', text: tr('telas.videoId', { id: e.videoId }) }),
      campo(tr('telas.titulo'), 'n-titulo', h('input', { type: 'text', id: 'n-titulo', value: e.titulo })),
      campo(tr('telas.serie'), 'n-serie', h('input', { type: 'text', id: 'n-serie', list: 'lista-series', placeholder: 'A classificar' })), /* i18n-ignorar: nome de série (dado do acervo) */
      h('div', { class: 'campo-trio' },
        campo(tr('telas.temporada'), 'n-temporada', h('input', { type: 'number', id: 'n-temporada', min: '1', step: '1' })),
        campo(tr('telas.episodio'), 'n-episodio', h('input', { type: 'number', id: 'n-episodio', min: '1', step: '1' })),
        campo(tr('telas.ano'), 'n-ano', h('input', { type: 'text', id: 'n-ano', inputmode: 'numeric' }))),
      campo(tr('telas.sinopse'), 'n-sinopse', h('textarea', { id: 'n-sinopse', rows: '5', placeholder: tr('telas.2A3FrasesEm') })),
      /* Capa e legenda por arquivo só onde o provedor as recebe; no cadastro por endereço elas já foram coladas. */
      cadastroPorEndereco() ? null : campo(tr('telas.capaJpgOpcional'), 'n-capa', h('input', { type: 'file', id: 'n-capa', accept: 'image/jpeg,image/png' })),
      cadastroPorEndereco() ? null : campo(tr('telas.legendaSrtOpcional'), 'n-legenda', h('input', { type: 'file', id: 'n-legenda', accept: '.srt,text/plain' })),
      h('p', { class: 'p-nota', text: tr('telas.oTituloEntraNoCatalogo') }),
      h('button', { type: 'button', class: 'botao botao-verde', id: 'n-salvar', text: tr('telas.salvarNoCatalogo') }),
      h('p', { class: 'estado', id: 'n-estado', role: 'status' }))) };
  };

  function lerTexto(arquivo) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error(tr('telas.erroLerArquivo', { nome: arquivo.name }))); };
      fr.readAsText(arquivo, 'utf-8');
    });
  }

  /* O título novo é a exceção ao rascunho: acrescentar um título fora do ar não
   * muda nada no site, então ele grava na hora — lendo o catálogo de novo e
   * gravando com o `rev`, como todo o resto. */
  M.salvarTituloNovo = function () {
    var e = M.envio, estado = M.$('n-estado');
    var val = function (id) { var n = M.$(id); return n ? n.value.trim() : ''; };
    if (!val('n-titulo')) { estado.textContent = tr('telas.oTituloNaoPodeFicar'); return; }
    estado.textContent = tr('telas.salvando');
    var campos = {
      titulo: val('n-titulo'), serie: val('n-serie') || 'A classificar', /* i18n-ignorar: nome de série (dado do acervo) */
      temporada: val('n-temporada') ? Number(val('n-temporada')) : null, episodio: val('n-episodio') ? Number(val('n-episodio')) : null,
      ano: val('n-ano'), sinopse: val('n-sinopse'), publicar: false,
      arquivo: e.arquivo ? e.arquivo.name : '', tamanho_mb: e.arquivo ? Math.round(e.arquivo.size / 1048576) : null,
      fonte: e.fonte || { provedor: null, id: e.videoId, extras: {} }
    };
    var tarefas = [];
    var capa = M.$('n-capa') && M.$('n-capa').files[0];
    var legenda = M.$('n-legenda') && M.$('n-legenda').files[0];
    if (capa) tarefas.push(M.capaParaEnvio(capa).then(function (reduzida) {
      return reduzida.arrayBuffer();
    }).then(function (bytes) {
      return M.api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(e.videoId), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })
        .then(function (r) { if (r.capa_arquivo) { campos.capa_arquivo = r.capa_arquivo; campos.capa_versao = r.capa_versao || String(Date.now()); } registrar(tr('telas.capaEnviadaRegistro')); });
    }));
    /* A legenda que a mesa acabou de ler serve duas vezes: vai ao Bunny, e
     * vira a fala do título na busca. Os blocos
     * são condensados AQUI — a função recebe prontos. */
    var blocosDaFala = null;
    if (legenda) tarefas.push(lerTexto(legenda).then(function (srt) {
      blocosDaFala = AppIndice.blocosDaLegenda(srt);
      return M.api('/api/midia?tipo=legenda&videoId=' + encodeURIComponent(e.videoId), { method: 'POST', body: JSON.stringify({ srt: srt, srclang: 'pt', label: 'Português' }) }) /* i18n-ignorar: rótulo da faixa de legenda (dado: a língua da fala) */
        .then(function () { registrar(tr('telas.legendaEnviada', { n: blocosDaFala.length })); });
    }));
    Promise.all(tarefas).then(function () {
      return M.api('/api/catalogo?completo=1');
    }).then(function (atual) {
      var copia = JSON.parse(JSON.stringify(atual));
      delete copia.config;
      campos.id = App.idUnico(copia.itens, campos.titulo);
      var novo = App.itemNovo(campos);
      if (campos.capa_arquivo) { novo.capa_arquivo = campos.capa_arquivo; novo.capa_versao = campos.capa_versao; }
      copia.itens.push(novo);
      return M.api('/api/catalogo', { method: 'PUT', body: JSON.stringify(copia) }).then(function () { return novo; });
    }).then(function (novo) {
      var videoId = e.videoId;
      M.envio = { upload: null, videoId: null, fonte: null, arquivo: null, titulo: '', fase: 'parado', enviados: 0, total: 0, registro: [], encoding: '', erro: '', pedidoId: null, duracaoEstimadaSeg: null };
      /* A BUSCA, no mesmo envio: ninguém aperta nada. Se falhar, o título
       * entra no catálogo do mesmo jeito — e a visão geral mostra que ele
       * ficou fora da busca pela fala. */
      M.indexarBusca(videoId, {
        fala: blocosDaFala || [],
        capitulos: [],
        sinopse: AppIndice.textoDaFicha(novo)
      }).then(function () { return M.carregarBusca(); }, function (erro) {
        M.toast(tr('telas.entrouForaDaBusca', { titulo: novo.titulo, mensagem: erro.message }));
      });
      return M.carregarServidor().then(function () {
        M.toast(tr('telas.entrouForaDoAr', { titulo: novo.titulo }));
        M.escolher('item:' + novo.id, { tela: 'catalogo' });
      });
    }).catch(function (erro) {
      estado.textContent = erro.status === 409 ? tr('telas.oCatalogoMudouEmOutra') : erro.message;
    });
  };

  /* --------------------------------------------------------------- contas */

  M.contas = { lista: null, carregando: false, erro: '', senhaNova: null, editando: '' };

  M.carregarContas = function () {
    M.contas.carregando = true;
    return M.api('/api/contas').then(function (r) {
      M.contas.lista = r.contas || [];
      M.contas.erro = '';
    }).catch(function (e) {
      M.contas.lista = [];
      M.contas.erro = e.message;
    }).then(function () {
      M.contas.carregando = false;
      M.aoMudar({ semPainel: true });
    });
  };

  /* Pedidos de envio aguardando autorização manual (limiteEnvio, M2+). Só o
   * superadmin vê a lista — chama junto com a tela de Contas. */
  M.autorizacoes = { lista: null, carregando: false };

  M.carregarAutorizacoes = function () {
    if (!M.sessao.super) return Promise.resolve();
    M.autorizacoes.carregando = true;
    return M.api('/api/autorizacoes').then(function (r) {
      M.autorizacoes.lista = r.pedidos || [];
    }).catch(function () {
      M.autorizacoes.lista = [];
    }).then(function () {
      M.autorizacoes.carregando = false;
      M.aoMudar({ semPainel: true });
    });
  };

  /* A senha é sorteada AQUI, no navegador de quem cria a conta: 16 caracteres
   * de um alfabeto sem os que se confundem (l, I, O, 0). É ela que carrega a
   * segurança — o PBKDF2 do servidor cabe nos 10 ms de CPU do plano gratuito e
   * não faria milagre por uma senha curta. */
  M.senhaSorteada = function () {
    var letras = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return [].map.call(crypto.getRandomValues(new Uint8Array(16)), function (b) { return letras[b % letras.length]; }).join('');
  };

  M.marcadasEm = function (prefixo) {
    return App.PERMISSOES.filter(function (p) { var n = M.$(prefixo + p); return n && n.checked; });
  };

  function caixaPermissoes(prefixo, marcadas) {
    return h('fieldset', { class: 'permissoes' },
      h('legend', { text: tr('telas.oQueEstaContaPode') }),
      App.PERMISSOES.map(function (p) {
        return h('label', { class: 'permissao', for: prefixo + p },
          h('input', { type: 'checkbox', id: prefixo + p, checked: (marcadas || []).indexOf(p) >= 0 }),
          h('span', null, h('b', { text: App.ROTULO_PERMISSAO[p] }), h('small', { text: App.AJUDA_PERMISSAO[p] })));
      }));
  }

  /* Limite de envio de vídeo (M2+): quantos vídeos, quão longos, e se cada
   * envio espera aprovação manual. Só o superadmin edita — ver /api/contas. */
  function caixaLimiteEnvio(prefixo, limite) {
    var l = limite || {};
    return h('fieldset', { class: 'permissoes' },
      h('legend', { text: tr('telas.limiteDeEnvioDeVideo') }),
      h('div', { class: 'campo-duo' },
        h('div', { class: 'campo' }, h('label', { for: prefixo + 'max-videos', text: tr('telas.maximoDeVideos') }),
          h('input', { type: 'number', id: prefixo + 'max-videos', min: '0', step: '1', placeholder: tr('telas.semLimite'),
            value: l.maxVideos != null ? String(l.maxVideos) : '' })),
        h('div', { class: 'campo' }, h('label', { for: prefixo + 'max-duracao', text: tr('telas.duracaoMaximaMinutos') }),
          h('input', { type: 'number', id: prefixo + 'max-duracao', min: '0', step: '1', placeholder: tr('telas.semLimite'),
            value: l.maxDuracaoSeg != null ? String(Math.round(l.maxDuracaoSeg / 60)) : '' }))),
      h('label', { class: 'permissao', for: prefixo + 'autorizacao' },
        h('input', { type: 'checkbox', id: prefixo + 'autorizacao', checked: l.autorizacaoManual === true }),
        h('span', null, h('b', { text: tr('telas.exigirAutorizacaoManual') }),
          h('small', { text: tr('telas.cadaEnvioEsperaVoceAprovar') }))));
  }

  /* Lê a caixa acima de volta para o formato que /api/contas espera. Campo
   * vazio é "sem limite" (null), não zero — zero bloquearia todo envio. */
  M.limiteEnvioEm = function (prefixo) {
    var mv = (M.$(prefixo + 'max-videos').value || '').trim();
    var md = (M.$(prefixo + 'max-duracao').value || '').trim();
    return {
      maxVideos: mv === '' ? null : Math.max(0, Math.floor(Number(mv))),
      maxDuracaoSeg: md === '' ? null : Math.max(0, Math.floor(Number(md))) * 60,
      autorizacaoManual: M.$(prefixo + 'autorizacao').checked === true
    };
  };

  M.telaContas = function () {
    if (M.contas.lista === null && !M.contas.carregando) M.carregarContas();
    if (M.autorizacoes.lista === null && !M.autorizacoes.carregando) M.carregarAutorizacoes();
    var contas = M.contas.lista || [];
    var pedidos = M.autorizacoes.lista || [];
    var caixa = h('div', { class: 'a' },
      topo(tr('telas.contas'), tr('telas.oSuperadminVoceEA')));

    if (pedidos.length) {
      caixa.appendChild(h('div', { class: 'cartao-conta' },
        h('h2', { class: 'a-subtitulo', text: tr('telas.pedidosDeEnvioAguardandoAutorizacao') }),
        pedidos.map(function (p) {
          return h('div', { class: 'conta-topo' },
            h('div', null, h('b', { text: p.titulo }), h('span', { class: 'mono fraco', text: '  ' + p.usuario }),
              p.duracaoEstimadaSeg ? h('span', { class: 'p-nota', text: '  ~' + M.I18n.duracao(Math.round(p.duracaoEstimadaSeg / 60) * 60) }) : null),
            h('div', { class: 'botoes-linha' },
              h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'pedido-aprovar', 'data-id': p.id, text: tr('telas.aprovar') }),
              h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'pedido-recusar', 'data-id': p.id, text: tr('telas.recusar') })));
        })));
    }

    if (M.contas.senhaNova) {
      caixa.appendChild(h('div', { class: 'senha-nova' },
        h('p', null, h('b', { text: tr('telas.asenhaDe', { usuario: M.contas.senhaNova.usuario }) })),
        h('p', { class: 'senha-valor mono', text: M.contas.senhaNova.senha }),
        h('p', { class: 'p-nota', text: tr('telas.copieEEntregueAPessoa') }),
        h('button', { type: 'button', class: 'botao botao-pequeno', id: 'senha-ok', text: tr('telas.jaCopiei') })));
    }

    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('telas.novaConta') }),
      h('div', { class: 'campo-duo' },
        h('div', { class: 'campo' }, h('label', { for: 'nc-usuario', text: tr('telas.usuario') }),
          h('input', { type: 'text', id: 'nc-usuario', placeholder: 'maria', autocapitalize: 'none', spellcheck: 'false' }),
          h('p', { class: 'dica', text: tr('telas.minusculasNumerosOu') })),
        h('div', { class: 'campo' }, h('label', { for: 'nc-nome', text: tr('telas.nome') }),
          h('input', { type: 'text', id: 'nc-nome', placeholder: tr('telas.mariaSilva') }))),
      h('div', { class: 'campo' }, h('label', { for: 'nc-senha', text: tr('telas.senha') }),
        h('div', { class: 'botoes-linha' },
          h('input', { type: 'text', id: 'nc-senha', class: 'mono', value: M.senhaSorteada() }),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'nc-sortear', text: tr('telas.sortearOutra') }))),
      caixaPermissoes('nc-', []),
      caixaLimiteEnvio('nc-', null),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', id: 'nc-criar', text: tr('telas.criarConta') }),
        h('p', { class: 'estado', id: 'nc-estado', role: 'status' }))));

    if (M.contas.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', text: M.contas.erro }));
    if (M.contas.carregando && !contas.length) caixa.appendChild(h('p', { class: 'p-nota', text: tr('telas.lendoAsContas') }));

    contas.forEach(function (c) {
      var editando = M.contas.editando === c.usuario;
      caixa.appendChild(h('div', { class: 'cartao-conta' + (c.ativa ? '' : ' desligada') },
        h('div', { class: 'conta-topo' },
          h('div', null, h('b', { text: c.nome }), h('span', { class: 'mono fraco', text: '  ' + c.usuario }),
            c.ativa ? null : chip('desativada', 'chip-alerta')),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-editar', 'data-usuario': c.usuario, text: editando ? tr('telas.fechar') : tr('telas.permissoes') }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-senha', 'data-usuario': c.usuario, text: tr('telas.trocarSenha') }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-ativa', 'data-usuario': c.usuario, 'data-ativa': String(!c.ativa), text: c.ativa ? tr('telas.desativar') : tr('telas.ativar') }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-excluir', 'data-usuario': c.usuario, text: tr('telas.excluir') }))),
        editando ? h('div', { class: 'conta-editor' }, caixaPermissoes('ec-', c.permissoes), caixaLimiteEnvio('ec-', c.limiteEnvio),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'conta-salvar', 'data-usuario': c.usuario, text: tr('telas.salvar') }),
            h('p', { class: 'p-nota', text: tr('telas.salvarDerrubaASessaoAberta') })))
          : h('div', { class: 'conta-chips' }, c.permissoes.length
            ? c.permissoes.map(function (p) { return chip(App.ROTULO_PERMISSAO[p] || p); })
            : h('span', { class: 'p-nota', text: tr('telas.soVeNenhumaPermissaoMarcada') }))));
      if (!editando && c.permissoes.indexOf('enviar') >= 0) {
        var l = c.limiteEnvio;
        var partes = [];
        partes.push(l && l.maxVideos != null ? tr('telas.videosDeMax', { n: c.enviosContagem || 0, max: l.maxVideos }) : tr('telas.videosEnviados', { n: c.enviosContagem || 0 }));
        if (l && l.maxDuracaoSeg != null) partes.push(tr('telas.ateMinPorVideo', { min: Math.round(l.maxDuracaoSeg / 60) }));
        if (l && l.autorizacaoManual === true) partes.push(tr('telas.autorizacaoManual'));
        caixa.lastChild.appendChild(h('p', { class: 'p-nota', text: partes.join(' · ') }));
      }
    });
    return caixa;
  };

  M.painelContas = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('telas.comoFuncionam') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('telas.aTelaEscondeOQue') }),
        h('ul', { class: 'lista-ajuda' }, App.PERMISSOES.map(function (p) {
          return h('li', null, h('b', { text: App.ROTULO_PERMISSAO[p] }), h('span', { text: App.AJUDA_PERMISSAO[p] }));
        })),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('telas.oQueSoOSuperadmin') }),
          tr('telas.trocarOVideoDeUm')),
        h('p', { class: 'p-nota', text: tr('telas.aSenhaDoSuperadminE') })) };
  };

  /* ---------------------------------------------------------- minha conta */

  M.telaMinhaConta = function () {
    var s = M.sessao;
    return h('div', { class: 'a' },
      topo(tr('telas.minhaConta'), tr('telas.quemEstaUsandoAMesa')),
      h('div', { class: 'cartao-conta' },
        h('dl', { class: 'p-dados' },
          h('dt', { text: tr('telas.nome') }), h('dd', { text: s.nome }),
          h('dt', { text: tr('telas.usuario') }), h('dd', { class: 'mono', text: s.usuario }),
          h('dt', { text: tr('telas.pode') }), h('dd', null, s.super ? tr('telas.tudoSuperadmin')
            : (s.permissoes.length ? s.permissoes.map(function (p) { return App.ROTULO_PERMISSAO[p] || p; }).join(' · ') : tr('telas.soVer')))),
        s.super
          ? h('p', { class: 'p-nota', text: tr('telas.aSenhaDoSuperadminE2') })
          : h('div', { class: 'p-form' },
            h('div', { class: 'campo' }, h('label', { for: 'ms-atual', text: tr('telas.senhaAtual') }), h('input', { type: 'password', id: 'ms-atual', autocomplete: 'current-password' })),
            h('div', { class: 'campo' }, h('label', { for: 'ms-nova', text: tr('telas.senhaNova') }),
              h('input', { type: 'password', id: 'ms-nova', autocomplete: 'new-password' }),
              h('p', { class: 'dica', text: tr('telas.senhaMinima', { n: App.SENHA_MINIMA }) })),
            h('div', { class: 'botoes-linha' },
              h('button', { type: 'button', class: 'botao botao-verde', id: 'ms-trocar', text: tr('telas.trocarSenha') }),
              h('p', { class: 'estado', id: 'ms-estado', role: 'status' })))));
  };

  /* ----------------------------------------------------------------- capa */

  /* A CAPA SOBE COM NO MÁXIMO 640 px DE LARGURA — a régua do capas-menores.mjs
   * (08/09), que serve os dois fregueses da mesma URL: o cartão (321 px no
   * computador, o dobro numa tela 2×) e o `poster` do player. Até 22/09 a mesa
   * mandava a imagem inteira, e as duas capas trocadas por ela em 15 e 16/09
   * estavam no ar com 1280 px e até 221 KB, contra a mediana de 27 KB.
   *
   * Imagem que já cabe sobe como veio: reduzir o que já é pequeno só a
   * recomprimiria. Sem `createImageBitmap`, ou com uma imagem que ele não lê,
   * ela também sobe como veio — o capas-menores.mjs acha depois, e o Bunny é
   * quem diz se aceita. */
  var LARGURA_CAPA = 640;
  var QUALIDADE_CAPA = 0.85;

  function desenharCapa(fonte, largura, altura) {
    return new Promise(function (resolve, reject) {
      var escala = Math.min(1, LARGURA_CAPA / largura);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      /* PNG com transparência: o fundo é o preto do player, e não o que o
       * JPEG inventaria no lugar. */
      /* O preto vem do token; se a folha não carregou, o `fillStyle` padrão do canvas já é preto. */
      var preto = window.getComputedStyle(document.documentElement).getPropertyValue('--player-fundo').trim();
      if (preto) ctx.fillStyle = preto;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try { ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height); }
      catch (e) { return reject(new Error(tr('telas.erroLerImagem', { mensagem: e.message }))); }
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error(tr('telas.aCapaNaoPodeSer'))); }, 'image/jpeg', QUALIDADE_CAPA);
    });
  }

  M.capaParaEnvio = function (arquivo) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(arquivo);
    return createImageBitmap(arquivo).then(function (img) {
      var fechar = function (x) { if (img.close) img.close(); return x; };
      if (img.width <= LARGURA_CAPA) return fechar(arquivo);
      return desenharCapa(img, img.width, img.height).then(fechar);
    }, function () { return arquivo; });
  };

  /* Captura o quadro exato que está na tela do <video>, já na largura da
   * capa. Só funciona porque a pull zone do Bunny devolve
   * Access-Control-Allow-Origin: * e o vídeo é carregado com crossOrigin — sem
   * isso o canvas fica "tainted" e toBlob lança SecurityError. */
  function capturarQuadro(video) {
    if (!video.videoWidth) return Promise.reject(new Error(tr('telas.oVideoAindaNaoCarregou')));
    return desenharCapa(video, video.videoWidth, video.videoHeight);
  }

  /* A CAPA DE UM TÍTULO QUE JÁ ESTÁ NO CATÁLOGO VAI AO SITE NA MESMA CHAMADA
   * (22/09): a `/api/midia` grava os dois campos pela porta do PUT e devolve a
   * `rev`. Até ali ela ia para o rascunho, com a promessa de que "até
   * publicar, o site segue com a capa de antes" — só que o Bunny apaga a capa
   * anterior, e um teste sem publicar deixou o *Bernardo Élis 2* sem capa no
   * ar. Bytes não cabem num rascunho, e agora o nome também não.
   *
   * Sem `rev` na resposta a capa vai para o rascunho, como antes, em dois
   * casos: o título não está no catálogo, ou o servidor não conseguiu gravar
   * (`pendente`) — e aí o aviso é alto, porque o site está sem aquela capa
   * até alguém publicar. */
  M.enviarCapa = function (item, arquivo) {
    var videoId = App.idDoVideo(item);
    if (!videoId) return Promise.reject(new Error(tr('telas.semVideoNoBunnyNao')));
    return M.capaParaEnvio(arquivo).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (bytes) {
      return M.api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(videoId), {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes
      });
    }).then(function (resposta) {
      if (!resposta || !(resposta.capa_arquivo || resposta.capa)) {
        throw new Error(tr('telas.oBunnyNaoInformouO'));
      }
      if (resposta.rev) {
        /* Uma capa deste título que estivesse no rascunho ficou para trás: o
         * servidor já tem a nova. */
        M.desfazerMudanca(item.id, 'capa_arquivo');
        M.desfazerMudanca(item.id, 'capa_versao');
        return M.carregarServidor().then(function () {
          M.toast(tr('telas.capaTrocada', { rev: resposta.rev }));
          if (M.aoMudar) M.aoMudar({});
          return resposta;
        });
      }
      M.mudarVarios(item.id, [['capa_arquivo', resposta.capa_arquivo || null], ['capa_versao', resposta.capa_versao || String(Date.now())]]);
      /* A capa que aparece nas telas é `midia.capa`, calculada pelo servidor: a
       * URL nova (que a resposta traz) entra na leitura do servidor que a mesa
       * guarda, para o rascunho já mostrar a capa trocada. */
      var base = M.item(item.id, true);
      if (base && base.midia && resposta.capa) base.midia = Object.assign({}, base.midia, { capa: resposta.capa });
      M.toast(resposta.pendente
        ? tr('telas.capaPendente', { motivo: resposta.erro || tr('telas.semMotivo') })
        : tr('telas.capaEnviada'));
      return resposta;
    });
  };

  M.telaCapa = function (cat) {
    var id = M.st.capaDe, it = id && App.porId(cat.itens, id);
    if (!it) return h('div', { class: 'a' }, topo(tr('telas.escolherCapa'), tr('telas.escolhaUmTituloPrimeiro')));
    var mp4 = App.urlMp4(it, '720p');
    var video = h('video', { class: 'capa-video', id: 'capa-video', controls: true, preload: 'metadata', playsinline: true });
    video.crossOrigin = 'anonymous';   /* precisa vir ANTES do src */
    if (mp4) video.src = mp4;
    return h('div', { class: 'a' },
      topo(tr('telas.escolherACapa'), App.tituloCurto(it) + ' · ' + tr('telas.navegueAteOQuadro'),
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'tela', 'data-tela': 'site', text: tr('telas.voltarAoSite') })),
      mp4 ? video : h('p', { class: 'estado estado-erro', text: tr('telas.semVideoNoBunnyNao2') }),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', id: 'capa-usar', disabled: !mp4, text: tr('telas.usarEsteQuadro') }),
        h('p', { class: 'estado', id: 'capa-estado', role: 'status' })),
      h('img', { class: 'capa-previa', id: 'capa-previa', alt: tr('telas.previaDoQuadroEscolhido'), hidden: true }));
  };

  M.usarQuadro = function () {
    var video = M.$('capa-video'), estado = M.$('capa-estado'), botao = M.$('capa-usar');
    var it = M.item(M.st.capaDe);
    if (!video || !it) return;
    video.pause();
    botao.disabled = true;
    estado.textContent = tr('telas.capturandoQuadro', { s: M.I18n.numero(video.currentTime, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
    capturarQuadro(video).then(function (blob) {
      var previa = M.$('capa-previa');
      previa.src = URL.createObjectURL(blob);
      previa.hidden = false;
      estado.textContent = tr('telas.enviandoCapa', { kb: Math.round(blob.size / 1024) });
      return M.enviarCapa(it, blob);
    }).then(function (resposta) {
      estado.textContent = resposta && resposta.rev ? tr('telas.capaTrocadaNoSite') : tr('telas.capaNoRascunho');
      botao.disabled = false;
    }).catch(function (e) {
      estado.textContent = e.message;
      botao.disabled = false;
    });
  };

  /* ---------------------------------------------------- fila: pendências
   *
   * Tela própria (não é o site no quadro): "versão duplicada" pode ter duas
   * fichas para comparar, e isso não cabe numa ficha só. Decidir é reaproveitar
   * o que já existe — o rótulo daqui é o mesmo `f-pendencia`/`f-publicar` do
   * painel de edição da direita —, só que com botão pronto e avanço automático. */
  function cartaoPendencia(it, cat) {
    /* Decidir "áudio sem trilha" ou "versão duplicada" pede OUVIR e VER, não
     * uma miniatura — por isso é o embed do Bunny, grande, e não a capa. O
     * autoplay vem sempre falso do App.urlEmbed(): quem aperta o play é a
     * pessoa, nunca o código (mesma regra do player do site). */
    var embed = App.urlEmbed(App.midiaDe(it));
    return h('div', { class: 'cartao-conta' },
      h('div', { class: 'embed-pendencia' }, embed
        ? h('iframe', { src: embed, allow: 'fullscreen', title: tr('telas.previaDe', { titulo: it.titulo || it.id }), loading: 'lazy' })
        : h('span', { class: 'p-nota', text: tr('telas.semVideoNoBunny') })),
      h('b', { text: it.titulo || tr('telas.semTitulo') }), h('small', { class: 'fraco', text: '  ' + (it.serie || tr('telas.semSerie')) }),
      h('p', { class: 'p-nota mono', text: (App.formatarDuracao(it) || '—') + ' · ' + (it.publicar ? tr('painel.noAr') : tr('telas.foraDoArMin')) }));
  }


  /* --------------------------------------------------------- estrutura (M4)
   *
   * A chegada e os textos fixos, vistos todos de uma vez. O que se edita aqui
   * é o mesmo que se edita clicando na prateleira dentro da prévia — as duas
   * telas chamam as mesmas funções de `mesa-base.js`, que por sua vez chamam
   * as puras do core. A tela não sabe montar mapa nenhum, de propósito.
   *
   * Por que uma tela além do painel: ordem se arruma vendo a lista inteira, a
   * classe da série é uma lista de 23 linhas, e quatro dos cinco textos do B8
   * só aparecem no site em situações que ninguém consegue provocar de
   * propósito (busca vazia, ficha que não existe, falha de rede). */

  var ROTULO_CLASSE = { pedagogica: tr('telas.serie'), curta: tr('telas.curta'), institucional: tr('telas.institucional') };

  var AJUDA_TEXTO = {
    rodape: tr('telas.oPeDeTodaPagina'),
    semCapa: tr('telas.noLugarDaImagemQuando'),
    videoIndisponivel: tr('telas.seloVermelhoNoCartaoDe'),
    buscaVazia: tr('telas.tituloDaBuscaSemResultado'),
    buscaVaziaAjuda: tr('telas.aLinhaEmbaixoDele'),
    fichaAusente: tr('telas.tituloDoLinkDeUma'),
    fichaAusenteAjuda: tr('telas.aLinhaEmbaixoDele'),
    erroCatalogo: tr('telas.tituloDaFalhaDeRede'),
    erroCatalogoAjuda: tr('telas.aLinhaEmbaixoAMensagem')
  };

  function linhaPrateleira(cat, site, p, pos, total, pode) {
    var escolha = site.prateleiras[p.id] || {};
    var padrao = App.prateleiras(cat.itens).find(function (x) { return x.id === p.id; });
    return h('tr', { class: p.escondida ? 'escondida' : '' },
      h('td', { class: 'mono col-ordem', text: String(pos + 1) }),
      h('td', null,
        h('input', {
          type: 'text', class: 'entrada-linha', value: escolha.titulo || '',
          placeholder: padrao ? padrao.titulo : p.id, 'data-texto-prateleira': p.id,
          'aria-label': tr('telas.nomeDaPrateleira', { nome: padrao ? padrao.titulo : p.id }), disabled: !pode
        }),
        escolha.titulo ? h('small', { class: 'dica', text: tr('telas.padraoDois', { valor: padrao ? padrao.titulo : '' }) }) : null),
      h('td', { class: 'mono num', text: String(p.itens.length) }),
      h('td', { class: 'col-botoes' },
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'pr-mover', 'data-id': p.id, 'data-passo': '-1', 'aria-label': tr('telas.subir'), title: tr('telas.subir'), disabled: !pode || pos === 0 }, M.ic('esq')),
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'pr-mover', 'data-id': p.id, 'data-passo': '1', 'aria-label': tr('telas.descer'), title: tr('telas.descer'), disabled: !pode || pos === total - 1 }, M.ic('dir')),
        h('button', { type: 'button', class: 'icone-botao' + (p.escondida ? ' apagado' : ''), 'data-acao': 'pr-esconder', 'data-id': p.id, 'aria-pressed': String(!!p.escondida), 'aria-label': p.escondida ? tr('telas.mostrarNaChegada') : tr('telas.esconderDaChegada'), title: p.escondida ? tr('telas.mostrarNaChegada') : tr('telas.esconderDaChegada'), disabled: !pode }, M.ic('olho')),
        h('button', { type: 'button', class: 'linha-link linha-link-curta', 'data-acao': 'escolher', 'data-alvo': 'prateleira:' + p.id }, h('span', { text: tr('telas.verNaPrevia') }))));
  }

  M.telaEstrutura = function (cat) {
    var site = M.site();
    var pode = M.pode('estrutura');
    var todas = App.prateleiras(cat.itens, site);
    var somem = App.titulosSoEmEscondidas(cat.itens, site);
    var a = h('div', { class: 'a' },
      topo(tr('telas.estrutura'), tr('telas.aChegadaEOsTextos'),
        pode ? null : chip(tr('telas.soLeitura'), 'chip-alerta')));

    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.prateleirasDaChegada') }),
      h('p', { class: 'a-sub', text: tr('telas.quemEntraEmCadaPrateleira') }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('thead', null, h('tr', null,
          h('th', { class: 'col-ordem', text: '#' }), h('th', { text: tr('telas.nomeNaChegada') }),
          h('th', { class: 'num', text: tr('telas.titulos') }), h('th', { text: tr('telas.ordemEsconder') }))),
        h('tbody', null, todas.map(function (p, i) { return linhaPrateleira(cat, site, p, i, todas.length, pode); })))),
      somem.length ? h('div', { class: 'aviso-opcao' },
        h('b', null, tr('telas.naoAparecemNaChegada', { n: somem.length }) + ' '),
        tr('telas.estaoSoEmPrateleiraEscondida')) : null));

    /* As séries, com a classe que o código dá e a que a mesa escolheu. A lista
     * sai do catálogo, e não das três listas do core: série nova aparece aqui
     * no dia em que o primeiro título dela entra. */
    var nomes = App.series(App.publicaveis(cat.itens));
    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.classeDasSeries') }),
      h('p', { class: 'a-sub', text: tr('telas.decideDeQueLadoA') }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('thead', null, h('tr', null, h('th', { text: tr('telas.serie') }), h('th', { class: 'num', text: tr('telas.titulosNoAr') }), h('th', { text: tr('telas.classe') }))),
        h('tbody', null, nomes.map(function (nome) {
          var quantos = App.publicaveis(cat.itens).filter(function (i) { return (i.serie || App.semSerie()) === nome; }).length;
          var atual = App.classeDaSerie(nome, site);
          var escolhida = site.classes[nome];
          return h('tr', null,
            h('td', null, h('button', { type: 'button', class: 'linha-link', 'data-acao': 'escolher', 'data-alvo': 'serie:' + nome, title: tr('telas.aApresentacaoDaSerieO') },
              h('span', { text: nome }), site.series[nome] ? h('small', { class: 'dica', text: site.series[nome].origem === 'revisada' ? tr('telas.apresentacaoRevisada') : tr('telas.apresentacaoAutomatica') }) : null),
              escolhida ? h('small', { class: 'dica', text: tr('telas.padraoDois', { valor: ROTULO_CLASSE[App.classeDaSerie(nome, null)] }) }) : null),
            h('td', { class: 'mono num', text: String(quantos) }),
            h('td', null, h('select', { 'data-classe-serie': nome, 'aria-label': tr('telas.classeDe', { nome: nome }), disabled: !pode },
              App.CLASSES_SERIE.map(function (c) {
                return h('option', { value: c, selected: c === atual ? 'selected' : null, text: ROTULO_CLASSE[c] });
              }))));
        }))))));

    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: tr('telas.textosFixos') }),
      h('p', { class: 'a-sub', text: tr('telas.oRodapeEOsCinco') }),
      h('div', { class: 'p-form' }, Object.keys(App.TEXTOS_PADRAO).map(function (chave) {
        return h('div', { class: 'campo' },
          h('label', { for: 'tx-' + chave }, AJUDA_TEXTO[chave] || chave,
            site.textos[chave] ? h('span', { class: 'ponto ponto-ouro', title: tr('telas.noRascunhoOuJaGravado') }) : null),
          h('input', {
            type: 'text', id: 'tx-' + chave, value: site.textos[chave] || '',
            placeholder: App.TEXTOS_PADRAO[chave], 'data-texto': chave, disabled: !pode
          }));
      }))));

    return a;
  };


  /* --------------------------------------------------------- histórico (M5)
   *
   * A linha do tempo das publicações, e o que cada uma mudou. Ver é de todo
   * admin; desfazer pede a permissão DO CAMPO, e restaurar pede `historico` —
   * e as duas coisas são recusadas pelo servidor, não por esta tela. */

  function tamanho(bytes) {
    if (!bytes) return '';
    return M.I18n.bytes(bytes);
  }

  function valorDoHistorico(campo, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (v === true) return tr('comum.sim');
    if (v === false) return tr('comum.nao');
    if (Array.isArray(v)) return v.join(', ');
    if (campo === 'arrastoTeto') return Math.round(v * 100) + '%';
    if (campo === 'controlesEspera') return v + ' s';
    if (campo === 'pendencia') return App.rotuloPendencia(v);
    if (typeof v === 'object') {
      var n = Object.keys(v).length;
      return tr('telas.escolhasN', { n: n });
    }
    var t = String(v);
    return t.length > 90 ? t.slice(0, 88) + '…' : t;
  }

  function nomeDoAlvoNoHistorico(cat, alvo) {
    if (alvo === 'site') return tr('telas.estruturaDoSite');
    if (alvo === 'ajustes') return tr('telas.player');
    var it = App.porId(cat.itens, alvo);
    return it ? App.tituloCurto(it) : alvo;
  }

  function linhaDaMudanca(cat, dif) {
    var podeDesfazer = !!App.desfazerMudanca(dif) && M.pode(dif.permissao);
    var rotulo = dif.tipo === 'novo' ? tr('telas.tituloNovoMin') : dif.tipo === 'removido' ? tr('telas.tituloRemovidoMin')
      : (M.CAMPO[dif.campo] || dif.campo);
    return h('tr', null,
      h('td', null, h('span', { text: nomeDoAlvoNoHistorico(cat, dif.alvo) })),
      h('td', null, h('b', { text: rotulo })),
      h('td', { class: 'hist-de', text: valorDoHistorico(dif.campo, dif.antes) }),
      h('td', { class: 'hist-para', text: valorDoHistorico(dif.campo, dif.depois) }),
      h('td', { class: 'col-botoes' }, podeDesfazer
        ? h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-desfazer', 'data-i': String(dif.indice), text: tr('telas.desfazer') })
        : h('span', { class: 'dica', text: dif.tipo ? tr('telas.saiPorScript') : tr('telas.semPermissao') })));
  }

  M.telaHistorico = function (cat) {
    var hist = M.hist;
    var a = h('div', { class: 'a' },
      topo(tr('telas.historico'), tr('telas.cadaPublicacaoOQueEla'),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-recarregar' }, M.ic('recarregar'), tr('telas.atualizar'))));

    if (hist.erro) a.appendChild(h('div', { class: 'aviso-opcao' }, h('b', null, tr('telas.naoDeuParaLerHistorico') + ' '), hist.erro));
    if (!hist.linha.length) {
      a.appendChild(h('p', { class: 'p-nota', text: hist.carregando ? tr('telas.lendo')
        : tr('telas.nenhumaPublicacaoRegistradaAindaO') }));
      return a;
    }

    var corpo = h('tbody');
    hist.linha.forEach(function (p) {
      var aberta = hist.rev === p.rev;
      corpo.appendChild(h('tr', { class: aberta ? 'sel' : '' },
        h('td', { class: 'mono col-ordem', text: String(p.rev) }),
        h('td', null, h('div', { class: 't-texto' },
          h('b', { text: M.quando(p.em) || '—' }),
          h('small', { text: p.quem + (p.restaurou != null ? ' · ' + tr('telas.voltouARev', { rev: p.restaurou }) : '') }))),
        h('td', null, h('span', { text: p.resumo || '—' }),
          h('small', { class: 'dica', text: tr('mesa.camposN', { n: p.n }) + (p.bytes ? ' · ' + tr('telas.catalogoCom', { tamanho: tamanho(p.bytes) }) : '') })),
        h('td', { class: 'col-botoes' },
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-abrir', 'data-rev': String(p.rev), 'aria-expanded': String(aberta), text: aberta ? tr('telas.fechar') : tr('telas.verOQueMudou') }))));

      if (!aberta) return;
      var detalhe = h('td', { colspan: '4', class: 'hist-detalhe' });
      if (!hist.registro) {
        detalhe.appendChild(h('p', { class: 'p-nota', text: hist.erro || tr('telas.lendoORegistro') }));
      } else {
        var difs = (hist.registro.mudancas || []).map(function (d, i) { return Object.assign({ indice: i }, d); });
        detalhe.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
          h('thead', null, h('tr', null, h('th', { text: tr('telas.onde') }), h('th', { text: tr('telas.oQue') }),
            h('th', { text: tr('telas.era') }), h('th', { text: tr('telas.ficou') }), h('th', { text: tr('telas.desfazer') }))),
          h('tbody', null, difs.map(function (d) { return linhaDaMudanca(cat, d); })))));
        if (hist.registro.cortado) {
          detalhe.appendChild(h('p', { class: 'p-nota', text: tr('telas.mostrandoAsPrimeiras', { n: difs.length, total: hist.registro.total }) }));
        }
        detalhe.appendChild(h('div', { class: 'botoes-linha' },
          hist.temCopia
            ? h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'hist-restaurar', 'data-rev': String(p.rev), disabled: !M.pode('historico'), text: tr('telas.voltarOCatalogoParaEsta') })
            : h('span', { class: 'dica', text: tr('telas.aCopiaInteiraDestaRev') }),
          M.pode('historico') && hist.temCopia
            ? h('span', { class: 'dica', text: tr('telas.aVoltaEUmaPublicacao') }) : null));
      }
      corpo.appendChild(h('tr', { class: 'hist-linha-detalhe' }, detalhe));
    });

    a.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
      h('thead', null, h('tr', null, h('th', { class: 'col-ordem', text: 'rev' }), h('th', { text: tr('telas.quandoEQuem') }),
        h('th', { text: tr('telas.oQueMudou') }), h('th', { text: '' }))),
      corpo)));

    if (!hist.fim) {
      a.appendChild(h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-mais', text: hist.carregando ? tr('telas.lendo') : tr('telas.verMaisAntigas') }));
    }
    return a;
  };

  M.telaPendencias = function (cat) {
    var pos = M.filaPosicao('fila-pendencias');
    if (!pos || !pos.lista.length) {
      return h('div', { class: 'a' }, topo(tr('telas.pendencias'), tr('telas.nenhumTituloComPendenciaAgora')));
    }
    var it = pos.indice >= 0 ? pos.lista[pos.indice] : pos.lista[0];
    var outra = it.pendencia === 'versao_duplicada' ? App.outraVersaoDuplicada(cat.itens, it) : null;
    var podeConteudo = M.pode('conteudo'), podeNoAr = M.pode('no-ar');
    return h('div', { class: 'a' },
      topo(tr('mesa.pendencias'), tr('telas.decidirUmaPorVez', { atual: pos.indice + 1, total: pos.lista.length }), h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-anterior', disabled: pos.indice <= 0, text: tr('telas.anterior') }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-proxima', disabled: pos.indice >= pos.lista.length - 1, text: tr('telas.proxima') }))),
      h('div', { class: 'decisao' }, h('p', { class: 'decisao-rotulo' }, M.ic('alerta'), App.rotuloPendencia(it.pendencia))),
      it.nota_curadoria ? h('p', { class: 'nota-curadoria', text: it.nota_curadoria }) : null,
      h('div', { class: 'campo-duo' },
        cartaoPendencia(it, cat),
        outra ? cartaoPendencia(outra, cat) : it.pendencia === 'versao_duplicada'
          ? h('div', { class: 'cartao-conta' }, h('p', { class: 'p-nota', text: tr('telas.aOutraVersaoNaoEsta') }))
          : null),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'fila-resolver', 'data-id': it.id, disabled: !podeConteudo, text: tr('telas.resolvidaTirarAPendencia') }),
        it.publicar ? h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-tirar-do-ar', 'data-id': it.id, disabled: !podeNoAr, text: tr('telas.tirarDoAr') }) : null,
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'abrir-ficha', 'data-id': it.id, text: tr('telas.verAFicha') })),
      h('p', { class: 'p-nota', text: tr('telas.tambemDaParaDecidirPelos') }));
  };
})();
