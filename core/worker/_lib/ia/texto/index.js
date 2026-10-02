/* ia/texto/index.js — o registro dos adaptadores de texto: UM arquivo por provedor, o resto só conhece esta função.
 *
 * Contrato de um adaptador: `chamar({ fetch, chave, modelo, sistema, usuario, maxTokens, binding?, contaId? })`
 *   -> { texto, entradaTokens, saidaTokens, recusou, cortou }   ou lança ErroIA. */
import * as anthropic from './anthropic.js';
import * as openai from './openai.js';
import * as gemini from './gemini.js';
import * as workersAi from './workers-ai.js';
import { ErroIA } from '../erros.js';

export const ADAPTADORES = Object.freeze({ anthropic, openai, gemini, 'workers-ai': workersAi });

export function adaptadorDeTexto(id) {
  const a = Object.prototype.hasOwnProperty.call(ADAPTADORES, id) ? ADAPTADORES[id] : null;
  if (!a) throw new ErroIA('ia-provedor-invalido', { detalhe: String(id) });
  return a;
}
