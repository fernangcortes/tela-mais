/* mesa-assistente.js — o ASSISTENTE DE CONFIGURAÇÃO da mesa (só o superadmin), sem IA: um passo a passo para quem acabou de
 * publicar o site pelo botão "Deploy to Cloudflare" e abre o /admin pela primeira vez.
 *
 * Sete passos, um por tela: identidade (nome, logo, cor, tema, com prévia e contraste ao vivo) · para quê (o modelo de uso) ·
 * quem pode ver (o modo de acesso, em linguagem simples) · vídeo (comparação e as variáveis a criar no painel da Cloudflare,
 * com teste) · idiomas · home inicial · pronto (checklist e o site.json para baixar).
 *
 * TRÊS REGRAS QUE ESTA TELA NÃO QUEBRA:
 *   1. CHAVE NUNCA ENTRA PELO NAVEGADOR. O passo do vídeo mostra o NOME de cada variável e o caminho exato no painel da
 *      Cloudflare (Workers e Pages, o seu Worker, Configurações, Variáveis e segredos); depois pergunta ao servidor se ficou
 *      certo (só "presente ou não" volta). Não há campo para colar chave.
 *   2. O QUE É DE IMPLANTAÇÃO NÃO SE GRAVA AQUI. Nome, cores, modo de acesso, provedor e idiomas moram no config/site.json, que
 *      fica no repositório do cliente: o assistente GERA o arquivo novo (validado pelo mesmo validador do deploy), explica que é
 *      preciso republicar e oferece baixá-lo. Só a home (blocos e modelo de conteúdo) é dado operacional, e essa vai ao KV pelo
 *      MESMO caminho da mesa: rascunho, Publicar, permissão por campo, histórico e o 409 de quando alguém mexeu no meio.
 *   3. MODO MAIS ABERTO PEDE UM "SIM". Escolher "público" quando o site hoje é restrito exige marcar que entendeu.
 *
 * As contas de cor e a régua de contraste são do servidor (POST /api/saude, a mesma conta do validador do deploy): a tela
 * pergunta, com uma pequena espera entre uma tecla e a pergunta, e mostra a resposta.
 *
 * Quem decide é o servidor. A mesa só conduz, e cada texto vem do catálogo de idiomas. */
(function () {
  'use strict';
  var M = window.MESA, h = M.h, tr = M.tr, O = M.operacao;

  var PASSOS = ['identidade', 'uso', 'acesso', 'video', 'idiomas', 'home', 'pronto'];
  var MODOS = ['publico', 'cadastro', 'privado'];
  var TEMAS = ['cinema', 'claro', 'alto-contraste', 'institucional', 'vibrante', 'aconchegante'];
  var MODOS_DE_TEMA = ['escuro', 'claro', 'auto'];
  var ESPERA_DA_COR_MS = 250;

  /* Explícitas, e não montadas: cada chave aparece inteira para o conferidor de textos. */
  var ROTULO_DO_TEMA = {
    cinema: 'assistente.tema.cinema', claro: 'assistente.tema.claro', 'alto-contraste': 'assistente.tema.altoContraste',
    institucional: 'assistente.tema.institucional', vibrante: 'assistente.tema.vibrante', aconchegante: 'assistente.tema.aconchegante'
  };
  var ROTULO_DO_MODO_DE_TEMA = { escuro: 'assistente.modoEscuro', claro: 'assistente.modoClaro', auto: 'assistente.modoAuto' };
  var TIPO_DE_BLOCO = {
    'destaque': 'telas.homeTipoDestaque', 'continuar-assistindo': 'telas.homeTipoContinuar', 'minha-lista': 'telas.homeTipoMinhaLista',
    'prateleira-recentes': 'telas.homeTipoNovidades', 'prateleira-duracao': 'telas.homeTipoDuracao', 'prateleira-por-serie': 'telas.homeTipoPorSerie',
    'prateleira-colecao': 'telas.homeTipoColecao', 'carrossel': 'telas.homeTipoCarrossel', 'prateleira-restante': 'telas.homeTipoRestante',
    'texto': 'telas.homeTipoTexto', 'banner': 'telas.homeTipoBanner', 'busca': 'telas.homeTipoBusca'
  };
  var NOME_DO_IDIOMA = { 'pt-BR': 'assistente.idioma.ptBR', en: 'assistente.idioma.en', es: 'assistente.idioma.es' };
  var AREAS_DA_MUDANCA = { marca: 'assistente.area.marca', tema: 'assistente.area.tema', acesso: 'assistente.area.acesso', video: 'assistente.area.video', idiomas: 'assistente.area.idiomas', home: 'assistente.area.home', catalogo: 'assistente.area.catalogo', recursos: 'assistente.area.recursos', player: 'assistente.area.player', preset: 'assistente.area.preset', implantacao: 'assistente.area.implantacao' };

  var A = M.assistente = {
    dados: null, carregando: false, erro: '', passo: 0, e: null, tocou: {},
    avaliacao: null, avaliando: false, geracao: null, validando: false, erros: [],
    teste: null, testando: false, homeResultado: null, aplicandoHome: false, logo: '', concluindo: false, confirmouPublico: false
  };

  function redesenhar() { O.redesenhar(); }
  function achar(lista, id) { for (var i = 0; i < lista.length; i++) if (lista[i].id === id) return lista[i]; return null; }
  function presetAtual() { return A.e && A.e.preset && A.dados ? achar(A.dados.presets, A.e.preset) : null; }
  function provedorAtual() { return A.dados ? achar(A.dados.provedores, A.e.provedor) : null; }

  /* ------------------------------------------------------------ dados */

  function iniciar(d) {
    var a = d.atual;
    A.dados = d;
    A.e = {
      nome: a.marca.nome, nomeCurto: a.marca.nomeCurto, slogan: a.marca.slogan,
      cor: (a.tema.cores.escuro && a.tema.cores.escuro.marca) || '', corMudou: false,
      temaPreset: a.tema.preset, temaModo: a.tema.modo,
      preset: a.preset || '', acesso: a.acesso, provedor: a.video.provedor, hlsBaseUrl: a.video.hlsBaseUrl || '',
      idiomas: a.idiomas.disponiveis.slice(), idiomaPadrao: a.idiomas.padrao,
      home: a.preset ? 'preset' : 'manter'
    };
    A.passo = 0;
    A.tocou = {};
    A.confirmouPublico = false;
  }

  /* Mesma regra do servidor: o nome inteiro se couber em 12 letras; senão a primeira palavra. */
  function nomeCurtoDe(nome) {
    var n = String(nome || '').trim();
    return (n.length <= 12 ? n : n.split(/\s+/)[0]).slice(0, 12);
  }

  A.carregar = function () {
    A.carregando = true;
    A.erro = '';
    return M.api('/api/saude?assistente=1').then(function (d) {
      if (!A.e) iniciar(d); else A.dados = d;
      A.dados.estado = d.estado;
    }).catch(function (e) {
      A.erro = e.message;
    }).then(function () {
      A.carregando = false;
      redesenhar();
      if (A.e && A.passo === 0) A.avaliar();
    });
  };

  /* Só o que o administrador MUDOU (ou escolheu) vai ao servidor; o resto fica como está no arquivo. */
  A.escolhas = function () {
    var e = A.e, o = {
      nome: String(e.nome || '').trim(), slogan: String(e.slogan || '').trim(),
      tema: { preset: e.temaPreset, modo: e.temaModo }, acesso: e.acesso, provedor: e.provedor,
      idiomas: { disponiveis: e.idiomas.slice(), padrao: e.idiomaPadrao }
    };
    var curto = String(e.nomeCurto || '').trim();
    if (curto) o.nomeCurto = curto;
    if (e.preset) o.preset = e.preset;
    if (e.corMudou && e.cor) o.cor = e.cor;
    if (e.provedor === 'hls-generico' && e.hlsBaseUrl) o.hlsBaseUrl = String(e.hlsBaseUrl).trim();
    return o;
  };

  /* ---------------------------------------------------- cor e prévia */

  var sequencia = 0, espera = 0;

  /* Pergunta ao servidor a paleta e o contraste (com uma pequena espera entre uma tecla e a pergunta). */
  A.avaliar = function (logo) {
    if (!A.e) return Promise.resolve(null);
    var minha = ++sequencia;
    A.avaliando = true;
    pintarContraste();
    var corpo = { acao: 'marca', tema: { preset: A.e.temaPreset, modo: A.e.temaModo } };
    if (A.e.corMudou && A.e.cor) corpo.cor = A.e.cor;
    return M.api('/api/saude', { method: 'POST', body: JSON.stringify(corpo) }).then(function (r) {
      if (minha !== sequencia) return;
      A.avaliacao = r;
      A.avaliacaoErro = '';
    }).catch(function (e) {
      if (minha !== sequencia) return;
      A.avaliacao = null;
      A.avaliacaoErro = e.message;
    }).then(function () {
      if (minha !== sequencia) return;
      A.avaliando = false;
      pintarContraste();
    });
  };

  function avaliarComEspera() {
    clearTimeout(espera);
    espera = setTimeout(function () { A.avaliar(); }, ESPERA_DA_COR_MS);
  }

  /* 16.386 -> "16,39" em português, "16.39" em inglês: o número sai no formato do idioma de quem edita */
  function formatar(n) {
    try { return new Intl.NumberFormat(M.I18n.idioma(), { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(n); } catch (e) { return String(n); }
  }

  function linhaDeContraste(rotulo, razao, minimo) {
    var passa = razao >= minimo;
    return h('li', { class: 'asst-razao' },
      O.chip(passa ? tr('assistente.contrasteOk') : tr('assistente.contrasteFalha'), passa ? 'chip-ok' : 'chip-erro'),
      h('span', { text: ' ' + tr('assistente.razao', { rotulo: rotulo, razao: formatar(razao), minimo: formatar(minimo) }) }));
  }

  function blocoDoEsquema(esq, av) {
    var caixa = h('div', { class: 'asst-contraste-esquema' });
    if (A.avaliacao.modo === 'auto') caixa.appendChild(h('h4', { class: 'p-rotulo', text: tr(esq === 'escuro' ? 'assistente.modoEscuro' : 'assistente.modoClaro') }));
    if (av.ajustada) {
      caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'note' },
        h('b', { text: tr('assistente.corAjustadaTitulo') + ' ' }),
        tr('assistente.corAjustadaTexto', { pedida: av.pedida, usada: av.usada, razao: formatar(av.razaoDaPedida) }),
        ' ', h('button', { type: 'button', class: 'botao botao-pequeno', 'data-acao': 'asst-usar-cor', 'data-cor': av.usada, text: tr('assistente.usarEstaCor', { cor: av.usada }) }),
        esq === 'escuro' ? h('span', { text: ' ' + tr('assistente.corAjustadaDica') }) : null));
    }
    if (av.ajustada) caixa.appendChild(h('p', { class: 'p-nota', text: tr('assistente.contrasteDaCorUsada', { cor: av.usada }) }));
    caixa.appendChild(h('ul', { class: 'lista-ajuda' },
      linhaDeContraste(tr('assistente.rotuloTexto'), av.razoes.texto, av.minimos.texto),
      linhaDeContraste(tr('assistente.rotuloTextoFraco'), av.razoes.textoFraco, av.minimos.texto),
      linhaDeContraste(tr('assistente.rotuloLink'), av.razoes.link, av.minimos.texto),
      linhaDeContraste(tr('assistente.rotuloBotao'), av.razoes.botao, av.minimos.texto)));
    if (av.falhas.length) {
      caixa.appendChild(h('p', { class: 'p-nota p-nota-alerta', text: tr('assistente.temaComFalhas', { n: av.falhas.length }) }));
    }
    return caixa;
  }

  /* A prévia: um cartão de exemplo pintado com a paleta que o servidor devolveu (as cores entram como variáveis do cartão). */
  function previa(esq, av) {
    var p = av.paleta;
    var no = h('div', { class: 'asst-previa', role: 'img', 'aria-label': tr('assistente.previaDescricao', { modo: tr(esq === 'escuro' ? 'assistente.modoEscuro' : 'assistente.modoClaro') }) });
    var cores = { '--prev-fundo': p.fundo, '--prev-superficie': p.superficie, '--prev-texto': p.texto, '--prev-texto-fraco': p.textoFraco, '--prev-marca': p.marca, '--prev-sobre-marca': p.textoSobreMarca, '--prev-borda': p.borda };
    Object.keys(cores).forEach(function (k) { no.style.setProperty(k, cores[k]); });
    var nome = String(A.e.nome || '').trim() || tr('assistente.nomeDeExemplo');
    var marca = A.logo
      ? h('img', { class: 'asst-previa-logo', src: A.logo, alt: '' })
      : h('span', { class: 'asst-previa-inicial', 'aria-hidden': 'true', text: Array.from(nome)[0] || '' });
    no.appendChild(h('div', { class: 'asst-previa-topo' }, marca, h('b', { text: nome })));
    if (A.e.slogan) no.appendChild(h('p', { class: 'asst-previa-fraco', text: A.e.slogan }));
    no.appendChild(h('div', { class: 'asst-previa-cartao' },
      h('b', { text: tr('assistente.previaTitulo') }),
      h('span', { class: 'asst-previa-fraco', text: tr('assistente.previaSub') }),
      h('span', { class: 'asst-previa-link', text: tr('assistente.previaLink') })));
    no.appendChild(h('span', { class: 'asst-previa-botao', text: tr('assistente.previaBotao') }));
    return no;
  }

  /* Repinta só a prévia e a leitura de contraste: redesenhar a tela inteira tiraria o cursor de quem digita. */
  function pintarContraste() {
    var alvo = M.$('asst-contraste');
    var previaAlvo = M.$('asst-previas');
    if (!alvo || !previaAlvo) return;
    if (A.avaliando && !A.avaliacao) { alvo.replaceChildren(h('p', { class: 'p-nota', text: tr('assistente.calculando') })); return; }
    if (!A.avaliacao) { alvo.replaceChildren(h('p', { class: 'estado estado-erro', text: A.avaliacaoErro || '' })); previaAlvo.replaceChildren(); return; }
    var esquemas = Object.keys(A.avaliacao.esquemas);
    alvo.replaceChildren.apply(alvo, esquemas.map(function (esq) { return blocoDoEsquema(esq, A.avaliacao.esquemas[esq]); }));
    previaAlvo.replaceChildren.apply(previaAlvo, esquemas.map(function (esq) { return previa(esq, A.avaliacao.esquemas[esq]); }));
  }

  /* ------------------------------------------------------ componentes */

  function campoTexto(id, rotulo, valor, max, dica, extra) {
    return h('div', { class: 'campo' }, h('label', { for: id, text: rotulo }),
      h('input', Object.assign({ type: 'text', id: id, maxlength: String(max), value: valor || '', autocomplete: 'off', 'data-asst': id, 'aria-describedby': dica ? id + '-dica' : null }, extra || {})),
      dica ? h('p', { class: 'dica', id: id + '-dica', text: dica }) : null);
  }

  function radio(nome, id, valor, marcado, titulo, descricao, extras) {
    return h('label', { class: 'asst-opcao' + (marcado ? ' marcada' : ''), for: id },
      h('input', { type: 'radio', name: nome, id: id, value: valor, checked: marcado, 'data-asst': nome }),
      h('span', { class: 'asst-opcao-texto' }, h('b', { text: titulo }), descricao ? h('small', { text: descricao }) : null, extras || null));
  }

  function listaDeErros() {
    if (!A.erros.length) return null;
    return h('div', { class: 'aviso-opcao asst-erros', role: 'alert' },
      h('b', { text: tr('assistente.corrijaAntes') }),
      h('ul', { class: 'lista-ajuda' }, A.erros.map(function (x) {
        return h('li', { text: O.texto('assistente.erro.' + x.codigo, x.params || undefined, x.codigo + (x.params && x.params.detalhe ? ': ' + x.params.detalhe : '')) });
      })));
  }

  function copiarBotao(texto) {
    return h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'asst-copiar', 'data-texto': texto, 'aria-label': tr('assistente.copiarNome', { nome: texto }), text: tr('assistente.copiar') });
  }

  /* ------------------------------------------------------------ passos */

  function passoIdentidade() {
    var e = A.e;
    var temas = h('select', { id: 'asst-tema', 'data-asst': 'asst-tema' }, TEMAS.map(function (t) { return h('option', { value: t, selected: e.temaPreset === t, text: tr(ROTULO_DO_TEMA[t]) }); }));
    var modos = h('div', { class: 'seg', role: 'group', 'aria-label': tr('assistente.modoDoTema') }, MODOS_DE_TEMA.map(function (m) {
      return h('button', { type: 'button', 'aria-pressed': String(e.temaModo === m), 'data-acao': 'asst-modo-tema', 'data-modo': m, text: tr(ROTULO_DO_MODO_DE_TEMA[m]) });
    }));
    return h('div', { class: 'asst-passo' },
      h('div', { class: 'asst-colunas' },
        h('div', { class: 'asst-coluna' },
          campoTexto('asst-nome', tr('assistente.nome'), e.nome, 60, tr('assistente.nomeDica'), { required: true }),
          campoTexto('asst-nome-curto', tr('assistente.nomeCurto'), e.nomeCurto, 12, tr('assistente.nomeCurtoDica')),
          campoTexto('asst-slogan', tr('assistente.slogan'), e.slogan, 120, null),
          h('div', { class: 'campo' }, h('label', { for: 'asst-cor-hex', text: tr('assistente.cor') }),
            h('div', { class: 'asst-cor-linha' },
              h('input', { type: 'color', id: 'asst-cor', value: /^#[0-9a-fA-F]{6}$/.test(e.cor) ? e.cor : '', 'data-asst': 'asst-cor', 'aria-label': tr('assistente.corSeletor') }),
              h('input', { type: 'text', id: 'asst-cor-hex', value: e.cor, maxlength: '7', spellcheck: 'false', autocomplete: 'off', 'data-asst': 'asst-cor-hex', 'aria-describedby': 'asst-cor-hex-dica' })),
            h('p', { class: 'dica', id: 'asst-cor-hex-dica', text: tr('assistente.corDica') })),
          h('div', { class: 'campo' }, h('label', { for: 'asst-tema', text: tr('assistente.tema') }), temas, h('p', { class: 'dica', text: tr('assistente.temaDica') })),
          h('div', { class: 'campo' }, h('span', { class: 'p-rotulo', text: tr('assistente.modoDoTema') }), modos),
          h('div', { class: 'campo' }, h('label', { for: 'asst-logo', text: tr('assistente.logo') }),
            h('input', { type: 'file', id: 'asst-logo', accept: 'image/svg+xml,image/png', 'data-asst': 'asst-logo', 'aria-describedby': 'asst-logo-dica' }),
            h('p', { class: 'dica', id: 'asst-logo-dica', text: tr('assistente.logoDica') }))),
        h('div', { class: 'asst-coluna' },
          h('h3', { class: 'a-subtitulo', text: tr('assistente.previaTituloSecao') }),
          h('div', { id: 'asst-previas', class: 'asst-previas' }),
          h('h3', { class: 'a-subtitulo', text: tr('assistente.contrasteTitulo') }),
          h('div', { id: 'asst-contraste', class: 'asst-contraste', role: 'status', 'aria-live': 'polite' }),
          h('p', { class: 'p-nota', text: tr('assistente.contrasteNota') }))));
  }

  function sugestaoDoPreset(p) {
    var s = p.sugere, itens = [];
    if (s.tema) itens.push(tr('assistente.sugereTema', { tema: tr(ROTULO_DO_TEMA[s.tema] || ROTULO_DO_TEMA.cinema) }));
    if (s.acesso) itens.push(tr('assistente.sugereAcesso', { modo: tr('assistente.acesso.' + s.acesso + '.nome') }));
    itens.push(tr(s.modeloDeConteudo === 'avulso' ? 'assistente.sugereAvulso' : 'assistente.sugereSeriado'));
    if (s.legendas) itens.push(tr('assistente.sugereLegendas'));
    if (s.continuarAssistindo) itens.push(tr('assistente.sugereContinuar'));
    return h('ul', { class: 'asst-sugere' }, itens.map(function (t) { return h('li', { text: t }); }));
  }

  function passoUso() {
    var grupo = h('fieldset', { class: 'asst-opcoes' }, h('legend', { class: 'p-rotulo', text: tr('assistente.usoLegenda') }));
    A.dados.presets.forEach(function (p) {
      grupo.appendChild(radio('asst-preset', 'asst-preset-' + p.id, p.id, A.e.preset === p.id, tr('assistente.preset.' + p.id + '.nome'), tr('assistente.preset.' + p.id + '.resumo'), A.e.preset === p.id ? sugestaoDoPreset(p) : null));
    });
    grupo.appendChild(radio('asst-preset', 'asst-preset-nenhum', '', !A.e.preset, tr('assistente.usoNenhum'), tr('assistente.usoNenhumDica')));
    return h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.usoIntro') }), grupo);
  }

  function passoAcesso() {
    var preset = presetAtual();
    var sugerido = preset && preset.sugere.acesso;
    var grupo = h('fieldset', { class: 'asst-opcoes' }, h('legend', { class: 'p-rotulo', text: tr('assistente.acessoLegenda') }));
    MODOS.forEach(function (m) {
      var detalhes = h('span', { class: 'asst-detalhes' },
        h('small', null, h('b', { text: tr('assistente.quemEntra') + ' ' }), tr('assistente.acesso.' + m + '.quem')),
        h('small', null, h('b', { text: tr('assistente.comoFunciona') + ' ' }), tr('assistente.acesso.' + m + '.como')),
        h('small', null, h('b', { text: tr('assistente.custoECuidado') + ' ' }), tr('assistente.acesso.' + m + '.cuidado')));
      var titulo = tr('assistente.acesso.' + m + '.nome') + (sugerido === m ? ' — ' + tr('assistente.recomendadoParaVoce') : '');
      grupo.appendChild(radio('asst-acesso', 'asst-acesso-' + m, m, A.e.acesso === m, titulo, tr('assistente.acesso.' + m + '.resumo'), detalhes));
    });
    var caixa = h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.acessoIntro') }), grupo,
      h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('assistente.gravarTelaTitulo') + ' ' }), tr('assistente.gravarTela')));
    if (A.e.acesso !== 'publico' && A.e.provedor === 'hls-generico') {
      caixa.appendChild(h('p', { class: 'p-nota p-nota-alerta', role: 'alert', text: tr('assistente.acessoHlsConflito') }));
    }
    if (A.e.acesso === 'publico' && A.dados.atual.acesso !== 'publico') {
      caixa.appendChild(h('label', { class: 'permissao', for: 'asst-confirma-publico' },
        h('input', { type: 'checkbox', id: 'asst-confirma-publico', 'data-asst': 'asst-confirma-publico', checked: A.confirmouPublico }),
        h('span', null, h('b', { text: tr('assistente.confirmaPublicoTitulo') }), h('small', { text: tr('assistente.confirmaPublicoTexto') }))));
    }
    return caixa;
  }

  /* A comparação dos provedores: uma linha por provedor, e o que cada um faz pelo modo de acesso escolhido. */
  function tabelaDeProvedores() {
    var linhas = A.dados.provedores.map(function (p) {
      var c = p.capacidades || {};
      return h('tr', { class: A.e.provedor === p.id ? 'sel' : '' },
        h('th', { scope: 'row', text: tr('assistente.provedor.' + p.id + '.nome') }),
        h('td', { text: tr('assistente.provedor.' + p.id + '.oQueE') }),
        h('td', { text: tr('assistente.provedor.' + p.id + '.custo') }),
        h('td', { text: c.assinatura ? tr('comum.sim') : tr('comum.nao') }),
        h('td', { text: c.envio ? tr('comum.sim') : tr('comum.nao') }));
    });
    return h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita a-tabela-provedores' },
      h('caption', { class: 'so-leitor', text: tr('assistente.videoComparacao') }),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: tr('assistente.colProvedor') }), h('th', { scope: 'col', text: tr('assistente.colOQueE') }), h('th', { scope: 'col', text: tr('assistente.colCusto') }),
        h('th', { scope: 'col', text: tr('assistente.colAssina') }), h('th', { scope: 'col', text: tr('assistente.colEnvio') }))),
      h('tbody', null, linhas)));
  }

  function linhaDeVariavel(c, restrito) {
    var papel = c.obrigatoria ? tr('assistente.varObrigatoria') : (c.assinatura && restrito ? tr('assistente.varParaAssinar') : tr('assistente.varOpcional'));
    return h('tr', null,
      h('td', null, h('span', { class: 'mono', text: c.env }), ' ', copiarBotao(c.env)),
      h('td', { text: c.secreta ? tr('assistente.tipoSegredo') : tr('assistente.tipoVariavel') }),
      h('td', { text: papel }),
      h('td', { class: 'p-nota', text: O.texto('assistente.onde.' + c.env, null, '') }),
      h('td', null, O.chip(c.presente ? tr('saude.presente') : tr('saude.faltando'), c.presente ? 'chip-ok' : (c.obrigatoria || (c.assinatura && restrito) ? 'chip-erro' : 'chip-alerta'))));
  }

  function resultadoDoTeste() {
    if (!A.teste) return null;
    var ids = ['video-credenciais', 'video-conexao', 'video-assinatura'];
    var itens = (A.teste.checagens || []).filter(function (x) { return ids.indexOf(x.id) >= 0; });
    var mesmo = A.teste.provedor === A.e.provedor;
    return h('div', { class: 'asst-teste', role: 'status', 'aria-live': 'polite' },
      h('b', { text: tr('assistente.testeResultado') }),
      h('ul', { class: 'lista-ajuda' }, itens.map(function (x) {
        var est = x.estado === 'ok' ? ['saude.estadoOk', 'chip-ok'] : x.estado === 'erro' ? ['saude.estadoErro', 'chip-erro'] : x.estado === 'aviso' ? ['saude.estadoAviso', 'chip-alerta'] : ['saude.estadoPulado', ''];
        return h('li', null, O.chip(tr(est[0]), est[1]), ' ', M.saude.mensagem(x));
      })),
      !mesmo ? h('p', { class: 'p-nota p-nota-alerta', text: tr('assistente.testeOutroProvedor', { atual: tr('assistente.provedor.' + A.teste.provedor + '.nome') }) }) : null);
  }

  function passoVideo() {
    var e = A.e, restrito = e.acesso !== 'publico';
    var grupo = h('fieldset', { class: 'asst-opcoes asst-opcoes-linha' }, h('legend', { class: 'p-rotulo', text: tr('assistente.videoLegenda') }));
    A.dados.provedores.forEach(function (p) {
      grupo.appendChild(radio('asst-provedor', 'asst-provedor-' + p.id, p.id, e.provedor === p.id, tr('assistente.provedor.' + p.id + '.nome'), null));
    });
    var caixa = h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.videoIntro') }), tabelaDeProvedores(), grupo);
    if (restrito && e.provedor === 'hls-generico') caixa.appendChild(h('p', { class: 'p-nota p-nota-alerta', role: 'alert', text: tr('assistente.acessoHlsConflito') }));
    var p = provedorAtual();
    if (!p) return caixa;

    var passos = h('ol', { class: 'asst-lista-passos' });
    if (p.links.conta) passos.appendChild(h('li', null, tr('assistente.videoPasso1'), ' ', h('a', { href: p.links.conta, target: '_blank', rel: 'noopener noreferrer' /* i18n-ignorar: valor do atributo rel */, text: tr('assistente.videoCriarConta', { provedor: tr('assistente.provedor.' + p.id + '.nome') }) })));
    if (p.credenciais.length) {
      passos.appendChild(h('li', { text: tr('assistente.videoPasso2') }));
      passos.appendChild(h('li', null, h('b', { text: tr('assistente.painelCaminho') })));
      passos.appendChild(h('li', { text: tr('assistente.videoPasso3') }));
    } else passos.appendChild(h('li', { text: tr('assistente.videoSemChaves') }));
    caixa.appendChild(h('h3', { class: 'a-subtitulo', text: tr('assistente.videoPassoAPasso', { provedor: tr('assistente.provedor.' + p.id + '.nome') }) }));
    caixa.appendChild(passos);

    if (p.id === 'hls-generico') {
      caixa.appendChild(h('div', { class: 'campo' }, h('label', { for: 'asst-hls', text: tr('assistente.hlsBase') }),
        h('input', { type: 'text', id: 'asst-hls', value: e.hlsBaseUrl, placeholder: 'https://', autocomplete: 'off', spellcheck: 'false', 'data-asst': 'asst-hls', 'aria-describedby': 'asst-hls-dica' }),
        h('p', { class: 'dica', id: 'asst-hls-dica', text: tr('assistente.hlsBaseDica') })));
    }

    var uteis = p.credenciais.filter(function (c) { return c.obrigatoria || (c.assinatura && restrito); });
    var outras = p.credenciais.filter(function (c) { return uteis.indexOf(c) < 0; });
    if (uteis.length) {
      caixa.appendChild(h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
        h('caption', { class: 'so-leitor', text: tr('assistente.videoVariaveis') }),
        h('thead', null, h('tr', null, ['assistente.colVariavel', 'assistente.colTipo', 'assistente.colPapel', 'assistente.colOnde', 'assistente.colEstado'].map(function (k) { return h('th', { scope: 'col', text: tr(k) }); }))),
        h('tbody', null, uteis.map(function (c) { return linhaDeVariavel(c, restrito); })))));
    }
    if (outras.length) {
      caixa.appendChild(h('details', { class: 'asst-mais' }, h('summary', { text: tr('assistente.videoOutrasVariaveis', { n: outras.length }) }),
        h('div', { class: 'a-rolagem' }, h('table', { class: 'a-tabela a-tabela-estreita' },
          h('thead', null, h('tr', null, ['assistente.colVariavel', 'assistente.colTipo', 'assistente.colPapel', 'assistente.colOnde', 'assistente.colEstado'].map(function (k) { return h('th', { scope: 'col', text: tr(k) }); }))),
          h('tbody', null, outras.map(function (c) { return linhaDeVariavel(c, restrito); }))))));
    }
    caixa.appendChild(h('div', { class: 'aviso-opcao', role: 'note' }, h('b', { text: tr('assistente.chaveNuncaAqui') + ' ' }), tr('assistente.chaveNuncaAquiTexto')));
    caixa.appendChild(h('div', { class: 'botoes-linha' },
      h('button', { type: 'button', class: 'botao', 'data-acao': 'asst-testar', disabled: A.testando, text: A.testando ? tr('assistente.testando') : tr('assistente.testarAgora') }),
      h('p', { class: 'p-nota', text: tr('assistente.testarNota') })));
    var r = resultadoDoTeste();
    if (r) caixa.appendChild(r);
    return caixa;
  }

  function passoIdiomas() {
    var e = A.e;
    var grupo = h('fieldset', { class: 'asst-opcoes asst-opcoes-linha' }, h('legend', { class: 'p-rotulo', text: tr('assistente.idiomasLegenda') }));
    A.dados.idiomasDoProduto.forEach(function (id) {
      var marcado = e.idiomas.indexOf(id) >= 0;
      grupo.appendChild(h('label', { class: 'permissao', for: 'asst-idioma-' + id },
        h('input', { type: 'checkbox', id: 'asst-idioma-' + id, 'data-asst': 'asst-idioma', 'data-idioma': id, checked: marcado }),
        h('span', null, h('b', { text: tr(NOME_DO_IDIOMA[id]) }))));
    });
    var padrao = h('select', { id: 'asst-idioma-padrao', 'data-asst': 'asst-idioma-padrao' }, e.idiomas.map(function (id) { return h('option', { value: id, selected: e.idiomaPadrao === id, text: tr(NOME_DO_IDIOMA[id] || NOME_DO_IDIOMA['pt-BR']) }); }));
    return h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.idiomasIntro') }), grupo,
      h('div', { class: 'campo' }, h('label', { for: 'asst-idioma-padrao', text: tr('assistente.idiomaPadrao') }), padrao, h('p', { class: 'dica', text: tr('assistente.idiomaPadraoDica') })),
      h('p', { class: 'p-nota', text: tr('assistente.idiomasOutros') }));
  }

  function passoHome() {
    var preset = presetAtual();
    var caixa = h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.homeIntro') }));
    if (!preset) {
      caixa.appendChild(h('p', { class: 'p-nota', text: tr('assistente.homeSemModelo') }));
      return caixa;
    }
    var blocos = preset.home.blocos;
    caixa.appendChild(h('div', { class: 'cartao-conta' },
      h('h3', { class: 'a-subtitulo', text: tr('assistente.homeDoModelo', { modelo: tr('assistente.preset.' + preset.id + '.nome') }) }),
      h('ol', { class: 'asst-blocos' }, blocos.map(function (b) { return h('li', { text: tr(TIPO_DE_BLOCO[b.tipo] || TIPO_DE_BLOCO.texto) }); })),
      h('p', { class: 'p-nota', text: tr(preset.home.modeloDeConteudo === 'avulso' ? 'assistente.homeModeloAvulso' : 'assistente.homeModeloSeriado') })));
    var grupo = h('fieldset', { class: 'asst-opcoes asst-opcoes-linha' }, h('legend', { class: 'p-rotulo', text: tr('assistente.homeLegenda') }));
    grupo.appendChild(radio('asst-home', 'asst-home-preset', 'preset', A.e.home === 'preset', tr('assistente.homeUsarModelo'), tr('assistente.homeUsarModeloDica')));
    grupo.appendChild(radio('asst-home', 'asst-home-manter', 'manter', A.e.home === 'manter', tr('assistente.homeManter'), tr('assistente.homeManterDica')));
    caixa.appendChild(grupo);
    if (A.e.home === 'preset') {
      var r = A.homeResultado;
      caixa.appendChild(h('div', { class: 'botoes-linha' },
        h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'asst-aplicar-home', disabled: A.aplicandoHome || (r && r.estado === 'publicada'), text: A.aplicandoHome ? tr('assistente.aplicando') : tr('assistente.homeAplicar') }),
        h('p', { class: 'estado' + (r && r.estado === 'erro' ? ' estado-erro' : ''), id: 'asst-home-estado', role: 'status',
          text: !r ? '' : r.estado === 'publicada' ? tr('assistente.homePublicada', { rev: r.rev }) : r.estado === 'rascunho' ? tr('assistente.homeNoRascunho') : r.estado === 'conflito' ? tr('assistente.homeConflito') : tr('assistente.homeFalhou', { mensagem: r.mensagem || '' }) })));
      caixa.appendChild(h('p', { class: 'p-nota', text: tr('assistente.homeComoGrava') }));
    }
    return caixa;
  }

  /* O resumo do que esta sessão do assistente deixou pronto. */
  function checklist() {
    var e = A.e, s = M.saude.dados, itens = [];
    var checagem = function (id) { return s && (s.checagens || []).filter(function (x) { return x.id === id; })[0]; };
    var poe = function (ok, texto, passo, aviso) {
      itens.push(h('li', { class: 'asst-check' }, O.chip(ok ? tr('assistente.feito') : tr('assistente.falta'), ok ? 'chip-ok' : (aviso ? 'chip-alerta' : 'chip-erro')), ' ', texto,
        !ok && passo ? [' ', h('button', { type: 'button', class: 'botao botao-leve botao-pequeno', 'data-acao': 'asst-ir-passo', 'data-passo': passo, text: tr('assistente.irParaPasso') })] : null));
    };
    poe(!!String(e.nome || '').trim(), tr('assistente.checkIdentidade', { nome: String(e.nome || '').trim() || '—' }), 0);
    poe(true, tr('assistente.checkAcesso', { modo: tr('assistente.acesso.' + e.acesso + '.nome') }), 2);
    var p = provedorAtual();
    var faltam = p ? p.credenciais.filter(function (c) { return (c.obrigatoria || (c.assinatura && e.acesso !== 'publico')) && !c.presente; }).map(function (c) { return c.env; }) : [];
    poe(!faltam.length, faltam.length ? tr('assistente.checkVideoFalta', { provedor: tr('assistente.provedor.' + e.provedor + '.nome'), nomes: faltam.join(', ') }) : tr('assistente.checkVideoOk', { provedor: tr('assistente.provedor.' + e.provedor + '.nome') }), 3);
    var home = A.homeResultado;
    poe(e.home === 'manter' || !presetAtual() || (home && (home.estado === 'publicada' || home.estado === 'rascunho')),
      e.home === 'manter' || !presetAtual() ? tr('assistente.checkHomeMantida') : (home && home.estado === 'rascunho' ? tr('assistente.checkHomeRascunho') : home && home.estado === 'publicada' ? tr('assistente.checkHomePublicada') : tr('assistente.checkHome')), 5, true);
    var admin = checagem('admin-senha'), sessao = checagem('sessao');
    poe(!admin || (admin.estado === 'ok' && sessao && sessao.estado === 'ok'), tr('assistente.checkAdmin'), null);
    var backup = checagem('backup');
    poe(!backup || backup.estado === 'ok', tr('assistente.checkBackup'), null, true);
    return h('ul', { class: 'asst-checklist', 'aria-label': tr('assistente.checklist') }, itens);
  }

  function agrupar(mudancas) {
    var grupos = {};
    (mudancas || []).forEach(function (c) { var a = c.split('.')[0]; grupos[a] = (grupos[a] || 0) + 1; });
    return Object.keys(grupos);
  }

  /* O logo no caminho sem agente: baixar o SVG com os nomes certos e soltar no GitHub (nada de comando). */
  function blocoDoLogo() {
    if (A.logo && A.logoSvg) {
      var link = function (nome, chave) { return h('a', { class: 'botao botao-leve', href: A.logo, download: nome, text: tr(chave) }); };
      return h('div', { class: 'cartao-conta' },
        h('h3', { class: 'a-subtitulo', text: tr('assistente.logoTitulo') }),
        h('ol', { class: 'asst-lista-passos' }, ['assistente.logo1', 'assistente.logo2', 'assistente.logo3'].map(function (k) { return h('li', { text: tr(k) }); })),
        h('div', { class: 'botoes-linha' }, link('logo-fundo-escuro.svg', 'assistente.baixarLogoEscuro'), link('logo-fundo-claro.svg', 'assistente.baixarLogoClaro')),
        h('p', { class: 'p-nota', text: tr('assistente.logoNota') }));
    }
    return h('p', { class: 'p-nota', text: tr(A.logo ? 'assistente.logoPng' : 'assistente.logoSemArquivo') });
  }

  function passoPronto() {
    var g = A.geracao;
    var caixa = h('div', { class: 'asst-passo' }, h('p', { class: 'p-nota', text: tr('assistente.prontoIntro') }), checklist());
    if (A.validando && !g) caixa.appendChild(h('p', { class: 'p-nota', role: 'status', text: tr('assistente.gerando') }));
    var erros = listaDeErros();
    if (erros) caixa.appendChild(erros);
    if (g && g.ok) {
      if (g.precisaRepublicar) {
        var areas = agrupar(g.mudancas).map(function (a) { return tr(AREAS_DA_MUDANCA[a] || AREAS_DA_MUDANCA.implantacao); });
        caixa.appendChild(h('div', { class: 'cartao-conta' },
          h('h3', { class: 'a-subtitulo', text: tr('assistente.republicarTitulo') }),
          h('p', { text: tr('assistente.republicarTexto') }),
          h('p', { class: 'p-nota', text: tr('assistente.republicarAreas', { areas: areas.join(', ') }) }),
          h('ol', { class: 'asst-lista-passos' }, ['assistente.republicar1', 'assistente.republicar2', 'assistente.republicar3', 'assistente.republicar4'].map(function (k) { return h('li', { text: tr(k) }); })),
          h('div', { class: 'botoes-linha' },
            h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'asst-baixar', text: tr('assistente.baixarSiteJson') }),
            h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'asst-copiar-json', text: tr('assistente.copiarSiteJson') }),
            h('p', { class: 'estado', id: 'asst-baixar-estado', role: 'status' })),
          h('p', { class: 'p-nota', text: tr('assistente.republicarRepo') }),
          h('p', { class: 'p-nota', text: tr('assistente.republicarErro') }),
          h('p', { class: 'p-nota', text: tr('assistente.republicarTerminal') })));
      } else {
        caixa.appendChild(h('p', { class: 'p-nota', role: 'status', text: tr('assistente.nadaARepublicar') }));
      }
    }
    caixa.appendChild(blocoDoLogo());
    caixa.appendChild(h('div', { class: 'botoes-linha' },
      h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'asst-concluir', disabled: A.concluindo, text: tr('assistente.concluir') }),
      h('p', { class: 'p-nota', text: tr('assistente.concluirNota') })));
    return caixa;
  }

  var DESENHO = { identidade: passoIdentidade, uso: passoUso, acesso: passoAcesso, video: passoVideo, idiomas: passoIdiomas, home: passoHome, pronto: passoPronto };
  var TITULO = {
    identidade: 'assistente.passo.identidade', uso: 'assistente.passo.uso', acesso: 'assistente.passo.acesso', video: 'assistente.passo.video',
    idiomas: 'assistente.passo.idiomas', home: 'assistente.passo.home', pronto: 'assistente.passo.pronto'
  };

  M.telaAssistente = function () {
    if (!M.sessao.super) return h('div', { class: 'a' }, O.topo(tr('assistente.titulo'), tr('assistente.soSuper')));
    if (!A.dados && !A.carregando && !A.erro) A.carregar();
    var caixa = h('div', { class: 'a assistente' }, O.topo(tr('assistente.titulo'), tr('assistente.sub'),
      h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'asst-dispensar', text: tr('assistente.agoraNao') })));
    if (A.erro) caixa.appendChild(h('p', { class: 'estado estado-erro', role: 'alert', text: A.erro }));
    if (!A.e) {
      if (!A.erro) caixa.appendChild(h('p', { class: 'p-nota', role: 'status', text: tr('assistente.carregando') }));
      return caixa;
    }
    var nome = PASSOS[A.passo];
    var trilha = h('ol', { class: 'asst-trilha', 'aria-label': tr('assistente.passos') }, PASSOS.map(function (p, i) {
      return h('li', null, h('button', { type: 'button', class: 'asst-trilha-botao' + (i === A.passo ? ' ativo' : '') + (i < A.passo ? ' feito' : ''), 'data-acao': 'asst-ir-passo', 'data-passo': String(i),
        'aria-current': i === A.passo ? 'step' : null },
        h('span', { class: 'asst-trilha-n', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { text: tr(TITULO[p]) })));
    }));
    caixa.appendChild(trilha);
    caixa.appendChild(h('h2', { class: 'a-subtitulo asst-titulo', id: 'asst-titulo-passo', tabindex: '-1', text: tr('assistente.passoDeTotal', { n: A.passo + 1, total: PASSOS.length, nome: tr(TITULO[nome]) }) }));
    if (nome !== 'pronto') { var er = listaDeErros(); if (er) caixa.appendChild(er); }
    caixa.appendChild(DESENHO[nome]());
    caixa.appendChild(h('div', { class: 'botoes-linha asst-nav' },
      h('button', { type: 'button', class: 'botao botao-leve', 'data-acao': 'asst-voltar', disabled: A.passo === 0, text: tr('assistente.voltar') }),
      nome !== 'pronto' ? h('button', { type: 'button', class: 'botao botao-verde', 'data-acao': 'asst-avancar', disabled: A.validando, text: A.validando ? tr('assistente.conferindo') : tr('assistente.continuar') }) : null,
      h('p', { class: 'estado', id: 'asst-estado', role: 'status' })));
    /* Depois de desenhar, a prévia se pinta com o que o servidor já respondeu. */
    setTimeout(pintarContraste, 0);
    return caixa;
  };

  M.painelAssistente = function () {
    var nome = PASSOS[A.passo] || 'identidade';
    return { cab: h('div', { class: 'p-cab' }, h('span', { class: 'chip', text: tr('assistente.ajudaChip') }), h('h2', { class: 'p-cab-titulo', text: tr('assistente.ajuda.' + nome + '.titulo') })),
      corpo: h('div', { class: 'p-corpo-in' },
        h('p', { class: 'p-nota', text: tr('assistente.ajuda.' + nome + '.texto') }),
        h('div', { class: 'aviso-opcao' }, h('b', { text: tr('assistente.glossarioTitulo') + ' ' }), tr('assistente.glossario')),
        h('p', { class: 'p-nota', text: tr('assistente.semIA') })) };
  };

  /* ----------------------------------------------------------- navegação */

  function focarNoTitulo() {
    setTimeout(function () { var t = M.$('asst-titulo-passo'); if (t && t.focus) t.focus(); }, 0);
  }

  function irPara(n) {
    A.passo = Math.max(0, Math.min(PASSOS.length - 1, n));
    A.erros = [];
    /* inteiro (com o painel da direita): a ajuda muda a cada passo */
    if (M.redesenhar) M.redesenhar({});
    focarNoTitulo();
    if (PASSOS[A.passo] === 'identidade') A.avaliar();
    if (PASSOS[A.passo] === 'pronto') { A.geracao = null; A.gerar(); if (M.saude && M.saude.carregar) M.saude.carregar({}); }
  }
  A.irPara = irPara;

  /* Pede ao servidor o config/site.json novo com as escolhas de agora: é a conferência (as combinações impossíveis voltam
   * como erro com código) e, no fim, o arquivo para baixar. Não grava nada. */
  A.gerar = function () {
    A.validando = true;
    A.erros = [];
    redesenhar();
    return M.api('/api/saude', { method: 'POST', body: JSON.stringify({ acao: 'config', escolhas: A.escolhas() }) }).then(function (r) {
      A.geracao = Object.assign({ ok: true }, r);
      return true;
    }).catch(function (e) {
      A.geracao = null;
      A.erros = e.corpo && Array.isArray(e.corpo.erros) ? e.corpo.erros : [{ codigo: 'falha', params: { detalhe: e.message } }];
      return false;
    }).then(function (ok) {
      A.validando = false;
      redesenhar();
      return ok;
    });
  };

  /* O que impede de sair do passo, sem ir ao servidor. */
  function impedimento(passo) {
    var e = A.e;
    if (passo === 'identidade' && !String(e.nome || '').trim()) return { codigo: 'nome-invalido', foco: 'asst-nome' };
    if (passo === 'identidade' && e.corMudou && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(e.cor)) return { codigo: 'cor-invalida', foco: 'asst-cor-hex' };
    if (passo === 'acesso' && e.acesso === 'publico' && A.dados.atual.acesso !== 'publico' && !A.confirmouPublico) return { codigo: 'confirme-publico', foco: 'asst-confirma-publico' };
    if (passo === 'idiomas' && !e.idiomas.length) return { codigo: 'idiomas-invalidos', foco: 'asst-idioma-pt-BR' };
    return null;
  }

  function avancar() {
    var passo = PASSOS[A.passo];
    var barrou = impedimento(passo);
    if (barrou) {
      A.erros = [{ codigo: barrou.codigo }];
      redesenhar();
      setTimeout(function () { var f = M.$(barrou.foco); if (f && f.focus) f.focus(); }, 0);
      return Promise.resolve(false);
    }
    /* acesso, vídeo e idiomas mudam o que o validador do deploy aceita: confere agora, e não só no fim */
    if (passo === 'acesso' || passo === 'video' || passo === 'idiomas') {
      return A.gerar().then(function (ok) { if (ok) irPara(A.passo + 1); return ok; });
    }
    irPara(A.passo + 1);
    return Promise.resolve(true);
  }
  A.avancar = avancar;

  /* ---------------------------------------------------------------- ações */

  A.testarVideo = function () {
    A.testando = true;
    redesenhar();
    return M.api('/api/saude?testar=1').then(function (s) {
      A.teste = s;
      if (M.saude) M.saude.dados = s;
      return M.api('/api/saude?assistente=1').then(function (d) { A.dados = Object.assign(d, { estado: d.estado }); });
    }).catch(function (e) {
      A.erros = [{ codigo: 'falha', params: { detalhe: e.message } }];
    }).then(function () {
      A.testando = false;
      redesenhar();
    });
  };

  /* A home do modelo vai ao KV pelo MESMO caminho da mesa (rascunho -> Publicar). Se já havia outras alterações no rascunho,
   * elas NÃO são publicadas por tabela: a home fica no rascunho e a pessoa revê e publica pela barra de sempre. */
  A.aplicarHome = function () {
    var preset = presetAtual();
    if (!preset || A.aplicandoHome) return Promise.resolve(null);
    var haviaRascunho = M.st.rascunho.length > 0;
    A.aplicandoHome = true;
    A.homeResultado = null;
    redesenhar();
    M.mudarSite('blocos', preset.home.blocos);
    if (preset.home.modeloDeConteudo) M.mudarSite('modeloDeConteudo', preset.home.modeloDeConteudo);
    if (haviaRascunho) {
      A.aplicandoHome = false;
      A.homeResultado = { estado: 'rascunho' };
      redesenhar();
      return Promise.resolve(null);
    }
    return M.publicar().then(function (r) {
      if (r && r.ok) A.homeResultado = { estado: 'publicada', rev: r.rev };
      else if (M.st.conflitos && M.st.conflitos.length) A.homeResultado = { estado: 'conflito' };
      else A.homeResultado = { estado: 'erro', mensagem: '' };
    }).catch(function (e) {
      A.homeResultado = { estado: 'erro', mensagem: e.message };
    }).then(function () {
      A.aplicandoHome = false;
      redesenhar();
    });
  };

  function marcarEstado(estado) {
    return M.api('/api/saude', { method: 'PUT', body: JSON.stringify({ assistente: estado }) });
  }

  A.concluir = function () {
    A.concluindo = true;
    redesenhar();
    return marcarEstado('concluido').then(function () {
      A.concluindo = false;
      if (M.saude) M.saude.carregar({});
      M.toast(tr('assistente.concluido'));
      M.irTela('saude');
    }).catch(function (e) {
      A.concluindo = false;
      A.erros = [{ codigo: 'falha', params: { detalhe: e.message } }];
      redesenhar();
    });
  };

  A.dispensar = function () {
    return marcarEstado('dispensado').then(function () {
      if (M.saude && M.saude.dados) M.saude.dados.assistente = { estado: 'dispensado' };
      M.toast(tr('assistente.dispensado'));
      M.irTela('saude');
    }).catch(function (e) { M.toast(e.message); });
  };

  function baixarSiteJson() {
    if (!A.geracao || !A.geracao.texto) return;
    O.baixar('site.json', A.geracao.texto, 'application/json');
    O.dizer('asst-baixar-estado', tr('assistente.baixado'));
  }

  /* ----------------------------------------------------------- eventos */

  function aplicarSugestoesDoModelo(p) {
    var s = p ? p.sugere : null;
    if (!s) return;
    if (!A.tocou.acesso && s.acesso) A.e.acesso = s.acesso;
    if (!A.tocou.tema && s.tema) { A.e.temaPreset = s.tema; A.e.temaModo = s.modoDeTema || A.e.temaModo; }
    A.e.home = 'preset';
  }

  var HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  function hexParaSeletor(v) {
    if (!HEX.test(v)) return '';
    if (v.length === 4) return '#' + v.slice(1).split('').map(function (c) { return c + c; }).join('').toLowerCase();
    return v.toLowerCase();
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-acao^="asst-"]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'asst-avancar') return avancar();
    if (a === 'asst-voltar') return irPara(A.passo - 1);
    if (a === 'asst-ir-passo') return irPara(Number(b.getAttribute('data-passo')));
    if (a === 'asst-dispensar') return A.dispensar();
    if (a === 'asst-concluir') return A.concluir();
    if (a === 'asst-testar') return A.testarVideo();
    if (a === 'asst-aplicar-home') return A.aplicarHome();
    if (a === 'asst-baixar') return baixarSiteJson();
    if (a === 'asst-copiar-json') {
      if (!A.geracao || !A.geracao.texto) return;
      return O.copiar(A.geracao.texto).then(function () { O.dizer('asst-baixar-estado', tr('assistente.copiado')); }, function () { O.dizer('asst-baixar-estado', tr('saude.naoCopiou'), true); });
    }
    if (a === 'asst-copiar') {
      return O.copiar(b.getAttribute('data-texto')).then(function () { M.toast(tr('assistente.copiado')); }, function () { M.toast(tr('saude.naoCopiou')); });
    }
    if (a === 'asst-modo-tema') { A.e.temaModo = b.getAttribute('data-modo'); A.tocou.tema = true; A.tocou.modo = true; redesenhar(); return A.avaliar(); }
    if (a === 'asst-usar-cor') { A.e.cor = b.getAttribute('data-cor'); A.e.corMudou = true; redesenhar(); return A.avaliar(); }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    var que = t && t.getAttribute ? t.getAttribute('data-asst') : null;
    if (!que || !A.e) return;
    if (que === 'asst-nome') {
      A.e.nome = t.value;
      /* o nome curto acompanha o nome enquanto a pessoa não o escrever por conta própria (senão ficaria com o do modelo) */
      if (!A.e.curtoMudou) {
        A.e.nomeCurto = nomeCurtoDe(t.value);
        var campoCurto = M.$('asst-nome-curto');
        if (campoCurto) campoCurto.value = A.e.nomeCurto;
      }
      return pintarContraste();
    }
    if (que === 'asst-nome-curto') { A.e.nomeCurto = t.value; A.e.curtoMudou = true; return; }
    if (que === 'asst-slogan') { A.e.slogan = t.value; return pintarContraste(); }
    if (que === 'asst-hls') { A.e.hlsBaseUrl = t.value; return; }
    if (que === 'asst-cor-hex') {
      A.e.cor = t.value.trim();
      A.e.corMudou = true;
      var seletor = M.$('asst-cor');
      if (seletor && HEX.test(A.e.cor)) seletor.value = hexParaSeletor(A.e.cor);
      if (HEX.test(A.e.cor)) avaliarComEspera();
      return;
    }
    if (que === 'asst-cor') {
      A.e.cor = t.value;
      A.e.corMudou = true;
      var hex = M.$('asst-cor-hex');
      if (hex) hex.value = t.value;
      return avaliarComEspera();
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    var que = t && t.getAttribute ? t.getAttribute('data-asst') : null;
    if (!que || !A.e) return;
    if (que === 'asst-tema') {
      A.e.temaPreset = t.value; A.tocou.tema = true;
      /* escolher o tema já leva o fundo (claro/escuro) que ele traz, senão a prévia não muda e parece defeito */
      var dadosDoTema = A.dados && A.dados.temas ? achar(A.dados.temas, t.value) : null;
      if (dadosDoTema && dadosDoTema.modoPadrao && !A.tocou.modo) A.e.temaModo = dadosDoTema.modoPadrao;
      redesenhar();
      return A.avaliar();
    }
    if (que === 'asst-logo') {
      var arquivo = t.files && t.files[0];
      A.logo = ''; A.logoSvg = false;
      if (!arquivo) return pintarContraste();
      if (!/^image\/(svg\+xml|png)$/.test(arquivo.type || '') || arquivo.size > 512 * 1024) { A.erros = [{ codigo: 'logo-invalido' }]; return redesenhar(); }
      var leitor = new FileReader();
      leitor.onload = function () { A.logo = String(leitor.result); A.logoSvg = arquivo.type === 'image/svg+xml'; A.erros = []; pintarContraste(); };
      leitor.readAsDataURL(arquivo);
      return;
    }
    if (que === 'asst-preset') {
      A.e.preset = t.value;
      aplicarSugestoesDoModelo(presetAtual());
      A.homeResultado = null;
      return redesenhar();
    }
    if (que === 'asst-acesso') { A.e.acesso = t.value; A.tocou.acesso = true; A.confirmouPublico = false; return redesenhar(); }
    if (que === 'asst-confirma-publico') { A.confirmouPublico = t.checked; return; }
    if (que === 'asst-provedor') { A.e.provedor = t.value; A.teste = null; return redesenhar(); }
    if (que === 'asst-home') { A.e.home = t.value; return redesenhar(); }
    if (que === 'asst-idioma') {
      var id = t.getAttribute('data-idioma');
      var i = A.e.idiomas.indexOf(id);
      if (t.checked && i < 0) A.e.idiomas.push(id);
      if (!t.checked && i >= 0) A.e.idiomas.splice(i, 1);
      if (A.e.idiomas.indexOf(A.e.idiomaPadrao) < 0) A.e.idiomaPadrao = A.e.idiomas[0] || 'pt-BR';
      return redesenhar();
    }
    if (que === 'asst-idioma-padrao') { A.e.idiomaPadrao = t.value; return; }
    if (que === 'asst-hls') { A.e.hlsBaseUrl = t.value; return; }
  });
})();
