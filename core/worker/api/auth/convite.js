/* POST /api/auth/convite  { token, aceite?, versoes?, senha? }
 *
 * Aceita um CONVITE (o link que o administrador copiou da tela Acesso, ou que o
 * e-mail trouxe; vale 7 dias, uso único). Mesmo passo final do link mágico
 * (contas-fluxo.js: confirmarToken): gasta o token, ativa a conta, grava o aceite
 * da política e dos termos e abre a sessão por cookie. */
import { confirmarToken } from '../../_lib/contas-fluxo.js';

export function onRequestPost(contexto) {
  return confirmarToken(Object.assign({ tipoEsperado: 'cv_' }, contexto));
}
