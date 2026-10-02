/* mesa-telas.js — o que o meio da mesa mostra quando não é o site: a tabela do
 * catálogo, o envio de vídeo, o seletor de capa, as contas, a fila de
 * pendências e a estrutura da chegada. O envio e a capa vieram do
 * admin.js de antes, com as mesmas armadilhas documentadas. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h;

  function chip(texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); }
  function topo(titulo, sub, extra) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null), extra || null);
  }

  /* ------------------------------------------------------------- catálogo */

  var FILTROS = [
    ['todos', 'Todos', function () { return true; }],
    ['no-ar', 'No ar', function (i) { return i.publicar === true; }],
    ['fora', 'Fora do ar', function (i) { return i.publicar !== true; }],
    ['auto', 'Sinopse automática', function (i) { return !!i.sinopse && i.sinopse_origem === 'auto'; }],
    ['vazia', 'Sem sinopse', function (i) { return i.publicar === true && !i.sinopse; }],
    ['pendencia', 'Com pendência', function (i) { return !!i.pendencia; }],
    ['semvideo', 'Sem vídeo', function (i) { return !(i.fonte && i.fonte.videoId); }],
    ['triagem', 'Série de triagem', function (i) { return i.serie === 'A classificar' || i.serie === 'A identificar'; }]
  ];
  M.FILTROS = FILTROS;

  /* As colunas da tabela, na ordem do <thead>. `ordem` é a chave que
   * `App.ordenarPor` conhece — sem ela a coluna não ordena, que é o caso da
   * primeira, onde só mora a caixinha de marcar. */
  var COLUNAS = [
    { rotulo: '', ordem: '' },
    { rotulo: 'Título', ordem: 'titulo' },
    { rotulo: 'T · E', ordem: 'episodio' },
    { rotulo: 'Duração', ordem: 'duracao', num: true },
    { rotulo: 'Sinopse', ordem: 'sinopse' },
    { rotulo: 'Pendência', ordem: 'pendencia' },
    { rotulo: 'No ar', ordem: 'no-ar' }
  ];
  M.COLUNAS = COLUNAS;

  M.linhasCatalogo = function (cat) {
    var st = M.st;
    var regra = (FILTROS.find(function (f) { return f[0] === st.filtro; }) || FILTROS[0])[2];
    var lista = App.ordenarPor(App.buscar(cat.itens, st.busca).filter(regra), st.ordem, st.ordemDesc);
    var tbody = h('tbody', { id: 'cat-linhas' });
    lista.forEach(function (it) {
      var capa = App.urlCapa(it, cat.config);
      var mudou = st.rascunho.some(function (m) { return m.alvo === it.id; });
      tbody.appendChild(h('tr', { class: (st.sel === 'item:' + it.id ? 'sel' : '') + (it.publicar ? '' : ' fantasma'), 'data-alvo': 'item:' + it.id, tabindex: '0' },
        h('td', { class: 'col-marca' }, h('input', { type: 'checkbox', id: 'mc-' + it.id, 'data-acao': 'marcar', 'data-id': it.id, checked: !!st.marcados[it.id], 'aria-label': 'Marcar ' + (it.titulo || it.id) })),
        h('td', null, h('div', { class: 't-titulo' },
          h('span', { class: 't-capa' }, capa ? h('img', { src: capa, alt: '', loading: 'lazy', width: '640', height: '360' }) : null),
          h('span', { class: 't-texto' }, h('b', null, it.titulo || '(sem título)', mudou ? h('span', { class: 'ponto ponto-ouro', title: 'tem alteração no rascunho' }) : null),
            h('small', { text: it.serie || 'sem série' })))),
        h('td', { class: 'mono', text: App.rotuloEpisodio(it) || '—' }),
        h('td', { class: 'mono num', text: App.formatarDuracao(it) || '—' }),
        h('td', null, !it.sinopse ? chip('vazia', 'chip-erro') : it.sinopse_origem === 'auto' ? chip('automática', 'chip-alerta') : chip('revisada', 'chip-ok')),
        h('td', null, it.pendencia ? chip(App.rotuloPendencia(it.pendencia), 'chip-alerta') : !(it.fonte && it.fonte.videoId) ? chip('sem vídeo', 'chip-erro') : h('span', { class: 'fraco', text: '—' })),
        h('td', null, h('label', { class: 'interruptor interruptor-so', for: 'pb-' + it.id },
          h('span', { class: 'so-leitor', text: (it.publicar ? 'Tirar do ar: ' : 'Pôr no ar: ') + (it.titulo || it.id) }),
          h('input', { type: 'checkbox', id: 'pb-' + it.id, 'data-acao': 'no-ar', 'data-id': it.id, checked: it.publicar === true, disabled: !M.pode('no-ar') }),
          h('span', { class: 'trilho' })))));
    });
    if (!lista.length) tbody.appendChild(h('tr', null, h('td', { colspan: '7', class: 'vazio-linha', text: 'Nenhum título com esses filtros.' })));
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
    if (!c.ordem) return h('th', { scope: 'col', class: 'col-marca' }, h('span', { class: 'so-leitor', text: 'Marcar' }));
    var st = M.st, ativa = st.ordem === c.ordem;
    return h('th', { scope: 'col', class: c.num ? 'num' : '', 'aria-sort': ativa ? (st.ordemDesc ? 'descending' : 'ascending') : 'none' },
      h('button', {
        type: 'button', id: 'co-' + c.ordem, class: 'th-ordem' + (ativa ? ' ativa' : ''),
        'data-acao': 'ordenar', 'data-coluna': c.ordem,
        title: !ativa ? 'Ordenar por ' + c.rotulo : st.ordemDesc ? 'Voltar à ordem do acervo' : 'Inverter a ordem'
      }, c.rotulo, h('span', { class: 'th-seta', 'aria-hidden': 'true', text: ativa ? (st.ordemDesc ? '↓' : '↑') : '↕' })));
  }

  M.telaCatalogo = function (cat) {
    var st = M.st, r = M.linhasCatalogo(cat);
    var marcados = Object.keys(st.marcados).filter(function (k) { return st.marcados[k]; });
    var no = App.publicaveis(cat.itens).length;
    return h('div', { class: 'a' },
      topo('Todos os títulos', no + ' no ar · ' + (cat.itens.length - no) + ' fora do ar · rev ' + M.st.servidor.rev + '. O cabeçalho ordena; clique numa linha para editar à direita, e o duplo clique abre a ficha no site.'),
      h('div', { class: 'a-filtros' },
        h('label', { class: 'a-busca', for: 'cat-busca' }, M.ic('busca'), h('span', { class: 'so-leitor', text: 'Buscar no catálogo' }),
          h('input', { type: 'search', id: 'cat-busca', placeholder: 'título, série, tema ou tag', value: st.busca })),
        h('div', { class: 'seg seg-filtros', role: 'group', 'aria-label': 'Filtrar' }, FILTROS.map(function (f) {
          var n = cat.itens.filter(f[2]).length;
          return h('button', { type: 'button', id: 'cf-' + f[0], 'aria-pressed': String(st.filtro === f[0]), 'data-acao': 'filtro', 'data-filtro': f[0] },
            f[1], h('span', { class: 'mono fraco', text: ' ' + n }));
        })),
        h('span', { class: 'a-conta mono', id: 'cat-conta', text: r.n + (r.n === 1 ? ' título' : ' títulos') })),
      marcados.length && M.pode('no-ar') ? h('div', { class: 'a-lote', role: 'region', 'aria-label': 'Ações em lote' },
        h('b', { text: marcados.length + (marcados.length === 1 ? ' marcado' : ' marcados') }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-publicar', text: 'Pôr no ar' }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-tirar', text: 'Tirar do ar' }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'lote-limpar', text: 'Desmarcar' }),
        h('span', { class: 'p-nota', text: 'vai para o rascunho' })) : null,
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela' },
        h('thead', null, h('tr', null, COLUNAS.map(cabecalho))), r.tbody)));
  };

  /* ---------------------------------------------------------------- envio */

  var TAMANHO_PEDACO = 50 * 1024 * 1024;   /* 50 MB por PATCH: progresso fino e retomada barata */

  M.envio = { upload: null, videoId: null, arquivo: null, titulo: '', fase: 'parado', enviados: 0, total: 0, registro: [], encoding: '', erro: '', pedidoId: null, duracaoEstimadaSeg: null };

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
    M.envio.registro.push(new Date().toLocaleTimeString('pt-BR') + '  ' + msg);
    var pre = M.$('env-registro');
    if (pre) { pre.textContent = M.envio.registro.join('\n'); pre.scrollTop = pre.scrollHeight; }
  }
  M.pctEnvio = function () { return M.envio.total ? M.envio.enviados / M.envio.total * 100 : 0; };

  function atualizarProgresso() {
    var pct = M.pctEnvio();
    var barra = M.$('env-barra'), texto = M.$('env-progresso');
    if (barra) barra.style.width = pct.toFixed(1) + '%';
    if (texto) texto.textContent = pct.toFixed(1) + '%  ·  ' + (M.envio.enviados / 1048576).toFixed(0) + ' MB de ' + (M.envio.total / 1048576).toFixed(0) + ' MB';
    if (M.aoProgressoEnvio) M.aoProgressoEnvio();
  }

  M.telaEnviar = function () {
    var e = M.envio, pct = M.pctEnvio();
    var ocupado = e.fase === 'enviando' || e.fase === 'aguardando-autorizacao';
    return h('div', { class: 'a' },
      topo('Enviar título', 'O arquivo vai do navegador direto para o Bunny, por TUS. Pode trocar de tela na mesa: o envio continua. Só não feche a aba.'),
      h('div', { class: 'envio' },
        h('div', { class: 'campo' }, h('label', { for: 'env-arquivo' }, 'Arquivo ', h('span', { class: 'fraco', text: '— o .mp4 do master' })),
          h('input', { type: 'file', id: 'env-arquivo', accept: 'video/*', disabled: ocupado })),
        h('div', { class: 'campo' }, h('label', { for: 'env-titulo', text: 'Título de exibição' }),
          h('input', { type: 'text', id: 'env-titulo', value: e.titulo, placeholder: 'Ex.: Título do vídeo', disabled: ocupado })),
        h('div', { class: 'botoes-linha' },
          e.fase === 'enviado' || e.fase === 'aguardando-autorizacao' ? null : h('button', { type: 'button', class: 'botao botao-verde', id: 'env-enviar', disabled: ocupado, text: e.fase === 'pausado' ? 'Retomar envio' : 'Enviar vídeo' }),
          e.fase === 'enviando' ? h('button', { type: 'button', class: 'botao botao-leve', id: 'env-pausar', text: 'Pausar' }) : null),
        e.fase === 'aguardando-autorizacao' ? h('p', { class: 'estado', text: 'Esta conta exige autorização manual: aguardando o superadmin aprovar este envio…' }) : null,
        e.total ? h('div', { class: 'progresso', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-label': 'Envio do vídeo' },
          h('i', { id: 'env-barra', style: 'width:' + pct.toFixed(1) + '%' })) : null,
        e.total ? h('p', { class: 'p-nota mono', id: 'env-progresso' }) : null,
        e.erro ? h('p', { class: 'estado estado-erro', text: e.erro }) : null,
        e.encoding ? h('p', { class: 'estado', text: e.encoding }) : null,
        h('pre', { class: 'registro', id: 'env-registro', text: e.registro.join('\n') })),
      h('ol', { class: 'passos' }, [
        'O arquivo sobe para o Bunny',
        'O Bunny codifica — em fila, o vídeo embeda e não toca',
        'Metadados, capa e legenda, à direita',
        'Pôr no ar, pelo rascunho, com a codificação pronta'
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
    registrar('arquivo escolhido: ' + arquivo.name + ' (' + (arquivo.size / 1048576).toFixed(0) + ' MB)');
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
          registrar('autorização aprovada — retomando o envio');
          M.envio.fase = 'parado';
          M.comecarEnvio();
        } else if (status === 'recusado') {
          M.envio.fase = 'erro';
          M.envio.pedidoId = null;
          M.envio.erro = 'O superadmin recusou este envio.';
          registrar('autorização recusada');
          M.aoMudar({});
        } else if (tentativas < 240) {
          setTimeout(checar, 15000);
        }
      }).catch(function (erro) { registrar('não foi possível consultar a autorização: ' + erro.message); });
    })();
  }

  M.comecarEnvio = function () {
    var e = M.envio;
    e.erro = '';
    if (!e.arquivo) { e.erro = 'Escolha o arquivo de vídeo.'; return M.aoMudar({}); }
    if (!e.titulo.trim()) { e.erro = 'Informe o título.'; return M.aoMudar({}); }
    if (typeof window.tus === 'undefined') { e.erro = 'A biblioteca de envio (tus-js-client) não carregou. Confira a conexão e recarregue a página.'; return M.aoMudar({}); }
    if (e.fase === 'pausado' && e.upload) {
      e.fase = 'enviando';
      registrar('retomando o envio');
      e.upload.start();
      return M.aoMudar({});
    }
    e.fase = 'enviando';
    M.aoMudar({});
    var corpoPedido = e.pedidoId ? { pedidoId: e.pedidoId } : { titulo: e.titulo.trim(), duracaoEstimadaSeg: e.duracaoEstimadaSeg };
    M.api('/api/upload-token', { method: 'POST', body: JSON.stringify(corpoPedido) }).then(function (t) {
      if (t.aguardando) {
        e.fase = 'aguardando-autorizacao';
        e.pedidoId = t.pedidoId;
        registrar('envio aguardando autorização do superadmin');
        M.aoMudar({});
        acompanharAutorizacao(t.pedidoId);
        return;
      }
      e.pedidoId = null;
      e.videoId = t.videoId;
      registrar('vídeo criado: ' + t.videoId + ' (a assinatura vale até ' + new Date(t.expire * 1000).toLocaleTimeString('pt-BR') + ')');
      var upload = new window.tus.Upload(e.arquivo, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
        chunkSize: TAMANHO_PEDACO,
        headers: { AuthorizationSignature: t.signature, AuthorizationExpire: String(t.expire), VideoId: String(t.videoId), LibraryId: String(t.libraryId) },
        metadata: { filetype: e.arquivo.type || 'video/mp4', title: e.titulo.trim() },
        onProgress: function (enviados, total) { e.enviados = enviados; e.total = total; atualizarProgresso(); },
        onError: function (erro) { e.fase = 'erro'; e.erro = 'Falha no envio: ' + erro.message; registrar('ERRO: ' + erro.message); M.aoMudar({}); },
        onSuccess: function () {
          e.fase = 'enviado';
          e.enviados = e.total;
          registrar('envio concluído — o Bunny está codificando');
          M.toast('Vídeo enviado. Preencha os metadados à direita.');
          acompanharCodificacao(e.videoId);
          M.aoMudar({});
        }
      });
      e.upload = upload;
      /* Se a conexão caiu num envio anterior, o TUS retoma de onde parou. */
      upload.findPreviousUploads().then(function (anteriores) {
        if (anteriores.length) { upload.resumeFromPreviousUpload(anteriores[0]); registrar('retomando envio interrompido'); }
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
    registrar('envio pausado');
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
        if (s.pronto) { M.envio.encoding = 'Codificação concluída: já pode pôr no ar.'; registrar('codificação concluída'); }
        else if (s.falhou) { M.envio.encoding = 'A CODIFICAÇÃO FALHOU no Bunny — não ponha este título no ar.'; registrar('codificação falhou'); }
        else {
          M.envio.encoding = 'O Bunny está codificando: ' + (s.progresso != null ? s.progresso + '%' : '…');
          if (tentativas < 120) setTimeout(checar, 15000);
        }
        if (M.st.tela === 'enviar') M.aoMudar({ semPainel: true });
      }).catch(function (erro) { registrar('não foi possível consultar a codificação: ' + erro.message); });
    })();
  }

  M.painelEnvio = function (cat) {
    var e = M.envio;
    var cabecalho = h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: 'Título novo' }), h('h2', { class: 'p-cab-titulo', text: 'Metadados' }));
    if (e.fase !== 'enviado') {
      return { cab: cabecalho, corpo: h('div', { class: 'p-corpo-in' }, h('p', { class: 'p-nota', text: 'Os metadados abrem aqui quando o vídeo terminar de subir. Enquanto isso, a mesa continua livre: dá para editar outros títulos.' })) };
    }
    var campo = function (rot, id, entrada) { return h('div', { class: 'campo' }, h('label', { for: id, text: rot }), entrada); };
    return { cab: cabecalho, corpo: h('div', { class: 'p-corpo-in' }, h('div', { class: 'p-form' },
      h('p', { class: 'p-nota mono', text: 'vídeo ' + e.videoId }),
      campo('Título', 'n-titulo', h('input', { type: 'text', id: 'n-titulo', value: e.titulo })),
      campo('Série', 'n-serie', h('input', { type: 'text', id: 'n-serie', list: 'lista-series', placeholder: 'A classificar' })),
      h('div', { class: 'campo-trio' },
        campo('Temporada', 'n-temporada', h('input', { type: 'number', id: 'n-temporada', min: '1', step: '1' })),
        campo('Episódio', 'n-episodio', h('input', { type: 'number', id: 'n-episodio', min: '1', step: '1' })),
        campo('Ano', 'n-ano', h('input', { type: 'text', id: 'n-ano', inputmode: 'numeric' }))),
      campo('Sinopse', 'n-sinopse', h('textarea', { id: 'n-sinopse', rows: '5', placeholder: '2 a 3 frases, em terceira pessoa, descrevendo do que trata o vídeo.' })),
      campo('Capa (JPG), opcional', 'n-capa', h('input', { type: 'file', id: 'n-capa', accept: 'image/jpeg,image/png' })),
      campo('Legenda (.srt), opcional', 'n-legenda', h('input', { type: 'file', id: 'n-legenda', accept: '.srt,text/plain' })),
      h('p', { class: 'p-nota', text: 'O título entra no catálogo agora, fora do ar. Pôr no ar passa pelo rascunho, e só com a codificação pronta.' }),
      h('button', { type: 'button', class: 'botao botao-verde', id: 'n-salvar', text: 'Salvar no catálogo' }),
      h('p', { class: 'estado', id: 'n-estado', role: 'status' }))) };
  };

  function lerTexto(arquivo) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('não foi possível ler ' + arquivo.name)); };
      fr.readAsText(arquivo, 'utf-8');
    });
  }

  /* O título novo é a exceção ao rascunho: acrescentar um título fora do ar não
   * muda nada no site, então ele grava na hora — lendo o catálogo de novo e
   * gravando com o `rev`, como todo o resto. */
  M.salvarTituloNovo = function () {
    var e = M.envio, estado = M.$('n-estado');
    var val = function (id) { var n = M.$(id); return n ? n.value.trim() : ''; };
    if (!val('n-titulo')) { estado.textContent = 'O título não pode ficar vazio.'; return; }
    estado.textContent = 'Salvando…';
    var campos = {
      titulo: val('n-titulo'), serie: val('n-serie') || 'A classificar',
      temporada: val('n-temporada') ? Number(val('n-temporada')) : null, episodio: val('n-episodio') ? Number(val('n-episodio')) : null,
      ano: val('n-ano'), sinopse: val('n-sinopse'), publicar: false,
      arquivo: e.arquivo ? e.arquivo.name : '', tamanho_mb: e.arquivo ? Math.round(e.arquivo.size / 1048576) : null,
      videoId: e.videoId, libraryId: (M.st.servidor.config || {}).libraryId || null
    };
    var tarefas = [];
    var capa = M.$('n-capa') && M.$('n-capa').files[0];
    var legenda = M.$('n-legenda') && M.$('n-legenda').files[0];
    if (capa) tarefas.push(M.capaParaEnvio(capa).then(function (reduzida) {
      return reduzida.arrayBuffer();
    }).then(function (bytes) {
      return M.api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(e.videoId), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })
        .then(function (r) { if (r.capa_arquivo) { campos.capa_arquivo = r.capa_arquivo; campos.capa_versao = String(Date.now()); } registrar('capa enviada'); });
    }));
    /* A legenda que a mesa acabou de ler serve duas vezes: vai ao Bunny, e
     * vira a fala do título na busca. Os blocos
     * são condensados AQUI — a função recebe prontos. */
    var blocosDaFala = null;
    if (legenda) tarefas.push(lerTexto(legenda).then(function (srt) {
      blocosDaFala = AppIndice.blocosDaLegenda(srt);
      return M.api('/api/midia?tipo=legenda&videoId=' + encodeURIComponent(e.videoId), { method: 'POST', body: JSON.stringify({ srt: srt, srclang: 'pt', label: 'Português' }) })
        .then(function () { registrar('legenda enviada · ' + blocosDaFala.length + ' blocos de fala'); });
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
      M.envio = { upload: null, videoId: null, arquivo: null, titulo: '', fase: 'parado', enviados: 0, total: 0, registro: [], encoding: '', erro: '', pedidoId: null, duracaoEstimadaSeg: null };
      /* A BUSCA, no mesmo envio: ninguém aperta nada. Se falhar, o título
       * entra no catálogo do mesmo jeito — e a visão geral mostra que ele
       * ficou fora da busca pela fala. */
      M.indexarBusca(videoId, {
        fala: blocosDaFala || [],
        capitulos: [],
        sinopse: AppIndice.textoDaFicha(novo)
      }).then(function () { return M.carregarBusca(); }, function (erro) {
        M.toast('“' + novo.titulo + '” entrou no catálogo, mas ficou fora da busca: ' + erro.message);
      });
      return M.carregarServidor().then(function () {
        M.toast('“' + novo.titulo + '” entrou no catálogo, fora do ar.');
        M.escolher('item:' + novo.id, { tela: 'catalogo' });
      });
    }).catch(function (erro) {
      estado.textContent = erro.status === 409 ? 'O catálogo mudou em outra tela. Clique de novo em Salvar.' : erro.message;
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
      h('legend', { text: 'O que esta conta pode fazer' }),
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
      h('legend', { text: 'Limite de envio de vídeo' }),
      h('div', { class: 'campo-duo' },
        h('div', { class: 'campo' }, h('label', { for: prefixo + 'max-videos', text: 'Máximo de vídeos' }),
          h('input', { type: 'number', id: prefixo + 'max-videos', min: '0', step: '1', placeholder: 'sem limite',
            value: l.maxVideos != null ? String(l.maxVideos) : '' })),
        h('div', { class: 'campo' }, h('label', { for: prefixo + 'max-duracao', text: 'Duração máxima (minutos)' }),
          h('input', { type: 'number', id: prefixo + 'max-duracao', min: '0', step: '1', placeholder: 'sem limite',
            value: l.maxDuracaoSeg != null ? String(Math.round(l.maxDuracaoSeg / 60)) : '' }))),
      h('label', { class: 'permissao', for: prefixo + 'autorizacao' },
        h('input', { type: 'checkbox', id: prefixo + 'autorizacao', checked: l.autorizacaoManual === true }),
        h('span', null, h('b', { text: 'Exigir autorização manual' }),
          h('small', { text: 'cada envio espera você aprovar antes de ir para o Bunny' }))));
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
      topo('Contas', 'O superadmin — você — é a senha do ambiente e não aparece nesta lista. Cada conta entra com usuário e senha, e faz só o que estiver marcado. Tirar uma permissão ou trocar o limite de envio derruba a sessão aberta da pessoa no pedido seguinte.'));

    if (pedidos.length) {
      caixa.appendChild(h('div', { class: 'cartao-conta' },
        h('h2', { class: 'a-subtitulo', text: 'Pedidos de envio aguardando autorização' }),
        pedidos.map(function (p) {
          return h('div', { class: 'conta-topo' },
            h('div', null, h('b', { text: p.titulo }), h('span', { class: 'mono fraco', text: '  ' + p.usuario }),
              p.duracaoEstimadaSeg ? h('span', { class: 'p-nota', text: '  ~' + Math.round(p.duracaoEstimadaSeg / 60) + ' min' }) : null),
            h('div', { class: 'botoes-linha' },
              h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'pedido-aprovar', 'data-id': p.id, text: 'Aprovar' }),
              h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'pedido-recusar', 'data-id': p.id, text: 'Recusar' })));
        })));
    }

    if (M.contas.senhaNova) {
      caixa.appendChild(h('div', { class: 'senha-nova' },
        h('p', null, h('b', { text: 'A senha de ' + M.contas.senhaNova.usuario + ':' })),
        h('p', { class: 'senha-valor mono', text: M.contas.senhaNova.senha }),
        h('p', { class: 'p-nota', text: 'Copie e entregue à pessoa agora. Ela não volta a aparecer: o servidor guarda só o embaralhado.' }),
        h('button', { type: 'button', class: 'botao botao-pequeno', id: 'senha-ok', text: 'Já copiei' })));
    }

    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: 'Nova conta' }),
      h('div', { class: 'campo-duo' },
        h('div', { class: 'campo' }, h('label', { for: 'nc-usuario', text: 'Usuário' }),
          h('input', { type: 'text', id: 'nc-usuario', placeholder: 'maria', autocapitalize: 'none', spellcheck: 'false' }),
          h('p', { class: 'dica', text: 'minúsculas, números, _ ou -' })),
        h('div', { class: 'campo' }, h('label', { for: 'nc-nome', text: 'Nome' }),
          h('input', { type: 'text', id: 'nc-nome', placeholder: 'Maria Silva' }))),
      h('div', { class: 'campo' }, h('label', { for: 'nc-senha', text: 'Senha' }),
        h('div', { class: 'botoes-linha' },
          h('input', { type: 'text', id: 'nc-senha', class: 'mono', value: M.senhaSorteada() }),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', id: 'nc-sortear', text: 'Sortear outra' }))),
      caixaPermissoes('nc-', []),
      caixaLimiteEnvio('nc-', null),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', id: 'nc-criar', text: 'Criar conta' }),
        h('p', { class: 'estado', id: 'nc-estado', role: 'status' }))));

    if (M.contas.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', text: M.contas.erro }));
    if (M.contas.carregando && !contas.length) caixa.appendChild(h('p', { class: 'p-nota', text: 'Lendo as contas…' }));

    contas.forEach(function (c) {
      var editando = M.contas.editando === c.usuario;
      caixa.appendChild(h('div', { class: 'cartao-conta' + (c.ativa ? '' : ' desligada') },
        h('div', { class: 'conta-topo' },
          h('div', null, h('b', { text: c.nome }), h('span', { class: 'mono fraco', text: '  ' + c.usuario }),
            c.ativa ? null : chip('desativada', 'chip-alerta')),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-editar', 'data-usuario': c.usuario, text: editando ? 'Fechar' : 'Permissões' }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-senha', 'data-usuario': c.usuario, text: 'Trocar senha' }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-ativa', 'data-usuario': c.usuario, 'data-ativa': String(!c.ativa), text: c.ativa ? 'Desativar' : 'Ativar' }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conta-excluir', 'data-usuario': c.usuario, text: 'Excluir' }))),
        editando ? h('div', { class: 'conta-editor' }, caixaPermissoes('ec-', c.permissoes), caixaLimiteEnvio('ec-', c.limiteEnvio),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'conta-salvar', 'data-usuario': c.usuario, text: 'Salvar' }),
            h('p', { class: 'p-nota', text: 'Salvar derruba a sessão aberta desta conta.' })))
          : h('div', { class: 'conta-chips' }, c.permissoes.length
            ? c.permissoes.map(function (p) { return chip(App.ROTULO_PERMISSAO[p] || p); })
            : h('span', { class: 'p-nota', text: 'Só vê: nenhuma permissão marcada.' }))));
      if (!editando && c.permissoes.indexOf('enviar') >= 0) {
        var l = c.limiteEnvio;
        var partes = [];
        partes.push((c.enviosContagem || 0) + (l && l.maxVideos != null ? ' de ' + l.maxVideos : '') + (l && l.maxVideos != null ? ' vídeos' : ' vídeos enviados'));
        if (l && l.maxDuracaoSeg != null) partes.push('até ' + Math.round(l.maxDuracaoSeg / 60) + ' min por vídeo');
        if (l && l.autorizacaoManual === true) partes.push('autorização manual');
        caixa.lastChild.appendChild(h('p', { class: 'p-nota', text: partes.join(' · ') }));
      }
    });
    return caixa;
  };

  M.painelContas = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: 'Equipe' }), h('h2', { class: 'p-cab-titulo', text: 'Como funcionam' })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: 'A tela esconde o que a conta não pode usar, mas quem recusa é o servidor: toda gravação do catálogo é comparada campo a campo com o documento anterior.' }),
        h('ul', { class: 'lista-ajuda' }, App.PERMISSOES.map(function (p) {
          return h('li', null, h('b', { text: App.ROTULO_PERMISSAO[p] }), h('span', { text: App.AJUDA_PERMISSAO[p] }));
        })),
        h('div', { class: 'aviso-opcao' }, h('b', { text: 'O que só o superadmin faz: ' }),
          'trocar o vídeo de um título, mexer em capítulos e taxa de quadros, tirar título do catálogo e gerenciar contas. São os campos que vêm de script.'),
        h('p', { class: 'p-nota', text: 'A senha do superadmin é a variável ADMIN_PASSWORD do ambiente do Pages. Trocá-la derruba todas as sessões, de todas as contas.' })) };
  };

  /* ---------------------------------------------------------- minha conta */

  M.telaMinhaConta = function () {
    var s = M.sessao;
    return h('div', { class: 'a' },
      topo('Minha conta', 'Quem está usando a mesa neste navegador.'),
      h('div', { class: 'cartao-conta' },
        h('dl', { class: 'p-dados' },
          h('dt', { text: 'Nome' }), h('dd', { text: s.nome }),
          h('dt', { text: 'Usuário' }), h('dd', { class: 'mono', text: s.usuario }),
          h('dt', { text: 'Pode' }), h('dd', null, s.super ? 'tudo (superadmin)'
            : (s.permissoes.length ? s.permissoes.map(function (p) { return App.ROTULO_PERMISSAO[p] || p; }).join(' · ') : 'só ver'))),
        s.super
          ? h('p', { class: 'p-nota', text: 'A senha do superadmin é a variável ADMIN_PASSWORD, no ambiente do Pages — trocá-la é trocar a variável, e isso derruba todas as sessões.' })
          : h('div', { class: 'p-form' },
            h('div', { class: 'campo' }, h('label', { for: 'ms-atual', text: 'Senha atual' }), h('input', { type: 'password', id: 'ms-atual', autocomplete: 'current-password' })),
            h('div', { class: 'campo' }, h('label', { for: 'ms-nova', text: 'Senha nova' }),
              h('input', { type: 'password', id: 'ms-nova', autocomplete: 'new-password' }),
              h('p', { class: 'dica', text: 'pelo menos ' + App.SENHA_MINIMA + ' caracteres' })),
            h('div', { class: 'botoes-linha' },
              h('button', { type: 'button', class: 'botao botao-verde', id: 'ms-trocar', text: 'Trocar senha' }),
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
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try { ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height); }
      catch (e) { return reject(new Error('não foi possível ler a imagem: ' + e.message)); }
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('a capa não pôde ser gerada')); }, 'image/jpeg', QUALIDADE_CAPA);
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
    if (!video.videoWidth) return Promise.reject(new Error('o vídeo ainda não carregou'));
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
    var fonte = App.resolverFonte(item, M.st.servidor.config);
    if (!fonte) return Promise.reject(new Error('Sem vídeo no Bunny: não há onde guardar a capa.'));
    return M.capaParaEnvio(arquivo).then(function (blob) {
      return blob.arrayBuffer();
    }).then(function (bytes) {
      return M.api('/api/midia?tipo=capa&videoId=' + encodeURIComponent(fonte.videoId), {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes
      });
    }).then(function (resposta) {
      if (!resposta || !resposta.capa_arquivo) {
        throw new Error('o Bunny não informou o nome da capa nova, e o site pode estar sem ela: rode o sincronizar-capas.mjs');
      }
      if (resposta.rev) {
        /* Uma capa deste título que estivesse no rascunho ficou para trás: o
         * servidor já tem a nova. */
        M.desfazerMudanca(item.id, 'capa_arquivo');
        M.desfazerMudanca(item.id, 'capa_versao');
        return M.carregarServidor().then(function () {
          M.toast('Capa trocada no site · rev ' + resposta.rev);
          if (M.aoMudar) M.aoMudar({});
          return resposta;
        });
      }
      M.mudarVarios(item.id, [['capa_arquivo', resposta.capa_arquivo], ['capa_versao', String(Date.now())]]);
      M.toast(resposta.pendente
        ? 'A capa foi ao Bunny, mas o catálogo não foi gravado (' + (resposta.erro || 'sem motivo') +
          '). Publique agora: até lá o site fica sem esta capa.'
        : 'Capa enviada ao Bunny. Entra no site quando você publicar.');
      return resposta;
    });
  };

  M.telaCapa = function (cat) {
    var id = M.st.capaDe, it = id && App.porId(cat.itens, id);
    if (!it) return h('div', { class: 'a' }, topo('Escolher capa', 'Escolha um título primeiro.'));
    var mp4 = App.urlMp4(it, cat.config, '720p');
    var video = h('video', { class: 'capa-video', id: 'capa-video', controls: true, preload: 'metadata', playsinline: true });
    video.crossOrigin = 'anonymous';   /* precisa vir ANTES do src */
    if (mp4) video.src = mp4;
    return h('div', { class: 'a' },
      topo('Escolher a capa', App.tituloCurto(it) + ' · navegue até o quadro e use. Pausar ajuda a acertar.',
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'tela', 'data-tela': 'site', text: 'Voltar ao site' })),
      mp4 ? video : h('p', { class: 'estado estado-erro', text: 'Sem vídeo no Bunny: não há de onde tirar a capa.' }),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', id: 'capa-usar', disabled: !mp4, text: 'Usar este quadro' }),
        h('p', { class: 'estado', id: 'capa-estado', role: 'status' })),
      h('img', { class: 'capa-previa', id: 'capa-previa', alt: 'Prévia do quadro escolhido', hidden: true }));
  };

  M.usarQuadro = function () {
    var video = M.$('capa-video'), estado = M.$('capa-estado'), botao = M.$('capa-usar');
    var it = M.item(M.st.capaDe);
    if (!video || !it) return;
    video.pause();
    botao.disabled = true;
    estado.textContent = 'Capturando o quadro em ' + video.currentTime.toFixed(1) + ' s…';
    capturarQuadro(video).then(function (blob) {
      var previa = M.$('capa-previa');
      previa.src = URL.createObjectURL(blob);
      previa.hidden = false;
      estado.textContent = 'Enviando a capa (' + Math.round(blob.size / 1024) + ' KB)…';
      return M.enviarCapa(it, blob);
    }).then(function (resposta) {
      estado.textContent = resposta && resposta.rev ? 'Capa trocada no site.' : 'Capa no rascunho.';
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
    var fonte = App.resolverFonte(it, cat.config);
    var embed = fonte ? App.urlEmbed(fonte) : null;
    return h('div', { class: 'cartao-conta' },
      h('div', { class: 'embed-pendencia' }, embed
        ? h('iframe', { src: embed, allow: 'fullscreen', title: 'Prévia de ' + (it.titulo || it.id), loading: 'lazy' })
        : h('span', { class: 'p-nota', text: 'Sem vídeo no Bunny.' })),
      h('b', { text: it.titulo || '(sem título)' }), h('small', { class: 'fraco', text: '  ' + (it.serie || 'sem série') }),
      h('p', { class: 'p-nota mono', text: (App.formatarDuracao(it) || '—') + ' · ' + (it.publicar ? 'no ar' : 'fora do ar') }));
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

  var ROTULO_CLASSE = { pedagogica: 'Série', curta: 'Curta', institucional: 'Institucional' };

  var AJUDA_TEXTO = {
    rodape: 'O pé de toda página. O link "Administração" fica sempre.',
    semCapa: 'No lugar da imagem, quando o título não tem capa.',
    videoIndisponivel: 'Selo vermelho no cartão de quem está sem vídeo.',
    buscaVazia: 'Título da busca sem resultado. O termo buscado entra na linha de baixo.',
    buscaVaziaAjuda: 'A linha embaixo dele.',
    fichaAusente: 'Título do link de uma ficha que não existe ou saiu do ar.',
    fichaAusenteAjuda: 'A linha embaixo dele.',
    erroCatalogo: 'Título da falha de rede.',
    erroCatalogoAjuda: 'A linha embaixo. A mensagem técnica entra numa linha menor, depois dela.'
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
          'aria-label': 'Nome da prateleira ' + (padrao ? padrao.titulo : p.id), disabled: !pode
        }),
        escolha.titulo ? h('small', { class: 'dica', text: 'padrão: ' + (padrao ? padrao.titulo : '') }) : null),
      h('td', { class: 'mono num', text: String(p.itens.length) }),
      h('td', { class: 'col-botoes' },
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'pr-mover', 'data-id': p.id, 'data-passo': '-1', 'aria-label': 'Subir', title: 'Subir', disabled: !pode || pos === 0 }, M.ic('esq')),
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'pr-mover', 'data-id': p.id, 'data-passo': '1', 'aria-label': 'Descer', title: 'Descer', disabled: !pode || pos === total - 1 }, M.ic('dir')),
        h('button', { type: 'button', class: 'icone-botao' + (p.escondida ? ' apagado' : ''), 'data-acao': 'pr-esconder', 'data-id': p.id, 'aria-pressed': String(!!p.escondida), 'aria-label': p.escondida ? 'Mostrar na chegada' : 'Esconder da chegada', title: p.escondida ? 'Mostrar na chegada' : 'Esconder da chegada', disabled: !pode }, M.ic('olho')),
        h('button', { type: 'button', class: 'linha-link linha-link-curta', 'data-acao': 'escolher', 'data-alvo': 'prateleira:' + p.id }, h('span', { text: 'Ver na prévia' }))));
  }

  M.telaEstrutura = function (cat) {
    var site = M.site();
    var pode = M.pode('estrutura');
    var todas = App.prateleiras(cat.itens, site);
    var somem = App.titulosSoEmEscondidas(cat.itens, site);
    var a = h('div', { class: 'a' },
      topo('Estrutura', 'A chegada e os textos fixos do site. Tudo aqui entra no rascunho e vai ao ar no Publicar.',
        pode ? null : chip('só leitura', 'chip-alerta')));

    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: 'Prateleiras da chegada' }),
      h('p', { class: 'a-sub', text: 'Quem entra em cada prateleira é regra do código. O nome, a ordem e o esconder são escolha sua — e o campo vazio volta para o padrão.' }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('thead', null, h('tr', null,
          h('th', { class: 'col-ordem', text: '#' }), h('th', { text: 'Nome na chegada' }),
          h('th', { class: 'num', text: 'Títulos' }), h('th', { text: 'Ordem, esconder' }))),
        h('tbody', null, todas.map(function (p, i) { return linhaPrateleira(cat, site, p, i, todas.length, pode); })))),
      somem.length ? h('div', { class: 'aviso-opcao' },
        h('b', null, somem.length + (somem.length === 1 ? ' título não aparece' : ' títulos não aparecem') + ' na chegada. '),
        'Estão só em prateleira escondida — e continuam na busca, na página da série e no link direto.') : null));

    /* As séries, com a classe que o código dá e a que a mesa escolheu. A lista
     * sai do catálogo, e não das três listas do core: série nova aparece aqui
     * no dia em que o primeiro título dela entra. */
    var nomes = App.series(App.publicaveis(cat.itens));
    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: 'Classe das séries' }),
      h('p', { class: 'a-sub', text: 'Decide de que lado a série cai: prateleira própria e "Séries", a prateleira "Curtas", ou "Institucional". Sem escolha vale a lista do código — e a série que ninguém classificou é tratada como para a aula.' }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('thead', null, h('tr', null, h('th', { text: 'Série' }), h('th', { class: 'num', text: 'Títulos no ar' }), h('th', { text: 'Classe' }))),
        h('tbody', null, nomes.map(function (nome) {
          var quantos = App.publicaveis(cat.itens).filter(function (i) { return (i.serie || 'Sem série') === nome; }).length;
          var atual = App.classeDaSerie(nome, site);
          var escolhida = site.classes[nome];
          return h('tr', null,
            h('td', null, h('button', { type: 'button', class: 'linha-link', 'data-acao': 'escolher', 'data-alvo': 'serie:' + nome, title: 'A apresentação da série: o Sobre, o começo, os momentos e os temas' },
              h('span', { text: nome }), site.series[nome] ? h('small', { class: 'dica', text: site.series[nome].origem === 'revisada' ? 'apresentação revisada' : 'apresentação automática' }) : null),
              escolhida ? h('small', { class: 'dica', text: 'padrão: ' + ROTULO_CLASSE[App.classeDaSerie(nome, null)] }) : null),
            h('td', { class: 'mono num', text: String(quantos) }),
            h('td', null, h('select', { 'data-classe-serie': nome, 'aria-label': 'Classe de ' + nome, disabled: !pode },
              App.CLASSES_SERIE.map(function (c) {
                return h('option', { value: c, selected: c === atual ? 'selected' : null, text: ROTULO_CLASSE[c] });
              }))));
        }))))));

    a.appendChild(h('section', { class: 'a-bloco' },
      h('h2', { class: 'a-bloco-titulo', text: 'Textos fixos' }),
      h('p', { class: 'a-sub', text: 'O rodapé e os cinco estados vazios do site. O campo vazio mostra o texto padrão, que é o que está escrito em cinza.' }),
      h('div', { class: 'p-form' }, Object.keys(App.TEXTOS_PADRAO).map(function (chave) {
        return h('div', { class: 'campo' },
          h('label', { for: 'tx-' + chave }, AJUDA_TEXTO[chave] || chave,
            site.textos[chave] ? h('span', { class: 'ponto ponto-ouro', title: 'no rascunho ou já gravado' }) : null),
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
    return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'
      : Math.round(bytes / 1024) + ' KB';
  }

  function valorDoHistorico(campo, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (v === true) return 'sim';
    if (v === false) return 'não';
    if (Array.isArray(v)) return v.join(', ');
    if (campo === 'arrastoTeto') return Math.round(v * 100) + '%';
    if (campo === 'controlesEspera') return v + ' s';
    if (campo === 'pendencia') return App.rotuloPendencia(v);
    if (typeof v === 'object') {
      var n = Object.keys(v).length;
      return n + (n === 1 ? ' escolha' : ' escolhas');
    }
    var t = String(v);
    return t.length > 90 ? t.slice(0, 88) + '…' : t;
  }

  function nomeDoAlvoNoHistorico(cat, alvo) {
    if (alvo === 'site') return 'Estrutura do site';
    if (alvo === 'ajustes') return 'Player';
    var it = App.porId(cat.itens, alvo);
    return it ? App.tituloCurto(it) : alvo;
  }

  function linhaDaMudanca(cat, dif) {
    var podeDesfazer = !!App.desfazerMudanca(dif) && M.pode(dif.permissao);
    var rotulo = dif.tipo === 'novo' ? 'título novo' : dif.tipo === 'removido' ? 'título removido'
      : (M.CAMPO[dif.campo] || dif.campo);
    return h('tr', null,
      h('td', null, h('span', { text: nomeDoAlvoNoHistorico(cat, dif.alvo) })),
      h('td', null, h('b', { text: rotulo })),
      h('td', { class: 'hist-de', text: valorDoHistorico(dif.campo, dif.antes) }),
      h('td', { class: 'hist-para', text: valorDoHistorico(dif.campo, dif.depois) }),
      h('td', { class: 'col-botoes' }, podeDesfazer
        ? h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-desfazer', 'data-i': String(dif.indice), text: 'Desfazer' })
        : h('span', { class: 'dica', text: dif.tipo ? 'sai por script' : 'sem permissão' })));
  }

  M.telaHistorico = function (cat) {
    var hist = M.hist;
    var a = h('div', { class: 'a' },
      topo('Histórico', 'Cada publicação, o que ela mudou e de onde dá para voltar. Ver é de todo admin; desfazer entra no rascunho.',
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-recarregar' }, M.ic('recarregar'), 'Atualizar')));

    if (hist.erro) a.appendChild(h('div', { class: 'aviso-opcao' }, h('b', null, 'Não deu para ler o histórico. '), hist.erro));
    if (!hist.linha.length) {
      a.appendChild(h('p', { class: 'p-nota', text: hist.carregando ? 'Lendo…'
        : 'Nenhuma publicação registrada ainda. O histórico começa na primeira publicação depois desta versão do site.' }));
      return a;
    }

    var corpo = h('tbody');
    hist.linha.forEach(function (p) {
      var aberta = hist.rev === p.rev;
      corpo.appendChild(h('tr', { class: aberta ? 'sel' : '' },
        h('td', { class: 'mono col-ordem', text: String(p.rev) }),
        h('td', null, h('div', { class: 't-texto' },
          h('b', { text: M.quando(p.em) || '—' }),
          h('small', { text: p.quem + (p.restaurou != null ? ' · voltou à rev ' + p.restaurou : '') }))),
        h('td', null, h('span', { text: p.resumo || '—' }),
          h('small', { class: 'dica', text: p.n + (p.n === 1 ? ' campo' : ' campos') + (p.bytes ? ' · catálogo com ' + tamanho(p.bytes) : '') })),
        h('td', { class: 'col-botoes' },
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-abrir', 'data-rev': String(p.rev), 'aria-expanded': String(aberta), text: aberta ? 'Fechar' : 'Ver o que mudou' }))));

      if (!aberta) return;
      var detalhe = h('td', { colspan: '4', class: 'hist-detalhe' });
      if (!hist.registro) {
        detalhe.appendChild(h('p', { class: 'p-nota', text: hist.erro || 'Lendo o registro…' }));
      } else {
        var difs = (hist.registro.mudancas || []).map(function (d, i) { return Object.assign({ indice: i }, d); });
        detalhe.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
          h('thead', null, h('tr', null, h('th', { text: 'Onde' }), h('th', { text: 'O quê' }),
            h('th', { text: 'Era' }), h('th', { text: 'Ficou' }), h('th', { text: 'Desfazer' }))),
          h('tbody', null, difs.map(function (d) { return linhaDaMudanca(cat, d); })))));
        if (hist.registro.cortado) {
          detalhe.appendChild(h('p', { class: 'p-nota', text: 'Mostrando as primeiras ' + difs.length + ' de ' + hist.registro.total + ' mudanças desta publicação.' }));
        }
        detalhe.appendChild(h('div', { class: 'botoes-linha' },
          hist.temCopia
            ? h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'hist-restaurar', 'data-rev': String(p.rev), disabled: !M.pode('historico'), text: 'Voltar o catálogo para esta versão' })
            : h('span', { class: 'dica', text: 'A cópia inteira desta rev já saiu — ficam as 30 últimas. O registro do que mudou fica para sempre.' }),
          M.pode('historico') && hist.temCopia
            ? h('span', { class: 'dica', text: 'A volta é uma publicação nova, conferida campo a campo.' }) : null));
      }
      corpo.appendChild(h('tr', { class: 'hist-linha-detalhe' }, detalhe));
    });

    a.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
      h('thead', null, h('tr', null, h('th', { class: 'col-ordem', text: 'rev' }), h('th', { text: 'Quando e quem' }),
        h('th', { text: 'O que mudou' }), h('th', { text: '' }))),
      corpo)));

    if (!hist.fim) {
      a.appendChild(h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'hist-mais', text: hist.carregando ? 'Lendo…' : 'Ver mais antigas' }));
    }
    return a;
  };

  M.telaPendencias = function (cat) {
    var pos = M.filaPosicao('fila-pendencias');
    if (!pos || !pos.lista.length) {
      return h('div', { class: 'a' }, topo('Pendências', 'Nenhum título com pendência agora.'));
    }
    var it = pos.indice >= 0 ? pos.lista[pos.indice] : pos.lista[0];
    var outra = it.pendencia === 'versao_duplicada' ? App.outraVersaoDuplicada(cat.itens, it) : null;
    var podeConteudo = M.pode('conteudo'), podeNoAr = M.pode('no-ar');
    return h('div', { class: 'a' },
      topo('Pendências', (pos.indice + 1) + ' de ' + pos.lista.length + ' — decidir uma por vez.', h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-anterior', disabled: pos.indice <= 0, text: '← Anterior' }),
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-proxima', disabled: pos.indice >= pos.lista.length - 1, text: 'Próxima →' }))),
      h('div', { class: 'decisao' }, h('p', { class: 'decisao-rotulo' }, M.ic('alerta'), App.rotuloPendencia(it.pendencia))),
      it.nota_curadoria ? h('p', { class: 'nota-curadoria', text: it.nota_curadoria }) : null,
      h('div', { class: 'campo-duo' },
        cartaoPendencia(it, cat),
        outra ? cartaoPendencia(outra, cat) : it.pendencia === 'versao_duplicada'
          ? h('div', { class: 'cartao-conta' }, h('p', { class: 'p-nota', text: 'A outra versão não está mais no catálogo — não há o que comparar. Decida pelo que sobrou.' }))
          : null),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde botao-pequeno', 'data-acao': 'fila-resolver', 'data-id': it.id, disabled: !podeConteudo, text: 'Resolvida — tirar a pendência' }),
        it.publicar ? h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'fila-tirar-do-ar', 'data-id': it.id, disabled: !podeNoAr, text: 'Tirar do ar' }) : null,
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'abrir-ficha', 'data-id': it.id, text: 'Ver a ficha' })),
      h('p', { class: 'p-nota', text: 'Também dá para decidir pelos campos “Pendência” e “No ar”, no painel da direita.' }));
  };
})();
