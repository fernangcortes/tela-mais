/* mesa-inicio.js — a porta da mesa: idioma primeiro, depois o resto.
 *
 * O admin.html só carrega o i18n.js e este arquivo. Aqui se escolhe o idioma de
 * quem EDITA (?idioma= na URL > a escolha guardada > o do navegador > o padrão do
 * site), baixa-se o catálogo de textos dele e, só então, entram os scripts da
 * mesa, em ordem. Assim as constantes de módulo da mesa (tabelas de rótulos,
 * filas, filtros) já nascem traduzidas, e nenhum texto sai como chave.
 *
 * A mesa oferece TODOS os idiomas que o produto traz (pt-BR, en, es), mesmo que
 * o site do cliente tenha um só: quem edita nem sempre lê o idioma do público. */
(function () {
  'use strict';
  var I18n = window.AppI18n;
  var PREFIXO = 'tm';   /* o mesmo padrão do catalogo-core; ajustado abaixo se APP_PREFIXO existir */
  if (typeof window.APP_PREFIXO === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(window.APP_PREFIXO)) PREFIXO = window.APP_PREFIXO;

  var SCRIPTS = [
    'vendor/tus.min.js', 'home-blocos.js', 'catalogo-core.js', 'indice-core.js',
    'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa-home.js', 'mesa-acesso.js',
    'mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js', 'mesa.js'
  ];

  /* Em ordem: cada <script> só entra quando o anterior terminou (async = false não
   * basta para scripts criados à mão em todos os navegadores antigos). */
  function carregar(i) {
    if (i >= SCRIPTS.length) return;
    var tag = document.createElement('script');
    tag.src = SCRIPTS[i];
    tag.async = false;
    tag.onload = function () { carregar(i + 1); };
    tag.onerror = function () { carregar(i + 1); };
    document.head.appendChild(tag);
  }

  /* O seletor de idioma da mesa: o mesmo no cartão de entrada e no menu. Trocar
   * recarrega a página (os textos são desenhados uma vez); o rascunho está guardado. */
  window.MESA_IDIOMA = {
    chave: PREFIXO + ':idioma-mesa',
    montar: function (select, idiomas, atual) {
      while (select.firstChild) select.removeChild(select.firstChild);
      idiomas.forEach(function (id) {
        var o = document.createElement('option');
        o.value = id;
        o.textContent = I18n.rotuloDoIdioma(id);
        if (id === atual) o.selected = true;
        select.appendChild(o);
      });
      select.addEventListener('change', function () { I18n.trocarIdioma(select.value, { chaveSalva: window.MESA_IDIOMA.chave }); });
    }
  };

  I18n.iniciarNoNavegador({
    chaveSalva: window.MESA_IDIOMA.chave,
    disponiveis: I18n.IDIOMAS_DE_FABRICA,
    detectar: true
  }).then(function (r) {
    window.MESA_IDIOMA.atual = r.idioma;
    window.MESA_IDIOMA.disponiveis = r.disponiveis;
    I18n.aplicarNoDocumento(document);
    var caixa = document.getElementById('idioma-entrar');
    var sel = document.getElementById('idioma-mesa-entrar');
    if (caixa && sel) { window.MESA_IDIOMA.montar(sel, r.disponiveis, r.idioma); caixa.hidden = false; }
    carregar(0);
  });
})();
