/* rotas.js — caminho × método -> handler. Só despacho; QUEM ENTRA está em
 * permissoes.js. As duas tabelas têm que ter as mesmas chaves (teste de matriz).
 *
 * Os handlers mantêm a assinatura que tinham no Pages: `({ request, env, data,
 * waitUntil })`, com `data.conta`, `data.admin` e `data.provedor` (o adaptador de vídeo) preenchidos
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
import * as authEstado from './api/auth/estado.js';
import * as authEntrar from './api/auth/entrar.js';
import * as authCadastro from './api/auth/cadastro.js';
import * as authLink from './api/auth/link.js';
import * as authConvite from './api/auth/convite.js';
import * as authSair from './api/auth/sair.js';
import * as contaEu from './api/conta/eu.js';
import * as contaExportar from './api/conta/exportar.js';
import * as contaExcluir from './api/conta/excluir.js';
import * as legal from './api/legal.js';
import * as convites from './api/convites.js';
import * as espectadores from './api/espectadores.js';

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
  '/api/busca/indexar': indexar,
  '/api/auth/estado': authEstado,
  '/api/auth/entrar': authEntrar,
  '/api/auth/cadastro': authCadastro,
  '/api/auth/link': authLink,
  '/api/auth/convite': authConvite,
  '/api/auth/sair': authSair,
  '/api/conta/eu': contaEu,
  '/api/conta/exportar': contaExportar,
  '/api/conta/excluir': contaExcluir,
  '/api/legal': legal,
  '/api/convites': convites,
  '/api/espectadores': espectadores
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
