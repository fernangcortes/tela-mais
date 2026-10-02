/* mesa.js — entrada, menu, barra do meio, o site no quadro, e os eventos.
 *
 * O meio da mesa é o próprio index.html num <iframe>, em modo mesa (app.js).
 * A conversa com ele é por postMessage, e as duas pontas conferem a origem e a
 * janela de quem fala. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, st = M.st, $ = M.$;

  var el = {
    entrar: $('tela-entrar'), mesa: $('mesa'), esq: $('esq'), barra: $('barra'), palco: $('palco'),
    quadro: $('quadro'), quadroBarra: $('quadro-barra'), janela: $('quadro-janela'), site: $('site'),
    admin: $('palco-admin'), dirCab: $('dir-cab'), dirCorpo: $('dir-corpo'), rascunho: $('rascunho')
  };
  /* Foco programático, sem entrar na ordem do Tab (-1): é o que faz a seta do
   * teclado achar o ouvinte de keydown depois de entrar numa fila. Sem isto,
   * clicar no item do menu redesenha o menu inteiro (novos nós, nenhum com
   * id) e o foco cai no <body> — fora de `el.mesa` — e a seta nunca chega ao
   * ouvinte, porque bolha SOBE da árvore, nunca desce a partir do body. */
  el.mesa.tabIndex = -1;
  var LARGURA = { computador: 1400, tablet: 768, celular: 375 };
  /* 'fila-pendencias' NÃO entra aqui: ela pode mostrar duas fichas lado a
   * lado (versão duplicada), e isso não cabe no quadro de uma ficha só. */
  var NO_QUADRO = { site: true, player: true, 'fila-sinopses': true, 'fila-semsinopse': true };

  /* --------------------------------------------------------- o site no quadro */

  function enviarAoSite(msg) {
    if (!st.sitePronto || !el.site.contentWindow) return;
    msg.app = 'mesa';
    el.site.contentWindow.postMessage(msg, window.location.origin);
  }

  /* Navegação que a MESA pede ao site. A rota que volta dela não é escolha de
   * quem usa: sem esta anotação, ir para Player devolvia a ficha guardada, a
   * rota voltava, e a mesa escolhia o título — o inspetor tomava o lugar dos
   * ajustes. */
  function irNoSite(hash) {
    st.rotaEsperada = hash;
    enviarAoSite({ tipo: 'ir', hash: hash });
  }

  function enviarCatalogo() {
    if (!st.servidor) return;
    var cat = st.semRascunho ? st.servidor : M.efetivo();
    enviarAoSite({
      tipo: 'catalogo',
      editavel: M.pode('conteudo'),
      /* `site` viaja junto desde a M4: é ele que manda no nome, na ordem e no
       * escondida das prateleiras, na classe das séries, no destaque e nos
       * textos. Sem esta chave a prévia mostraria a chegada padrão enquanto o
       * site no ar mostra outra — a mesa mentiria sobre o próprio efeito. */
      dados: { rev: cat.rev, config: st.servidor.config || {}, ajustes: cat.ajustes || {}, site: cat.site || {}, itens: cat.itens }
    });
  }
  var tempoCatalogo = 0;
  function agendarCatalogo() { clearTimeout(tempoCatalogo); tempoCatalogo = setTimeout(enviarCatalogo, 120); }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== window.location.origin || ev.source !== el.site.contentWindow) return;
    var m = ev.data;
    if (!m || m.app !== 'mesa') return;
    if (m.tipo === 'pronto') {
      st.sitePronto = true;
      enviarCatalogo();
      enviarAoSite({ tipo: 'selecao', alvo: st.sel });
      if (st.rotaGuardada && NO_QUADRO[st.tela]) { irNoSite(st.rotaGuardada); st.rotaGuardada = ''; }
    } else if (m.tipo === 'selecionar') {
      M.escolher(m.alvo || '', { doSite: true });
    } else if (m.tipo === 'rota' && typeof m.hash === 'string') {
      st.rota = m.hash;
      var pedidaPelaMesa = st.rotaEsperada === m.hash;
      st.rotaEsperada = '';
      /* Abrir uma ficha pelo site — duplo clique num cartão — escolhe o título
       * dela. A ficha que a mesa mesma reabriu, não. */
      var ep = m.hash.match(/^#\/ep\/(.+)$/);
      if (ep && !pedidaPelaMesa && st.sel !== 'item:' + decodeURIComponent(ep[1])) M.escolher('item:' + decodeURIComponent(ep[1]), { doSite: true });
      else desenharBarra();
    } else if (m.tipo === 'editar' && typeof m.alvo === 'string' && m.alvo.indexOf('item:') === 0) {
      /* Digitando no site, o foco está no quadro, não no painel: redesenhar o
       * painel não tira o cursor de ninguém, e sem isso o campo da direita
       * ficaria mostrando o texto de antes. */
      var id = m.alvo.slice(5), valor = String(m.valor == null ? '' : m.valor).trim();
      if (m.campo === 'sinopse') M.mudarSinopse(id, valor, { doSite: true, semPainel: false });
      else if (m.campo === 'titulo') M.mudar(id, 'titulo', valor, { doSite: true, semCentro: true });
    }
  });

  /* A prévia do computador é de 1400 px de verdade, reduzida para caber no
   * meio (P3: o computador tem de ficar perfeito). */
  function ajustarQuadro() {
    if (!NO_QUADRO[st.tela] || el.mesa.hidden) return;
    var largura = LARGURA[st.disp];
    var cabe = el.palco.clientWidth - 36;
    var altura = el.palco.clientHeight - 36 - el.quadroBarra.offsetHeight;
    var escala = Math.min(1, cabe / largura);
    el.janela.style.width = Math.round(largura * escala) + 'px';
    el.janela.style.height = Math.max(200, altura) + 'px';
    el.site.style.width = largura + 'px';
    el.site.style.height = Math.round(Math.max(200, altura) / escala) + 'px';
    el.site.style.transform = escala < 1 ? 'scale(' + escala + ')' : 'none';
    st.leituraQuadro = largura + ' px' + (escala < 1 ? ' · ' + Math.round(escala * 100) + '%' : '');
    var leitura = $('quadro-largura');
    if (leitura) leitura.textContent = st.leituraQuadro;
  }

  /* ------------------------------------------------------------------ menu */

  function itemMenu(tela, icone, rotulo, badge, classeBadge) {
    var ativo = st.tela === tela || (tela === 'site' && st.tela === 'capa');
    return h('li', null, h('button', { type: 'button', class: 'menu-item' + (ativo ? ' ativo' : ''), 'data-acao': 'tela', 'data-tela': tela, 'aria-current': ativo ? 'page' : null, title: rotulo },
      M.ic(icone), h('span', { class: 'menu-rotulo', text: rotulo }), badge != null ? h('span', { class: 'badge mono ' + (classeBadge || ''), text: String(badge) }) : null));
  }

  function desenharMenu() {
    var cat = M.efetivo();
    var envio = M.envio.fase === 'enviando' || M.envio.fase === 'pausado' ? Math.floor(M.pctEnvio()) + '%' : M.envio.fase === 'enviado' ? 'ok' : null;
    var ate = new Date(M.sessao.expira * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.esq.replaceChildren(h('div', { class: 'menu' },
      h('div', { class: 'marca-mesa' }, h('span', { class: 'marca-mesa-logo', 'aria-hidden': 'true' }, 'P'),
        h('span', { class: 'menu-rotulo' }, h('b', { text: 'Plataforma Exemplo' }), h('small', { text: 'Mesa de Curadoria' }))),
      h('ul', { class: 'menu-lista' },
        itemMenu('site', 'site', 'Site'),
        h('li', { class: 'menu-grupo', text: 'Catálogo' }),
        itemMenu('catalogo', 'tabela', 'Todos os títulos', cat ? cat.itens.length : null),
        M.pode('enviar') ? itemMenu('enviar', 'enviar', 'Enviar título', envio, 'b-ouro') : null,
        itemMenu('historico', 'desfazer', 'Histórico'),
        M.pode('conteudo') && cat ? h('li', { class: 'menu-grupo', text: 'Filas de trabalho' }) : null,
        M.pode('conteudo') && cat ? itemMenu('fila-sinopses', 'busca', 'Sinopses a revisar', App.filaSinopses(cat.itens).length) : null,
        M.pode('conteudo') && cat ? itemMenu('fila-pendencias', 'alerta', 'Pendências', App.filaPendencias(cat.itens).length, 'b-ouro') : null,
        M.pode('conteudo') && cat ? itemMenu('fila-semsinopse', 'imagem', 'Sem sinopse', App.filaSemSinopse(cat.itens).length, 'b-ouro') : null,
        M.pode('player') || M.pode('estrutura') ? h('li', { class: 'menu-grupo', text: 'Ajustes' }) : null,
        M.pode('estrutura') ? itemMenu('estrutura', 'estrutura', 'Estrutura') : null,
        M.pode('player') ? itemMenu('player', 'player', 'Player') : null,
        h('li', { class: 'menu-grupo', text: 'Equipe' }),
        M.sessao.super ? itemMenu('contas', 'contas', 'Contas', (M.contas.lista || []).length || null) : null,
        itemMenu('conta', 'conta', M.sessao.super ? 'Superadmin' : M.sessao.nome)),
      h('div', { class: 'menu-pe' },
        h('span', { class: 'menu-rotulo sessao', text: 'sessão até ' + ate }),
        h('button', { type: 'button', class: 'icone-botao', id: 'b-sair', 'aria-label': 'Sair', title: 'Sair' }, M.ic('sair')),
        h('button', { type: 'button', class: 'icone-botao so-largo', id: 'b-recolher', 'aria-label': st.rail ? 'Abrir o menu' : 'Recolher o menu', 'aria-pressed': String(st.rail) }, M.ic('recolher')))));
  }

  /* --------------------------------------------------------- barra do meio */

  function nomeDaRota() {
    var ep = st.rota.match(/^#\/ep\/(.+)$/);
    if (ep) { var it = M.item(decodeURIComponent(ep[1])); return ['Ficha', it ? App.tituloCurto(it) : '']; }
    var tudo = st.rota.match(/^#\/tudo\/(.+)$/);
    if (tudo) return ['Ver tudo'];
    return ['Início'];
  }

  function segmentado(prefixo, opcoes, atual, rotulo) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': rotulo }, opcoes.map(function (o) {
      return h('button', { type: 'button', id: prefixo + o[0], 'aria-pressed': String(atual === o[0]), title: o[1] },
        o[2] ? M.ic(o[2]) : null, h('span', { class: o[2] ? 'so-leitor' : '', text: o[1] }));
    }));
  }

  function desenharBarra() {
    var trilha = st.tela === 'site' ? ['Site'].concat(nomeDaRota())
      : st.tela === 'capa' ? ['Site', 'Escolher capa']
      : st.tela === 'player' ? ['Ajustes', 'Player']
      : st.tela === 'estrutura' ? ['Ajustes', 'Estrutura']
      : st.tela === 'historico' ? ['Catálogo', 'Histórico']
      : st.tela === 'enviar' ? ['Catálogo', 'Enviar título']
      : st.tela === 'contas' ? ['Equipe', 'Contas']
      : st.tela === 'conta' ? ['Equipe', 'Minha conta']
      : M.FILAS[st.tela] ? ['Filas de trabalho', M.FILAS[st.tela].rotulo]
      : ['Catálogo', 'Todos os títulos'];
    var ferramentas = h('div', { class: 'ferramentas' });
    if (NO_QUADRO[st.tela]) {
      ferramentas.appendChild(segmentado('d-', [['computador', 'Computador · 1400 px', 'computador'], ['tablet', 'Tablet · 768 px', 'tablet'], ['celular', 'Celular · 375 px', 'celular']], st.disp, 'Largura da prévia'));
      ferramentas.appendChild(segmentado('v-', [['rascunho', 'Com rascunho'], ['noar', 'No ar']], st.semRascunho ? 'noar' : 'rascunho', 'O que a prévia mostra'));
    }
    ferramentas.appendChild(h('a', { class: 'botao botao-leve botao-pequeno', href: 'index.html' + (NO_QUADRO[st.tela] ? st.rota : ''), target: '_blank', rel: 'noopener' }, M.ic('abrir'), 'Abrir o site'));
    ferramentas.appendChild(h('button', { type: 'button', class: 'icone-botao so-movel', id: 'b-painel', 'aria-label': 'Painel da direita' }, M.ic('painel')));
    el.barra.replaceChildren(h('div', { class: 'barra-in' },
      h('button', { type: 'button', class: 'icone-botao so-movel', id: 'b-menu', 'aria-label': 'Menu' }, M.ic('menu')),
      h('p', { class: 'trilha' }, trilha.filter(Boolean).map(function (t, k, a) { return h('span', { class: k === a.length - 1 ? 'trilha-atual' : '', text: t }); })),
      ferramentas));
  }

  function desenharQuadroBarra() {
    var n = M.contarAlteracoes();
    el.quadroBarra.replaceChildren(
      h('span', { class: 'ponto ' + (st.semRascunho || !n ? 'ponto-verde' : 'ponto-ouro') }),
      h('span', { text: st.semRascunho ? 'O site no ar, sem o rascunho' : n ? 'Prévia com o rascunho: ' + n + (n === 1 ? ' alteração' : ' alterações') : 'Prévia igual ao site no ar' }),
      h('span', { class: 'quadro-largura mono', id: 'quadro-largura', text: st.leituraQuadro || '' }));
  }

  /* ------------------------------------------------------------- desenhar */

  function desenharCentro() {
    var noQuadro = !!NO_QUADRO[st.tela];
    el.quadro.hidden = !noQuadro;
    el.admin.hidden = noQuadro;
    el.palco.classList.toggle('palco-site', noQuadro);
    if (noQuadro) return;
    var cat = M.efetivo();
    var topo = el.admin.scrollTop;
    el.admin.replaceChildren(
      st.tela === 'enviar' ? M.telaEnviar()
        : st.tela === 'capa' ? M.telaCapa(cat)
        : st.tela === 'contas' ? M.telaContas()
        : st.tela === 'conta' ? M.telaMinhaConta()
        : st.tela === 'fila-pendencias' ? M.telaPendencias(cat)
        : st.tela === 'estrutura' ? M.telaEstrutura(cat)
        : st.tela === 'historico' ? M.telaHistorico(cat)
        : M.telaCatalogo(cat));
    el.admin.scrollTop = topo;
  }

  function desenharPainel() {
    var p = M.painel(M.efetivo());
    el.dirCab.replaceChildren(p.cab);
    el.dirCorpo.replaceChildren(p.corpo);
  }

  function desenharRascunho() { el.rascunho.replaceChildren(M.barraRascunho()); }

  function desenharSeries() {
    var lista = $('lista-series');
    lista.replaceChildren.apply(lista, App.series(M.efetivo().itens).map(function (s) { return h('option', { value: s }); }));
  }

  function redesenhar(o) {
    o = o || {};
    if (!st.servidor) return;
    var ativo = document.activeElement && el.mesa.contains(document.activeElement) ? document.activeElement.id : '';
    desenharMenu();
    desenharBarra();
    desenharQuadroBarra();
    if (!o.semCentro) desenharCentro();
    if (!o.semPainel) desenharPainel();
    desenharRascunho();
    desenharSeries();
    el.mesa.classList.toggle('esq-aberta', !!st.esqAberta);
    el.mesa.classList.toggle('dir-aberta', !!st.dirAberta);
    el.mesa.classList.toggle('rail', !!st.rail && !el.mesa.classList.contains('movel'));
    if (ativo && $(ativo) && document.activeElement !== $(ativo)) $(ativo).focus({ preventScroll: true });
  }
  M.redesenhar = redesenhar;

  M.aoMudar = function (o) {
    if (o.soBarra) { desenharRascunho(); return; }
    agendarCatalogo();
    redesenhar({ semCentro: o.semCentro, semPainel: o.semPainel });
  };

  var tempoProgresso = 0;
  M.aoProgressoEnvio = function () {
    if (tempoProgresso) return;
    tempoProgresso = setTimeout(function () { tempoProgresso = 0; desenharMenu(); }, 1000);
  };

  /* ----------------------------------------------------------------- ações */

  function irTela(tela, o) {
    o = o || {};
    var eraQuadro = !!NO_QUADRO[st.tela], vaiQuadro = !!NO_QUADRO[tela];
    /* Esconder o quadro com uma ficha aberta deixaria o vídeo tocando sem
     * ninguém ver — e ouvindo. A ficha sai de cena e volta ao voltar. */
    if (eraQuadro && !vaiQuadro && /^#\/ep\//.test(st.rota)) { st.rotaGuardada = st.rota; irNoSite('#/'); }
    if (!eraQuadro && vaiQuadro && st.rotaGuardada) { irNoSite(st.rotaGuardada); st.rotaGuardada = ''; }
    st.tela = tela;
    st.esqAberta = false;
    if (!o.manterSel) { st.sel = ''; st.dirAberta = false; enviarAoSite({ tipo: 'selecao', alvo: '' }); }
    redesenhar();
    ajustarQuadro();
  }
  M.irTela = irTela;

  M.escolher = function (alvo, o) {
    o = o || {};
    if (o.tela && o.tela !== st.tela) irTela(o.tela, { manterSel: true });
    if (st.sel !== alvo) st.aba = 'editar';
    st.sel = alvo;
    enviarAoSite({ tipo: 'selecao', alvo: alvo });
    if (!o.doSite && alvo && NO_QUADRO[st.tela]) enviarAoSite({ tipo: 'rolar', alvo: alvo });
    if (el.mesa.classList.contains('movel')) st.dirAberta = !!alvo;
    /* 'catalogo' redesenha para marcar a linha selecionada; 'fila-pendencias'
     * redesenha porque O CENTRO É a ficha da pendência atual, não o quadro do
     * site — sem isto ela ficava sempre um passo atrás da seleção. */
    redesenhar({ semCentro: st.tela !== 'catalogo' && st.tela !== 'fila-pendencias' });
  };

  function abrirFicha(id) {
    if (!NO_QUADRO[st.tela]) irTela('site', { manterSel: true });
    st.rotaGuardada = '';
    irNoSite('#/ep/' + encodeURIComponent(id));
    M.escolher('item:' + id);
  }

  /* ------------------------------------------------------- filas (M3)
   *
   * As três filas (M.FILAS) andam pela mesma seleção de sempre (`st.sel`):
   * as que abrem a ficha no quadro (sinopses, sem sinopse) usam abrirFicha;
   * "Pendências" tem tela própria — mudar de item não sai dela. */
  function irNaFila(tipo, id) {
    if (NO_QUADRO[tipo]) abrirFicha(id);
    else M.escolher('item:' + id, { tela: tipo });
    /* Devolve o foco à mesa (nunca a um botão específico, que o próximo
     * redesenho troca por um nó novo): é o que deixa a seta seguinte
     * funcionar sem precisar clicar em nada de novo. */
    if (!el.mesa.contains(document.activeElement)) el.mesa.focus({ preventScroll: true });
  }

  function abrirPrimeiroDaFila(tipo) {
    var lista = M.filaItens(tipo);
    if (lista.length) irNaFila(tipo, lista[0].id);
  }

  /* Confirmar não muda o texto — quem já editou a sinopse, editando já
   * revisou (M.mudarSinopse). Isto é só para quem leu e concordou. */
  function confirmarSinopseEAvancar() {
    var pos = M.filaPosicao('fila-sinopses');
    if (!pos || pos.indice < 0) return;
    var it = pos.lista[pos.indice];
    var proximo = pos.lista[pos.indice + 1] || null;
    if (it.sinopse_origem === 'auto') M.mudar(it.id, 'sinopse_origem', 'revisada', { semPainel: true, semCentro: true });
    if (proximo) irNaFila('fila-sinopses', proximo.id);
    else { M.escolher(''); M.toast('Fila de sinopses concluída — nada mais a revisar.'); }
  }

  /* "Resolvida" tira a pendência; "tirar do ar" some da chegada por decisão
   * de conteúdo (piloto a decidir, material bruto etc.) e também some da
   * pendência — ninguém revisa de novo algo que já saiu do ar por isso. */
  function decidirPendencia(id, tirarDoAr) {
    var pos = M.filaPosicao('fila-pendencias');
    var indice = pos ? pos.lista.findIndex(function (i) { return i.id === id; }) : -1;
    var proximo = indice >= 0 ? (pos.lista[indice + 1] || pos.lista[indice - 1] || null) : null;
    var pares = [['pendencia', null]];
    if (tirarDoAr) pares.push(['publicar', false]);
    M.mudarVarios(id, pares, { semPainel: true, semCentro: false });
    M.escolher(proximo ? 'item:' + proximo.id : '', { tela: 'fila-pendencias' });
  }

  /* Editar a sinopse à mão é revisá-la — mas só se o texto mudou. Voltar ao
   * texto do servidor devolve a origem que ele tinha. */
  M.mudarSinopse = function (id, texto, o) {
    var noServidor = M.item(id, true) || {};
    var mudou = texto !== String(noServidor.sinopse || '').trim();
    M.mudarVarios(id, [['sinopse', texto], ['sinopse_origem', mudou ? 'revisada' : noServidor.sinopse_origem]],
      Object.assign({ semPainel: true, semCentro: true }, o || {}));
  };

  function alternarNoAr(id, ligar) {
    var it = M.item(id);
    if (!it) return;
    if (ligar && !(it.fonte && it.fonte.videoId)) {
      M.toast('Este título não tem vídeo no Bunny: pôr no ar deixaria um player vazio.');
      return redesenhar();
    }
    /* Marcado como bruto de câmera na curadoria: dá para pôr no ar, mas não por descuido. */
    if (ligar && it.pendencia === 'material_bruto' &&
        !window.confirm('Este título foi identificado como MATERIAL BRUTO (não editado).\n\n' + (it.nota_curadoria || '') + '\n\nPôr no ar mesmo assim?')) {
      return redesenhar();
    }
    M.mudar(id, 'publicar', ligar);
  }

  function emLote(ligar) {
    var ids = Object.keys(st.marcados).filter(function (k) { return st.marcados[k]; });
    var pulados = 0;
    ids.forEach(function (id) {
      var it = M.item(id);
      if (!it || (ligar && !(it.fonte && it.fonte.videoId))) { pulados++; return; }
      if (it.publicar !== ligar) st.rascunho = App.registrarMudanca(st.rascunho, { alvo: id, campo: 'publicar', antes: M.valorNoServidor(id, 'publicar'), depois: ligar });
    });
    st.marcados = {};
    st.versao++;
    M.guardarRascunho();
    if (pulados) M.toast(pulados + (pulados === 1 ? ' título sem vídeo ficou fora do ar.' : ' títulos sem vídeo ficaram fora do ar.'));
    M.aoMudar({});
  }

  function consultarMidia() {
    var it = st.sel.indexOf('item:') === 0 && M.item(st.sel.slice(5));
    var videoId = it && it.fonte && it.fonte.videoId;
    st.midia = st.midia || {};
    if (!videoId || videoId in st.midia) return;
    st.midia[videoId] = null;
    M.api('/api/midia?videoId=' + encodeURIComponent(videoId)).then(function (s) { st.midia[videoId] = s; })
      .catch(function (e) { st.midia[videoId] = { erro: e.message }; })
      .then(function () { if (st.aba === 'dados') redesenhar({ semCentro: true }); });
  }

  function recarregar() {
    return M.carregarServidor().then(function () {
      st.lidoEm = Date.now();
      st.conflitos = App.conflitosRascunho(st.servidor, st.rascunho);
      agendarCatalogo();
      /* O índice da busca também é relido: é ele que diz quem ficou fora. */
      M.carregarBusca();
      redesenhar();
      M.toast('Catálogo lido de novo · rev ' + st.servidor.rev + (st.conflitos.length ? ' · ' + st.conflitos.length + ' em conflito com o rascunho' : ''));
    }).catch(function (e) { M.toast('Não deu para ler o catálogo: ' + e.message); });
  }

  /* ------------------------------------------------------------- contas */

  function mudarConta(usuario, mudanca) {
    return M.api('/api/contas', { method: 'PUT', body: JSON.stringify(Object.assign({ usuario: usuario }, mudanca)) })
      .then(function (r) {
        M.toast(r.sessoesDerrubadas ? 'Salvo. A sessão aberta de ' + usuario + ' caiu.' : 'Salvo.');
        return M.carregarContas();
      })
      .catch(function (e) { M.toast(e.message); });
  }

  function criarConta() {
    var estado = $('nc-estado');
    var senha = $('nc-senha').value;
    var corpo = {
      usuario: ($('nc-usuario').value || '').trim().toLowerCase(),
      nome: ($('nc-nome').value || '').trim(),
      senha: senha,
      permissoes: M.marcadasEm('nc-'),
      limiteEnvio: M.limiteEnvioEm('nc-')
    };
    estado.textContent = 'Criando…';
    M.api('/api/contas', { method: 'POST', body: JSON.stringify(corpo) }).then(function (r) {
      M.contas.senhaNova = { usuario: r.conta.usuario, senha: senha };
      return M.carregarContas();
    }).catch(function (e) { estado.textContent = e.message; });
  }

  var POR_ID = {
    'nc-sortear': function () { $('nc-senha').value = M.senhaSorteada(); },
    'nc-criar': criarConta,
    'senha-ok': function () { M.contas.senhaNova = null; redesenhar({ semPainel: true }); },
    'ms-trocar': function () {
      var estado = $('ms-estado');
      estado.textContent = 'Trocando…';
      M.api('/api/conta', { method: 'PUT', body: JSON.stringify({ senhaAtual: $('ms-atual').value, senhaNova: $('ms-nova').value }) })
        .then(function (r) {
          M.guardarSessao(r);
          $('ms-atual').value = '';
          $('ms-nova').value = '';
          estado.textContent = '';
          M.toast('Senha trocada. As outras sessões desta conta caíram.');
        })
        .catch(function (e) { estado.textContent = e.message; });
    },
    'b-menu': function () { st.esqAberta = !st.esqAberta; redesenhar({ semCentro: true, semPainel: true }); },
    'b-painel': function () { st.dirAberta = !st.dirAberta; redesenhar({ semCentro: true, semPainel: true }); },
    'b-recolher': function () { st.rail = !st.rail; redesenhar({ semCentro: true, semPainel: true }); setTimeout(ajustarQuadro, 0); },
    'b-sair': function () { M.encerrarSessao(); },
    'd-computador': function () { st.disp = 'computador'; redesenhar({ semCentro: true, semPainel: true }); ajustarQuadro(); },
    'd-tablet': function () { st.disp = 'tablet'; redesenhar({ semCentro: true, semPainel: true }); ajustarQuadro(); },
    'd-celular': function () { st.disp = 'celular'; redesenhar({ semCentro: true, semPainel: true }); ajustarQuadro(); },
    'v-rascunho': function () { st.semRascunho = false; enviarCatalogo(); redesenhar({ semCentro: true, semPainel: true }); },
    'v-noar': function () { st.semRascunho = true; enviarCatalogo(); redesenhar({ semCentro: true, semPainel: true }); },
    'f-confirmar': function () { if (st.sel.indexOf('item:') === 0) M.mudar(st.sel.slice(5), 'sinopse_origem', 'revisada'); },
    /* A série do painel é a escolhida — 'serie:<nome>' (fase 5). */
    's-revisar': function () { M.mudarSerie(st.sel.slice(6), { origem: 'revisada' }, {}); },
    's-gerado': function () {
      var nome = st.sel.slice(6);
      if (!window.confirm('Voltar "' + nome + '" ao gerado?\n\nA apresentação sai da página até o script gerar de novo. O que foi revisado se perde (o histórico guarda).')) return;
      M.voltarSerieAoGerado(nome);
    },
    /* A prateleira do painel é a que está escolhida — `st.sel` é
     * 'prateleira:<id>', e o id vem de lá para não haver duas verdades. */
    'pr-sobe': function () { M.moverPrateleira(st.sel.slice(11), -1); },
    'pr-desce': function () { M.moverPrateleira(st.sel.slice(11), 1); },
    'pr-padrao': function () { M.padraoDaPrateleira(st.sel.slice(11)); },
    'f-quadro': function () { st.capaDe = st.sel.slice(5); irTela('capa', { manterSel: true }); },
    'f-destaque': function () {
      var id = st.sel.slice(5), it = M.item(id);
      if (!it) return;
      var cat = M.efetivo();
      var atual = App.destaque(cat.itens, cat.site);
      var ligar = !(atual && atual.id === id);
      /* Trocar o destaque tira o de outro título, e quem clica tem de saber QUAL
       * — senão a chegada muda de cara e ninguém liga uma coisa à outra (D4).
       * Só pergunta quando havia ESCOLHA: passar por cima do padrão não desfaz
       * decisão de ninguém. */
      var escolhido = !!M.site().destaque || cat.itens.some(function (i) { return i.destaque === true && i.publicar === true; });
      if (ligar && escolhido && atual && atual.id !== id &&
        !window.confirm('A chegada destaca hoje:\n\n' + (atual.titulo || atual.id) + '\n\nSubstituir por este título?')) return;
      M.destacar(id, ligar);
    },
    'r-ver': function () { st.verRascunho = !st.verRascunho; desenharRascunho(); },
    'r-descartar': function () {
      var n = M.contarAlteracoes();
      if (window.confirm('Descartar ' + n + (n === 1 ? ' alteração' : ' alterações') + ' do rascunho? O site não muda.')) M.descartarRascunho();
    },
    'r-publicar': function () { M.publicar(); },
    'a-padrao': function () { M.mudarVarios('ajustes', [['arrastoTeto', 0.4], ['controlesEspera', 3]]); },
    'env-enviar': function () { M.comecarEnvio(); },
    'env-pausar': function () { M.pausarEnvio(); },
    'n-salvar': function () { M.salvarTituloNovo(); },
    'capa-usar': function () { M.usarQuadro(); },
    'lote-publicar': function () { emLote(true); },
    'lote-tirar': function () { emLote(false); },
    'lote-limpar': function () { st.marcados = {}; redesenhar({ semPainel: true }); },
    'fila-confirmar': confirmarSinopseEAvancar
  };

  el.mesa.addEventListener('click', function (ev) {
    var t = ev.target;
    var comId = t.closest('button[id]');
    if (comId && POR_ID[comId.id] && !comId.disabled) { POR_ID[comId.id](); return; }
    if (t.id === 'veu') { st.esqAberta = st.dirAberta = false; redesenhar({ semCentro: true, semPainel: true }); return; }

    var acao = t.closest('[data-acao]');
    if (acao && acao.tagName !== 'INPUT') {
      var a = acao.getAttribute('data-acao');
      /* A tela Estrutura tem uma linha por prateleira: o id vem do botão, e
       * não da seleção — ali não há nada escolhido. */
      /* O HISTÓRICO (M5). Abrir uma publicação lê o registro dela; desfazer
       * uma mudança entra no rascunho de sempre; restaurar é uma publicação
       * nova, e por isso pergunta antes. */
      if (a === 'hist-recarregar') return M.carregarHistorico();
      if (a === 'hist-mais') return M.carregarHistorico(true);
      if (a === 'hist-abrir') return M.abrirPublicacao(Number(acao.getAttribute('data-rev')));
      if (a === 'hist-desfazer') {
        var dif = (M.hist.registro && M.hist.registro.mudancas) || [];
        return M.desfazerDoHistorico(dif[Number(acao.getAttribute('data-i'))]);
      }
      if (a === 'hist-restaurar') {
        var revVolta = Number(acao.getAttribute('data-rev'));
        if (!window.confirm('Voltar o catálogo inteiro para a rev ' + revVolta + '?\n\nIsso é uma publicação nova: o site muda na hora, e a volta fica no histórico. Nada é apagado.')) return;
        return M.restaurarVersao(revVolta);
      }
      if (a === 'pr-mover') return M.moverPrateleira(acao.getAttribute('data-id'), Number(acao.getAttribute('data-passo')));
      if (a === 'pr-esconder') {
        var idPr = acao.getAttribute('data-id');
        var cfg = M.site().prateleiras[idPr] || {};
        return M.esconderPrateleira(idPr, !cfg.escondida);
      }
      if (a === 'tela') {
        var tela = acao.getAttribute('data-tela');
        irTela(tela);
        if (M.FILAS[tela]) abrirPrimeiroDaFila(tela);
        /* A linha do tempo não vem no catálogo: é uma listagem à parte, e é
         * lida ao abrir a tela. Reler a cada visita é de propósito — quem
         * abre o histórico quer ver o que acabou de acontecer. */
        if (tela === 'historico') M.carregarHistorico();
        return;
      }
      if (a === 'fila-anterior' || a === 'fila-proxima') {
        var pos = M.filaPosicao(st.tela);
        if (!pos) return;
        var novo = pos.indice + (a === 'fila-proxima' ? 1 : -1);
        if (novo < 0 || novo >= pos.lista.length) return;
        return irNaFila(st.tela, pos.lista[novo].id);
      }
      if (a === 'fila-resolver') return decidirPendencia(acao.getAttribute('data-id'), false);
      if (a === 'fila-tirar-do-ar') return decidirPendencia(acao.getAttribute('data-id'), true);
      if (a === 'fechar') return M.escolher('');
      if (a === 'aba') { st.aba = acao.getAttribute('data-aba'); if (st.aba === 'dados') consultarMidia(); return redesenhar({ semCentro: true }); }
      if (a === 'filtro') { st.filtro = acao.getAttribute('data-filtro'); return st.tela === 'catalogo' ? redesenhar({ semPainel: true }) : irTela('catalogo'); }
      /* A busca: põe na busca quem ficou fora. */
      if (a === 'busca-por') return M.porNaBusca();
      /* O cabeçalho da tabela, em três batidas: ordena pela coluna, inverte,
       * e devolve a ordem do acervo — que é a única que agrupa por série, e a
       * que a tela abre. Sem a terceira, quem ordenasse por duração não teria
       * como voltar a enxergar as séries inteiras. */
      if (a === 'ordenar') {
        var coluna = acao.getAttribute('data-coluna');
        if (st.ordem !== coluna) { st.ordem = coluna; st.ordemDesc = false; }
        else if (!st.ordemDesc) { st.ordemDesc = true; }
        else { st.ordem = ''; st.ordemDesc = false; }
        return redesenhar({ semPainel: true });
      }
      if (a === 'escolher') {
        var alvo = acao.getAttribute('data-alvo');
        if (!alvo) return irTela('player');
        if (alvo.indexOf('prateleira:') === 0 && !NO_QUADRO[st.tela]) return M.escolher(alvo, { tela: 'site' });
        /* A série escolhida fora do quadro abre a página dela no quadro: é lá
         * que o "Sobre" aparece enquanto se escreve. */
        if (alvo.indexOf('serie:') === 0) {
          M.escolher(alvo, { tela: 'site' });
          return irNoSite('#/serie/' + encodeURIComponent(alvo.slice(6)));
        }
        return M.escolher(alvo);
      }
      if (a === 'abrir-ficha') return abrirFicha(acao.getAttribute('data-id'));
      if (a === 'desfazer') return M.desfazerMudanca(acao.getAttribute('data-alvo'), acao.getAttribute('data-campo'));
      if (a === 'conflito-meu') return M.resolverConflito(acao.getAttribute('data-alvo'), acao.getAttribute('data-campo'), true);
      if (a === 'conflito-site') return M.resolverConflito(acao.getAttribute('data-alvo'), acao.getAttribute('data-campo'), false);
      if (a === 'recarregar') return recarregar();

      var usuario = acao.getAttribute('data-usuario');
      if (a === 'conta-editar') { M.contas.editando = M.contas.editando === usuario ? '' : usuario; return redesenhar({ semPainel: true }); }
      if (a === 'conta-salvar') {
        return mudarConta(usuario, { permissoes: M.marcadasEm('ec-'), limiteEnvio: M.limiteEnvioEm('ec-') }).then(function () {
          M.contas.editando = '';
          redesenhar({ semPainel: true });
        });
      }
      if (a === 'conta-ativa') return mudarConta(usuario, { ativa: acao.getAttribute('data-ativa') === 'true' });
      if (a === 'conta-senha') {
        if (!window.confirm('Sortear uma senha nova para ' + usuario + '?\n\nA senha de agora para de valer, e a sessão aberta dela cai.')) return;
        var senha = M.senhaSorteada();
        return mudarConta(usuario, { senha: senha }).then(function () {
          M.contas.senhaNova = { usuario: usuario, senha: senha };
          redesenhar({ semPainel: true });
        });
      }
      if (a === 'conta-excluir') {
        if (!window.confirm('Excluir a conta ' + usuario + '?\n\nEla perde o acesso na hora.')) return;
        return M.api('/api/contas?usuario=' + encodeURIComponent(usuario), { method: 'DELETE' })
          .then(function () { M.toast('Conta excluída.'); return M.carregarContas(); })
          .catch(function (e) { M.toast(e.message); });
      }

      if (a === 'pedido-aprovar' || a === 'pedido-recusar') {
        var id = acao.getAttribute('data-id');
        return M.api('/api/autorizacoes', { method: 'PUT', body: JSON.stringify({ id: id, aprovado: a === 'pedido-aprovar' }) })
          .then(function () {
            M.toast(a === 'pedido-aprovar' ? 'Pedido aprovado — a pessoa retoma o envio dela.' : 'Pedido recusado.');
            return M.carregarAutorizacoes();
          })
          .catch(function (e) { M.toast(e.message); });
      }
    }
    if (t.closest('input, label, select, textarea, a')) return;
    var linha = t.closest('tr[data-alvo]');
    if (linha) M.escolher(linha.getAttribute('data-alvo'));
  });

  el.mesa.addEventListener('dblclick', function (ev) {
    var linha = ev.target.closest('tr[data-alvo]');
    if (linha && !ev.target.closest('input, label')) abrirFicha(linha.getAttribute('data-alvo').slice(5));
  });

  var TEXTO = { 'f-titulo': 'titulo', 'f-ano': 'ano', 'f-tema': 'tema', 'f-publico': 'publico_alvo' };

  el.mesa.addEventListener('input', function (ev) {
    var t = ev.target, id = st.sel.indexOf('item:') === 0 ? st.sel.slice(5) : '';
    if (TEXTO[t.id] && id) {
      M.mudar(id, TEXTO[t.id], t.value.trim(), { semPainel: true, semCentro: true });
      if (t.id === 'f-titulo') $('f-titulo-dica').textContent = M.dicaTitulo(Object.assign({}, M.item(id), { titulo: t.value.trim() }));
      return;
    }
    if (t.id === 'f-tags' && id) {
      return M.mudar(id, 'tags', t.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean), { semPainel: true, semCentro: true });
    }
    if (t.id === 'f-sinopse' && id) {
      M.mudarSinopse(id, t.value.trim());
      var it = M.item(id), chipOrigem = $('f-origem');
      chipOrigem.textContent = !it.sinopse ? 'vazia' : it.sinopse_origem === 'auto' ? 'automática' : 'revisada';
      chipOrigem.className = 'chip ' + (!it.sinopse ? 'chip-erro' : it.sinopse_origem === 'auto' ? 'chip-alerta' : 'chip-ok');
      return;
    }
    /* A ESTRUTURA (M4), pelos dois caminhos. O campo do painel não redesenha o
     * painel; o da tela Estrutura não redesenha o centro — os dois sumiriam
     * debaixo do cursor de quem está digitando. */
    if (t.id === 'pr-nome' && st.sel.indexOf('prateleira:') === 0) {
      return M.renomearPrateleira(st.sel.slice(11), t.value, { semPainel: true });
    }
    if (t.hasAttribute('data-texto-prateleira')) {
      return M.renomearPrateleira(t.getAttribute('data-texto-prateleira'), t.value, { semCentro: true });
    }
    if (t.id === 'tx-rodape') return M.mudarTextoDoSite('rodape', t.value, { semPainel: true });
    if (t.id === 's-sobre' && st.sel.indexOf('serie:') === 0) {
      var nomeSerie = st.sel.slice(6);
      M.mudarSerie(nomeSerie, { sobre: t.value });
      var dadoSerie = M.site().series[nomeSerie], chipSerie = $('s-origem');
      chipSerie.textContent = !dadoSerie ? 'sem apresentação' : dadoSerie.origem === 'revisada' ? 'revisado' : 'automático · não revisado';
      chipSerie.className = 'chip ' + (!dadoSerie ? 'chip-erro' : dadoSerie.origem === 'revisada' ? 'chip-ok' : 'chip-alerta');
      return;
    }
    if (t.id === 's-temas' && st.sel.indexOf('serie:') === 0) {
      return M.mudarSerie(st.sel.slice(6), { temas: t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) });
    }
    if (t.hasAttribute('data-texto')) return M.mudarTextoDoSite(t.getAttribute('data-texto'), t.value, { semCentro: true });
    if (t.id === 'cat-busca') {
      st.busca = t.value;
      var r = M.linhasCatalogo(M.efetivo());
      $('cat-linhas').replaceWith(r.tbody);
      $('cat-conta').textContent = r.n + (r.n === 1 ? ' título' : ' títulos');
      return;
    }
    if (t.id === 'a-teto') {
      var pct = Number(t.value), estado = $('a-estado');
      if (!isFinite(pct) || pct < 5 || pct > 100) { estado.textContent = 'Escolha entre 5% e 100%.'; return; }
      estado.textContent = '';
      $('a-exemplos').replaceChildren.apply($('a-exemplos'), M.exemplosDoTeto(M.efetivo(), pct).map(function (x) { return h('li', { text: x }); }));
      /* Grava a FRAÇÃO: a tela fala em % porque é o que se lê, e o player-core
       * trabalha em fração. Trocar isso em silêncio faria o teto valer 40
       * vezes o vídeo. */
      return M.mudar('ajustes', 'arrastoTeto', Math.round(pct) / 100, { semPainel: true, semCentro: true });
    }
    if (t.id === 'env-titulo') { M.envio.titulo = t.value; return; }
  });

  el.mesa.addEventListener('change', function (ev) {
    var t = ev.target, id = st.sel.indexOf('item:') === 0 ? st.sel.slice(5) : '';
    if (t.id === 'f-publicar' && id) return alternarNoAr(id, t.checked);
    if (t.id === 'f-serie' && id) return M.mudar(id, 'serie', t.value.trim() || 'A classificar');
    if ((t.id === 'f-temporada' || t.id === 'f-episodio') && id) return M.mudar(id, t.id.slice(2), t.value === '' ? null : Number(t.value));
    if (t.id === 'f-pendencia' && id) return M.mudar(id, 'pendencia', t.value || null);
    if (t.id === 'm-titularidade' && id) return M.mudar(id, 'titularidade', t.value);
    if (t.id === 'm-evidencia' && id) return M.mudar(id, 'nivel_evidencia', t.value);
    if ((TEXTO[t.id] || t.id === 'f-sinopse' || t.id === 'f-tags') && id) return redesenhar();
    if (t.id === 'f-jpg' && id && t.files[0]) {
      return M.enviarCapa(M.item(id), t.files[0]).catch(function (e) { M.toast(e.message); });
    }
    if (t.id === 'a-sumico') {
      var seg = Number(t.value);
      if (!isFinite(seg) || seg < 0 || seg > 30) { $('a-estado').textContent = 'O sumiço vai de 0 a 30 segundos.'; return; }
      $('a-estado').textContent = '';
      return M.mudar('ajustes', 'controlesEspera', Math.round(seg), { semCentro: true });
    }
    if (t.id === 'pr-escondida' && st.sel.indexOf('prateleira:') === 0) {
      /* O interruptor diz "aparece na chegada": marcado é VISÍVEL. */
      return M.esconderPrateleira(st.sel.slice(11), !t.checked);
    }
    if (t.hasAttribute('data-classe-serie')) return M.mudarClasseDaSerie(t.getAttribute('data-classe-serie'), t.value);
    if (t.id === 's-comeco' && st.sel.indexOf('serie:') === 0) return M.mudarSerie(st.sel.slice(6), { comeco: t.value || null }, {});
    /* "Trocar momentos": a lista inteira, montada a partir das caixas marcadas
     * na ordem em que estão na tela — a ordem da página. */
    if (t.hasAttribute('data-momento') && st.sel.indexOf('serie:') === 0) {
      var marcadas = el.mesa.querySelectorAll('[data-momento]:checked');
      var momentos = [];
      for (var k = 0; k < marcadas.length; k++) {
        var par = marcadas[k].getAttribute('data-momento'), arroba = par.lastIndexOf('@');
        momentos.push({ id: par.slice(0, arroba), inicio: Number(par.slice(arroba + 1)) });
      }
      return M.mudarSerie(st.sel.slice(6), { momentos: momentos }, {});
    }
    /* Os campos da estrutura NÃO redesenham ao sair do campo, e isso é uma
     * decisão contra um defeito achado no runtime: o `mousedown` no botão tira
     * o foco do campo, o `change` dispara ANTES do clique, e o redesenho troca
     * os nós — o botão em que a pessoa clicou já não está no documento quando
     * o `click` sobe, e o ouvinte de `el.mesa` nunca o vê. Era um esconder de
     * prateleira que não acontecia, sem erro nenhum na tela. O rascunho já foi
     * registrado no `input`, e o resto da mesa já se redesenhou lá; as dicas
     * de "padrão: …" se acertam no próximo desenho da tela. */
    if (t.id === 'env-arquivo') return M.escolherArquivo(t.files[0]);
    var acao = t.getAttribute('data-acao');
    if (acao === 'marcar') { st.marcados[t.getAttribute('data-id')] = t.checked; return redesenhar({ semPainel: true }); }
    if (acao === 'no-ar') return alternarNoAr(t.getAttribute('data-id'), t.checked);
  });

  el.mesa.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (ev.key === 'Escape') {
      if (st.esqAberta || st.dirAberta) { st.esqAberta = st.dirAberta = false; return redesenhar({ semCentro: true, semPainel: true }); }
      if (st.verRascunho) { st.verRascunho = false; return desenharRascunho(); }
      if (st.sel && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return M.escolher('');
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && t.matches('tr[data-alvo]')) { ev.preventDefault(); M.escolher(t.getAttribute('data-alvo')); }
    /* A fila de sinopses anda só pelo teclado: Ctrl+Enter confirma e já abre
     * a próxima, sem tirar a mão do texto que acabou de ler. Só funciona com
     * o foco dentro da mesa — dentro do quadro (site) é outra janela. */
    if (ev.ctrlKey && ev.key === 'Enter' && st.tela === 'fila-sinopses' && st.sel.indexOf('item:') === 0) {
      ev.preventDefault();
      confirmarSinopseEAvancar();
    }
    /* As setas andam a fila sem o mouse — mas não roubam a seta de dentro de
     * um campo de texto ou de um <select> (edição normal). */
    if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && M.FILAS[st.tela] && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      var pos = M.filaPosicao(st.tela);
      if (pos) {
        var novo = pos.indice + (ev.key === 'ArrowRight' ? 1 : -1);
        if (novo >= 0 && novo < pos.lista.length) { ev.preventDefault(); irNaFila(st.tela, pos.lista[novo].id); }
      }
    }
  });

  /* ------------------------------------------------------ entrada e tamanho */

  function abrirMesa() {
    el.entrar.hidden = true;
    el.mesa.hidden = false;
    $('mesa-carregando').hidden = false;
    /* A conta é relida ao abrir: as permissões podem ter mudado desde o login,
     * e a mesa não pode mostrar botão que o servidor vai recusar. */
    M.confirmarConta().then(function () { return M.carregarServidor(); }).then(function () {
      st.lidoEm = Date.now();
      st.rascunho = M.lerRascunhoGuardado();
      st.versao++;
      st.conflitos = App.conflitosRascunho(st.servidor, st.rascunho);
      $('mesa-carregando').hidden = true;
      if (el.site.getAttribute('src') !== 'index.html?mesa=1') { st.sitePronto = false; el.site.setAttribute('src', 'index.html?mesa=1'); }
      /* O índice da busca, em segundo plano: a visão geral mostra quem ficou
       * fora dela, e ninguém espera por isso para entrar. */
      M.carregarBusca();
      redesenhar();
      ajustarQuadro();
      if (st.rascunho.length) {
        M.toast('O rascunho voltou: ' + M.contarAlteracoes() + (M.contarAlteracoes() === 1 ? ' alteração' : ' alterações') +
          (st.conflitos.length ? ', ' + st.conflitos.length + ' em conflito com o site' : '') + '.');
      }
    }).catch(function (e) {
      $('mesa-carregando').textContent = 'Não deu para ler o catálogo: ' + e.message;
    });
  }

  M.aoSair = function () {
    el.mesa.hidden = true;
    el.entrar.hidden = false;
    st.sitePronto = false;
    st.servidor = null;
    el.site.setAttribute('src', 'about:blank');
  };

  $('form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var estado = $('estado-entrar');
    estado.textContent = 'Conferindo…';
    fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: ($('usuario').value || '').trim(), senha: $('senha').value })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (corpo) { if (!r.ok) throw new Error(corpo.erro || ('erro ' + r.status)); return corpo; }); })
      .then(function (dados) { M.guardarSessao(dados); $('senha').value = ''; estado.textContent = ''; abrirMesa(); })
      .catch(function (e) { estado.textContent = e.message; });
  });

  function medir() {
    var w = window.innerWidth;
    var movel = w < 960, estreita = w >= 960 && w < 1280;
    var mudou = el.mesa.classList.contains('movel') !== movel || el.mesa.classList.contains('estreita') !== estreita;
    el.mesa.classList.toggle('movel', movel);
    el.mesa.classList.toggle('estreita', estreita);
    if (!movel) { st.esqAberta = false; st.dirAberta = false; }
    if (mudou && st.servidor) redesenhar({ semCentro: true, semPainel: true });
    ajustarQuadro();
  }
  /* O tamanho vem de um observador, e não só do `resize` da janela: a largura
   * da página muda sem esse evento quando a janela é emulada, e o menu ficava
   * aberto a 900 px. */
  window.addEventListener('resize', medir);
  if (window.ResizeObserver) {
    new ResizeObserver(medir).observe(document.documentElement);
    new ResizeObserver(function () { ajustarQuadro(); }).observe(el.palco);
  }

  window.addEventListener('beforeunload', function (ev) {
    if (M.envio.fase === 'enviando') { ev.preventDefault(); ev.returnValue = ''; }
  });

  medir();
  if (M.recuperarSessao()) abrirMesa();
})();
