/* ia/texto/http.js — o `fetch` com tempo-limite e a tradução de falha HTTP em ErroIA (compartilhado por todos os adaptadores).
 *
 * 401/403 e 400 NÃO são retentáveis (chave errada, pedido torto: repetir só gasta). 408/409/425/429 e 5xx são. A chave nunca
 * entra na mensagem: o `detalhe` sai do corpo de erro do provedor, passado por `sanear`. */
import { ErroIA } from '../erros.js';

export const TEMPO_LIMITE_MS = 90000;

const RETENTAVEIS = new Set([408, 409, 425, 429]);

export function detalheDeErro(corpo) {
  if (!corpo) return '';
  const e = corpo.error || corpo.errors || corpo;
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map((x) => (x && x.message) || String(x)).join('; ');
  return (e && (e.message || e.msg)) || '';
}

/* Faz a chamada e devolve { status, corpo (JSON ou null), texto }. Lança ErroIA se a rede falhar ou o status não for 2xx. */
export async function pedir(fetchFn, url, init, { tempoMs = TEMPO_LIMITE_MS } = {}) {
  const f = fetchFn || globalThis.fetch;
  const controle = typeof AbortController === 'function' ? new AbortController() : null;
  const relogio = controle ? setTimeout(() => controle.abort(), tempoMs) : null;
  let r;
  try {
    r = await f(url, controle ? Object.assign({}, init, { signal: controle.signal }) : init);
  } catch (e) {
    throw new ErroIA('ia-provedor-inacessivel', { detalhe: e && e.name === 'AbortError' ? 'tempo esgotado' : (e && e.message) || 'sem resposta', retentavel: true });
  } finally {
    if (relogio) clearTimeout(relogio);
  }
  const texto = await r.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch (e) { corpo = null; }
  if (!r.ok) {
    throw new ErroIA('ia-provedor-recusou', {
      status: r.status, detalhe: detalheDeErro(corpo) || texto.slice(0, 200),
      retentavel: r.status >= 500 || RETENTAVEIS.has(r.status)
    });
  }
  return { status: r.status, corpo, texto };
}

export function exigirJson(resposta) {
  if (resposta.corpo === null || typeof resposta.corpo !== 'object') {
    throw new ErroIA('ia-provedor-inacessivel', { status: resposta.status, detalhe: 'a resposta não é JSON', retentavel: true });
  }
  return resposta.corpo;
}
