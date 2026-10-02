/* rotas.js — caminho × método -> handler. Só despacho; QUEM ENTRA está em
 * permissoes.js. As duas tabelas têm que ter as mesmas chaves (teste de matriz).
 *
 * Os handlers mantêm a assinatura que tinham no Pages: `({ request, env, data,
 * waitUntil })`, com `data.conta`, `data.admin` e `data.bunny` preenchidos
 * pelo middleware. Importação estática de tudo: o bundle é um arquivo só e não
 * há carga preguiçosa para dar errado em produção. */
import * as login from './api/login.js';
import * as catalogo from './api/catalogo.js';
import * as conta from './api/conta.js';
import * as contas from './api/contas.js';
import * as autorizacoes from './api/autorizacoes.js';
import * as historico from './api/historico.js';
import * as midia from './api/midia.js';
import * as uploadToken from './api/upload-token.js';
import * as fala from './api/busca/fala.js';
import * as sentido from './api/busca/sentido.js';
import * as indexar from './api/busca/indexar.js';

const MODULOS = {
  '/api/login': login,
  '/api/catalogo': catalogo,
  '/api/conta': conta,
  '/api/contas': contas,
  '/api/autorizacoes': autorizacoes,
  '/api/historico': historico,
  '/api/midia': midia,
  '/api/upload-token': uploadToken,
  '/api/busca/fala': fala,
  '/api/busca/sentido': sentido,
  '/api/busca/indexar': indexar
};

/* Método HTTP -> função exportada. HEAD cai no GET do handler. */
const NOME = { GET: 'onRequestGet', POST: 'onRequestPost', PUT: 'onRequestPut', DELETE: 'onRequestDelete' };

export function handlerDe(caminho, metodo) {
  const modulo = MODULOS[caminho];
  const nome = NOME[metodo];
  return modulo && nome && typeof modulo[nome] === 'function' ? modulo[nome] : null;
}

/* Todas as rotas de API registradas, com os métodos que implementam. É o que o
 * teste de matriz enumera. */
export function rotasRegistradas() {
  const saida = [];
  for (const caminho of Object.keys(MODULOS)) {
    for (const metodo of Object.keys(NOME)) {
      if (typeof MODULOS[caminho][NOME[metodo]] === 'function') saida.push({ caminho, metodo });
    }
  }
  return saida;
}
