/* sw.js — GERADO por scripts/aplicar-config.mjs a partir de config/site.json (recursos.pwaCacheDoShell).
 * Não edite à mão. Leia docs/home-e-colecoes.md antes de ligar. */
'use strict';
var PREFIXO_DO_CACHE = 'tm-casca-';
/* Desligado: apaga o que este service worker guardou e se desinstala. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n.indexOf(PREFIXO_DO_CACHE) === 0; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.registration.unregister(); }));
});
