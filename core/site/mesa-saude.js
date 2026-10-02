/* mesa-saude.js — a tela "Saúde" da mesa (a equipe vê; o superadmin também abre o assistente por ela).
 *
 * O que a tela faz:
 *   1. mostra o retrato que o servidor monta em GET /api/saude: configuração, KV e catálogo, D1, senha e chave de sessão,
 *      provedor de vídeo (credenciais, conexão, assinatura), modo de acesso, último backup e versão do core;
 *   2. lista os segredos pelo NOME e por "presente ou não" (o valor nunca chega ao navegador, e a tela diz onde mudá-lo);
 *   3. em cada problema, diz em frase curta o que está acontecendo e como corrigir, e oferece "copiar o pedido para o
 *      agente" (um texto pronto para colar numa ferramenta de IA com terminal, sem segredo nenhum dentro);
 *   4. avisa que há versão nova do core (o servidor compara com a última release pública; falha de rede só some o aviso).
 *
 * Também mora aqui o gancho de entrada (`M.aoAbrirMesa`): ao abrir a mesa lê a saúde em segundo plano, abre o assistente
 * de configuração na primeira entrada do superadmin e põe o selo de problemas no menu.
 *
 * Os textos de cada checagem vêm do catálogo de idiomas (`saude.t.<id>`, `saude.c.<codigo>`, `saude.f.<codigo>`): o
 * servidor só manda códigos e parâmetros. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr;

  var S = M.saude = { dados: null, carregando: false, erro: '', testando: false, buscandoVersao: false, avisouVersao: false };

  /* ---------------------------------------------------------- utilidades comuns às telas de operação */

  var O = M.operacao = {};

  O.topo = function (titulo, sub, extra) {
    return h('div', { class: 'a-topo' }, h('div', null, h('h1', { class: 'a-titulo', text: titulo }), sub ? h('p', { class: 'a-sub', text: sub }) : null), extra || null);
  };

  O.chip = function (texto, classe) { return h('span', { class: 'chip ' + (classe || ''), text: texto }); };

  O.copiar = function (texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise(function (resolve, reject) {
      var t = document.createElement('textarea');
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); }
      document.body.removeChild(t);
    });
  };

  /* Entrega um texto como arquivo para baixar. O arquivo nunca sobe a lugar nenhum: é um Blob local. */
  O.baixar = function (nome, texto, tipo) {
    var blob = new Blob([texto], { type: tipo || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* Uma chave do catálogo de idiomas, ou o fallback (nunca a chave crua na tela). */
  O.texto = function (chave, params, reserva) {
    return M.I18n.tem(chave) ? tr(chave, params) : (reserva === undefined ? '' : reserva);
  };

  O.dizer = function (id, texto, erro) {
    var e = M.$(id);
    if (e) { e.textContent = texto || ''; e.className = 'estado' + (erro ? ' estado-erro' : ''); }
  };

  O.redesenhar = function (o) { if (M.redesenhar) M.redesenhar(o || { semPainel: true }); };

  /* --------------------------------------------------------------- dados */

  var CONSULTAS = { testar: 'testar=1', versao: 'versao=1' };

  S.carregar = function (o) {
    o = o || {};
    S.carregando = true;
    if (o.testar) S.testando = true;
    if (o.versao) S.buscandoVersao = true;
    var q = Object.keys(CONSULTAS).filter(function (k) { return o[k]; }).map(function (k) { return CONSULTAS[k]; }).join('&');
    return M.api('/api/saude' + (q ? '?' + q : '')).then(function (d) {
      S.dados = d;
      S.erro = '';
    }).catch(function (e) {
      S.erro = e.message;
    }).then(function () {
      S.carregando = false;
      S.testando = false;
      S.buscandoVersao = false;
      O.redesenhar();
    });
  };

  /* Quantos itens pedem atenção: o número que vai no selo do menu. */
  S.pendencias = function () {
    var r = S.dados && S.dados.resumo;
    return r ? (r.erro || 0) + (r.aviso || 0) : 0;
  };

  /* Chamado pela mesa ao abrir: lê a saúde (e a versão) em segundo plano. Na primeira entrada do superadmin depois do
   * deploy, o assistente de configuração abre sozinho; quem já o concluiu (ou o dispensou) não o vê de novo. */
  M.aoAbrirMesa = function () {
    return S.carregar({ versao: true }).then(function () {
      var d = S.dados;
      if (!d) return;
      if (d.versao && d.versao.nova && !S.avisouVersao) {
        S.avisouVersao = true;
        M.toast(tr('saude.versaoNovaAviso', { versao: d.versao.ultima.versao }), { rotulo: tr('saude.verNovidades'), fazer: function () { M.irTela('saude'); } });
      }
      if (M.sessao.super && d.assistente && d.assistente.estado === 'pendente' && M.st.tela === 'site' && M.irTela) M.irTela('assistente');
    });
  };

  /* ------------------------------------------------------------ desenho */

  var ESTADOS = {
    ok: ['saude.estadoOk', 'chip-ok'],
    aviso: ['saude.estadoAviso', 'chip-alerta'],
    erro: ['saude.estadoErro', 'chip-erro'],
    pulado: ['saude.estadoPulado', '']
  };
  var ORDEM = { erro: 0, aviso: 1, pulado: 2, ok: 3 };

  /* Para onde cada checagem leva quem quer resolver (o assistente é do superadmin). */
  var ACOES = {
    config: { tela: 'assistente', super: true }, 'video-credenciais': { tela: 'assistente', super: true }, 'video-conexao': { tela: 'assistente', super: true },
    'video-assinatura': { tela: 'assistente', super: true }, acesso: { tela: 'assistente', super: true }, turnstile: { tela: 'assistente', super: true },
    backup: { tela: 'backup' }, catalogo: { tela: 'enviar' }, 'catalogo-tamanho': { tela: 'custos' }
  };

  function parametros(x) {
    var p = Object.assign({}, x.params || {});
    if (p.provedor) p.provedor = O.texto('assistente.provedor.' + p.provedor + '.nome', null, p.provedor);
    if (p.modo) p.modo = O.texto('saude.modo.' + p.modo, null, p.modo);
    return p;
  }

  S.mensagem = function (x) { return O.texto('saude.c.' + x.codigo, parametros(x), x.codigo); };
  S.comoCorrigir = function (x) { return O.texto('saude.f.' + x.codigo, parametros(x), ''); };

  /* O pedido para colar numa ferramenta de IA com terminal. Sem segredo: só o problema e o comando que o diagnostica. */
  S.pedidoParaOAgente = function (x) {
    return tr('saude.pedidoAgente', { problema: S.mensagem(x), codigo: x.id + ':' + x.codigo });
  };

  function itemDaLista(x) {
    var est = ESTADOS[x.estado] || ESTADOS.pulado;
    var corrigir = x.estado === 'erro' || x.estado === 'aviso' ? S.comoCorrigir(x) : '';
    var acao = ACOES[x.id];
    var botoes = [];
    if ((x.estado === 'erro' || x.estado === 'aviso') && acao && (!acao.super || M.sessao.super)) {
      botoes.push(h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'saude-ir', 'data-tela': acao.tela, text: tr('saude.resolverAgora') }));
    }
    if (x.estado === 'erro') botoes.push(h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'saude-copiar-pedido', 'data-id': x.id, text: tr('saude.copiarPedido') }));
    return h('li', { class: 'saude-item saude-' + x.estado },
      h('div', { class: 'saude-item-topo' },
        O.chip(tr(est[0]), est[1]),
        h('b', { text: O.texto('saude.t.' + x.id, null, x.id) })),
      h('p', { class: 'saude-msg', text: S.mensagem(x) }),
      corrigir ? h('p', { class: 'p-nota' }, h('b', { text: tr('saude.comoCorrigir') + ' ' }), corrigir) : null,
      botoes.length ? h('div', { class: 'botoes-linha' }, botoes) : null);
  }

  function cartaoResumo(d) {
    var r = d.resumo || {};
    var tudoOk = !(r.erro || r.aviso);
    return h('div', { class: 'cartao-conta' },
      h('div', { class: 'conta-topo' },
        h('div', null,
          h('h2', { class: 'a-subtitulo', text: tudoOk ? tr('saude.tudoCerto') : tr('saude.pedemAtencao', { n: (r.erro || 0) + (r.aviso || 0) }) }),
          h('p', { class: 'p-nota', text: tr('saude.lidoEm', { data: M.I18n.data(Date.parse(d.geradoEm), 'dataHora') }) })),
        h('div', { class: 'botoes-linha' },
          O.chip(tr('saude.nProblemas', { n: r.erro || 0 }), (r.erro ? 'chip-erro' : '')),
          O.chip(tr('saude.nAvisos', { n: r.aviso || 0 }), (r.aviso ? 'chip-alerta' : '')),
          O.chip(tr('saude.nOk', { n: r.ok || 0 }), 'chip-ok'))),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'saude-recarregar', disabled: S.carregando, text: S.carregando && !S.testando ? tr('saude.verificando') : tr('saude.verificarDeNovo') }),
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'saude-testar', disabled: S.carregando, text: S.testando ? tr('saude.testando') : tr('saude.testarProvedor') }),
        h('p', { class: 'estado', id: 'saude-estado', role: 'status' })),
      h('p', { class: 'p-nota', text: tr('saude.testarNota') }));
  }

  function cartaoVersao(d) {
    var v = d.versao || {};
    var ultima = v.ultima;
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('saude.versaoTitulo') }),
      h('p', { text: tr('saude.versaoAtual', { versao: v.core }) }),
      v.nova
        ? h('div', { class: 'aviso-opcao' }, h('b', { text: tr('saude.versaoNovaTitulo') + ' ' }), tr('saude.versaoNovaTexto', { versao: ultima.versao }))
        : h('p', { class: 'p-nota', text: ultima ? tr('saude.versaoEmDia', { data: M.I18n.data(ultima.verificadaEm, 'dataHora') }) : tr('saude.versaoSemInfo') }),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'saude-versao', disabled: S.buscandoVersao, text: S.buscandoVersao ? tr('saude.procurando') : tr('saude.procurarVersao') }),
        v.nova && ultima.url && /^https:\/\//.test(ultima.url) ? h('a', { class: 'botao botao-pequeno', href: ultima.url, target: '_blank', rel: 'noopener noreferrer' /* i18n-ignorar: valor do atributo rel */, text: tr('saude.verNovidades') }) : null),
      v.nova ? h('p', { class: 'p-nota', text: tr('saude.versaoComoAtualizar') }) : null);
  }

  function cartaoSegredos(d) {
    var linhas = (d.segredos || []).map(function (s) {
      return h('tr', null,
        h('td', { class: 'mono', text: s.nome }),
        h('td', { text: s.secreta ? tr('saude.tipoSegredo') : tr('saude.tipoVariavel') }),
        h('td', { text: s.necessario ? tr('saude.necessarioSim') : tr('saude.necessarioNao') }),
        h('td', null, O.chip(s.presente ? tr('saude.presente') : tr('saude.faltando'), s.presente ? 'chip-ok' : (s.necessario ? 'chip-erro' : 'chip-alerta'))));
    });
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('saude.segredosTitulo') }),
      h('p', { class: 'p-nota', text: tr('saude.segredosNota') }),
      h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('caption', { class: 'so-leitor', text: tr('saude.segredosTitulo') }),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: tr('saude.colNome') }), h('th', { scope: 'col', text: tr('saude.colTipo') }),
          h('th', { scope: 'col', text: tr('saude.colNecessario') }), h('th', { scope: 'col', text: tr('saude.colEstado') }))),
        h('tbody', null, linhas))),
      h('p', { class: 'p-nota', text: tr('saude.segredosOndeMudar') }));
  }

  function cartaoArmazenamento(d) {
    var a = d.armazenamento || {};
    var kb = a.bytesDoCatalogo == null ? null : Math.round(a.bytesDoCatalogo / 1024);
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('saude.numerosTitulo') }),
      h('ul', { class: 'lista-ajuda' },
        h('li', { text: tr('saude.numTitulos', { n: a.titulos == null ? 0 : a.titulos, noAr: a.noAr == null ? 0 : a.noAr }) }),
        kb !== null ? h('li', { text: tr('saude.numTamanho', { kb: kb }) }) : null,
        h('li', { text: d.backup && d.backup.ultimo ? tr('saude.numBackup', { data: M.I18n.data(Date.parse(d.backup.ultimo.em), 'dataHora'), origem: O.texto('saude.origem.' + d.backup.ultimo.origem, null, d.backup.ultimo.origem || '') }) : tr('saude.numBackupNunca') }),
        h('li', { text: tr('saude.numProvedor', { provedor: O.texto('assistente.provedor.' + d.provedor + '.nome', null, d.provedor), modo: O.texto('saude.modo.' + d.modo, null, d.modo) }) })));
  }

  M.telaSaude = function () {
    if (S.dados === null && !S.carregando && !S.erro) S.carregar({ versao: true });
    var caixa = h('div', { class: 'a saude' }, O.topo(tr('saude.titulo'), tr('saude.sub'),
      M.sessao.super ? h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'saude-ir', 'data-tela': 'assistente', text: tr('assistente.abrirAssistente') }) : null));
    if (S.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', role: 'alert', text: S.erro }));
    var d = S.dados;
    if (!d) {
      /* sem leitura: ou ainda lendo, ou falhou — e nesse caso quem decide tentar de novo é a pessoa (nada de laço) */
      caixa.appendChild(S.erro
        ? h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'saude-recarregar', text: tr('saude.verificarDeNovo') })
        : h('p', { class: 'p-nota', role: 'status', text: tr('saude.lendo') }));
      return caixa;
    }
    caixa.appendChild(cartaoResumo(d));
    var lista = (d.checagens || []).slice().sort(function (a, b) { return (ORDEM[a.estado] - ORDEM[b.estado]); });
    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('saude.checagensTitulo') }),
      h('ul', { class: 'saude-lista', 'aria-label': tr('saude.checagensTitulo') }, lista.map(itemDaLista))));
    caixa.appendChild(cartaoVersao(d));
    caixa.appendChild(cartaoSegredos(d));
    caixa.appendChild(cartaoArmazenamento(d));
    return caixa;
  };

  M.painelSaude = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('saude.painelTitulo') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('saude.painel1') }),
        h('ul', { class: 'lista-ajuda' },
          h('li', null, O.chip(tr('saude.estadoOk'), 'chip-ok'), ' ', tr('saude.painelOk')),
          h('li', null, O.chip(tr('saude.estadoAviso'), 'chip-alerta'), ' ', tr('saude.painelAviso')),
          h('li', null, O.chip(tr('saude.estadoErro'), 'chip-erro'), ' ', tr('saude.painelErro')),
          h('li', null, O.chip(tr('saude.estadoPulado'), ''), ' ', tr('saude.painelPulado'))),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('saude.painelSegredoTitulo') + ' ' }), tr('saude.painelSegredo'))) };
  };

  /* -------------------------------------------------------------- ações */

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="saude-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'saude-recarregar') return S.carregar({ versao: true });
    if (a === 'saude-testar') return S.carregar({ testar: true });
    if (a === 'saude-versao') return S.carregar({ versao: true });
    if (a === 'saude-ir') return M.irTela(b.getAttribute('data-tela'));
    if (a === 'saude-copiar-pedido') {
      var x = ((S.dados && S.dados.checagens) || []).filter(function (c) { return c.id === b.getAttribute('data-id'); })[0];
      if (!x) return;
      return O.copiar(S.pedidoParaOAgente(x)).then(function () { M.toast(tr('saude.pedidoCopiado')); }, function () { M.toast(tr('saude.naoCopiou')); });
    }
  });
})();
