/* mesa-ia.js — a tela "IA" da mesa (M9): ligar e desligar cada recurso, ver provedor, orçamento e estimativa, e REVISAR a fila de sugestões.
 *
 * NADA GERADO VAI AO AR SOZINHO. Tudo que a IA escreve (sinopse, capítulos, tags, legenda traduzida) ou corta (clipe e trailer)
 * espera aqui como SUGESTÃO, ao lado do que está no ar hoje. A pessoa aceita, edita e aceita, ou descarta. Quem decide
 * e grava é o servidor (/api/ia, /api/ia-sugestoes); a mesa só conduz, e pede confirmação antes de qualquer coisa que gaste dinheiro.
 *
 * O provedor, o modelo e o orçamento vêm de config/site.json (ia.*) e aparecem aqui só para LER; o liga e desliga é do superadmin
 * e vale na hora (fica no KV, sem novo deploy). As chaves nunca chegam aqui: só "tem" ou "falta". */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr, O = M.operacao;

  var TEXTOS = ['sinopse-curta', 'sinopse-longa', 'capitulos', 'tags', 'titulo-alternativo', 'descricao-acessivel', 'traducao-legenda'];
  var RECURSOS = TEXTOS.concat(['transcricao', 'trailer']);
  /* o que a tela manda para a estimativa (o "trailer" estima a escolha de trechos pelo modelo) */
  var PARA_ESTIMAR = { trailer: 'trechos-trailer' };
  var CAMPOS_DE_TEXTO = ['sinopse', 'sinopse_longa', 'titulo_alternativo', 'descricao_acessivel'];
  var MAX_AQUI = 3;

  var I = M.ia = {
    estado: null, fila: null, erro: '', carregando: false,
    tarefas: {}, ids: [], estimativa: null, estimando: false, gerando: false, resultado: null,
    editando: '', texto: '', tagsNovas: false
  };

  function chave(s) { return s.itemId + '|' + s.campo; }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    try { return new Intl.NumberFormat(M.I18n.idioma(), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n); } catch (e) { return 'US$ ' + n; }
  }
  function mmss(seg) { var s = Math.max(0, Math.round(Number(seg) || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function quando(iso) { var t = Date.parse(iso || ''); return isFinite(t) ? M.I18n.data(t, 'dataHora') : '—'; }
  function rotuloDoCampo(campo) {
    var m = /^legenda-(.+)$/.exec(campo);
    return m ? tr('ia.campo.legenda', { idioma: m[1] }) : O.texto('ia.campo.' + campo, null, campo);
  }
  function redesenhar() { O.redesenhar(); }

  /* ------------------------------------------------------------- dados */

  I.carregar = function () {
    I.carregando = true;
    return Promise.all([M.api('/api/ia'), M.api('/api/ia-sugestoes')]).then(function (r) {
      I.estado = r[0]; I.fila = r[1].sugestoes || []; I.erro = '';
    }).catch(function (e) { I.erro = e.message; }).then(function () { I.carregando = false; redesenhar(); });
  };
  I.pendentes = function () { return I.estado ? I.estado.pendentes : 0; };

  function sel() { return RECURSOS.filter(function (t) { return I.tarefas[t]; }); }
  function paraEstimar() { return sel().map(function (t) { return PARA_ESTIMAR[t] || t; }); }

  I.estimar = function () {
    var t = paraEstimar();
    if (!t.length) { M.toast(tr('ia.escolhaUmaTarefa')); return Promise.resolve(); }
    I.estimando = true; I.estimativa = null; I.resultado = null; redesenhar();
    return M.api('/api/ia', { method: 'POST', body: JSON.stringify({ acao: 'estimar', tarefas: t, ids: I.ids }) })
      .then(function (r) { I.estimativa = r; })
      .catch(function (e) { M.toast(e.message); })
      .then(function () { I.estimando = false; redesenhar(); });
  };

  /* Só texto, e poucos títulos por vez: o Worker tem tempo curto. Lote maior vai para o GitHub (ffmpeg e fôlego). */
  I.gerarAqui = function () {
    var t = sel();
    if (!window.confirm(tr('ia.confirmaGastar', { total: usd(I.estimativa && I.estimativa.estimativa.totalUSD) }))) return Promise.resolve();
    I.gerando = true; I.resultado = null; redesenhar();
    return M.api('/api/ia', { method: 'POST', body: JSON.stringify({ acao: 'gerar', tarefas: t, ids: I.ids }) })
      .then(function (r) { I.resultado = r; M.toast(tr('ia.geradoNaFila')); return I.carregar(); })
      .catch(function (e) { M.toast(e.message); })
      .then(function () { I.gerando = false; redesenhar(); });
  };

  I.gerarNoGithub = function () {
    var t = sel(), lotes = [];
    var texto = t.filter(function (x) { return TEXTOS.indexOf(x) >= 0; });
    if (texto.length) lotes.push({ tarefa: 'textos', subtarefas: texto });
    if (I.tarefas.transcricao) lotes.push({ tarefa: 'transcrever' });
    if (I.tarefas.trailer) lotes.push({ tarefa: 'trailer' });
    if (!window.confirm(tr('ia.confirmaGithub', { total: usd(I.estimativa && I.estimativa.estimativa.totalUSD) }))) return Promise.resolve();
    I.gerando = true; redesenhar();
    return lotes.reduce(function (p, l) {
      return p.then(function () { return M.api('/api/ia', { method: 'POST', body: JSON.stringify({ acao: 'disparar', tarefa: l.tarefa, subtarefas: l.subtarefas, ids: I.ids }) }); });
    }, Promise.resolve()).then(function () { M.toast(tr('ia.disparado')); })
      .catch(function (e) { M.toast(e.message); })
      .then(function () { I.gerando = false; redesenhar(); });
  };

  I.ligar = function (tarefa, ligar) {
    if (ligar && !window.confirm(tr('ia.confirmaLigar', { recurso: tr('ia.recurso.' + tarefa) }))) return redesenhar();
    var corpo = { recursos: {} }; corpo.recursos[tarefa] = ligar;
    return M.api('/api/ia', { method: 'PUT', body: JSON.stringify(corpo) })
      .then(function () { return I.carregar(); })
      .catch(function (e) { M.toast(e.message); redesenhar(); });
  };

  function achar(k) { return (I.fila || []).filter(function (s) { return chave(s) === k; })[0] || null; }

  I.aceitar = function (k) {
    var s = achar(k); if (!s) return Promise.resolve();
    if (s.mudouDesde && !window.confirm(tr('ia.confirmaSobrescrever'))) return Promise.resolve();
    var corpo = { itemId: s.itemId, campo: s.campo };
    if (I.editando === k) corpo.edicao = I.texto;
    if (s.campo === 'tags' && I.tagsNovas) corpo.incluirTagsNovas = true;
    return M.api('/api/ia-sugestoes', { method: 'PUT', body: JSON.stringify(corpo) }).then(function (r) {
      M.toast(tr(r.decisao === 'aceita-editada' ? 'ia.aceitaEditada' : 'ia.aceita'));
      I.editando = ''; I.tagsNovas = false;
      return Promise.all([I.carregar(), M.carregarServidor ? M.carregarServidor() : null]);
    }).catch(function (e) { M.toast(e.status === 409 ? tr('ia.catalogoMudou') : e.message); });
  };

  I.descartar = function (k) {
    var s = achar(k); if (!s) return Promise.resolve();
    return M.api('/api/ia-sugestoes', { method: 'DELETE', body: JSON.stringify({ itemId: s.itemId, campo: s.campo }) })
      .then(function () { M.toast(tr('ia.descartada')); if (I.editando === k) I.editando = ''; return I.carregar(); })
      .catch(function (e) { M.toast(e.message); });
  };

  /* ------------------------------------------------------------- desenho */

  function valorEmTexto(campo, v) {
    if (v === null || v === undefined || v === '') return h('p', { class: 'p-nota', text: tr('ia.vazio') });
    if (/^legenda-/.test(campo)) return h('pre', { class: 'ia-valor ia-pre mono', text: String(v) });
    if (campo === 'capitulos') {
      return h('ol', { class: 'ia-valor lista-ajuda' }, (Array.isArray(v) ? v : []).map(function (c) { return h('li', { text: mmss(c.inicio) + '  ' + c.titulo }); }));
    }
    if (campo === 'tags') {
      return h('div', { class: 'ia-valor' },
        v.tema ? h('p', null, h('b', { text: tr('ia.tema') + ' ' }), v.tema) : null,
        h('p', null, h('b', { text: tr('ia.tags') + ' ' }), (v.tags || []).join(', ') || '—'),
        v.tagsNovas && v.tagsNovas.length ? h('p', { class: 'p-nota' }, h('b', { text: tr('ia.tagsNovas') + ' ' }), v.tagsNovas.join(', ')) : null);
    }
    if (campo === 'midia_clipe' || campo === 'midia_trailer') {
      /* só controles: nada toca sozinho (o guardião do player vale para o site; aqui a pessoa aperta o play) */
      var video = h('video', { class: 'ia-video', controls: true, preload: 'none', muted: true, playsinline: true, src: v.url, poster: v.posterUrl || null, 'aria-label': rotuloDoCampo(campo) });
      return h('div', { class: 'ia-valor' }, video, h('p', { class: 'p-nota mono', text: [v.duracao ? Math.round(v.duracao) + ' s' : '', v.bytes ? (v.bytes / 1048576).toFixed(1) + ' MB' : ''].filter(Boolean).join(' · ') }));
    }
    return h('p', { class: 'ia-valor', text: String(v) });
  }

  function cartaoSugestao(s) {
    var k = chave(s);
    var p = s.proveniencia || {};
    var editavel = CAMPOS_DE_TEXTO.indexOf(s.campo) >= 0;
    var editando = I.editando === k;
    var podeRever = M.pode('conteudo');
    var lado = h('div', { class: 'ia-par' },
      h('div', { class: 'ia-lado' }, h('h4', { class: 'p-rotulo', text: tr('ia.noArHoje') }),
        /legenda-/.test(s.campo) ? h('p', { class: 'p-nota', text: tr('ia.legendaNova') }) : valorEmTexto(s.campo, s.atual)),
      h('div', { class: 'ia-lado ia-lado-sugerido' }, h('h4', { class: 'p-rotulo', text: tr('ia.sugestao') }),
        editando
          ? h('textarea', { class: 'ia-edicao', id: 'ia-edicao', rows: 6, 'aria-label': tr('ia.editar'), text: I.texto })
          : valorEmTexto(s.campo, s.valor),
        s.truncado ? h('p', { class: 'p-nota', text: tr('ia.truncado', { n: s.valorTamanho }) }) : null));
    return h('div', { class: 'cartao-conta ia-sug', 'data-sug': k },
      h('div', { class: 'ia-sug-topo' },
        h('h3', { class: 'a-subtitulo', text: (s.titulo || s.itemId) + ' · ' + rotuloDoCampo(s.campo) }),
        h('span', { class: 'chip', text: p.origem === 'ia' ? tr('ia.geradoPorIA') : tr('ia.geradoAutomatico') })),
      h('p', { class: 'p-nota' }, tr('ia.proveniencia', { modelo: p.modelo || '—', data: quando(p.data || s.criadaEm) }), ' ', h('b', { text: tr('ia.naoRevisado') })),
      s.mudouDesde ? h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('ia.mudouTitulo') + ' ' }), tr('ia.mudouTexto')) : null,
      lado,
      s.campo === 'tags' && s.valor && s.valor.tagsNovas && s.valor.tagsNovas.length
        ? h('label', { class: 'permissao', for: 'ia-tagsnovas' }, h('input', { type: 'checkbox', id: 'ia-tagsnovas', 'data-ia': 'tagsnovas', checked: I.tagsNovas }), h('span', null, h('b', { text: tr('ia.incluirTagsNovas') }), h('small', { text: tr('ia.incluirTagsNovasDica') })))
        : null,
      podeRever ? h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'ia-aceitar', 'data-k': k, text: editando ? tr('ia.aceitarEditada') : tr('ia.aceitar') }),
        editavel ? h('button', { type: 'button', class: 'botao', 'data-acao': 'ia-editar', 'data-k': k, text: editando ? tr('ia.cancelarEdicao') : tr('ia.editar') }) : null,
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'ia-descartar', 'data-k': k, text: tr('ia.descartar') })) : null);
  }

  function cartaoFila() {
    var f = I.fila || [];
    var caixa = h('div', { class: 'ia-fila' },
      h('h2', { class: 'a-subtitulo', text: tr('ia.filaTitulo', { n: f.length }) }),
      h('p', { class: 'p-nota', text: tr('ia.filaTexto') }));
    if (!f.length) caixa.appendChild(h('p', { class: 'p-nota', role: 'status', text: tr('ia.filaVazia') }));
    f.forEach(function (s) { caixa.appendChild(cartaoSugestao(s)); });
    return caixa;
  }

  function cartaoEstado() {
    var e = I.estado, t = e.textos, f = e.transcricao, o = e.orcamento;
    var pct = o.limiteUSD > 0 ? Math.min(100, Math.round((o.gastoUSD / o.limiteUSD) * 100)) : 0;
    function linha(rotulo, c) {
      return h('tr', null,
        h('th', { scope: 'row', text: rotulo }),
        h('td', { class: 'mono', text: c.provedor === 'nenhum' ? tr('ia.desligado') : c.provedor }),
        h('td', { class: 'mono', text: c.modelo || '—' }),
        h('td', null, O.chip(c.provedor === 'nenhum' ? tr('ia.chaveNaoSeAplica') : c.pronto ? tr('ia.chaveOk') : tr('ia.chaveFalta'), c.provedor !== 'nenhum' && c.pronto ? 'chip-ok' : '')));
    }
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('ia.provedorTitulo') }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('caption', { class: 'so-leitor', text: tr('ia.provedorTitulo') }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: tr('ia.colUso') }), h('th', { scope: 'col', text: tr('ia.colProvedor') }), h('th', { scope: 'col', text: tr('ia.colModelo') }), h('th', { scope: 'col', text: tr('ia.colChave') }))),
        h('tbody', null, linha(tr('ia.usoTextos'), t), linha(tr('ia.usoTranscricao'), f)))),
      h('p', { class: 'p-nota', text: tr('ia.provedorOnde') }),
      e.privacidade && e.privacidade.conteudoSaiDaConta
        ? h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('ia.privacidadeTitulo') + ' ' }), tr('ia.privacidadeSai'))
        : h('p', { class: 'p-nota', text: tr('ia.privacidadeFica') }),
      h('h3', { class: 'a-subtitulo', text: tr('ia.orcamentoTitulo') }),
      h('p', { class: 'p-nota' }, tr('ia.orcamentoTexto', { gasto: usd(o.gastoUSD), limite: usd(o.limiteUSD), restante: usd(o.restanteUSD) })),
      h('progress', { max: 100, value: pct, 'aria-label': tr('ia.orcamentoTitulo'), class: 'ia-barra' }),
      h('p', { class: 'p-nota', text: tr('ia.precosData', { data: e.precos.data }) }));
  }

  function cartaoRecursos() {
    var e = I.estado, ehSuper = M.sessao.super;
    var caixa = h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('ia.recursosTitulo') }),
      h('p', { class: 'p-nota', text: tr('ia.recursosTexto') }));
    RECURSOS.forEach(function (t) {
      var r = e.recursos[t] || { ligado: false };
      caixa.appendChild(h('label', { class: 'permissao', for: 'ia-rec-' + t },
        h('input', { type: 'checkbox', id: 'ia-rec-' + t, 'data-ia': 'recurso', 'data-tarefa': t, checked: r.ligado, disabled: !ehSuper }),
        h('span', null, h('b', { text: tr('ia.recurso.' + t) }), h('small', { text: tr('ia.recursoDica.' + t) }))));
    });
    if (!ehSuper) caixa.appendChild(h('p', { class: 'p-nota', text: tr('ia.soSuperLiga') }));
    return caixa;
  }

  function cartaoLote() {
    var e = I.estado, ehSuper = M.sessao.super;
    var cat = M.efetivo ? M.efetivo() : null;
    var itens = (cat && cat.itens) || [];
    var algumaLigada = RECURSOS.some(function (t) { return e.recursos[t] && e.recursos[t].ligado; });
    var caixa = h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('ia.loteTitulo') }),
      h('p', { class: 'p-nota', text: tr('ia.loteTexto') }));
    var grupo = h('fieldset', { class: 'bkp-partes' }, h('legend', { class: 'p-rotulo', text: tr('ia.oQueGerar') }));
    RECURSOS.forEach(function (t) {
      grupo.appendChild(h('label', { class: 'permissao', for: 'ia-t-' + t },
        h('input', { type: 'checkbox', id: 'ia-t-' + t, 'data-ia': 'tarefa', 'data-tarefa': t, checked: I.tarefas[t] === true }),
        h('span', null, h('b', { text: tr('ia.recurso.' + t) }), (e.recursos[t] && e.recursos[t].ligado) ? null : h('small', { text: tr('ia.estaDesligado') }))));
    });
    caixa.appendChild(grupo);
    caixa.appendChild(h('div', { class: 'campo' },
      h('label', { for: 'ia-ids', text: tr('ia.quaisTitulos') }),
      h('select', { id: 'ia-ids', multiple: true, size: 6, 'data-ia': 'ids', 'aria-describedby': 'ia-ids-dica' },
        itens.map(function (i) { return h('option', { value: i.id, selected: I.ids.indexOf(i.id) >= 0, text: i.titulo || i.id }); })),
      h('p', { class: 'dica', id: 'ia-ids-dica', text: tr('ia.quaisTitulosDica', { n: MAX_AQUI }) })));
    var texto = sel().every(function (t) { return TEXTOS.indexOf(t) >= 0; });
    var cabeAqui = sel().length > 0 && texto && I.ids.length > 0 && I.ids.length <= MAX_AQUI;
    var gh = e.executor && e.executor.github;
    caixa.appendChild(h('div', { class: 'botoes-linha' },
      h('button', { type: 'button', class: 'botao', 'data-acao': 'ia-estimar', disabled: I.estimando || !sel().length, text: I.estimando ? tr('ia.estimando') : tr('ia.estimar') }),
      ehSuper ? h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'ia-gerar-aqui', disabled: I.gerando || !I.estimativa || !I.estimativa.decisao.ok || !cabeAqui || !algumaLigada, text: I.gerando ? tr('ia.gerando') : tr('ia.gerarAqui') }) : null,
      ehSuper && gh && gh.ligado ? h('button', { type: 'button', class: 'botao', 'data-acao': 'ia-gerar-github', disabled: I.gerando || !I.estimativa || !I.estimativa.decisao.ok || !gh.pronto || !I.ids.length, text: tr('ia.gerarGithub') }) : null));
    if (ehSuper && I.estimativa && !cabeAqui) caixa.appendChild(h('p', { class: 'p-nota', text: tr('ia.naoCabeAqui', { n: MAX_AQUI }) }));
    if (ehSuper && gh && gh.ligado && !gh.pronto) caixa.appendChild(h('p', { class: 'p-nota p-nota-alerta', text: tr('ia.githubSemToken', { nome: gh.nomeDoToken }) }));
    if (I.estimativa) caixa.appendChild(blocoEstimativa(I.estimativa));
    if (I.resultado && I.resultado.resultados) caixa.appendChild(blocoResultado(I.resultado.resultados));
    return caixa;
  }

  function blocoEstimativa(r) {
    var es = r.estimativa, d = r.decisao;
    var linhas = Object.keys(es.porTarefa).map(function (t) { return h('li', { text: O.texto('ia.recurso.' + t.replace('trechos-trailer', 'trailer'), null, t) + ': ' + usd(es.porTarefa[t]) }); });
    return h('div', { class: 'aviso-opcao', role: 'region', 'aria-live': 'polite', 'aria-label': tr('ia.estimativaTitulo') },
      h('b', { text: tr('ia.estimativaTitulo') + ' ' }),
      tr('ia.estimativaTexto', { total: usd(es.totalUSD), restante: usd(es.restanteUSD), data: es.dataDosPrecos, margem: Math.round((es.margem - 1) * 100) }),
      h('ul', { class: 'lista-ajuda' }, linhas),
      !es.precosConfirmados ? h('p', { class: 'p-nota', text: tr('ia.precoNaoConfirmado') }) : null,
      d.ok ? null : h('p', { class: 'estado estado-erro', role: 'alert', text: tr('ia.recusadoOrcamento', { total: usd(d.totalUSD), restante: usd(d.restanteUSD) }) }),
      es.avisos.indexOf('ia-desligada') >= 0 ? h('p', { class: 'p-nota p-nota-alerta', text: tr('ia.semProvedor') }) : null);
  }

  function blocoResultado(res) {
    var linhas = [];
    res.forEach(function (it) {
      (it.resultados || []).forEach(function (x) {
        linhas.push(h('li', { text: it.id + ' · ' + O.texto('ia.recurso.' + x.tarefa, null, x.tarefa) + ': ' + O.texto('ia.estado.' + x.estado, null, x.estado) }));
      });
    });
    return h('div', { class: 'aviso-opcao', role: 'status' }, h('b', { text: tr('ia.resultadoTitulo') }), h('ul', { class: 'lista-ajuda' }, linhas));
  }

  M.telaIA = function () {
    if (!I.estado && !I.carregando && !I.erro) I.carregar();
    var caixa = h('div', { class: 'a ia' }, O.topo(tr('ia.titulo'), tr('ia.sub')));
    if (!I.estado) {
      caixa.appendChild(I.erro
        ? h('div', { class: 'cartao-conta' }, h('p', { class: 'estado estado-erro', role: 'alert', text: I.erro }), h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'ia-tentar', text: tr('ia.tentarDeNovo') }))
        : h('p', { class: 'p-nota', role: 'status', text: tr('ia.carregando') }));
      return caixa;
    }
    caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('ia.regraTitulo') + ' ' }), tr('ia.regraTexto')));
    caixa.appendChild(cartaoFila());
    caixa.appendChild(cartaoRecursos());
    caixa.appendChild(cartaoLote());
    caixa.appendChild(cartaoEstado());
    return caixa;
  };

  M.painelIA = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('ia.painelTitulo') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('ia.painel1') }),
        h('p', { class: 'p-nota', text: tr('ia.painel2') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('ia.painelCustoTitulo') + ' ' }), tr('ia.painelCusto'))) };
  };

  /* -------------------------------------------------------------- ações */

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="ia-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao'), k = b.getAttribute('data-k');
    if (a === 'ia-tentar') { I.erro = ''; return I.carregar(); }
    if (a === 'ia-estimar') return I.estimar();
    if (a === 'ia-gerar-aqui') return I.gerarAqui();
    if (a === 'ia-gerar-github') return I.gerarNoGithub();
    if (a === 'ia-aceitar') return I.aceitar(k);
    if (a === 'ia-descartar') return I.descartar(k);
    if (a === 'ia-editar') {
      if (I.editando === k) I.editando = '';
      else { var s = achar(k); I.editando = k; I.texto = s && typeof s.valor === 'string' ? s.valor : ''; }
      return redesenhar();
    }
  });

  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'ia-edicao') I.texto = ev.target.value;
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target, que = t && t.getAttribute ? t.getAttribute('data-ia') : null;
    if (!que) return;
    if (que === 'recurso') return I.ligar(t.getAttribute('data-tarefa'), t.checked);
    if (que === 'tarefa') { I.tarefas[t.getAttribute('data-tarefa')] = t.checked; I.estimativa = null; return redesenhar(); }
    if (que === 'ids') { I.ids = [].slice.call(t.selectedOptions).map(function (o) { return o.value; }); I.estimativa = null; return redesenhar(); }
    if (que === 'tagsnovas') { I.tagsNovas = t.checked; }
  });
})();
