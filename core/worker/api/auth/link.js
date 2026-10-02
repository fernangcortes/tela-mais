/* POST /api/auth/link  { token, aceite?, versoes?, senha? }
 *
 * Confirma o LINK MÁGICO: uso único, 15 minutos. O link que a pessoa recebe abre
 * uma página (GET, que não gasta nada: pré-visualizadores de e-mail e de mensageiro
 * não queimam o link); o gasto é ESTE POST, do botão "Entrar".
 *
 * Link reutilizado, vencido, inventado ou de conta bloqueada: todos `link-invalido`.
 * Precisa aceitar os textos vigentes? Responde 409 `consentimento-necessario` SEM
 * gastar o link: a página mostra a caixa e reenvia. Ver contas-fluxo.js. */
import { confirmarToken } from '../../_lib/contas-fluxo.js';

export function onRequestPost(contexto) {
  return confirmarToken(Object.assign({ tipoEsperado: 'ml_' }, contexto));
}
