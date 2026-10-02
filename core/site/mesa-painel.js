/* mesa-painel.js — a coluna da direita: os dados do site quando nada está
 * escolhido, o inspetor quando algo está, e a barra do rascunho no pé.
 *
 * Só desenha. Os cliques e as digitações chegam a mesa.js pelos `id` e pelos
 * `data-acao` daqui. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr;

  var CAMPO = {
    titulo: tr('painel.titulo'), serie: tr('painel.serie'), temporada: tr('painel.temporada'), episodio: tr('painel.episodio'), ano: tr('painel.ano'),
    sinopse: tr('painel.sinopse'), sinopse_origem: tr('painel.origemDaSinopse'), tema: tr('painel.tema'), publico_alvo: tr('painel.publicoAlvo'),
    tags: tr('painel.tags'), pendencia: tr('painel.pendencia'), publicar: tr('mesa.noAr'), titularidade: tr('painel.titularidade'),
    nivel_evidencia: tr('painel.nivelDeEvidencia'), capa_arquivo: tr('painel.capa'), capa_versao: tr('painel.versaoDaCapa'),
    nota_curadoria: tr('painel.notaDeCuradoria'), destaque: tr('painel.destaque'), arrastoTeto: tr('painel.arrastoMaximo'), controlesEspera: tr('painel.sumicoDosControles'),
    prateleiras: tr('painel.prateleiras'), classes: tr('painel.classeDasSeries'), textos: tr('painel.textosFixos'), series: tr('painel.apresentacaoDasSeries')
  };
  M.CAMPO = CAMPO;

  var PENDENCIAS = ['audio_sem_trilha', 'sem_identificacao', 'direitos_a_verificar', 'piloto_decidir',
    'material_bruto', 'versao_duplicada', 'nao_e_conteudo', 'titulo_nao_confere'];

  function noRascunho(alvo, campo) {
    return M.st.rascunho.some(function (x) { return x.alvo === alvo && x.campo === campo; });
  }
  function cab(chip, titulo, extras) {
    return h('div', { class: 'p-cab' },
      h('span', { class: 'chip ' + (chip.classe || ''), text: chip.texto }),
      h('h2', { class: 'p-cab-titulo', text: titulo, title: titulo }),
      extras || null,
      M.st.sel ? h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'fechar', 'aria-label': tr('painel.fecharEVerOsDados') }, M.ic('x')) : null);
  }
  function rotulo(texto, id, alvo, campo) {
    return h('label', { for: id }, texto, alvo && noRascunho(alvo, campo) ? h('span', { class: 'ponto ponto-ouro', title: tr('painel.noRascunho') }) : null);
  }
  function campo(texto, id, entrada, alvo, nomeCampo, dica) {
    return h('div', { class: 'campo' }, rotulo(texto, id, alvo, nomeCampo), entrada, dica || null);
  }
  function secao(titulo) {
    var s = h('section', { class: 'p-secao' }, titulo ? h('h3', { class: 'p-rotulo', text: titulo }) : null);
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) s.appendChild(arguments[i]);
    return s;
  }
  function botao(texto, id, classe, icone, extra) {
    return h('button', Object.assign({ type: 'button', id: id, class: 'botao ' + (classe || '') }, extra || {}), icone ? M.ic(icone) : null, texto);
  }
  function quando(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : M.I18n.data(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  M.quando = quando;

  /* ----------------------------------------------------------- visão geral */

  function contasDoSite(cat) {
    var no = App.publicaveis(cat.itens);
    var c = { no: no, fora: cat.itens.length - no.length, series: App.series(no).length, capitulos: 0, comCapitulos: 0, revisadas: 0, automaticas: 0, vazias: 0 };
    no.forEach(function (i) {
      var n = App.capitulos(i).length;
      c.capitulos += n;
      if (n) c.comCapitulos++;
      if (!i.sinopse) c.vazias++;
      else if (i.sinopse_origem === 'auto') c.automaticas++;
      else c.revisadas++;
    });
    return c;
  }

  /* A seção da busca na visão geral. Sem o manifesto lido — a rota falhou, ou
   * ainda está vindo —, diz isso em vez de inventar um número. */
  function secaoDaBusca(cat, c) {
    var b = M.busca;
    if (!b.manifesto) {
      return secao(tr('painel.busca'), h('p', { class: 'p-nota', text: b.erro ? tr('painel.naoDeuParaLerIndice', { mensagem: b.erro }) : tr('painel.lendoIndice') }));
    }
    var conta = AppIndice.foraDaBusca(cat.itens, b.manifesto, b.sentido);
    var comFala = c.no.length - conta.semFala.length;
    /* O medidor, com a mesma conta do resto da visão geral. `fatia` mora
     * dentro de `visao`, e daqui não se alcança. */
    var total = c.no.length || 1;
    var fatiaDaBusca = function (qtd, classe) {
      return h('i', { class: classe, style: 'flex-basis:' + (qtd / total * 100) + '%' + (qtd ? ';min-width:4px' : '') });
    };
    var partes = [
      h('div', { class: 'medidor medidor-fino' }, fatiaDaBusca(comFala, 'm-rev'), fatiaDaBusca(conta.semFala.length, 'm-nada')),
      h('p', { class: 'p-nota', text: tr('painel.naBuscaPelaFala', { n: comFala, total: c.no.length }) +
        (b.sentido ? tr('painel.sentidoLigado') : tr('painel.sentidoDesligado')) })
    ];
    if (conta.semFala.length) {
      partes.push(h('p', { class: 'p-nota p-nota-alerta', text: tr('painel.foraDaBuscaPelaFala', { n: conta.semFala.length }) }));
    }
    if (conta.desatualizados.length) {
      partes.push(h('p', { class: 'p-nota p-nota-alerta', text: tr('painel.sentidoDesatualizado', { n: conta.desatualizados.length }) }));
    }
    if (b.andando) {
      partes.push(h('p', { class: 'estado', text: b.andando }));
    } else if (conta.semFala.length || conta.desatualizados.length) {
      if (M.pode('conteudo') || M.pode('enviar')) {
        partes.push(h('button', { type: 'button', class: 'botao', 'data-acao': 'busca-por' }, h('span', { text: tr('painel.porNaBusca') })));
      } else {
        partes.push(h('p', { class: 'p-nota', text: tr('painel.quemTemAPermissaoDe') }));
      }
    }
    /* `secao` recebe os pedaços soltos, e não uma lista. */
    return secao.apply(null, [tr('painel.busca')].concat(partes));
  }

  function visao(cat) {
    var c = contasDoSite(cat), n = M.st.rascunho.length;
    var corpo = h('div', { class: 'p-corpo-in' });

    corpo.appendChild(h('p', { class: 'p-status' },
      h('span', { class: 'ponto ponto-verde' }),
      tr('painel.noArRev', { rev: M.st.servidor.rev }) + (M.st.servidor.atualizado_em ? ' · ' + tr('painel.gravadoEm', { quando: quando(M.st.servidor.atualizado_em) }) : ''),
      n ? h('span', { class: 'p-status-rasc' }, h('span', { class: 'ponto ponto-ouro' }), tr('painel.contandoORascunho')) : null));

    corpo.appendChild(h('div', { class: 'numeros' }, [[tr('painel.noAr'), c.no.length], [tr('painel.series'), c.series], [tr('painel.numCapitulos'), c.capitulos]].map(function (x) {
      return h('div', { class: 'numero' }, h('b', { class: 'mono', text: x[1] }), h('span', { text: x[0] }));
    })));

    var total = c.no.length || 1;
    var fatia = function (qtd, classe) { return h('i', { class: classe, style: 'flex-basis:' + (qtd / total * 100) + '%' + (qtd ? ';min-width:4px' : '') }); };
    corpo.appendChild(secao(tr('painel.sinopsesNoAr'),
      h('div', { class: 'medidor', role: 'img', 'aria-label': tr('painel.medidorSinopses', { revisadas: c.revisadas, automaticas: c.automaticas, vazias: c.vazias }) },
        fatia(c.revisadas, 'm-rev'), fatia(c.automaticas, 'm-auto'), fatia(c.vazias, 'm-vazia')),
      h('ul', { class: 'legenda' }, [['m-rev', tr('painel.revisadasOuEscritas'), c.revisadas, ''], ['m-auto', tr('painel.automaticasARevisar'), c.automaticas, 'auto'], ['m-vazia', tr('painel.vazias'), c.vazias, 'vazia']].map(function (x) {
        return h('li', null, h('i', { class: x[0] }),
          x[3] && x[2] ? h('button', { type: 'button', class: 'linha-link linha-link-curta', 'data-acao': 'filtro', 'data-filtro': x[3] }, h('span', { text: x[1] })) : h('span', { text: x[1] }),
          h('b', { class: 'mono', text: x[2] }));
      }))));

    var faixas = [[tr('painel.ate2'), 0, 120], ['2–5', 120, 300], ['5–10', 300, 600], ['10–20', 600, 1200], ['20+', 1200, Infinity]];
    var contas = faixas.map(function (f) { return c.no.filter(function (i) { return i.duracao_seg > f[1] && i.duracao_seg <= f[2]; }).length; });
    var max = Math.max.apply(null, contas.concat([1]));
    var curtos = (App.prateleiras(cat.itens).find(function (p) { return p.id === 'curtos'; }) || { itens: [] }).itens.length;
    corpo.appendChild(secao(tr('painel.duracaoEmMinutos'),
      h('div', { class: 'histo', role: 'img', 'aria-label': faixas.map(function (f, k) { return tr('painel.faixaMin', { faixa: f[0], n: contas[k] }); }).join(', ') },
        faixas.map(function (f, k) {
          return h('div', { class: 'histo-col' + (k < 2 ? ' curto' : '') },
            h('span', { class: 'histo-num mono', text: contas[k] }),
            h('div', { class: 'histo-trilho' }, h('i', { style: 'height:' + Math.round(contas[k] / max * 100) + '%' })),
            h('span', { class: 'histo-rot', text: f[0] }));
        })),
      h('p', { class: 'p-nota', text: tr('painel.ate5min', { n: contas[0] + contas[1], curtos: curtos }) })));

    corpo.appendChild(secao(tr('painel.capitulos'),
      h('div', { class: 'medidor medidor-fino' }, fatia(c.comCapitulos, 'm-rev'), fatia(c.no.length - c.comCapitulos, 'm-nada')),
      h('p', { class: 'p-nota', text: tr('painel.comCapitulos', { n: c.comCapitulos, total: c.no.length }) })));

    /* A BUSCA: a rede de segurança dos três caminhos que
     * escrevem no índice — o envio, o Publicar e o script. Quem ficou fora
     * aparece aqui, e o botão o põe na busca: a legenda vem da pull zone, e a
     * sinopse e os capítulos, do catálogo no ar. */
    corpo.appendChild(secaoDaBusca(cat, c));

    var atencao = [];
    if (c.vazias) atencao.push(['erro', tr('painel.noArSemSinopse', { n: c.vazias }), 'vazia']);
    var semVideo = cat.itens.filter(function (i) { return !(i.fonte && i.fonte.videoId); }).length;
    if (semVideo) atencao.push(['erro', tr('painel.semVideoNoProvedor', { n: semVideo }), 'semvideo']);
    var pend = cat.itens.filter(function (i) { return i.pendencia; });
    if (pend.length) atencao.push(['alerta', tr('painel.comPendencia', { n: pend.length, noAr: pend.filter(function (i) { return i.publicar; }).length }), 'pendencia']);
    var triagem = c.no.filter(function (i) { return i.serie === 'A classificar' || i.serie === 'A identificar' /* i18n-ignorar: nomes de série (dado do acervo) */; }).length;
    if (triagem) atencao.push(['alerta', tr('painel.noArEmTriagem', { n: triagem }), 'triagem']);
    if (c.automaticas) atencao.push(['info', tr('painel.sinopsesAutomaticasNoAr', { n: c.automaticas }), 'auto']);
    if (atencao.length) {
      corpo.appendChild(secao(tr('painel.precisaDeAtencao'), h('ul', { class: 'atencao' }, atencao.map(function (a) {
        return h('li', null, h('button', { type: 'button', class: 'atencao-item sev-' + a[0], 'data-acao': 'filtro', 'data-filtro': a[2] },
          h('span', { class: 'sev', text: a[0] === 'erro' ? 'corrigir' : a[0] === 'alerta' ? 'decidir' : 'revisar' }),
          h('span', { text: a[1] }), M.ic('dir')));
      }))));
    }

    var aj = cat.ajustes || {};
    var teto = Number(aj.arrastoTeto) > 0 ? Math.round(aj.arrastoTeto * 100) : 40;
    var sumico = aj.controlesEspera == null ? 3 : aj.controlesEspera;
    corpo.appendChild(secao(tr('painel.player'), h('button', { type: 'button', class: 'linha-link', 'data-acao': 'tela', 'data-tela': 'player' },
      h('span', { text: tr('painel.resumoPlayer', { teto: teto, sumico: sumico }) }), M.ic('dir'))));

    corpo.appendChild(h('p', { class: 'p-fonte' }, tr('painel.catalogoLidoAs', { hora: M.I18n.data(M.st.lidoEm || Date.now(), 'hora') }) + ' ',
      h('button', { type: 'button', class: 'linha-link linha-link-curta', 'data-acao': 'recarregar' }, M.ic('recarregar'), h('span', { text: tr('painel.lerDeNovo') }))));

    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('painel.site') }), h('h2', { class: 'p-cab-titulo', text: tr('painel.oSiteAgora') })), corpo: corpo };
  }

  /* -------------------------------------------------------- título: editar */

  M.dicaTitulo = function (item) {
    var n = App.rotuloNumero(item);
    return n ? tr('painel.noCartaoComNumero', { titulo: App.tituloCurto(item), numero: n }) : tr('painel.noCartao', { titulo: App.tituloCurto(item) });
  };

  function editar(cat, it) {
    var id = it.id, f = h('div', { class: 'p-form' });
    /* Campo que esta conta não pode mudar aparece DESLIGADO: aceitar a
     * digitação e o servidor recusar depois é pior do que não deixar. Quem
     * recusa continua sendo o servidor (M2). */
    var podeConteudo = M.pode('conteudo'), podeNoAr = M.pode('no-ar'), podeEstrutura = M.pode('estrutura');
    if (!podeConteudo) f.appendChild(h('p', { class: 'aviso-conta', text: tr('painel.estaContaNaoEditaConteudo') }));
    var capa = App.urlCapa(it, cat.config);
    var temVideo = !!(it.fonte && it.fonte.videoId);

    f.appendChild(h('div', { class: 'capa-linha' },
      h('div', { class: 'capa-mini' }, capa ? h('img', { src: capa, alt: '', loading: 'lazy', width: '640', height: '360' }) : h('span', { text: temVideo ? tr('site.semCapa') : tr('painel.semVideo') })),
      h('div', { class: 'capa-botoes' },
        botao(tr('painel.escolherQuadro'), 'f-quadro', 'botao-leve botao-pequeno', 'imagem', { disabled: !temVideo || !podeConteudo }),
        h('label', { class: 'botao botao-leve botao-pequeno' + (temVideo && podeConteudo ? '' : ' desligado'), for: 'f-jpg' }, tr('painel.enviarJpg'),
          h('input', { type: 'file', id: 'f-jpg', accept: 'image/jpeg,image/png', class: 'so-leitor', disabled: !temVideo || !podeConteudo })),
        noRascunho(id, 'capa_arquivo') ? h('span', { class: 'dica', text: tr('painel.capaNovaNoRascunho') }) : null)));

    f.appendChild(h('label', { class: 'interruptor', for: 'f-publicar' },
      h('input', { type: 'checkbox', id: 'f-publicar', checked: it.publicar === true, disabled: !podeNoAr }), h('span', { class: 'trilho' }),
      h('span', { class: 'interruptor-texto' }, h('b', null, it.publicar ? tr('mesa.noAr') : tr('painel.foraDoAr'), noRascunho(id, 'publicar') ? h('span', { class: 'ponto ponto-ouro', title: tr('painel.noRascunho') }) : null),
        h('small', { text: it.publicar ? tr('painel.apareceNaChegadaENa') : tr('painel.soAMesaVe') }))));

    /* Destacar só existe para título no ar: o destaque é a primeira coisa que
     * a chegada mostra, e destacar um fora do ar o vazaria (D4). */
    if (it.publicar === true) {
      /* Quem ESTÁ no destaque agora, pela mesma função do site: o id escolhido
       * em `site.destaque` (M4), a marca antiga no título, ou o padrão. */
      var hoje = App.destaque(cat.itens, cat.site);
      var escolhido = !!M.site().destaque || cat.itens.some(function (i) { return i.publicar === true && i.destaque === true; });
      var marcado = !!hoje && hoje.id === it.id;
      f.appendChild(h('div', { class: 'destaque-linha' },
        h('span', { class: 'interruptor-texto' },
          h('b', null, marcado ? tr('painel.eODestaqueDaChegada') : tr('painel.destaqueDaChegada'),
            noRascunho('site', 'destaque') ? h('span', { class: 'ponto ponto-ouro', title: tr('painel.noRascunho') }) : null),
          h('small', { text: marcado ? (escolhido ? tr('painel.primeiraCoisaDaChegada') : tr('painel.eOPadraoENinguem'))
            : hoje ? tr('painel.hoje', { titulo: App.tituloCurto(hoje) }) + (escolhido ? '' : ' ' + tr('painel.oPadraoSemEscolha')) : tr('painel.nenhumMin') })),
        botao(marcado && escolhido ? tr('painel.tirarDoDestaque') : tr('painel.destacar'), 'f-destaque', 'botao-leve botao-pequeno', null, { disabled: !podeEstrutura })));
    }

    if (it.nota_curadoria) f.appendChild(h('p', { class: 'nota-curadoria', text: it.nota_curadoria }));

    f.appendChild(campo(tr('painel.titulo'), 'f-titulo', h('input', { type: 'text', id: 'f-titulo', value: it.titulo || '', disabled: !podeConteudo }), id, 'titulo',
      h('p', { class: 'dica', id: 'f-titulo-dica', text: M.dicaTitulo(it) })));
    f.appendChild(campo(tr('painel.serie'), 'f-serie', h('input', { type: 'text', id: 'f-serie', value: it.serie || '', list: 'lista-series', disabled: !podeConteudo }), id, 'serie'));
    f.appendChild(h('div', { class: 'campo-trio' },
      campo(tr('painel.temporada'), 'f-temporada', h('input', { type: 'number', id: 'f-temporada', min: '1', step: '1', value: it.temporada == null ? '' : String(it.temporada), disabled: !podeConteudo }), id, 'temporada'),
      campo(tr('painel.episodio'), 'f-episodio', h('input', { type: 'number', id: 'f-episodio', min: '1', step: '1', value: it.episodio == null ? '' : String(it.episodio), disabled: !podeConteudo }), id, 'episodio'),
      campo(tr('painel.ano'), 'f-ano', h('input', { type: 'text', id: 'f-ano', inputmode: 'numeric', value: it.ano || '', disabled: !podeConteudo }), id, 'ano')));

    var origem = !it.sinopse ? ['vazia', 'chip-erro'] : it.sinopse_origem === 'auto' ? [tr('painel.automatica'), 'chip-alerta'] : ['revisada', 'chip-ok'];
    f.appendChild(h('div', { class: 'campo' },
      h('div', { class: 'campo-topo' }, rotulo(tr('painel.sinopse'), 'f-sinopse', id, 'sinopse'), h('span', { class: 'chip ' + origem[1], id: 'f-origem', text: origem[0] })),
      h('textarea', { id: 'f-sinopse', rows: '6', placeholder: tr('painel.2A3FrasesEm'), value: it.sinopse || '', disabled: !podeConteudo }),
      it.sinopse && it.sinopse_origem === 'auto' ? botao(tr('painel.confirmarSinopse'), 'f-confirmar', 'botao-leve botao-pequeno', 'check', { disabled: !podeConteudo }) : null,
      h('p', { class: 'dica', text: tr('painel.tambemDaParaDigitarDireto') })));

    var sel = h('select', { id: 'f-pendencia', disabled: !podeConteudo }, h('option', { value: '', text: tr('painel.nenhumaMin') }));
    PENDENCIAS.forEach(function (k) { sel.appendChild(h('option', { value: k, text: App.rotuloPendencia(k) })); });
    if (it.pendencia && PENDENCIAS.indexOf(it.pendencia) < 0) sel.appendChild(h('option', { value: it.pendencia, text: App.rotuloPendencia(it.pendencia) }));
    sel.value = it.pendencia || '';
    f.appendChild(campo(tr('painel.pendencia'), 'f-pendencia', sel, id, 'pendencia'));

    f.appendChild(h('details', { class: 'mais' }, h('summary', null, tr('painel.temaPublicoAlvoETags')),
      campo(tr('painel.tema'), 'f-tema', h('input', { type: 'text', id: 'f-tema', value: it.tema || '', disabled: !podeConteudo }), id, 'tema'),
      campo(tr('painel.publicoAlvo'), 'f-publico', h('input', { type: 'text', id: 'f-publico', value: it.publico_alvo || '', disabled: !podeConteudo }), id, 'publico_alvo'),
      campo(tr('painel.tags'), 'f-tags', h('input', { type: 'text', id: 'f-tags', value: (it.tags || []).join(', '), placeholder: tr('painel.separadasPorVirgula'), disabled: !podeConteudo }), id, 'tags')));

    /* Titularidade e evidência são classificação interna (04/09): saíram da
     * ficha e da API pública, e moram aqui. */
    var titular = h('select', { id: 'm-titularidade', disabled: !podeConteudo }, ['INCONCLUSIVO', 'Própria', 'Terceiros'].map(function (v) { return h('option', { value: v, text: v }); })); /* i18n-ignorar: valores do dado (classificação interna), não texto de tela */
    var evid = h('select', { id: 'm-evidencia', disabled: !podeConteudo }, ['SEM EVIDÊNCIA', 'PROVÁVEL', 'CONFIRMADO'].map(function (v) { return h('option', { value: v, text: v }); })); /* i18n-ignorar: valores do dado */
    [[titular, it.titularidade], [evid, it.nivel_evidencia]].forEach(function (par) {
      if (par[1] && !Array.prototype.some.call(par[0].options, function (o) { return o.value === par[1]; })) par[0].appendChild(h('option', { value: par[1], text: par[1] }));
      par[0].value = par[1] || par[0].options[0].value;
    });
    f.appendChild(h('details', { class: 'mais' }, h('summary', null, tr('painel.catalogacaoInterna')),
      h('div', { class: 'campo-duo' },
        campo(tr('painel.titularidade'), 'm-titularidade', titular, id, 'titularidade'),
        campo(tr('painel.nivelDeEvidencia'), 'm-evidencia', evid, id, 'nivel_evidencia'))));
    return f;
  }

  /* ----------------------------------------------------------- título: dados */

  function dados(cat, it) {
    var dl = h('dl', { class: 'p-dados' });
    var caps = App.capitulos(it);
    var midia = (M.st.midia || {})[it.fonte && it.fonte.videoId];
    var estadoVideo = !(it.fonte && it.fonte.videoId) ? h('span', { class: 'chip chip-erro', text: tr('painel.semVideo') })
      : !midia ? h('span', { class: 'fraco', text: tr('painel.consultando') })
      : midia.erro ? h('span', { class: 'chip chip-erro', text: midia.erro })
      : midia.pronto ? h('span', { class: 'chip chip-ok', text: tr('painel.pronto') })
      : midia.falhou ? h('span', { class: 'chip chip-erro', text: tr('painel.codificacaoFalhou') })
      : h('span', { class: 'chip chip-alerta', text: tr('painel.processando', { pct: midia.progresso != null ? midia.progresso + '%' : '' }) });
    [
      [tr('painel.videoNoBunny'), estadoVideo],
      [tr('painel.duracao'), h('span', { class: 'mono', text: it.duracao_seg ? App.formatarTempo(it.duracao_seg) + '  (' + it.duracao_seg + ' s)' : '—' })],
      [tr('painel.taxaDeQuadros'), h('span', { class: 'mono', text: it.framerate ? tr('painel.fps', { n: M.I18n.numero(it.framerate) }) : '—' })],
      [tr('painel.capitulos'), caps.length ? tr('painel.capitulosUltimo', { n: caps.length, tempo: App.formatarTempo(caps[caps.length - 1].inicio) }) : tr('painel.nenhumMin')],
      [tr('painel.sinopse'), it.sinopse ? (it.sinopse_origem === 'auto' ? tr('painel.automatica') : tr('painel.revisada')) + ' · ' + tr('painel.caracteres', { n: it.sinopse.length }) : tr('painel.vazia')],
      [tr('painel.temporadaEpisodio'), App.rotuloEpisodio(it) || '—'],
      [tr('painel.titularidade'), it.titularidade || '—'],
      [tr('painel.evidencia'), it.nivel_evidencia || '—'],
      [tr('painel.arquivoDeOrigem'), it.arquivo || '—'],
      [tr('painel.tamanhoDoMaster'), it.tamanho_mb ? it.tamanho_mb + ' MB' : '—'],
      [tr('painel.idNoCatalogo'), h('span', { class: 'mono quebra', text: it.id })],
      [tr('painel.idDoVideo'), h('span', { class: 'mono quebra', text: (it.fonte && it.fonte.videoId) || '—' })]
    ].forEach(function (par) { dl.appendChild(h('dt', { text: par[0] })); dl.appendChild(h('dd', null, par[1])); });
    return h('div', { class: 'p-form' }, dl);
  }

  /* ---------------------------------------------------------- título: no site */

  function noSite(cat, it) {
    var ps = App.prateleiras(cat.itens).filter(function (p) { return p.itens.some(function (x) { return x.id === it.id; }); });
    var lista = h('ul', { class: 'lugares' }, ps.map(function (p) {
      var pos = p.itens.findIndex(function (x) { return x.id === it.id; }) + 1;
      return h('li', null, h('button', { type: 'button', class: 'linha-link', 'data-acao': 'escolher', 'data-alvo': 'prateleira:' + p.id },
        h('span', { text: p.titulo }), h('small', { class: 'mono', text: pos + 'º de ' + p.itens.length }), M.ic('dir')));
    }));
    var viz = App.vizinhos(cat.itens, it.id);
    var vizinhos = [viz.anterior ? [tr('painel.anterior'), viz.anterior] : null, viz.proximo ? [tr('painel.proximo'), viz.proximo] : null].filter(Boolean);
    return h('div', { class: 'p-form' },
      secao(tr('painel.apareceEm'), ps.length ? lista : h('p', { class: 'p-nota', text: it.publicar ? tr('painel.emNenhumaPrateleiraDaChegada') : tr('painel.emNenhumLugarDoSite') })),
      vizinhos.length ? secao(tr('painel.naSerie'), h('ul', { class: 'lugares' }, vizinhos.map(function (v) {
        return h('li', null, h('button', { type: 'button', class: 'linha-link', 'data-acao': 'escolher', 'data-alvo': 'item:' + v[1].id },
          h('small', { text: v[0] }), h('span', { text: App.tituloCurto(v[1]) }), M.ic('dir')));
      }))) : null,
      secao(tr('painel.ficha'), botao(tr('painel.abrirAFichaNoMeio'), 'n-ficha', 'botao-leve', 'abrir', { 'data-acao': 'abrir-ficha', 'data-id': it.id })));
  }

  /* A tira da fila (M3): "3 de 56", setas, e — só na de sinopses — o botão
   * que confirma sem mexer no texto e já abre a próxima. Some sozinha quando
   * o item resolvido sai da lista no próximo redesenho. */
  function filaTira(tipo) {
    var pos = M.filaPosicao(tipo);
    if (!pos || pos.indice < 0) return null;
    var def = M.FILAS[tipo];
    return h('div', { class: 'fila-tira' },
      h('p', { class: 'p-nota mono', text: def.rotulo + ' · ' + (pos.indice + 1) + ' de ' + pos.lista.length }),
      h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'fila-anterior', 'aria-label': tr('painel.anterior'), disabled: pos.indice <= 0 }, M.ic('esq')),
        h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'fila-proxima', 'aria-label': tr('painel.proxima'), disabled: pos.indice >= pos.lista.length - 1 }, M.ic('dir')),
        tipo === 'fila-sinopses' ? botao(tr('painel.confirmarEIrParaA'), 'fila-confirmar', 'botao-verde botao-pequeno', 'check', { disabled: !M.pode('conteudo'), title: 'Ctrl+Enter' }) : null));
  }

  function inspItem(cat, it) {
    var corpo = h('div', { class: 'p-corpo-in' });
    var fila = M.FILAS[M.st.tela] ? filaTira(M.st.tela) : null;
    if (fila) corpo.appendChild(fila);
    if (it.pendencia) corpo.appendChild(h('div', { class: 'decisao' }, h('p', { class: 'decisao-rotulo' }, M.ic('alerta'), App.rotuloPendencia(it.pendencia))));
    var abas = h('div', { class: 'abas', role: 'tablist', 'aria-label': tr('painel.oTitulo') });
    [['editar', tr('painel.editar')], ['dados', tr('painel.dados')], ['site', tr('painel.noSite2')]].forEach(function (a) {
      abas.appendChild(h('button', { type: 'button', role: 'tab', id: 'aba-' + a[0], class: 'aba', 'aria-selected': String(M.st.aba === a[0]), 'data-acao': 'aba', 'data-aba': a[0], text: a[1] }));
    });
    corpo.appendChild(abas);
    corpo.appendChild(M.st.aba === 'dados' ? dados(cat, it) : M.st.aba === 'site' ? noSite(cat, it) : editar(cat, it));
    var abrir = M.st.rota !== '#/ep/' + encodeURIComponent(it.id)
      ? h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'abrir-ficha', 'data-id': it.id, text: tr('painel.abrirFicha') }) : null;
    return { cab: cab({ texto: it.publicar ? tr('painel.titulo') : tr('painel.foraDoAr'), classe: it.publicar ? '' : 'chip-alerta' }, App.tituloCurto(it) || tr('painel.semTitulo'), abrir), corpo: corpo };
  }

  /* A PRATELEIRA, no painel (M4). Quem entra nela continua sendo regra do
   * `catalogo-core.js` — o que a mesa escolhe é o nome, o lugar na chegada e
   * se ela aparece.
   *
   * Reordenar grava a ordem de TODAS as prateleiras, e não só a das duas que
   * trocaram de lugar: quem tem ordem escolhida vai na frente de quem não tem,
   * então meia ordem embaralharia o resto (é o `comOrdemPrateleiras`). */
  function inspPrateleira(cat, id) {
    var site = M.site();
    var todas = App.prateleiras(cat.itens, site);
    var pos = -1;
    todas.forEach(function (x, k) { if (x.id === id) pos = k; });
    if (pos < 0) return null;
    var p = todas[pos];
    var escolha = site.prateleiras[id] || {};
    var padrao = App.prateleiras(cat.itens).find(function (x) { return x.id === id; });
    var min = Math.round(p.itens.reduce(function (a, i) { return a + (i.duracao_seg || 0); }, 0) / 60);
    var pode = M.pode('estrutura');

    /* Quantos títulos sairiam da chegada se esta prateleira fosse escondida —
     * a conta feita ANTES do clique, sobre a estrutura de agora. Eles não saem
     * do ar: continuam na busca, na página da série e no link direto. */
    var somem = p.escondida ? [] : App.titulosSoEmEscondidas(cat.itens, App.comPrateleira(site, id, { escondida: true }));

    var corpo = h('div', { class: 'p-corpo-in' },
      h('p', { class: 'p-nota', text: tr('painel.prateleiraResumo', { n: p.itens.length, min: min }) }),
      campo(tr('painel.nomeNaChegada'), 'pr-nome', h('input', {
        type: 'text', id: 'pr-nome', value: escolha.titulo || '', placeholder: padrao ? padrao.titulo : '', disabled: !pode
      }), 'site', 'prateleiras', h('p', { class: 'dica', text: escolha.titulo
        ? tr('painel.oPadraoE', { titulo: padrao ? padrao.titulo : '' })
        : tr('painel.vazioONomeQueO') })),
      h('div', { class: 'botoes-linha' },
        botao(tr('painel.subir'), 'pr-sobe', 'botao-leve botao-pequeno', null, { disabled: !pode || pos === 0 }),
        botao(tr('painel.descer'), 'pr-desce', 'botao-leve botao-pequeno', null, { disabled: !pode || pos === todas.length - 1 }),
        h('span', { class: 'dica', text: (pos + 1) + 'ª de ' + todas.length })),
      h('label', { class: 'interruptor', for: 'pr-escondida' },
        h('input', { type: 'checkbox', id: 'pr-escondida', checked: !p.escondida, disabled: !pode }), h('span', { class: 'trilho' }),
        h('span', { class: 'interruptor-texto' }, h('b', null, p.escondida ? tr('painel.escondidaDaChegada') : tr('painel.apareceNaChegada')),
          h('small', { text: p.escondida ? tr('painel.oVerTudoDelaContinua') : tr('painel.esconderNaoTiraNadaDo') }))),
      somem.length ? h('div', { class: 'aviso-opcao' },
        h('b', null, tr('painel.saemDaChegada', { n: somem.length }) + ' '),
        tr('painel.naoAparecemEmNenhumaOutra')) : null,
      escolha.titulo || escolha.escondida || typeof escolha.ordem === 'number'
        ? botao(tr('painel.voltarAoPadraoDestaPrateleira'), 'pr-padrao', 'botao-leve botao-pequeno', null, { disabled: !pode }) : null,
      secao(tr('painel.titulosNaOrdem'), h('ol', { class: 'lugares' }, p.itens.map(function (x) {
        return h('li', null, h('button', { type: 'button', class: 'linha-link', 'data-acao': 'escolher', 'data-alvo': 'item:' + x.id },
          h('span', { text: App.tituloCurto(x) }), h('small', { class: 'mono', text: App.formatarDuracao(x) })));
      }))));
    return { cab: cab({ texto: p.escondida ? tr('painel.escondida') : tr('painel.prateleira'), classe: p.escondida ? 'chip-alerta' : '' }, p.titulo), corpo: corpo };
  }

  /* A MARCA e o RODAPÉ, clicados dentro da prévia. A marca são arquivos, e
   * arquivo não é dado de catálogo; o rodapé é um dos seis textos da M4. */
  function inspFixo(tipo) {
    if (tipo === 'marca') {
      return { cab: cab({ texto: tr('painel.marca') }, tr('painel.logoDoCabecalho')), corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('painel.osArquivosDaMarcaLogo') })) };
    }
    var site = M.site(), pode = M.pode('estrutura');
    return { cab: cab({ texto: tr('painel.textoFixo') }, tr('painel.rodape')), corpo: h('div', { class: 'p-corpo-in' },
      campo(tr('painel.textoDoRodape'), 'tx-rodape', h('input', {
        type: 'text', id: 'tx-rodape', value: site.textos.rodape || '', placeholder: App.TEXTOS_PADRAO.rodape, disabled: !pode
      }), 'site', 'textos', h('p', { class: 'dica', text: tr('painel.vazioOTextoPadraoO') })),
      h('p', { class: 'p-nota', text: tr('painel.osOutrosCincoTextosSem') }),
      h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'tela', 'data-tela': 'estrutura', text: tr('painel.abrirAEstrutura') })) };
  }

  /* --------------------------------------------------------------- player */

  M.exemplosDoTeto = function (cat, pct) {
    var duracoes = App.publicaveis(cat.itens).map(function (i) { return Number(i.duracao_seg); }).filter(function (d) { return d > 0; });
    var amostras = duracoes.length ? [Math.min.apply(null, duracoes), Math.max.apply(null, duracoes), 3600] : [120, 1200, 3600];
    return amostras.filter(function (d, k, a) { return a.indexOf(d) === k; }).map(function (d) {
      return tr('painel.exemploArrasto', { duracao: App.formatarTempo(d), pula: App.formatarTempo(Math.round(d * pct / 100)) });
    });
  };

  function painelPlayer(cat) {
    var aj = cat.ajustes || {};
    var pct = Number(aj.arrastoTeto) > 0 ? Math.round(aj.arrastoTeto * 100) : 40;
    var sumico = aj.controlesEspera == null || !isFinite(Number(aj.controlesEspera)) ? 3 : Number(aj.controlesEspera);
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('painel.ajustes') }), h('h2', { class: 'p-cab-titulo', text: tr('painel.player') })),
      corpo: h('div', { class: 'p-corpo-in' }, h('div', { class: 'p-form' },
        campo(tr('painel.arrastoMaximoPorArrancoEm'), 'a-teto', h('input', { type: 'number', id: 'a-teto', min: '5', max: '100', step: '1', value: String(pct), disabled: !M.pode('player') }), 'ajustes', 'arrastoTeto'),
        h('ul', { class: 'exemplos', id: 'a-exemplos' }, M.exemplosDoTeto(cat, pct).map(function (t) { return h('li', { text: t }); })),
        h('p', { class: 'p-nota', text: tr('painel.noCelularArrastarODedo') }),
        campo(tr('painel.controlesSomemDepoisDeEm'), 'a-sumico', h('input', { type: 'number', id: 'a-sumico', min: '0', max: '30', step: '1', value: String(sumico), disabled: !M.pode('player') }), 'ajustes', 'controlesEspera',
          h('p', { class: 'dica', text: tr('painel.0DesligaOSumicoSo') })),
        h('p', { class: 'estado', id: 'a-estado', role: 'status' }),
        botao(tr('painel.voltarAoPadrao403'), 'a-padrao', 'botao-leve', null, { disabled: !M.pode('player') }))) };
  }

  /* ------------------------------------------- a apresentação da série
   *
   * Fase 5 da apresentação: o "Sobre" editável, a etiqueta da origem,
   * "Marcar revisado", o começo, os temas, "Trocar momentos" (todos os
   * capítulos da série, até cinco marcados) e "Voltar ao gerado". O que o dado
   * tem e a página não mostra — o momento cujo capítulo sumiu — aparece aqui,
   * para alguém decidir. */
  var MAX_MOMENTOS = 5;

  function inspSerie(cat, nome) {
    var pagina = App.paginaDaSerie(cat.itens, nome, cat.site);
    if (!pagina) return null;
    var site = M.site();
    var dado = site.series[nome] || null;
    var pode = M.pode('conteudo');
    var origem = !dado ? [tr('painel.semApresentacao'), 'chip-erro'] : dado.origem === 'revisada' ? ['revisado', 'chip-ok'] : [tr('painel.automaticoNaoRevisado'), 'chip-alerta'];

    var escolhidos = {};
    ((dado && dado.momentos) || []).forEach(function (m) { escolhidos[m.id + '@' + m.inicio] = true; });
    var validos = App.apresentacaoDaSerie(cat.itens, nome, cat.site);
    var vistos = {};
    ((validos && validos.momentos) || []).forEach(function (m) { vistos[m.item.id + '@' + m.inicio] = true; });
    var caidos = ((dado && dado.momentos) || []).filter(function (m) { return !vistos[m.id + '@' + m.inicio]; });
    var cheio = Object.keys(escolhidos).length >= MAX_MOMENTOS;

    var comCapitulo = pagina.itens.filter(function (i) { return App.capitulos(i).length; });

    var corpo = h('div', { class: 'p-corpo-in' },
      !pagina.temPagina ? h('p', { class: 'p-nota', text: tr('painel.estaSerieTemMenosDe') }) : null,
      !dado ? h('p', { class: 'p-nota', text: tr('painel.semApresentacaoAPaginaDa') }) : null,
      h('div', { class: 'campo' },
        h('div', { class: 'campo-topo' }, rotulo(tr('painel.sobreASerie'), 's-sobre', 'site', 'series'), h('span', { class: 'chip ' + origem[1], id: 's-origem', text: origem[0] })),
        h('textarea', { id: 's-sobre', rows: '8', placeholder: tr('painel.umOuDoisParagrafosDo'), value: (dado && dado.sobre) || '', disabled: !pode }),
        h('p', { class: 'dica', text: tr('painel.umaLinhaEmBrancoSepara') })),
      dado && dado.origem !== 'revisada' ? botao(tr('painel.marcarRevisado'), 's-revisar', 'botao-leve botao-pequeno', 'check', { disabled: !pode }) : null,
      campo(tr('painel.comecePorAqui'), 's-comeco', h('select', { id: 's-comeco', disabled: !pode },
        [h('option', { value: '', text: tr('painel.nenhum') })].concat(pagina.itens.map(function (i) {
          return h('option', { value: i.id, selected: dado && dado.comeco === i.id ? 'selected' : null, text: App.tituloCurto(i) || i.titulo });
        }))), 'site', 'series'),
      campo(tr('painel.temas'), 's-temas', h('input', { type: 'text', id: 's-temas', value: ((dado && dado.temas) || []).join(', '), placeholder: tr('painel.exemploTemas'), disabled: !pode }), 'site', 'series',
        h('p', { class: 'dica', text: tr('painel.separadosPorVirgulaAteCinco') })),
      secao(tr('painel.momentosDaSerieN', { n: Object.keys(escolhidos).length, max: MAX_MOMENTOS }),
        caidos.length ? h('div', { class: 'aviso-opcao' },
          h('b', null, tr('painel.momentosNaoAparecem', { n: caidos.length }) + ' '),
          tr('painel.oCapituloSumiuOuO'),
          h('ul', null, caidos.map(function (m) {
            return h('li', null, h('label', null,
              h('input', { type: 'checkbox', checked: true, 'data-momento': m.id + '@' + m.inicio, disabled: !pode }),
              ' ' + m.id + ' em ' + App.formatarTempo(m.inicio)));
          }))) : null,
        comCapitulo.length ? h('div', { class: 's-momentos' }, comCapitulo.map(function (i) {
          return h('details', { open: App.capitulos(i).some(function (c) { return escolhidos[i.id + '@' + c.inicio]; }) ? 'open' : null },
            h('summary', { text: App.tituloCurto(i) || i.titulo }),
            h('ul', { class: 's-capitulos' }, App.capitulos(i).map(function (c) {
              var chave = i.id + '@' + c.inicio;
              return h('li', null, h('label', null,
                h('input', { type: 'checkbox', checked: escolhidos[chave] ? true : null, 'data-momento': chave, disabled: !pode || (cheio && !escolhidos[chave]) }),
                h('span', { class: 'mono', text: ' ' + App.formatarTempo(c.inicio) + ' ' }), c.titulo));
            })));
        })) : h('p', { class: 'p-nota', text: tr('painel.nenhumTituloDestaSerieTem') })),
      dado ? botao(tr('painel.voltarAoGerado'), 's-gerado', 'botao-leve botao-pequeno', null, { disabled: !pode }) : null,
      dado ? h('p', { class: 'dica', text: tr('painel.apagaAApresentacaoAPagina') }) : null);

    return { cab: cab({ texto: tr('painel.serie') }, nome), corpo: corpo };
  }
  M.inspSerie = inspSerie;

  /* ---------------------------------------------------------- despacho */

  M.painel = function (cat) {
    var s = M.st.sel;
    if (s.indexOf('item:') === 0) {
      var it = App.porId(cat.itens, s.slice(5));
      if (it) return inspItem(cat, it);
    }
    if (s.indexOf('prateleira:') === 0) { var p = inspPrateleira(cat, s.slice(11)); if (p) return p; }
    if (s.indexOf('serie:') === 0) { var se = inspSerie(cat, s.slice(6)); if (se) return se; }
    if (s === 'marca' || s === 'rodape') return inspFixo(s);
    if (M.st.tela === 'player') return painelPlayer(cat);
    if (M.st.tela === 'enviar' && M.painelEnvio) return M.painelEnvio(cat);
    if (M.st.tela === 'contas' && M.painelContas) return M.painelContas();
    if (M.st.tela === 'conta') return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('painel.equipe') }), h('h2', { class: 'p-cab-titulo', text: tr('painel.minhaConta') })),
      corpo: h('div', { class: 'p-corpo-in' }, h('p', { class: 'p-nota', text: M.sessao.super
        ? tr('painel.voceEOSuperadminA')
        : tr('painel.aSenhaESuaTroca') })) };
    return visao(cat);
  };

  /* ---------------------------------------------------- barra do rascunho */

  function valorLegivel(campoNome, v, cat) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (v === true) return tr('comum.sim');
    if (v === false) return tr('comum.nao');
    if (Array.isArray(v)) return v.join(', ');
    /* Os campos da estrutura (M4) são MAPAS inteiros, e "[object Object]" não
     * diz nada a ninguém. O rascunho mostra o tamanho da escolha; o que mudou
     * dentro dela se vê na tela Estrutura, ao lado do padrão. */
    if (campoNome === 'destaque' && typeof v === 'string') {
      var alvo = cat && App.porId(cat.itens, v);
      return alvo ? App.tituloCurto(alvo) : v;
    }
    if (typeof v === 'object') {
      var n = Object.keys(v).length;
      if (campoNome === 'prateleiras') return tr('painel.prateleirasN', { n: n });
      if (campoNome === 'classes') return tr('comum.series', { n: n });
      if (campoNome === 'textos') return tr('painel.textosN', { n: n });
      if (campoNome === 'series') return tr('painel.seriesApresentadasN', { n: n });
      return tr('painel.itensN', { n: n });
    }
    if (campoNome === 'arrastoTeto') return Math.round(v * 100) + '%';
    if (campoNome === 'controlesEspera') return v + ' s';
    if (campoNome === 'pendencia') return App.rotuloPendencia(v);
    if (campoNome === 'capa_arquivo') return 'nova';
    var t = String(v);
    return t.length > 60 ? t.slice(0, 58) + '…' : t;
  }
  function nomeDoAlvo(alvo) {
    if (alvo === 'ajustes') return tr('painel.player');
    if (alvo === 'site') return tr('painel.estruturaDoSite');
    var it = M.item(alvo) || M.item(alvo, true);
    return it ? App.tituloCurto(it) : alvo;
  }

  M.barraRascunho = function () {
    var st = M.st, n = st.rascunho.length;
    if (!n) return h('div', { class: 'rasc' }, h('span', { class: 'ponto' }), h('span', { class: 'rasc-texto rasc-calmo', text: tr('painel.rascunhoVazioOQueVoce') }));
    var cat = M.efetivo();
    var barra = h('div', { class: 'rasc rasc-ativo' });

    if (st.verRascunho || st.conflitos.length) {
      var lista = h('div', { class: 'rasc-lista', id: 'rasc-lista', role: 'region', 'aria-label': tr('painel.alteracoesNoRascunho') });
      st.conflitos.forEach(function (c) {
        lista.appendChild(h('div', { class: 'rasc-conflito' },
          h('p', null, h('b', null, nomeDoAlvo(c.alvo) + ' · ' + (CAMPO[c.campo] || c.campo)), c.sumiu ? ' ' + tr('painel.tituloSumiu') : ' ' + tr('painel.mudouEmOutraTela')),
          c.sumiu ? null : h('p', { class: 'rasc-par' }, h('span', { class: 'fraco', text: tr('painel.noSite') }), valorLegivel(c.campo, c.noServidor, cat)),
          c.sumiu ? null : h('p', { class: 'rasc-par' }, h('span', { class: 'fraco', text: tr('painel.oSeu') }), valorLegivel(c.campo, c.depois, cat)),
          h('div', { class: 'botoes-linha' },
            c.sumiu ? null : h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'conflito-meu', 'data-alvo': c.alvo, 'data-campo': c.campo, text: tr('painel.ficarComOMeu') }),
            h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'conflito-site', 'data-alvo': c.alvo, 'data-campo': c.campo, text: c.sumiu ? tr('painel.descartar') : tr('painel.ficarComODoSite') }))));
      });
      var grupos = {};
      st.rascunho.forEach(function (m) { (grupos[m.alvo] = grupos[m.alvo] || []).push(m); });
      Object.keys(grupos).forEach(function (alvo) {
        lista.appendChild(h('p', { class: 'rasc-grupo' }, h('button', { type: 'button', class: 'linha-link linha-link-curta', 'data-acao': 'escolher', 'data-alvo': alvo === 'ajustes' || alvo === 'site' ? '' : 'item:' + alvo }, h('span', { text: nomeDoAlvo(alvo) }))));
        grupos[alvo].forEach(function (m) {
          if (m.campo === 'capa_versao') return;
          lista.appendChild(h('div', { class: 'rasc-mudanca' },
            h('span', { class: 'rasc-campo', text: CAMPO[m.campo] || m.campo }),
            h('span', { class: 'rasc-de', text: valorLegivel(m.campo, m.antes, cat) }),
            h('span', { class: 'rasc-seta', 'aria-hidden': 'true', text: '→' }),
            h('span', { class: 'rasc-para', text: valorLegivel(m.campo, m.depois, cat) }),
            h('button', { type: 'button', class: 'icone-botao', 'data-acao': 'desfazer', 'data-alvo': m.alvo, 'data-campo': m.campo, 'aria-label': tr('painel.desfazerCampoDe', { campo: CAMPO[m.campo] || m.campo, alvo: nomeDoAlvo(m.alvo) }) }, M.ic('desfazer'))));
        });
      });
      barra.appendChild(lista);
    }

    var alteracoes = M.contarAlteracoes();
    barra.appendChild(h('div', { class: 'rasc-linha' }, h('span', { class: 'ponto ponto-ouro' }),
      h('button', { type: 'button', class: 'rasc-texto rasc-abrir', id: 'r-ver', 'aria-expanded': String(st.verRascunho), 'aria-controls': 'rasc-lista' },
        h('b', null, tr('mesa.alteracoesN', { n: alteracoes })), st.conflitos.length ? ' · ' + tr('painel.emConflitoN', { n: st.conflitos.length }) : ' ' + tr('painel.noRascunho')),
      botao(tr('painel.descartar'), 'r-descartar', 'botao-leve botao-pequeno', null, { disabled: st.publicando }),
      botao(st.publicando ? tr('painel.publicando') : tr('painel.publicar'), 'r-publicar', 'botao-verde botao-pequeno', null, { disabled: st.publicando || st.conflitos.length > 0 })));
    return barra;
  };
})();
