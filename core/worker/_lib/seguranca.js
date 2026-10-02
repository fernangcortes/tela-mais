/* _lib/seguranca.js — cabeçalhos de segurança de TODAS as respostas do Worker.
 *
 * `core/site/_headers` leva a mesma política SEM os hosts de provedor, para os
 * arquivos estáticos que o Cloudflare serve sem passar pelo Worker (JS, CSS,
 * imagens: nenhum carrega mídia); um teste confere que ele é essa política
 * neutra. As páginas que carregam mídia passam pelo Worker. O que muda por requisição: `frame-ancestors`.
 *   - páginas e estáticos: 'self'. O /admin mostra o site dentro de um
 *     <iframe> da mesma origem (modo mesa, `?mesa=1`); ninguém de fora enquadra.
 *   - /api/*: 'none'. Resposta de API nunca é para ser exibida num quadro.
 *
 * O script inline do index.html (a camada de abertura) entra na CSP pelo HASH,
 * não por 'unsafe-inline'. Se alguém editar aquele bloco, o teste
 * `tests/worker-seguranca.test.js` falha e diz o hash novo. */

import { hostsDeMidia } from './provedores/index.js';

/* sha256 do conteúdo do <script> inline de core/site/index.html. */
export const HASH_SCRIPT_INLINE = 'sha256-pC8lL4UeLJne9z7wZYaoWQLHpQbyzO358yhEUQELSYQ=';

/* Provedor de vídeo: capas, HLS, MP4, legendas, player embutido, Player.js e o
 * envio TUS do /admin vêm de hosts que SÓ O ADAPTADOR sabe (provedores/*.js,
 * `hostsMidia()`): a política não escreve nome de provedor nenhum. Os hosts
 * dependem da config (`video.provedor`) e do ambiente (pull zone própria,
 * subdomínio do cliente), por isso a CSP é calculada por resposta.
 *
 * `hosts` explícito (sem consultar o adaptador) serve a quem gera o arquivo
 * estático `core/site/_headers`: ele é neutro (sem host de provedor), porque o
 * HTML que carrega mídia (`/`, `/index.html`, `/admin`) passa SEMPRE pelo
 * Worker (run_worker_first) e leva a política completa. */
const SEM_HOSTS = { img: [], media: [], connect: [], frame: [], script: [] };

export function politicaDeConteudo(env, ancestrais, { config = null, hosts = null } = {}) {
  const h = hosts || hostsDeMidia(config, env);
  const lista = (diretiva, base) => [base].concat(h[diretiva] || []).join(' ');
  return [
    "default-src 'self'",
    'script-src ' + lista('script', "'self' '" + HASH_SCRIPT_INLINE + "'"),
    /* 'unsafe-inline' só em estilo: o app.js usa `style=` em elementos criados. */
    "style-src 'self' 'unsafe-inline'",
    'img-src ' + lista('img', "'self' data: blob:"),
    'media-src ' + lista('media', "'self' blob:"),
    'connect-src ' + lista('connect', "'self'"),
    /* 'self': o /admin mostra o próprio site num <iframe> (modo mesa). */
    'frame-src ' + lista('frame', "'self'"),
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'frame-ancestors ' + ancestrais
  ].join('; ');
}

export function cabecalhosDeSeguranca(env, { api = false, config = null, semProvedor = false } = {}) {
  const ancestrais = api ? "'none'" : "'self'";
  return {
    'content-security-policy': politicaDeConteudo(env, ancestrais, semProvedor ? { hosts: SEM_HOSTS } : { config }),
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
