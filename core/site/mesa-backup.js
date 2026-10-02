/* mesa-backup.js — a tela "Backup" da mesa: baixar uma cópia dos dados e restaurar de uma cópia.
 *
 * EXPORTAR (a equipe): um arquivo JSON com o catálogo, a configuração operacional e os textos legais. O superadmin pode
 * incluir também as contas (equipe com o hash da senha; espectadores sem senha): esse arquivo passa a ser sensível, e a
 * tela avisa. Segredo nenhum entra no arquivo.
 *
 * IMPORTAR (só o superadmin), em três tempos, para ninguém restaurar no escuro:
 *   1. escolher o arquivo: a tela mostra de quando é, de que versão e o que ele traz — tudo lido NO NAVEGADOR, nada sobe;
 *   2. "Conferir": o servidor prova o arquivo (hash de cada parte), diz o que mudaria e NÃO grava nada;
 *   3. "Restaurar": pede confirmação e grava. O catálogo entra como publicação nova (com a revisão que esta tela viu: se
 *      alguém mexeu no meio, o servidor recusa com 409), e dá para voltar pelo histórico.
 *
 * Quem decide é o servidor (/api/backup). A mesa só conduz. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr, O = M.operacao;

  var B = M.backup = {
    exportando: false, incluirContas: false, ultimo: null,
    arquivo: null, nomeDoArquivo: '', erroDoArquivo: '', partes: {}, plano: null, conferindo: false, restaurando: false, feito: null, erro: ''
  };

  var PARTES = ['catalogo', 'operacao', 'legal', 'contas'];

  function redesenhar() { O.redesenhar(); }

  /* --------------------------------------------------------- exportar */

  B.exportar = function () {
    if (B.exportando) return Promise.resolve(null);
    B.exportando = true;
    B.erro = '';
    redesenhar();
    var contas = B.incluirContas && M.sessao.super;
    return M.api('/api/backup' + (contas ? '?contas=1' : '')).then(function (b) {
      var dia = String(b.criadoEm || '').slice(0, 10) || 'backup';
      O.baixar('backup-' + dia + (contas ? '-com-contas' : '') + '.json', JSON.stringify(b, null, 2));
      B.ultimo = { criadoEm: b.criadoEm, resumo: b.resumo, hash: b.hashes && b.hashes.catalogo, comContas: contas, aviso: b.aviso };
      M.toast(tr('backup.baixado'));
      if (M.saude && M.saude.carregar) M.saude.carregar({});
    }).catch(function (e) {
      B.erro = e.message;
    }).then(function () {
      B.exportando = false;
      redesenhar();
    });
  };

  /* ---------------------------------------------------------- importar */

  function limparImportacao() {
    B.arquivo = null; B.nomeDoArquivo = ''; B.erroDoArquivo = ''; B.partes = {}; B.plano = null; B.feito = null; B.erro = '';
  }

  /* O arquivo é lido aqui, no navegador; só o que o servidor pedir vai pela rede, e só quando a pessoa mandar. */
  B.escolherArquivo = function (arquivo) {
    limparImportacao();
    if (!arquivo) { redesenhar(); return; }
    B.nomeDoArquivo = arquivo.name || '';
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        var b = JSON.parse(String(leitor.result));
        if (!b || b.formato !== 'streaming-backup' || !b.conteudo || typeof b.conteudo !== 'object') throw new Error('formato');
        B.arquivo = b;
        PARTES.forEach(function (p) { B.partes[p] = b.conteudo[p] != null && p !== 'contas'; });
      } catch (e) {
        B.erroDoArquivo = tr('backup.arquivoInvalido');
      }
      redesenhar();
    };
    leitor.onerror = function () { B.erroDoArquivo = tr('backup.arquivoInvalido'); redesenhar(); };
    leitor.readAsText(arquivo);
  };

  function escolhas() {
    var o = {};
    PARTES.forEach(function (p) { o[p] = B.partes[p] === true && B.arquivo && B.arquivo.conteudo[p] != null; });
    return o;
  }

  function revVista() {
    return M.st.servidor && M.st.servidor.rev != null ? M.st.servidor.rev : undefined;
  }

  function corpo(simular) {
    return JSON.stringify({ backup: B.arquivo, aplicar: escolhas(), rev: revVista(), simular: simular });
  }

  function tratarErro(e) {
    if (e.status === 409) {
      B.erro = tr('backup.catalogoMudou');
      if (M.carregarServidor) M.carregarServidor().then(function () { redesenhar(); });
    } else B.erro = e.message;
  }

  B.conferir = function () {
    if (!B.arquivo || B.conferindo) return Promise.resolve(null);
    B.conferindo = true; B.erro = ''; B.plano = null; B.feito = null;
    redesenhar();
    return M.api('/api/backup', { method: 'POST', body: corpo(true) }).then(function (r) {
      B.plano = r.plano;
    }).catch(tratarErro).then(function () {
      B.conferindo = false;
      redesenhar();
    });
  };

  B.restaurar = function () {
    if (!B.arquivo || !B.plano || B.restaurando) return Promise.resolve(null);
    if (!window.confirm(tr('backup.confirmaRestaurar'))) return Promise.resolve(null);
    B.restaurando = true; B.erro = '';
    redesenhar();
    return M.api('/api/backup', { method: 'POST', body: corpo(false) }).then(function (r) {
      B.feito = r.feito;
      B.plano = null;
      M.toast(tr('backup.restaurado'));
      /* o catálogo da tela é o que o servidor tem agora; o rascunho que sobrar vai conferir contra ele */
      return M.carregarServidor ? M.carregarServidor().then(function () { if (M.st.conflitos) M.st.conflitos = App.conflitosRascunho(M.st.servidor, M.st.rascunho); }) : null;
    }).catch(tratarErro).then(function () {
      B.restaurando = false;
      redesenhar();
    });
  };

  /* ------------------------------------------------------------- desenho */

  function data(iso) { var t = Date.parse(iso || ''); return isFinite(t) ? M.I18n.data(t, 'dataHora') : '—'; }

  function cartaoExportar() {
    var caixa = h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('backup.exportarTitulo') }),
      h('p', { class: 'p-nota', text: tr('backup.exportarTexto') }),
      M.sessao.super ? h('label', { class: 'permissao', for: 'bkp-contas' },
        h('input', { type: 'checkbox', id: 'bkp-contas', 'data-bkp': 'contas', checked: B.incluirContas }),
        h('span', null, h('b', { text: tr('backup.incluirContas') }), h('small', { text: tr('backup.incluirContasDica') }))) : null,
      B.incluirContas && M.sessao.super ? h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('backup.sensivelTitulo') + ' ' }), tr('backup.sensivelTexto')) : null,
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'bkp-exportar', disabled: B.exportando, text: B.exportando ? tr('backup.gerando') : tr('backup.baixar') }),
        h('p', { class: 'estado', id: 'bkp-estado', role: 'status' })));
    if (B.ultimo) {
      var r = B.ultimo.resumo || {};
      caixa.appendChild(h('p', { class: 'p-nota' }, tr('backup.ultimoBaixado', { data: data(B.ultimo.criadoEm), titulos: r.titulos == null ? 0 : r.titulos }),
        B.ultimo.hash ? h('span', { class: 'mono', text: ' ' + String(B.ultimo.hash).slice(0, 19) + '…' }) : null));
    }
    return caixa;
  }

  function linhaDoPlano(chave, params) { return h('li', { text: tr(chave, params) }); }

  function cartaoPlano() {
    var p = B.plano;
    if (!p) return null;
    var itens = [];
    if (p.catalogo) {
      itens.push(linhaDoPlano('backup.planoCatalogo', { titulos: p.catalogo.titulos, revDe: p.catalogo.revDe, revPara: p.catalogo.revPara, n: p.catalogo.mudancas }));
    }
    if (p.operacao) itens.push(linhaDoPlano('backup.planoOperacao', { secoes: p.operacao.secoes.length ? p.operacao.secoes.join(', ') : '—' }));
    if (p.legal) itens.push(linhaDoPlano(p.legal.disponivel ? 'backup.planoLegal' : 'backup.planoLegalSemBanco', { n: p.legal.documentos.length }));
    if (p.contas) {
      itens.push(linhaDoPlano('backup.planoEquipe', p.contas.equipe));
      itens.push(linhaDoPlano(p.contas.espectadores.semBanco ? 'backup.planoEspectadoresSemBanco' : 'backup.planoEspectadores', p.contas.espectadores));
    }
    return h('div', { class: 'aviso-opcao', role: 'region', 'aria-label': tr('backup.planoTitulo') },
      h('b', { text: tr('backup.planoTitulo') }), h('ul', { class: 'lista-ajuda' }, itens),
      p.catalogo ? h('p', { class: 'p-nota', text: tr('backup.planoVoltar') }) : null,
      p.contas ? h('p', { class: 'p-nota', text: tr('backup.planoContasNunca') }) : null);
  }

  function cartaoImportar() {
    var caixa = h('div', { class: 'cartao-conta' }, h('h2', { class: 'a-subtitulo', text: tr('backup.importarTitulo') }));
    if (!M.sessao.super) { caixa.appendChild(h('p', { class: 'p-nota', text: tr('backup.importarSoSuper') })); return caixa; }
    caixa.appendChild(h('p', { class: 'p-nota', text: tr('backup.importarTexto') }));
    caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'bkp-arquivo', text: tr('backup.escolherArquivo') }),
      h('input', { type: 'file', id: 'bkp-arquivo', accept: '.json,application/json', 'aria-describedby': 'bkp-arquivo-dica' }),
      h('p', { class: 'dica', id: 'bkp-arquivo-dica', text: tr('backup.arquivoDica') })));
    if (B.erroDoArquivo) caixa.appendChild(h('p', { class: 'estado estado-erro', role: 'alert', text: B.erroDoArquivo }));
    var b = B.arquivo;
    if (b) {
      var r = b.resumo || {};
      caixa.appendChild(h('div', { class: 'p-nota', role: 'region', 'aria-label': tr('backup.doArquivo') },
        h('b', { text: B.nomeDoArquivo + ' ' }),
        tr('backup.resumoDoArquivo', { data: data(b.criadoEm), versao: b.core || '—', origem: O.texto('saude.origem.' + b.origem, null, b.origem || '—'), titulos: r.titulos == null ? 0 : r.titulos })));
      var grupo = h('fieldset', { class: 'bkp-partes' }, h('legend', { class: 'p-rotulo', text: tr('backup.queRestaurar') }));
      PARTES.forEach(function (p) {
        var tem = b.conteudo[p] != null;
        grupo.appendChild(h('label', { class: 'permissao', for: 'bkp-p-' + p },
          h('input', { type: 'checkbox', id: 'bkp-p-' + p, 'data-bkp': 'parte', 'data-parte': p, checked: B.partes[p] === true, disabled: !tem }),
          h('span', null, h('b', { text: tr('backup.parte.' + p) }), h('small', { text: tem ? tr('backup.parteDica.' + p) : tr('backup.naoTemNoArquivo') }))));
      });
      caixa.appendChild(grupo);
      if (B.partes.catalogo && M.st.rascunho && M.st.rascunho.length) {
        caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('backup.rascunhoTitulo') + ' ' }), tr('backup.rascunhoTexto')));
      }
      var algum = PARTES.some(function (p) { return B.partes[p] === true; });
      caixa.appendChild(h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao', 'data-acao': 'bkp-conferir', disabled: !algum || B.conferindo || B.restaurando, text: B.conferindo ? tr('backup.conferindo') : tr('backup.conferir') }),
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'bkp-restaurar', disabled: !B.plano || B.restaurando, text: B.restaurando ? tr('backup.restaurando') : tr('backup.restaurar') }),
        h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'bkp-limpar', text: tr('backup.escolherOutro') })));
      var plano = cartaoPlano();
      if (plano) caixa.appendChild(plano);
    }
    if (B.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', role: 'alert', text: B.erro }));
    if (B.feito) {
      var f = B.feito, linhas = [];
      if (f.catalogo) linhas.push(h('li', { text: tr('backup.feitoCatalogo', { titulos: f.catalogo.titulos, rev: f.catalogo.rev }) }));
      if (f.operacao) linhas.push(h('li', { text: tr('backup.feitoOperacao') }));
      if (f.legal) linhas.push(h('li', { text: tr('backup.feitoLegal', { n: f.legal.documentos.length }) }));
      if (f.contas) {
        linhas.push(h('li', { text: tr('backup.feitoEquipe', f.contas.equipe) }));
        linhas.push(h('li', { text: tr('backup.feitoEspectadores', f.contas.espectadores) }));
      }
      caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'status' }, h('b', { text: tr('backup.feitoTitulo') }), h('ul', { class: 'lista-ajuda' }, linhas),
        f.catalogo && f.catalogo.hash ? h('p', { class: 'p-nota' }, tr('backup.feitoHash'), h('span', { class: 'mono', text: ' ' + String(f.catalogo.hash).slice(0, 19) + '…' })) : null));
    }
    return caixa;
  }

  function cartaoAutomatico() {
    return h('div', { class: 'cartao-conta' },
      h('h2', { class: 'a-subtitulo', text: tr('backup.autoTitulo') }),
      h('p', { class: 'p-nota', text: tr('backup.autoTexto') }),
      h('p', { class: 'p-nota', text: tr('backup.autoOnde') }));
  }

  M.telaBackup = function () {
    return h('div', { class: 'a backup' }, O.topo(tr('backup.titulo'), tr('backup.sub')),
      B.erro && !B.arquivo ? h('p', { class: 'estado estado-erro', role: 'alert', text: B.erro }) : null,
      cartaoExportar(), cartaoImportar(), cartaoAutomatico());
  };

  M.painelBackup = function () {
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('telas.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('backup.painelTitulo') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('backup.painel1') }),
        h('p', { class: 'p-nota', text: tr('backup.painel2') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('backup.painelNaoEntraTitulo') + ' ' }), tr('backup.painelNaoEntra'))) };
  };

  /* -------------------------------------------------------------- ações */

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="bkp-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'bkp-exportar') return B.exportar();
    if (a === 'bkp-conferir') return B.conferir();
    if (a === 'bkp-restaurar') return B.restaurar();
    if (a === 'bkp-limpar') { limparImportacao(); return redesenhar(); }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    if (t.id === 'bkp-arquivo') return B.escolherArquivo(t.files && t.files[0]);
    var que = t.getAttribute('data-bkp');
    if (que === 'contas') { B.incluirContas = t.checked; return redesenhar(); }
    if (que === 'parte') { B.partes[t.getAttribute('data-parte')] = t.checked; B.plano = null; return redesenhar(); }
  });
})();
