/* _lib/turnstile.js — o desafio anti-robô da Cloudflare (Turnstile), conferido no servidor.
 *
 * A chave PÚBLICA (site key) vai na página (variável TURNSTILE_SITE_KEY, não é
 * segredo); o SEGREDO (TURNSTILE_SECRET) só existe no Worker. A resposta do
 * navegador (`cf-turnstile-response`) é conferida aqui, no siteverify, a cada
 * cadastro — o token vale uma vez.
 *
 * FALHA FECHADA. Sem segredo configurado, sem token, siteverify fora do ar,
 * lento (4 s), com status de erro ou com resposta que não é JSON: a resposta é
 * "não passou". Nunca "na dúvida, deixa entrar": cadastro aberto sem anti-robô
 * vira spam em horas.
 *
 * `fetch` é o global (os testes o trocam); o corpo é form-urlencoded, como o
 * siteverify pede. */
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LIMITE_DE_TEMPO_MS = 4000;

export function turnstileConfigurado(env) {
  return Boolean(env && typeof env.TURNSTILE_SECRET === 'string' && env.TURNSTILE_SECRET.length >= 8);
}

export function chavePublicaDoTurnstile(env) {
  const k = env && env.TURNSTILE_SITE_KEY;
  return typeof k === 'string' && /^[0-9A-Za-z_-]{6,80}$/.test(k) ? k : '';
}

/* { ok, motivo }: motivo é um de 'nao-configurado' | 'ausente' | 'indisponivel' | 'recusado' | null. */
export async function verificarTurnstile(env, token, ip) {
  if (!turnstileConfigurado(env)) return { ok: false, motivo: 'nao-configurado' };
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return { ok: false, motivo: 'ausente' };
  const corpo = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip && ip !== 'desconhecido') corpo.set('remoteip', ip);
  const controle = typeof AbortController === 'function' ? new AbortController() : null;
  const relogio = controle ? setTimeout(() => controle.abort(), LIMITE_DE_TEMPO_MS) : null;
  try {
    const r = await fetch(SITEVERIFY, { method: 'POST', body: corpo, signal: controle ? controle.signal : undefined });
    if (!r || !r.ok) return { ok: false, motivo: 'indisponivel' };
    const dados = await r.json();
    return dados && dados.success === true ? { ok: true, motivo: null } : { ok: false, motivo: 'recusado' };
  } catch (e) {
    return { ok: false, motivo: 'indisponivel' };
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
