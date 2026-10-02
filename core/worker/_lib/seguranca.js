/* _lib/seguranca.js — cabeçalhos de segurança de TODAS as respostas do Worker.
 *
 * A mesma política vai em `core/site/_headers`, para os arquivos estáticos que
 * o Cloudflare serve sem passar pelo Worker; um teste confere que os dois
 * dizem a mesma coisa. O que muda por requisição: `frame-ancestors`.
 *   - páginas e estáticos: 'self'. O /admin mostra o site dentro de um
 *     <iframe> da mesma origem (modo mesa, `?mesa=1`); ninguém de fora enquadra.
 *   - /api/*: 'none'. Resposta de API nunca é para ser exibida num quadro.
 *
 * O script inline do index.html (a camada de abertura) entra na CSP pelo HASH,
 * não por 'unsafe-inline'. Se alguém editar aquele bloco, o teste
 * `tests/worker-seguranca.test.js` falha e diz o hash novo. */

/* sha256 do conteúdo do <script> inline de core/site/index.html. */
export const HASH_SCRIPT_INLINE = 'sha256-pC8lL4UeLJne9z7wZYaoWQLHpQbyzO358yhEUQELSYQ=';

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/* Provedor de vídeo (Bunny, até o M4 ter adaptadores): capas, HLS, MP4 e
 * legendas vêm de *.b-cdn.net (ou do domínio próprio da pull zone, vindo de
 * BUNNY_PULLZONE); o player embutido, de player.mediadelivery.net; o Player.js
 * (capítulos), de assets.mediadelivery.net; o envio TUS do /admin, de
 * video.bunnycdn.com. */
export function politicaDeConteudo(env, ancestrais) {
  const pz = env && HOST.test(String(env.BUNNY_PULLZONE || '')) ? ' https://' + env.BUNNY_PULLZONE : '';
  const cdn = 'https://*.b-cdn.net' + pz;
  return [
    "default-src 'self'",
    "script-src 'self' '" + HASH_SCRIPT_INLINE + "' https://assets.mediadelivery.net",
    /* 'unsafe-inline' só em estilo: o app.js usa `style=` em elementos criados. */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: " + cdn,
    "media-src 'self' blob: " + cdn,
    "connect-src 'self' " + cdn + ' https://video.bunnycdn.com',
    'frame-src https://player.mediadelivery.net https://iframe.mediadelivery.net',
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'frame-ancestors ' + ancestrais
  ].join('; ');
}

export function cabecalhosDeSeguranca(env, { api = false } = {}) {
  const ancestrais = api ? "'none'" : "'self'";
  return {
    'content-security-policy': politicaDeConteudo(env, ancestrais),
    'x-content-type-options': 'nosniff',
    'x-frame-options': api ? 'DENY' : 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    /* HSTS: o navegador só honra em HTTPS; em http://localhost é ignorado. */
    'strict-transport-security': 'max-age=31536000'
  };
}

/* Devolve a resposta com os cabeçalhos por cima. Respostas de redirecionamento
 * e de `Response.error()` têm cabeçalhos imutáveis: por isso a cópia. */
export function comCabecalhos(resposta, env, opcoes) {
  const saida = new Response(resposta.body, resposta);
  const extras = cabecalhosDeSeguranca(env, opcoes);
  for (const k of Object.keys(extras)) saida.headers.set(k, extras[k]);
  return saida;
}
