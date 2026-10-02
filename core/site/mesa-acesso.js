/* mesa-acesso.js — a tela "Acesso" da mesa (só o superadmin): quem tem conta de espectador,
 * convites com link copiável e os textos de privacidade e termos.
 *
 * O que a tela faz, em ordem de uso:
 *   1. DIAGNÓSTICO: diz o que falta para o modo de acesso funcionar (banco D1, Turnstile,
 *      e-mail), em uma frase por item. Vem de GET /api/espectadores (sem segredo).
 *   2. CONVIDAR: digita o e-mail, o servidor devolve um LINK de 7 dias, e o administrador o
 *      copia e manda por WhatsApp (com o adaptador de e-mail `nenhum`, o padrão) ou o
 *      servidor também o envia por e-mail (adaptador `resend`).
 *   3. ESPECTADORES: aprovar quem ficou pendente, bloquear (derruba as sessões na hora),
 *      derrubar sessões, gerar um novo link de acesso, excluir.
 *   4. TEXTOS LEGAIS: política de privacidade e termos de uso. O cliente é o controlador dos
 *      dados: preenche os campos do modelo (ou escreve o texto próprio por idioma); cada
 *      alteração sobe a versão, e todos precisam aceitar de novo.
 *
 * Quem decide é o servidor (/api/espectadores, /api/convites, /api/legal: só superadmin). */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr;

  var A = M.acesso = {
    diag: null, indisponivel: false, espectadores: null, convites: [], legal: null,
    carregando: false, erro: '', link: null, doc: 'privacidade', temMais: false
  };

  function chip(texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); }
  function topo(titulo, sub) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null));
  }
  function redesenhar() { if (M.redesenhar) M.redesenhar({ semPainel: true }); }
  function data(s) { return s ? M.I18n.data(s * 1000, 'dataHora') : '—'; }

  var STATUS = {
    ativo: ['acesso.statusAtivo', 'chip-ok'],
    convidado: ['acesso.statusConvidado', ''],
    pendente: ['acesso.statusPendente', 'chip-alerta'],
    bloqueado: ['acesso.statusBloqueado', 'chip-erro']
  };
  var MOTIVOS = {
    'banco-ausente': 'api.banco-ausente',
    'turnstile-nao-configurado': 'api.turnstile-nao-configurado',
    'turnstile-sem-chave-publica': 'acesso.mesaMotivoSemChave',
    'cadastro-sem-email': 'api.cadastro-sem-email'
  };
  var LIMITES = { binding: 'acesso.mesaLimiteBinding', banco: 'acesso.mesaLimiteBanco', nenhum: 'acesso.mesaLimiteNenhum' };
  var MODOS = { publico: 'acesso.mesaModoPublico', cadastro: 'acesso.mesaModoCadastro', privado: 'acesso.mesaModoPrivado' };

  /* ---------------------------------------------------------------- dados */

  A.carregar = function () {
    A.carregando = true;
    return M.api('/api/espectadores').then(function (r) {
      A.diag = r.diagnostico;
      A.indisponivel = r.indisponivel === true;
      A.espectadores = r.espectadores || [];
      A.temMais = A.espectadores.length >= 100;
      A.erro = '';
      return A.indisponivel ? { convites: [] } : M.api('/api/convites');
    }).then(function (r) {
      A.convites = r.convites || [];
      return M.api('/api/legal');
    }).then(function (r) {
      A.legal = r;
    }).catch(function (e) {
      A.erro = e.message;
      if (A.espectadores === null) A.espectadores = [];
    }).then(function () {
      A.carregando = false;
      redesenhar();
    });
  };

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

  /* ------------------------------------------------------------ desenho */

  function linhaDiag(rotulo, ok, texto) {
    return h('li', { class: 'a-diag' }, chip(ok ? tr('acesso.mesaOk') : tr('acesso.mesaAtencao'), ok ? 'chip-ok' : 'chip-alerta'),
      h('span', null, h('b', { text: rotulo + ' ' }), h('span', { text: texto })));
  }

  function cartaoDiagnostico() {
    var d = A.diag;
    if (!d) return h('p', { class: 'p-nota', text: tr('acesso.mesaLendo') });
    var itens = [];
    itens.push(linhaDiag(tr('acesso.mesaModo'), true, tr(MODOS[d.modo] || MODOS.privado)));
    if (d.modo === 'publico') return h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaEstadoTitulo') }), h('ul', { class: 'lista-ajuda' }, itens),
      h('p', { class: 'p-nota', text: tr('acesso.mesaPublicoNota') }));
    itens.push(linhaDiag(tr('acesso.mesaBanco'), d.banco, d.banco ? tr('acesso.mesaBancoOk') : tr('api.banco-ausente')));
    itens.push(linhaDiag(tr('acesso.mesaEmail'), d.email.disponivel,
      d.email.disponivel ? tr('acesso.mesaEmailOk', { adaptador: d.email.adaptador }) : tr('acesso.mesaEmailNenhum')));
    itens.push(linhaDiag(tr('acesso.mesaTurnstile'), d.turnstile.configurado && d.turnstile.chavePublica,
      d.turnstile.configurado ? (d.turnstile.chavePublica ? tr('acesso.mesaTurnstileOk') : tr('acesso.mesaMotivoSemChave')) : tr('acesso.mesaTurnstileNao')));
    itens.push(linhaDiag(tr('acesso.mesaLimite'), d.limiteDeTentativas !== 'nenhum', tr(LIMITES[d.limiteDeTentativas] || LIMITES.nenhum)));
    if (d.modo === 'cadastro') {
      itens.push(linhaDiag(tr('acesso.mesaCadastro'), d.cadastro.disponivel,
        d.cadastro.disponivel ? tr('acesso.mesaCadastroAberto') : tr(MOTIVOS[d.cadastro.motivo] || 'acesso.mesaCadastroFechado')));
    }
    return h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaEstadoTitulo') }), h('ul', { class: 'lista-ajuda' }, itens));
  }

  function cartaoConvidar() {
    var d = A.diag || {};
    var caixa = h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaConvidarTitulo') }),
      h('p', { class: 'p-nota', text: d.email && d.email.disponivel ? tr('acesso.mesaConvidarComEmail') : tr('acesso.mesaConvidarSemEmail') }),
      h('div', { class: 'campo' }, h('label', { for: 'ac-email', text: tr('acesso.email') }),
        h('input', { type: 'email', id: 'ac-email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' })),
      d.email && d.email.disponivel ? h('label', { class: 'permissao', for: 'ac-enviar' },
        h('input', { type: 'checkbox', id: 'ac-enviar', checked: true }), h('span', null, h('b', { text: tr('acesso.mesaEnviarPorEmail') }))) : null,
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'acesso-convidar', text: tr('acesso.mesaGerarConvite') }),
        h('p', { class: 'estado', id: 'ac-estado', role: 'status' })));
    if (A.link) {
      caixa.appendChild(h('div', { class: 'senha-nova' },
        h('p', null, h('b', { text: tr('acesso.mesaLinkDe', { email: A.link.email }) })),
        h('p', { class: 'senha-valor mono', id: 'ac-link', text: A.link.link }),
        h('p', { class: 'p-nota', text: (A.link.enviado ? tr('acesso.mesaEnviadoPorEmail') + ' ' : (A.link.motivo ? tr('acesso.mesaNaoEnviou') + ' ' : '')) + tr('acesso.mesaLinkValidade', { data: data(A.link.expiraEm) }) }),
        h('div', { class: 'botoes-linha' },
          h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'acesso-copiar', text: tr('acesso.mesaCopiar') }),
          h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'acesso-fechar-link', text: tr('telas.fechar') }))));
    }
    return caixa;
  }

  function cartaoConvites() {
    if (!A.convites.length) return null;
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaConvitesPendentes') }),
      A.convites.map(function (c) {
        return h('div', { class: 'conta-topo' },
          h('div', null, h('b', { text: c.email }), h('span', { class: 'p-nota', text: '  ' + tr('acesso.mesaVenceEm', { data: data(c.expiraEm) }) })),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'acesso-revogar', 'data-email': c.email, text: tr('acesso.mesaRevogar') })));
      }));
  }

  function botao(acao, id, texto, extra) {
    return h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': acao, 'data-id': id, 'data-email': extra || null, text: texto });
  }

  function cartaoEspectadores() {
    var lista = A.espectadores || [];
    var caixa = h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaEspectadores') }));
    if (A.indisponivel) { caixa.appendChild(h('p', { class: 'p-nota', text: tr('acesso.mesaSemContas') })); return caixa; }
    if (!lista.length) caixa.appendChild(h('p', { class: 'p-nota', text: A.carregando ? tr('acesso.mesaLendo') : tr('acesso.mesaNinguem') }));
    lista.forEach(function (e) {
      var st = STATUS[e.status] || STATUS.convidado;
      caixa.appendChild(h('div', { class: 'conta-topo' },
        h('div', null, h('b', { text: e.email }), e.nome ? h('span', { class: 'p-nota', text: '  ' + e.nome }) : null, ' ', chip(tr(st[0]), st[1]),
          h('span', { class: 'p-nota', text: '  ' + tr('acesso.mesaUltimoAcesso', { data: data(e.ultimoAcesso) }) })),
        h('div', { class: 'botoes-linha' },
          e.status === 'pendente' ? botao('acesso-aprovar', e.id, tr('telas.aprovar')) : null,
          e.status === 'bloqueado' ? botao('acesso-desbloquear', e.id, tr('acesso.mesaDesbloquear')) : botao('acesso-bloquear', e.id, tr('acesso.mesaBloquear')),
          e.status !== 'bloqueado' ? botao('acesso-link', e.id, tr('acesso.mesaNovoLink'), e.email) : null,
          botao('acesso-sessoes', e.id, tr('acesso.mesaDerrubarSessoes')),
          botao('acesso-excluir', e.id, tr('telas.excluir'), e.email))));
    });
    if (A.temMais) caixa.appendChild(h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'acesso-mais', text: tr('acesso.mesaVerMais') }));
    return caixa;
  }

  var DOCS = { privacidade: 'legal.privacidadeTitulo', termos: 'legal.termosTitulo' };

  function cartaoLegal() {
    var legal = A.legal && A.legal.documentos;
    var caixa = h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('acesso.mesaTextosLegais') }));
    if (!legal) return caixa;
    caixa.appendChild(h('div', { class: 'aviso-opcao' }, h('b', { text: tr('acesso.mesaLegalAvisoTitulo') + ' ' }), tr('acesso.mesaLegalAviso')));
    var abas = h('div', { class: 'seg', role: 'group', 'aria-label': tr('acesso.mesaTextosLegais') });
    Object.keys(DOCS).forEach(function (t) {
      abas.appendChild(h('button', { type: 'button', 'data-acao': 'acesso-doc', 'data-tipo': t, 'aria-pressed': String(A.doc === t), text: tr(DOCS[t]) }));
    });
    caixa.appendChild(abas);
    var doc = legal[A.doc];
    var campos = doc.campos || {};
    var padrao = (A.legal.padroes && A.legal.padroes.controlador) || '';
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('legal.versaoDoTexto', { versao: doc.versao }) }));
    caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'ac-ctrl', text: tr('acesso.mesaControlador') }),
      h('input', { type: 'text', id: 'ac-ctrl', maxlength: '300', value: campos.controlador || '', placeholder: padrao })));
    caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'ac-contato', text: tr('acesso.mesaContato') }),
      h('input', { type: 'text', id: 'ac-contato', maxlength: '300', value: campos.contato || '' }),
      h('p', { class: 'dica', text: tr('acesso.mesaContatoDica') })));
    caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'ac-ret', text: tr('acesso.mesaRetencao') }),
      h('input', { type: 'text', id: 'ac-ret', maxlength: '300', value: campos.retencao || '' })));
    var idiomas = (window.MESA_IDIOMA && window.MESA_IDIOMA.disponiveis) || [M.I18n.idioma()];
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('acesso.mesaTextoProprioDica') }));
    idiomas.forEach(function (id) {
      caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'ac-txt-' + id, text: tr('acesso.mesaTextoProprio', { idioma: M.I18n.rotuloDoIdioma(id) }) }),
        h('textarea', { id: 'ac-txt-' + id, rows: '6', maxlength: '20000', 'data-idioma': id, text: (doc.textos && doc.textos[id]) || '' })));
    });
    caixa.appendChild(h('div', { class: 'botoes-linha' },
      h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'acesso-salvar-doc', text: tr('telas.salvar') }),
      h('a', { class: 'botao botao-leve', href: (A.doc === 'privacidade' ? 'privacidade.html' : 'termos.html'), target: '_blank', rel: 'noopener', text: tr('acesso.mesaVerPagina') }),
      h('p', { class: 'estado', id: 'ac-doc-estado', role: 'status' })));
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('acesso.mesaSalvarSobeVersao') }));
    return caixa;
  }

  M.telaAcesso = function () {
    if (A.espectadores === null && !A.carregando) A.carregar();
    var caixa = h('div', { class: 'a' }, topo(tr('acesso.mesaTitulo'), tr('acesso.mesaSub')));
    if (A.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', text: A.erro }));
    caixa.appendChild(cartaoDiagnostico());
    if (!A.indisponivel) {
      caixa.appendChild(cartaoConvidar());
      var c = cartaoConvites();
      if (c) caixa.appendChild(c);
    }
    caixa.appendChild(cartaoEspectadores());
    caixa.appendChild(cartaoLegal());
    return caixa;
  };

  M.painelAcesso = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('acesso.mesaComoFunciona') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('acesso.mesaAjuda1') }),
        h('p', { class: 'p-nota', text: tr('acesso.mesaAjuda2') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('acesso.mesaAjudaVideoTitulo') + ' ' }), tr('acesso.mesaAjudaVideo')),
        h('p', { class: 'p-nota', text: tr('acesso.mesaAjuda3') })) };
  };

  /* ---------------------------------------------------------------- ações */

  function dizer(id, texto, erro) {
    var e = M.$(id);
    if (e) { e.textContent = texto || ''; e.className = 'estado' + (erro ? ' estado-erro' : ''); }
  }

  function convidar(email, enviar, estadoId) {
    dizer(estadoId, tr('acesso.mesaGerando'));
    return M.api('/api/convites', { method: 'POST', body: JSON.stringify({ email: email, enviar: enviar }) }).then(function (r) {
      A.link = { email: email, link: r.link, enviado: r.enviado, motivo: r.motivo, expiraEm: r.expiraEm };
      return A.carregar();
    }).catch(function (e) { dizer(estadoId, e.message, true); });
  }

  function mudar(id, acao) {
    return M.api('/api/espectadores', { method: 'PUT', body: JSON.stringify({ id: id, acao: acao }) })
      .then(function () { M.toast(tr('acesso.mesaFeito')); return A.carregar(); })
      .catch(function (e) { M.toast(e.message); });
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="acesso-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    var id = b.getAttribute('data-id');
    if (a === 'acesso-convidar') {
      var email = (M.$('ac-email').value || '').trim();
      if (!email) { dizer('ac-estado', tr('api.email-invalido'), true); return; }
      var env = M.$('ac-enviar');
      return convidar(email, env ? env.checked : false, 'ac-estado');
    }
    if (a === 'acesso-link') return convidar(b.getAttribute('data-email'), false, 'ac-estado');
    if (a === 'acesso-copiar') return copiar(A.link.link).then(function () { M.toast(tr('acesso.mesaCopiado')); }, function () { M.toast(tr('acesso.mesaNaoCopiou')); });
    if (a === 'acesso-fechar-link') { A.link = null; return redesenhar(); }
    if (a === 'acesso-revogar') {
      return M.api('/api/convites?email=' + encodeURIComponent(b.getAttribute('data-email')), { method: 'DELETE' })
        .then(function () { return A.carregar(); }).catch(function (e) { M.toast(e.message); });
    }
    if (a === 'acesso-aprovar') return mudar(id, 'aprovar');
    if (a === 'acesso-bloquear') return mudar(id, 'bloquear');
    if (a === 'acesso-desbloquear') return mudar(id, 'desbloquear');
    if (a === 'acesso-sessoes') return mudar(id, 'revogar-sessoes');
    if (a === 'acesso-excluir') {
      if (!window.confirm(tr('acesso.mesaConfirmaExcluir', { email: b.getAttribute('data-email') }))) return;
      return M.api('/api/espectadores?id=' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function () { M.toast(tr('acesso.mesaFeito')); return A.carregar(); }).catch(function (e) { M.toast(e.message); });
    }
    if (a === 'acesso-mais') {
      var ultimo = A.espectadores[A.espectadores.length - 1];
      return M.api('/api/espectadores?antes=' + encodeURIComponent(ultimo.criadoEm)).then(function (r) {
        A.espectadores = A.espectadores.concat(r.espectadores || []);
        A.temMais = (r.espectadores || []).length >= 100;
        redesenhar();
      }).catch(function (e) { M.toast(e.message); });
    }
    if (a === 'acesso-doc') { A.doc = b.getAttribute('data-tipo'); return redesenhar(); }
    if (a === 'acesso-salvar-doc') {
      var textos = {};
      [].forEach.call(document.querySelectorAll('textarea[data-idioma]'), function (t) { if (t.value.trim()) textos[t.getAttribute('data-idioma')] = t.value; });
      var corpo = { tipo: A.doc, campos: { controlador: M.$('ac-ctrl').value, contato: M.$('ac-contato').value, retencao: M.$('ac-ret').value }, textos: textos };
      return M.api('/api/legal', { method: 'PUT', body: JSON.stringify(corpo) }).then(function (r) {
        A.legal.documentos[A.doc] = Object.assign({}, A.legal.documentos[A.doc], r.documento);
        redesenhar();
        M.toast(r.documento.mudou ? tr('acesso.mesaSalvoNovaVersao', { versao: r.documento.versao }) : tr('acesso.mesaSemMudanca'));
      }).catch(function (e) { dizer('ac-doc-estado', e.message, true); });
    }
  });
})();
