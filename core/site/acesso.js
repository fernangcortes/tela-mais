/* acesso.js — as páginas do espectador: entrar, cadastro, minha conta, privacidade e termos.
 *
 * Uma página, um `data-pagina` no <body>; este arquivo faz o que cada uma pede. Sem
 * framework, sem build, como o resto do site. Todo texto vem do catálogo de idiomas
 * (`acesso.*`, `legal.*`, `api.*`) por `tr()`.
 *
 * O que NÃO se faz aqui: guardar sessão. O cookie da sessão é HttpOnly (o JavaScript não
 * o lê, e é por isso que ele não vaza por XSS); a página só pergunta ao servidor quem é
 * a pessoa (`/api/auth/estado`, `/api/conta/eu`). O token do link mágico e do convite vem
 * no FRAGMENTO do endereço (#t=...): é lido, tirado da barra de endereço na hora e só
 * gasto quando a pessoa aperta o botão (POST) — abrir o link não gasta nada. */
(function () {
  'use strict';
  var I18n = window.AppI18n;
  var PREFIXO = 'tm';
  var pagina = document.body.getAttribute('data-pagina');
  var tr = function (chave, params) { return I18n.t(chave, params); };
  var estado = null;     /* a resposta de /api/auth/estado */

  function $(id) { return document.getElementById(id); }
  function mostrar(id, sim) { var e = $(id); if (e) e.hidden = !sim; }
  function limpar(no) { while (no && no.firstChild) no.removeChild(no.firstChild); }
  function criar(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  /* ------------------------------------------------------------------ rede */

  /* Nunca rejeita: devolve { status, corpo }; status 0 é "sem rede". */
  function api(caminho, opcoes) {
    var o = opcoes || {};
    var cabecalhos = { Accept: 'application/json' };
    var init = { method: o.metodo || 'GET', headers: cabecalhos, credentials: 'same-origin' };
    if (o.corpo !== undefined) {
      cabecalhos['content-type'] = 'application/json';
      init.body = JSON.stringify(o.corpo);
    }
    return fetch(caminho, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (corpo) { return { status: r.status, corpo: corpo || {}, resposta: r }; });
    }, function () { return { status: 0, corpo: {} }; });
  }

  function mensagemDe(r) {
    if (r.status === 0) return tr('acesso.semRede');
    var c = r.corpo || {};
    if (c.codigo && I18n.tem('api.' + c.codigo)) return tr('api.' + c.codigo, c.params);
    return tr('acesso.erroGenerico', { status: r.status });
  }

  function dizer(id, texto, erro) {
    var e = $(id);
    if (!e) return;
    e.textContent = texto || '';
    e.className = 'estado' + (erro ? ' estado-erro' : '');
  }

  /* Para onde voltar depois de entrar: só caminho do próprio site. */
  function destinoSeguro(valor) {
    var v = String(valor || '');
    if (!v || v.indexOf('//') === 0 || v.indexOf(':') >= 0 || v.indexOf('\\') >= 0 || !/^[\w\-./?=&%#~]*$/.test(v)) return 'index.html';
    return v;
  }
  function destinoDaUrl() {
    try { return destinoSeguro(new URLSearchParams(location.search).get('voltar')); } catch (e) { return 'index.html'; }
  }

  /* ------------------------------------------------------------- Turnstile */

  var turnstile = { token: '', id: null };

  /* O desafio anti-robô: o widget da Cloudflare, só quando o servidor tem a chave. */
  function ligarTurnstile(siteKey) {
    var caixa = $('turnstile');
    if (!caixa || !siteKey) return;
    caixa.hidden = false;
    window.__tmTurnstilePronto = function () {
      if (!window.turnstile) return;
      turnstile.id = window.turnstile.render(caixa, {
        sitekey: siteKey,
        callback: function (t) { turnstile.token = t; },
        'expired-callback': function () { turnstile.token = ''; },
        'error-callback': function () { turnstile.token = ''; }
      });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tmTurnstilePronto';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }
  /* O token vale uma vez: depois de cada tentativa, pede outro. */
  function renovarTurnstile() {
    turnstile.token = '';
    try { if (window.turnstile && turnstile.id != null) window.turnstile.reset(turnstile.id); } catch (e) { /* sem widget */ }
  }
  function precisaDeTurnstile() { return Boolean(estado && estado.turnstile && estado.turnstile.siteKey); }

  /* -------------------------------------------------------------- consentimento */

  /* "Li e aceito os [Termos de uso] e a [Política de privacidade]." — a frase em três
   * pedaços, com os dois links no meio, para valer em qualquer ordem de palavras. */
  function montarAceite(rotulo) {
    limpar(rotulo);
    rotulo.appendChild(document.createTextNode(tr('acesso.aceiteAntes') + ' '));
    var a1 = criar('a', null, tr('legal.termosTitulo'));
    a1.href = 'termos.html'; a1.target = '_blank'; a1.rel = 'noopener';
    rotulo.appendChild(a1);
    rotulo.appendChild(document.createTextNode(' ' + tr('acesso.aceiteMeio') + ' '));
    var a2 = criar('a', null, tr('legal.privacidadeTitulo'));
    a2.href = 'privacidade.html'; a2.target = '_blank'; a2.rel = 'noopener';
    rotulo.appendChild(a2);
    rotulo.appendChild(document.createTextNode(tr('acesso.aceiteFim')));
  }

  /* ------------------------------------------------------------------ idioma */

  function carregarIdioma() {
    return I18n.iniciarNoNavegador({ chaveSalva: PREFIXO + ':idioma' }).then(function (r) {
      I18n.aplicarNoDocumento(document);
      var caixa = $('idioma-caixa');
      var sel = $('idioma');
      var idi = (r.publica && r.publica.idiomas) || {};
      if (caixa && sel && r.disponiveis.length > 1 && idi.seletorVisivel !== false) {
        limpar(sel);
        r.disponiveis.forEach(function (id) {
          var o = criar('option', null, I18n.rotuloDoIdioma(id));
          o.value = id;
          if (id === r.idioma) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { I18n.trocarIdioma(sel.value, { chaveSalva: PREFIXO + ':idioma' }); });
        caixa.hidden = false;
      }
      return r;
    });
  }

  function titulo(chave) {
    var marca = I18n.t('site.tituloBase');
    document.title = tr(chave) + (marca && marca !== 'site.tituloBase' ? ' — ' + marca : '');
  }

  /* ------------------------------------------------------------------ ENTRAR */

  function lerTokenDoFragmento() {
    var m = /(?:^#|&)t=([^&]+)/.exec(location.hash || '');
    if (!m) return '';
    var t = '';
    try { t = decodeURIComponent(m[1]); } catch (e) { t = ''; }
    /* Fora da barra de endereço, do histórico e de qualquer cópia da URL. */
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sem history */ }
    return t;
  }

  function iniciarConfirmar(token) {
    var ehConvite = token.indexOf('cv_') === 0;
    var versoes = estado && estado.versoes ? estado.versoes : { privacidade: 1, termos: 1 };
    var aceiteVisivel = ehConvite;
    var precisaSenha = false;
    $('titulo').textContent = tr(ehConvite ? 'acesso.convitePessoaTitulo' : 'acesso.confirmarTitulo');
    $('confirmar-texto').textContent = tr(ehConvite ? 'acesso.confirmarConvite' : 'acesso.confirmarTexto');
    montarAceite($('aceite-rotulo'));
    mostrar('bloco-aceite', aceiteVisivel);
    mostrar('bloco-nova-senha', false);
    mostrar('form-confirmar', true);
    $('confirmar-botao').textContent = tr('acesso.confirmarBotao');
    $('form-confirmar').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var corpo = { token: token };
      if (aceiteVisivel) {
        if (!$('aceite').checked) { dizer('confirmar-estado', tr('acesso.aceiteObrigatorio'), true); $('aceite').focus(); return; }
        corpo.aceite = true;
        corpo.versoes = versoes;
      }
      if (precisaSenha) corpo.senha = $('nova-senha').value;
      var botao = $('confirmar-botao');
      botao.disabled = true;
      dizer('confirmar-estado', tr('acesso.entrando'));
      api(ehConvite ? '/api/auth/convite' : '/api/auth/link', { metodo: 'POST', corpo: corpo }).then(function (r) {
        if (r.status === 200) { location.replace(destinoDaUrl()); return; }
        botao.disabled = false;
        var codigo = r.corpo && r.corpo.codigo;
        if (codigo === 'consentimento-necessario' || codigo === 'termos-mudaram') {
          if (r.corpo.versoes) versoes = r.corpo.versoes;
          aceiteVisivel = true;
          mostrar('bloco-aceite', true);
          $('aceite').checked = false;
          $('aceite').focus();
        } else if (codigo === 'senha-necessaria') {
          precisaSenha = true;
          var minimo = (r.corpo.params && r.corpo.params.minimo) || r.corpo.minimo || 12;
          $('nova-senha-dica').textContent = tr('acesso.definirSenhaDica', { minimo: minimo });
          mostrar('bloco-nova-senha', true);
          $('nova-senha').focus();
        }
        dizer('confirmar-estado', mensagemDe(r), true);
      });
    });
  }

  function iniciarEntrar() {
    titulo('acesso.entrarTitulo');
    var token = lerTokenDoFragmento();
    if (token) { mostrar('carregando', false); iniciarConfirmar(token); return; }

    mostrar('carregando', false);
    if (estado.modo === 'publico') { mostrar('bloco-publico', true); return; }
    if (estado.sessao && estado.sessao.papel !== 'anonimo') {
      mostrar('bloco-dentro', true);
      $('sair-botao').addEventListener('click', function () {
        api('/api/auth/sair', { metodo: 'POST', corpo: {} }).then(function () { location.reload(); });
      });
      return;
    }
    if (!estado.contas) { mostrar('bloco-indisponivel', true); return; }

    var link = estado.emailAtivo;
    mostrar('form-entrar', link);
    mostrar('bloco-sem-email', !link && !estado.senha);
    mostrar('form-senha', estado.senha === true);
    mostrar('bloco-cadastro', estado.cadastroAberto === true);
    if (precisaDeTurnstile()) ligarTurnstile(estado.turnstile.siteKey);
    var viaTurnstile = function () { return precisaDeTurnstile() ? { turnstile: turnstile.token } : {}; };
    var exigeToken = function (idEstado) {
      if (precisaDeTurnstile() && !turnstile.token) { dizer(idEstado, tr('acesso.aguardeAVerificacao'), true); return false; }
      return true;
    };

    $('form-entrar').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!exigeToken('entrar-estado')) return;
      var botao = $('entrar-botao');
      botao.disabled = true;
      dizer('entrar-estado', tr('acesso.enviando'));
      api('/api/auth/entrar', { metodo: 'POST', corpo: Object.assign({ email: $('email').value }, viaTurnstile()) }).then(function (r) {
        botao.disabled = false;
        renovarTurnstile();
        if (r.status === 200) { dizer('entrar-estado', tr('acesso.linkEnviado')); return; }
        dizer('entrar-estado', mensagemDe(r), true);
      });
    });

    $('form-senha').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!exigeToken('senha-estado')) return;
      var botao = $('senha-botao');
      botao.disabled = true;
      dizer('senha-estado', tr('acesso.entrando'));
      api('/api/auth/entrar', { metodo: 'POST', corpo: Object.assign({ email: $('senha-email').value, senha: $('senha').value }, viaTurnstile()) }).then(function (r) {
        if (r.status === 200) { location.replace(destinoDaUrl()); return; }
        botao.disabled = false;
        renovarTurnstile();
        dizer('senha-estado', mensagemDe(r), true);
      });
    });
  }

  /* ---------------------------------------------------------------- CADASTRO */

  function iniciarCadastro() {
    titulo('acesso.cadastroTitulo');
    mostrar('carregando', false);
    if (estado.modo !== 'cadastro' || !estado.cadastroAberto) { mostrar('bloco-fechado', true); return; }
    if (estado.sessao && estado.sessao.papel !== 'anonimo') { mostrar('bloco-dentro', true); return; }
    montarAceite($('aceite-rotulo'));
    mostrar('bloco-senha', estado.senhaNoCadastro === true);
    mostrar('form-cadastro', true);
    ligarTurnstile(estado.turnstile.siteKey);
    var versoes = estado.versoes || { privacidade: 1, termos: 1 };

    $('form-cadastro').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!$('aceite').checked) { dizer('cadastro-estado', tr('acesso.aceiteObrigatorio'), true); $('aceite').focus(); return; }
      if (!turnstile.token) { dizer('cadastro-estado', tr('acesso.aguardeAVerificacao'), true); return; }
      var corpo = { email: $('email').value, nome: $('nome').value, aceite: true, versoes: versoes, turnstile: turnstile.token };
      if (estado.senhaNoCadastro) corpo.senha = $('senha').value;
      var botao = $('cadastro-botao');
      botao.disabled = true;
      dizer('cadastro-estado', tr('acesso.enviando'));
      api('/api/auth/cadastro', { metodo: 'POST', corpo: corpo }).then(function (r) {
        renovarTurnstile();
        if (r.status === 200) {
          mostrar('form-cadastro', false);
          var chave = estado.metodo === 'email-e-senha' && estado.senhaNoCadastro ? 'acesso.cadastroFeitoSenha'
            : (estado.aprovacaoManual ? 'acesso.cadastroFeitoAprovacao' : 'acesso.cadastroFeito');
          $('cadastro-feito').textContent = tr(chave);
          mostrar('bloco-feito', true);
          return;
        }
        botao.disabled = false;
        if (r.corpo && r.corpo.codigo === 'termos-mudaram' && r.corpo.versoes) versoes = r.corpo.versoes;
        dizer('cadastro-estado', mensagemDe(r), true);
      });
    });
  }

  /* ------------------------------------------------------------------- CONTA */

  function iniciarConta() {
    titulo('acesso.contaTitulo');
    api('/api/conta/eu').then(function (r) {
      mostrar('carregando', false);
      if (r.status === 401) { location.replace('entrar.html?voltar=' + encodeURIComponent('conta.html')); return; }
      if (r.status !== 200) { dizer('conta-erro', mensagemDe(r), true); mostrar('conta-erro', true); return; }
      var eu = r.corpo;
      if (eu.papel !== 'espectador') { mostrar('bloco-equipe', true); return; }
      mostrar('conta-tudo', true);
      $('dado-email').textContent = eu.email;
      $('nome').value = eu.nome || '';
      $('dado-desde').textContent = I18n.data(eu.criadoEm * 1000, 'curta');
      pintarTextos(eu);
      $('sessoes-n').textContent = tr('acesso.sessoesAtivas', { n: eu.sessoesAtivas });
    });

    function pintarTextos(eu) {
      var lista = $('textos-lista');
      limpar(lista);
      var nomes = { privacidade: 'legal.privacidadeTitulo', termos: 'legal.termosTitulo' };
      eu.consentimentos.forEach(function (c) {
        if (!nomes[c.tipo]) return;
        var li = criar('li', null, tr('acesso.aceitaEm', { texto: tr(nomes[c.tipo]), versao: c.versao, data: I18n.data(c.aceitoEm * 1000, 'curta') }));
        lista.appendChild(li);
      });
      var pend = eu.pendentes || [];
      mostrar('bloco-pendente', pend.length > 0);
      if (pend.length) {
        $('pendente-botao').onclick = function () {
          api('/api/conta/eu', { metodo: 'PUT', corpo: { aceite: true, versoes: eu.versoes } }).then(function (r) {
            if (r.status === 200) { location.reload(); return; }
            dizer('pendente-estado', mensagemDe(r), true);
          });
        };
      }
    }

    $('form-nome').addEventListener('submit', function (ev) {
      ev.preventDefault();
      api('/api/conta/eu', { metodo: 'PUT', corpo: { nome: $('nome').value } }).then(function (r) {
        dizer('nome-estado', r.status === 200 ? tr('acesso.salvo') : mensagemDe(r), r.status !== 200);
      });
    });
    $('sair-botao').addEventListener('click', function () {
      api('/api/auth/sair', { metodo: 'POST', corpo: {} }).then(function () { location.replace('entrar.html'); });
    });
    $('sair-todos-botao').addEventListener('click', function () {
      api('/api/auth/sair', { metodo: 'POST', corpo: { todas: true } }).then(function () { location.replace('entrar.html'); });
    });
    $('exportar-botao').addEventListener('click', function () {
      api('/api/conta/exportar').then(function (r) {
        if (r.status !== 200) { dizer('exportar-estado', mensagemDe(r), true); return; }
        var blob = new Blob([JSON.stringify(r.corpo, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'meus-dados.json';   /* i18n-ignorar: nome de arquivo (dado) */
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        dizer('exportar-estado', '');
      });
    });
    $('form-excluir').addEventListener('submit', function (ev) {
      ev.preventDefault();
      api('/api/conta/excluir', { metodo: 'POST', corpo: { email: $('excluir-email').value } }).then(function (r) {
        if (r.status === 200) {
          mostrar('conta-tudo', false);
          $('excluida-aviso').textContent = tr('acesso.contaExcluida');
          mostrar('bloco-excluida', true);
          return;
        }
        dizer('excluir-estado', mensagemDe(r), true);
      });
    });
  }

  /* ------------------------------------------------------------------- LEGAL */

  var SECOES = { privacidade: { n: 9, titulo: 'legal.privacidadeTitulo' }, termos: { n: 7, titulo: 'legal.termosTitulo' } };

  /* O texto do cliente (por idioma, parágrafos separados por linha em branco) vence o
   * modelo; o modelo é o dos catálogos, com os campos do cliente preenchidos. */
  function iniciarLegal() {
    var tipo = document.body.getAttribute('data-tipo');
    var def = SECOES[tipo];
    titulo(def.titulo);
    $('titulo').textContent = tr(def.titulo);
    api('/api/legal').then(function (r) {
      mostrar('carregando', false);
      var doc = r.status === 200 && r.corpo.documentos ? r.corpo.documentos[tipo] : { versao: 1, campos: {}, textos: {} };
      var padroes = (r.corpo && r.corpo.padroes) || {};
      var campos = doc.campos || {};
      var params = {
        controlador: campos.controlador || padroes.controlador || tr('site.tituloBase'),
        contato: campos.contato || tr('legal.contatoPadrao'),
        retencao: campos.retencao || tr('legal.retencaoPadrao')
      };
      var corpo = $('legal-corpo');
      limpar(corpo);
      var idioma = I18n.idioma ? I18n.idioma() : '';
      var padrao = I18n.instancia().padrao;
      var proprio = (doc.textos && (doc.textos[idioma] || doc.textos[padrao])) || '';
      if (proprio) {
        proprio.split(/\n{2,}/).forEach(function (p) { if (p.trim()) corpo.appendChild(criar('p', null, p.trim())); });
      } else {
        for (var i = 1; i <= def.n; i++) {
          corpo.appendChild(criar('h2', null, tr('legal.' + (tipo === 'privacidade' ? 'priv' : 'termos') + i + 'T')));
          corpo.appendChild(criar('p', null, tr('legal.' + (tipo === 'privacidade' ? 'priv' : 'termos') + i, params)));
        }
      }
      $('legal-versao').textContent = tr('legal.versaoDoTexto', { versao: doc.versao });
      mostrar('legal-versao', true);
    });
  }

  /* -------------------------------------------------------------------- início */

  carregarIdioma().then(function () {
    if (pagina === 'legal') { iniciarLegal(); return; }
    if (pagina === 'conta') { iniciarConta(); return; }
    return api('/api/auth/estado').then(function (r) {
      estado = r.status === 200 ? r.corpo : { modo: 'privado', contas: false, sessao: { papel: 'anonimo' }, turnstile: { siteKey: '' }, versoes: { privacidade: 1, termos: 1 } };
      if (pagina === 'entrar') iniciarEntrar();
      else if (pagina === 'cadastro') iniciarCadastro();
    });
  });
})();
