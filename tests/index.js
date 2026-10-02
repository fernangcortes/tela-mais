// Ponto de entrada para `node --test tests/` (a pasta): o Node 22 trata o
// argumento como módulo e procura tests/index.js. Carrega todos os testes.
// O comando oficial continua sendo `npm test` (que roda `node --test`).
'use strict';
require('./catalogo.test.js');
import('./anti-marca.test.js');
import('./worker-matriz.test.js');
import('./worker-seguranca.test.js');
import('./i18n.test.js');
import('./provedores-contrato.test.js');
import('./provedores-worker.test.js');
import('./provedores-bunny.test.js');
import('./provedores-cloudflare-stream.test.js');
import('./provedores-scripts.test.js');
import('./contas-d1.test.js');
import('./contas-acesso.test.js');
import('./contas-midia-assinada.test.js');
import('./contas-site.test.js');
import('./contas-paginas.test.js');
import('./player-guardiao.test.js');
import('./player-fundo.test.js');
import('./home-blocos.test.js');
import('./home-worker.test.js');
import('./home-minha-lista.test.js');
import('./home-pwa.test.js');
import('./home-config.test.js');
import('./home-site.test.js');
import('./home-mesa.test.js');
