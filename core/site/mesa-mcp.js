/* mesa-mcp.js — a tela "Integrações / MCP" da mesa (só o superadmin): tokens para agentes de IA e o registro do que eles fizeram.
 *
 * O que a tela faz, em ordem de uso:
 *   1. ESTADO: o MCP está ligado? (quem liga é o config/site.json, `mcp.ligado`, por deploy) e está em "só leitura"?
 *   2. CRIAR TOKEN: nome, escopo (ler, curar, administrar) e validade. O token aparece UMA vez, com o comando pronto para o
 *      Claude Code; depois só o início dele fica na lista (o servidor guarda só o hash).
 *   3. LISTA: ativos, vencidos e revogados, com último uso e botão de revogar (vale no pedido seguinte).
 *   4. AUDITORIA: o que cada token pediu, a ferramenta, o resumo dos argumentos (sem segredo) e o resultado.
 *
 * Quem decide é o servidor (/api/mcp-tokens, só superadmin). */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr;

  var G = M.mcp = { dados: null, carregando: false, erro: '', novo: null };

  function chip(texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); }
  function redesenhar() { if (M.redesenhar) M.redesenhar({ semPainel: true }); }
  function data(s) { return s ? M.I18n.data(s * 1000, 'dataHora') : '—'; }
  function dizer(id, texto, erro) {
    var e = M.$(id);
    if (e) { e.textContent = texto || ''; e.className = 'estado' + (erro ? ' estado-erro' : ''); }
  }
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise(function (resolve, reject) {
      var t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); }
      document.body.removeChild(t);
    });
  }

  var ESCOPOS = ['read', 'curate', 'admin'];
  var ROTULO_ESCOPO = { read: 'mcp.mesaEscopo_read', curate: 'mcp.mesaEscopo_curate', admin: 'mcp.mesaEscopo_admin' };
  var AJUDA_ESCOPO = { read: 'mcp.mesaEscopoAjuda_read', curate: 'mcp.mesaEscopoAjuda_curate', admin: 'mcp.mesaEscopoAjuda_admin' };
  var ESTADOS = { ativo: ['mcp.mesaEstadoAtivo', 'chip-ok'], vencido: ['mcp.mesaEstadoVencido', 'chip-alerta'], revogado: ['mcp.mesaEstadoRevogado', 'chip-erro'] };
  var RESULTADOS = { ok: 'mcp.mesaResOk', erro: 'mcp.mesaResErro', negado: 'mcp.mesaResNegado', confirmacao: 'mcp.mesaResConfirmacao', conflito: 'mcp.mesaResConflito' };

  G.carregar = function () {
    G.carregando = true;
    return M.api('/api/mcp-tokens').then(function (d) {
      G.dados = d;
      G.erro = '';
    }).catch(function (e) {
      G.erro = e.message;
      if (!G.dados) G.dados = { ligado: false, somenteLeitura: true, url: '', tokens: [], auditoria: [] };
    }).then(function () {
      G.carregando = false;
      redesenhar();
    });
  };

  function topo(titulo, sub) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null));
  }

  function cartaoEstado() {
    var d = G.dados;
    var itens = [
      h('li', { class: 'a-diag' }, chip(d.ligado ? tr('mcp.mesaLigado') : tr('mcp.mesaDesligado'), d.ligado ? 'chip-ok' : 'chip-alerta'),
        h('span', { text: d.ligado ? tr('mcp.mesaLigadoTexto') : tr('mcp.mesaDesligadoTexto') })),
      h('li', { class: 'a-diag' }, chip(d.somenteLeitura ? tr('mcp.mesaSoLeitura') : tr('mcp.mesaLeituraEscrita'), d.somenteLeitura ? '' : 'chip-alerta'),
        h('span', { text: d.somenteLeitura ? tr('mcp.mesaSoLeituraTexto') : tr('mcp.mesaLeituraEscritaTexto') }))
    ];
    return h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('mcp.mesaEstadoTitulo') }), h('ul', { class: 'lista-ajuda' }, itens),
      h('p', { class: 'p-nota' }, tr('mcp.mesaEndereco') + ' ', h('span', { class: 'mono', text: d.url })));
  }

  function comandoDoClaude(url, token) {
    return 'claude mcp add --transport http streaming ' + url + ' --header "Authorization: Bearer ' + token + '"';
  }

  function cartaoCriar() {
    var caixa = h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('mcp.mesaCriarTitulo') }),
      h('p', { class: 'p-nota', text: tr('mcp.mesaCriarNota') }),
      h('div', { class: 'campo' }, h('label', { for: 'mcp-nome', text: tr('mcp.mesaNome') }),
        h('input', { type: 'text', id: 'mcp-nome', maxlength: '60', autocomplete: 'off', placeholder: tr('mcp.mesaNomeExemplo') })),
      h('div', { class: 'campo' }, h('label', { for: 'mcp-escopo', text: tr('mcp.mesaEscopo') }),
        h('select', { id: 'mcp-escopo' }, ESCOPOS.map(function (e) { return h('option', { value: e, text: tr(ROTULO_ESCOPO[e]) }); }))),
      h('p', { class: 'dica', id: 'mcp-escopo-ajuda', text: tr(AJUDA_ESCOPO.read) }),
      h('div', { class: 'campo' }, h('label', { for: 'mcp-dias', text: tr('mcp.mesaValidade') }),
        h('input', { type: 'number', id: 'mcp-dias', min: '1', max: '365', value: '90' })),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'mcp-criar', text: tr('mcp.mesaCriar') }),
        h('p', { class: 'estado', id: 'mcp-estado', role: 'status' })));
    if (G.novo) {
      var cmd = comandoDoClaude(G.dados.url, G.novo.token);
      caixa.appendChild(h('div', { class: 'senha-nova' },
        h('p', null, h('b', { text: tr('mcp.mesaTokenNovo', { nome: G.novo.nome }) })),
        h('p', { class: 'senha-valor mono', id: 'mcp-token', text: G.novo.token }),
        h('p', { class: 'p-nota', text: tr('mcp.mesaTokenUmaVez') }),
        h('p', { class: 'p-nota', text: tr('mcp.mesaComandoClaude') }),
        h('p', { class: 'senha-valor mono', id: 'mcp-comando', text: cmd }),
        h('div', { class: 'botoes-linha' },
          h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'mcp-copiar-token', text: tr('mcp.mesaCopiarToken') }),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'mcp-copiar-comando', text: tr('mcp.mesaCopiarComando') }),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'mcp-fechar', text: tr('mcp.mesaJaGuardei') }))));
    }
    return caixa;
  }

  function cartaoTokens() {
    var lista = G.dados.tokens || [];
    var caixa = h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('mcp.mesaTokens') }));
    if (!lista.length) caixa.appendChild(h('p', { class: 'p-nota', text: G.carregando ? tr('acesso.mesaLendo') : tr('mcp.mesaNenhumToken') }));
    lista.forEach(function (t) {
      var st = ESTADOS[t.estado] || ESTADOS.ativo;
      caixa.appendChild(h('div', { class: 'conta-topo' },
        h('div', null, h('b', { text: t.nome }), ' ', chip(tr(st[0]), st[1]), ' ', chip(tr(ROTULO_ESCOPO[t.escopo] || ROTULO_ESCOPO.read), ''),
          h('span', { class: 'p-nota mono', text: '  ' + t.prefixo + '…' }),
          h('span', { class: 'p-nota', text: '  ' + tr('mcp.mesaVence', { data: data(t.expiraEm) }) + ' · ' + tr('mcp.mesaUltimoUso', { data: data(t.ultimoUso) }) })),
        t.estado === 'ativo' ? h('div', { class: 'botoes-linha' },
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'mcp-revogar', 'data-id': t.id, 'data-nome': t.nome, text: tr('mcp.mesaRevogar') })) : null));
    });
    return caixa;
  }

  function cartaoAuditoria() {
    var lista = G.dados.auditoria || [];
    var caixa = h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('mcp.mesaAuditoria') }), h('p', { class: 'p-nota', text: tr('mcp.mesaAuditoriaNota') }));
    if (!lista.length) { caixa.appendChild(h('p', { class: 'p-nota', text: tr('mcp.mesaAuditoriaVazia') })); return caixa; }
    lista.forEach(function (a) {
      var ruim = a.resultado === 'erro' || a.resultado === 'negado' || a.resultado === 'conflito';
      caixa.appendChild(h('div', { class: 'conta-topo' },
        h('div', null, h('b', { class: 'mono', text: a.ferramenta }), ' ', chip(tr(RESULTADOS[a.resultado] || RESULTADOS.erro), ruim ? 'chip-alerta' : 'chip-ok'),
          h('span', { class: 'p-nota', text: '  ' + a.tokenNome + ' · ' + data(a.em) + (a.detalhe ? ' · ' + a.detalhe : '') }),
          h('div', { class: 'p-nota mono', text: a.argumentos || '' }))));
    });
    return caixa;
  }

  M.telaMcp = function () {
    if (!G.dados && !G.carregando) G.carregar();
    var caixa = h('div', { class: 'a' }, topo(tr('mcp.mesaTitulo'), tr('mcp.mesaSub')));
    if (G.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', text: G.erro }));
    if (!G.dados) { caixa.appendChild(h('p', { class: 'p-nota', text: tr('acesso.mesaLendo') })); return caixa; }
    caixa.appendChild(cartaoEstado());
    caixa.appendChild(cartaoCriar());
    caixa.appendChild(cartaoTokens());
    caixa.appendChild(cartaoAuditoria());
    return caixa;
  };

  M.painelMcp = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('mcp.mesaComoFunciona') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('mcp.mesaAjuda1') }),
        h('p', { class: 'p-nota', text: tr('mcp.mesaAjuda2') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('mcp.mesaAjudaSegurancaTitulo') + ' ' }), tr('mcp.mesaAjudaSeguranca')),
        h('p', { class: 'p-nota', text: tr('mcp.mesaAjuda3') })) };
  };

  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'mcp-escopo') {
      var a = M.$('mcp-escopo-ajuda');
      if (a) a.textContent = tr(AJUDA_ESCOPO[ev.target.value] || AJUDA_ESCOPO.read);
    }
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="mcp-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'mcp-criar') {
      var nome = (M.$('mcp-nome').value || '').trim();
      if (!nome) { dizer('mcp-estado', tr('api.mcp-nome-invalido'), true); return; }
      dizer('mcp-estado', tr('acesso.mesaGerando'));
      return M.api('/api/mcp-tokens', { method: 'POST', body: JSON.stringify({ nome: nome, escopo: M.$('mcp-escopo').value, dias: Number(M.$('mcp-dias').value) }) })
        .then(function (r) { G.novo = r.token; return G.carregar(); })
        .catch(function (e) { dizer('mcp-estado', e.message, true); });
    }
    if (a === 'mcp-copiar-token') return copiar(G.novo.token).then(function () { M.toast(tr('acesso.mesaCopiado')); }, function () { M.toast(tr('acesso.mesaNaoCopiou')); });
    if (a === 'mcp-copiar-comando') return copiar(comandoDoClaude(G.dados.url, G.novo.token)).then(function () { M.toast(tr('acesso.mesaCopiado')); }, function () { M.toast(tr('acesso.mesaNaoCopiou')); });
    if (a === 'mcp-fechar') { G.novo = null; return redesenhar(); }
    if (a === 'mcp-revogar') {
      if (!window.confirm(tr('mcp.mesaConfirmaRevogar', { nome: b.getAttribute('data-nome') }))) return;
      return M.api('/api/mcp-tokens?id=' + encodeURIComponent(b.getAttribute('data-id')), { method: 'DELETE' })
        .then(function () { M.toast(tr('acesso.mesaFeito')); return G.carregar(); }).catch(function (e) { M.toast(e.message); });
    }
  });
})();
