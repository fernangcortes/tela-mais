/* mesa-custos.js — a tela "Custos": quanto custa, por mês, hospedar o streaming (estimativa).
 *
 * A CONTA NÃO MORA AQUI. É a mesma do guia escrito (docs/custos.md): core/worker/_lib/custos.js, que roda no servidor. A tela
 * pergunta (GET /api/saude?custos=1&...), com uma pequena espera entre uma tecla e a pergunta, e desenha a resposta: assim o
 * /admin e o guia nunca discordam de preço, de hipótese ou de data. Nada é gravado; a pergunta só leva os números do caso.
 *
 * A pessoa escolhe um cenário de partida (pequeno, médio, grande) ou digita os dela — quantos vídeos, de quantas horas,
 * quantas visualizações por mês, quanto cada uma assiste, onde está o público e quem pode ver o site — e vê, lado a lado,
 * o que cada provedor de vídeo custaria, mais o Worker da Cloudflare. O câmbio é a única conta feita aqui: trocar os reais por
 * dólar é multiplicar, e não precisa de ida ao servidor.
 *
 * É ESTIMATIVA e a tela repete isso, com a data dos preços, de forma que ninguém a leia como promessa. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr, O = M.operacao;

  var ESPERA_MS = 250;
  var PROVEDORES = ['bunny', 'cloudflare-stream', 'hls-generico'];
  var CAMPOS_ENVIADOS = ['videos', 'horasPorVideo', 'visualizacoesMes', 'minutosPorVisualizacao', 'publico', 'modoAcesso'];
  var MODOS = ['publico', 'cadastro', 'privado'];
  var FONTES = [
    'https://bunny.net/pricing/stream/', 'https://developers.cloudflare.com/stream/pricing/',
    'https://developers.cloudflare.com/workers/platform/pricing/', 'https://developers.cloudflare.com/workers/platform/limits/'
  ];

  var K = M.custos = { cenario: 'pequeno', entradas: null, cambio: '', resposta: null, erro: '', carregando: false };
  var sequencia = 0, espera = 0;

  function moeda(valor, codigo) {
    if (valor === null || valor === undefined || !isFinite(valor)) return '—';
    try {
      return new Intl.NumberFormat(M.I18n.idioma(), { style: 'currency', currency: codigo, maximumFractionDigits: valor >= 100 ? 0 : 2 }).format(valor);
    } catch (e) { return codigo + ' ' + Math.round(valor * 100) / 100; }
  }
  function numero(valor) {
    try { return new Intl.NumberFormat(M.I18n.idioma(), { maximumFractionDigits: 1 }).format(valor); } catch (e) { return String(valor); }
  }
  function porcento(razao) {
    try { return new Intl.NumberFormat(M.I18n.idioma(), { style: 'percent', maximumFractionDigits: 0 }).format(razao); } catch (e) { return Math.round(razao * 100) + '%'; }
  }

  /* O câmbio que vale na tela: o que a pessoa digitou, ou o de partida do servidor. */
  function cambio() {
    var n = Number(String(K.cambio).replace(',', '.'));
    return isFinite(n) && n > 0 ? n : (K.resposta ? K.resposta.cambioBrl : 0);
  }

  /* ------------------------------------------------------------- dados */

  function consulta() {
    var e = K.entradas || {};
    var partes = ['custos=1'];
    CAMPOS_ENVIADOS.forEach(function (c) { if (e[c] !== undefined && e[c] !== '') partes.push(c + '=' + encodeURIComponent(e[c])); });
    return partes.join('&');
  }

  /* Pergunta a conta ao servidor. A resposta mais nova ganha: uma que chega atrasada é descartada. */
  K.buscar = function () {
    var minha = ++sequencia;
    K.carregando = true;
    return M.api('/api/saude?' + consulta()).then(function (r) {
      if (minha !== sequencia) return;
      var primeira = !K.entradas;
      K.resposta = r;
      K.erro = '';
      if (primeira) {
        K.entradas = Object.assign({}, r.cenarios[K.cenario] || r.cenarios.pequeno, { publico: 'brasil', modoAcesso: (M.saude && M.saude.dados && M.saude.dados.modo) || 'publico' });
        K.cambio = String(r.cambioBrl);
      }
      K.carregando = false;
      if (primeira) O.redesenhar(); else pintar();
    }).catch(function (e) {
      if (minha !== sequencia) return;
      K.erro = e.message;
      K.carregando = false;
      /* ainda sem tela de campos (a primeira leitura falhou): redesenha tudo, para o erro e o "tentar de novo" aparecerem */
      if (!K.entradas) O.redesenhar(); else pintar();
    });
  };

  function buscarComEspera() {
    clearTimeout(espera);
    espera = setTimeout(K.buscar, ESPERA_MS);
  }

  /* ---------------------------------------------------------- resultado */

  function linhaDoProvedor(id, r) {
    var p = r.provedores[id], t = r.totaisComHospedagem[id];
    var usdDoVideo = p && p.calculavel ? p.totalUsd : null;
    var c = cambio();
    var melhor = r.maisBarato === id;
    var detalhe = id === 'hls-generico' || !p || !p.calculavel
      ? tr('custos.nota.hls-generico')
      : p.itens.map(function (x) { return tr('custos.parte.' + x.id) + ' ' + moeda(x.usd, 'USD'); }).join(' · ') + (p.avisos && p.avisos.length ? ' · ' + tr('custos.minimoAplicado') : '');
    return h('tr', { class: melhor ? 'custo-melhor' : '' },
      h('th', { scope: 'row' }, h('b', { text: tr('assistente.provedor.' + id + '.nome') }),
        melhor ? h('span', { class: 'chip chip-ok', text: tr('custos.maisBarato') }) : null),
      h('td', { class: 'num mono', text: usdDoVideo === null ? tr('custos.dependeDoServico') : moeda(usdDoVideo, 'USD') }),
      h('td', { class: 'num mono', text: usdDoVideo === null ? '—' : moeda(usdDoVideo * c, 'BRL') }),
      h('td', { class: 'num mono' }, h('b', { text: t ? moeda(t.totalUsd * c, 'BRL') : '—' })),
      h('td', { class: 'num mono', text: t ? moeda(t.totalUsd * c * (1 + r.iof), 'BRL') : '—' }),
      h('td', { class: 'p-nota', text: detalhe }));
  }

  function notaDoWorker(w) {
    var dia = numero(w.requisicoesPorDia);
    if (w.plano === 'gratis') return tr('custos.workersGratis', { dia: dia, pct: porcento(w.usoDoLimiteGratis) });
    var usd = moeda(w.totalUsd, 'USD');
    return tr(w.cabeNoGratis ? 'custos.workersPagoRecomendado' : 'custos.workersPagoLimite', { dia: dia, usd: usd });
  }

  function resultado() {
    var r = K.resposta;
    var caixa = h('div', { class: 'custo-resultado', id: 'custo-resultado', role: 'region', 'aria-live': 'polite', 'aria-label': tr('custos.resultado') });
    if (K.erro) { caixa.appendChild(h('p', { class: 'estado estado-erro', role: 'alert', text: K.erro })); }
    if (!r) { if (!K.erro) caixa.appendChild(h('p', { class: 'p-nota', text: tr('custos.calculando') })); return caixa; }
    var v = r.volumes;
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('custos.volumes', { horas: numero(v.horasTotais), minutos: numero(v.minutosEntregues), gb: numero(v.gbEntregues) }) }));
    caixa.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
      h('caption', { class: 'so-leitor', text: tr('custos.resultado') }),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: tr('custos.colProvedor') }), h('th', { scope: 'col', class: 'num', text: tr('custos.colUsd') }),
        h('th', { scope: 'col', class: 'num', text: tr('custos.colBrl') }), h('th', { scope: 'col', class: 'num', text: tr('custos.colTotal') }),
        h('th', { scope: 'col', class: 'num', text: tr('custos.colTotalIof') }), h('th', { scope: 'col', text: tr('custos.colDetalhe') }))),
      h('tbody', null, PROVEDORES.map(function (id) { return linhaDoProvedor(id, r); })))));
    caixa.appendChild(h('p', { class: 'p-nota', text: notaDoWorker(r.cloudflare) }));
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('custos.iofNota', { iof: porcento(r.iof) }) }));
    if (!r.entrada.videos || !r.entrada.visualizacoesMes) caixa.appendChild(h('p', { class: 'p-nota p-nota-alerta', text: tr('custos.semUso') }));
    return caixa;
  }

  /* Troca só o resultado: redesenhar a tela inteira tiraria o cursor de quem digita. */
  function pintar() {
    var antigo = M.$('custo-resultado');
    if (antigo) antigo.replaceWith(resultado());
  }

  /* ------------------------------------------------------------- desenho */

  var CAMPOS = [
    ['videos', 'custos.campoVideos', 'custos.dicaVideos', '1', 0],
    ['horasPorVideo', 'custos.campoHoras', 'custos.dicaHoras', 'any', 0],
    ['visualizacoesMes', 'custos.campoVisualizacoes', 'custos.dicaVisualizacoes', '1', 0],
    ['minutosPorVisualizacao', 'custos.campoMinutos', 'custos.dicaMinutos', 'any', 0]
  ];

  function campo(c) {
    return h('div', { class: 'campo' },
      h('label', { for: 'custo-' + c[0], text: tr(c[1]) }),
      h('input', { type: 'number', id: 'custo-' + c[0], inputmode: 'decimal', min: String(c[4]), step: c[3], value: String(K.entradas[c[0]]), 'data-custo': c[0], 'aria-describedby': 'custo-' + c[0] + '-dica' }),
      h('p', { class: 'dica', id: 'custo-' + c[0] + '-dica', text: tr(c[2]) }));
  }

  function selecao(id, rotulo, dica, valores, atual, chave) {
    return h('div', { class: 'campo' },
      h('label', { for: id, text: tr(rotulo) }),
      h('select', { id: id, 'data-custo': id.replace('custo-', ''), 'aria-describedby': id + '-dica' },
        valores.map(function (v) { return h('option', { value: v, selected: atual === v, text: tr(chave + v) }); })),
      h('p', { class: 'dica', id: id + '-dica', text: tr(dica) }));
  }

  M.telaCustos = function () {
    if (!K.resposta && !K.carregando && !K.erro) K.buscar();
    var caixa = h('div', { class: 'a custos' }, O.topo(tr('custos.titulo'), tr('custos.sub')));
    if (!K.entradas) {
      caixa.appendChild(K.erro
        ? h('div', { class: 'cartao-conta' }, h('p', { class: 'estado estado-erro', role: 'alert', text: K.erro }),
          h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'custo-tentar', text: tr('custos.tentarDeNovo') }))
        : h('p', { class: 'p-nota', role: 'status', text: tr('custos.calculando') }));
      return caixa;
    }
    var r = K.resposta;
    var cenarios = h('div', { class: 'seg', role: 'group', 'aria-label': tr('custos.cenarios') }, Object.keys(r.cenarios).map(function (id) {
      return h('button', { type: 'button', 'aria-pressed': String(K.cenario === id), 'data-acao': 'custo-cenario', 'data-cenario': id, text: tr('custos.cenario.' + id) });
    }));
    caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('custos.estimativaTitulo') + ' ' }),
      tr('custos.estimativaTexto', { data: M.I18n.data(Date.parse(r.dataDosValores), 'data') })));
    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('custos.seuCaso') }), cenarios,
      h('div', { class: 'campo-duo' }, campo(CAMPOS[0]), campo(CAMPOS[1])),
      h('div', { class: 'campo-duo' }, campo(CAMPOS[2]), campo(CAMPOS[3])),
      h('div', { class: 'campo-duo' },
        selecao('custo-publico', 'custos.campoPublico', 'custos.dicaPublico', ['brasil', 'global'], K.entradas.publico, 'custos.publico.'),
        selecao('custo-modoAcesso', 'custos.campoModo', 'custos.dicaModo', MODOS, K.entradas.modoAcesso, 'saude.modo.')),
      h('div', { class: 'campo' },
        h('label', { for: 'custo-cambio', text: tr('custos.campoCambio') }),
        h('input', { type: 'number', id: 'custo-cambio', inputmode: 'decimal', min: '0.01', step: 'any', value: String(K.cambio), 'data-custo': 'cambio', 'aria-describedby': 'custo-cambio-dica' }),
        h('p', { class: 'dica', id: 'custo-cambio-dica', text: tr('custos.dicaCambio', { cambio: numero(r.cambioBrl) }) }))));
    caixa.appendChild(h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('custos.quantoCusta') }), resultado()));
    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('custos.hipotesesTitulo') }),
      h('ul', { class: 'lista-ajuda' }, ['h1', 'h2', 'h3', 'h4', 'h5'].map(function (k) { return h('li', { text: tr('custos.' + k) }); })),
      h('p', { class: 'p-nota', text: tr('custos.fontes') }),
      h('ul', { class: 'lista-ajuda' }, FONTES.map(function (u) { return h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' /* i18n-ignorar: valor do atributo rel */, text: u })); }))));
    return caixa;
  };

  M.painelCustos = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('custos.painelTitulo') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('custos.painel1') }),
        h('p', { class: 'p-nota', text: tr('custos.painel2') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('custos.painelCartaoTitulo') + ' ' }), tr('custos.painelCartao'))) };
  };

  /* -------------------------------------------------------------- ações */

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    var nome = t && t.getAttribute ? t.getAttribute('data-custo') : null;
    if (!nome || !K.entradas) return;
    if (nome === 'cambio') { K.cambio = t.value; return pintar(); }
    if (nome === 'publico' || nome === 'modoAcesso') return;
    K.entradas[nome] = t.value;
    K.cenario = '';
    /* os números já não são os do cenário: o botão deixa de aparecer apertado, sem redesenhar a tela (e sem tirar o cursor) */
    [].forEach.call(document.querySelectorAll('[data-acao="custo-cenario"]'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    buscarComEspera();
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    var nome = t && t.getAttribute ? t.getAttribute('data-custo') : null;
    if (!nome || !K.entradas || (nome !== 'publico' && nome !== 'modoAcesso')) return;
    K.entradas[nome] = t.value;
    K.buscar();
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="custo-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'custo-tentar') { K.erro = ''; return K.buscar(); }
    if (a === 'custo-cenario' && K.resposta) {
      var id = b.getAttribute('data-cenario');
      K.cenario = id;
      K.entradas = Object.assign({}, K.entradas, K.resposta.cenarios[id]);
      return K.buscar().then(function () { O.redesenhar(); });
    }
  });
})();
