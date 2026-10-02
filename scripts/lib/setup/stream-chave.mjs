/* scripts/lib/setup/stream-chave.mjs — cria a chave de assinatura do Cloudflare Stream (POST /stream/keys).
 * Roda no computador da pessoa com o token que já está no .env: o agente não vê o token nem a chave (a resposta
 * vai direto para o .env e nunca é impressa). Sem ela, os modos cadastro e privado não conseguem proteger o vídeo. */
const API = 'https://api.cloudflare.com/client/v4';

export const VARIAVEIS_DA_CHAVE = Object.freeze(['CLOUDFLARE_STREAM_KEY_ID', 'CLOUDFLARE_STREAM_KEY_JWK']);

export async function criarChaveDeAssinatura({ fetch: f = fetch, accountId, token }) {
  let r;
  try {
    r = await f(`${API}/accounts/${encodeURIComponent(accountId)}/stream/keys`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
    });
  } catch {
    return { ok: false, motivo: 'sem-rede' };
  }
  let corpo = null;
  try { corpo = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok || !corpo || !corpo.success || !corpo.result || !corpo.result.id || !corpo.result.jwk) {
    return { ok: false, motivo: r.status === 401 || r.status === 403 ? 'sem-permissao' : 'recusada', status: r.status };
  }
  return { ok: true, id: String(corpo.result.id), jwk: String(corpo.result.jwk) };
}

export function explicarFalhaDaChave(motivo) {
  if (motivo === 'sem-rede') return 'não consegui falar com a Cloudflare (internet?). Tente de novo em instantes.';
  if (motivo === 'sem-permissao') return 'a Cloudflare recusou o token. Ele precisa da permissão "Stream: Edit" (Conta, Stream, Editar) e valer para a sua conta. Crie um token novo com essa permissão e rode: node scripts/setup.mjs video';
  return 'a Cloudflare não criou a chave. Confira o ID da conta e o token e rode de novo: node scripts/setup.mjs video --criar-chave-assinatura';
}
