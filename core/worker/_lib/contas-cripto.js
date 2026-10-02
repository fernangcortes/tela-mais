/* _lib/contas-cripto.js — as miudezas de criptografia das contas, só WebCrypto.
 *
 * Tokens (sessão, convite, link mágico) são 32 bytes sorteados, em base64url.
 * O que vai para o banco é o SHA-256 do token (hex): quem lê o banco não
 * consegue entrar com ele. Como o token já é aleatório de 256 bits, um hash
 * rápido basta (não há o que "adivinhar" para um PBKDF2 encarecer). */

const enc = new TextEncoder();

export function paraHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function paraBase64Url(bytes) {
  let texto = '';
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* 32 bytes sorteados, 43 caracteres. `prefixo` ajuda a ler logs e a recusar o
 * tipo errado de token cedo ("ml_" link mágico, "cv_" convite, "ss_" sessão). */
export function sortearToken(prefixo = '') {
  return prefixo + paraBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function idAleatorio() {
  return paraHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256Hex(texto) {
  return paraHex(await crypto.subtle.digest('SHA-256', enc.encode(String(texto))));
}

export async function hmacHex(segredo, mensagem) {
  const chave = await crypto.subtle.importKey(
    'raw', enc.encode(String(segredo)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return paraHex(await crypto.subtle.sign('HMAC', chave, enc.encode(String(mensagem))));
}

/* Comparação sem vazar o ponto da divergência pelo tempo. */
export function iguaisTempoConstante(a, b) {
  const A = enc.encode(String(a));
  const B = enc.encode(String(b));
  let diferenca = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diferenca |= (A[i] || 0) ^ (B[i] || 0);
  return diferenca === 0;
}

/* Hash de IP/e-mail para chave de limite e para o rastro do consentimento: o
 * dado pessoal não fica em claro no banco. Sem o segredo (config quebrada), cai
 * num SHA-256 puro: pior, mas nunca grava o IP. */
export async function hashDe(env, valor) {
  const segredo = env && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32 ? env.SESSION_SECRET : null;
  const h = segredo ? await hmacHex(segredo, 'h:' + valor) : await sha256Hex('h:' + valor);
  return h.slice(0, 32);
}

export const agoraS = () => Math.floor(Date.now() / 1000);

/* E-mail em forma canônica (minúsculas, sem espaços) ou null se não parece um.
 * A checagem é de forma, não de existência: quem decide é o envio. */
const FORMA_EMAIL = /^[^\s@<>"',;:\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizarEmail(valor) {
  if (typeof valor !== 'string') return null;
  const e = valor.trim().toLowerCase();
  return e.length <= 120 && FORMA_EMAIL.test(e) ? e : null;
}

export function dominioDe(email) {
  return String(email || '').split('@')[1] || '';
}

/* "ma***@exemplo.com": para mostrar ao dono sem entregar o endereço inteiro. */
export function mascararEmail(email) {
  const [local, dominio] = String(email || '').split('@');
  if (!dominio) return '';
  return local.slice(0, 2) + '***@' + dominio;
}
