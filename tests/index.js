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
