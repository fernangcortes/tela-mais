/* _lib/email.js — o e-mail transacional (link de acesso, convite), por adaptador.
 *
 *   'nenhum'            PADRÃO. Nada é enviado: o administrador copia o link (tela
 *                       Acesso do /admin) e o manda por WhatsApp, como quiser. É o que
 *                       faz o site rodar 100% no plano grátis sem domínio de e-mail.
 *   'resend'            POST https://api.resend.com/emails (fetch, sem biblioteca).
 *                       Segredo RESEND_API_KEY; remetente na variável EMAIL_REMETENTE
 *                       (`Nome <aviso@seu-dominio.com>`, domínio verificado no Resend).
 *   'cloudflare-email'  OPÇÃO FUTURA (Email Service da Cloudflare, ainda beta e do plano
 *                       pago): reconhecida na config, mas ainda NÃO envia — devolve
 *                       `motivo: 'cloudflare-nao-implementado'` e o fluxo cai no link
 *                       copiável, como o 'nenhum'.
 *
 * `enviarEmail` NUNCA lança e nunca é motivo de falhar um pedido: devolve
 * `{ enviado, adaptador, motivo? }`. Quem chama decide o que dizer à pessoa (sem
 * revelar se o e-mail existe) e o que mostrar ao administrador. O endereço do
 * destinatário não é registrado em log. */
import AppI18n from '../../site/i18n.js';
import { CATALOGOS_DE_FABRICA } from './i18n-catalogos.mjs';
import { idiomaDoPedido } from './mensagens.js';

export const ADAPTADORES = ['nenhum', 'resend', 'cloudflare-email'];

export function adaptadorDe(config) {
  const a = config && config.acesso && config.acesso.email && config.acesso.email.adaptador;
  return ADAPTADORES.indexOf(a) >= 0 ? a : 'nenhum';
}

/* Há como entregar e-mail de verdade neste momento? */
export function emailDisponivel(config, env) {
  return adaptadorDe(config) === 'resend' && Boolean(env && env.RESEND_API_KEY && env.EMAIL_REMETENTE);
}

const SITE_URL = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/i;

/* Endereço do site: APP_SITE_URL, ou a origem do pedido. */
export function baseDoSite(env, request) {
  const v = env && env.APP_SITE_URL;
  if (typeof v === 'string' && v.length < 200 && SITE_URL.test(v)) return v.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

/* O endereço que a pessoa abre. O token vai no FRAGMENTO (#): não viaja ao
 * servidor, não entra em log nem em Referer, e o clique em si não consome nada —
 * quem gasta é o POST do botão "Entrar", e isso impede que um pré-visualizador de
 * link (cliente de e-mail, mensageiro) queime o link de uso único. */
export function linkDeAcesso(env, request, token) {
  return baseDoSite(env, request) + '/entrar.html#t=' + encodeURIComponent(token);
}

/* Assunto e texto, no idioma do pedido. `tipo`: 'link' | 'convite'. */
export function montarMensagem(tipo, { link, request, config, minutos }) {
  const { idioma, padrao } = idiomaDoPedido(request, config);
  const marca = (config && config.marca) || {};
  const inst = AppI18n.criar({
    idioma, padrao, catalogos: CATALOGOS_DE_FABRICA,
    globais: { marca: marca.nome || '', marcaCurta: marca.nomeCurto || marca.nome || '', organizacao: marca.organizacao || '' }
  });
  return tipo === 'convite'
    ? { assunto: inst.t('email.conviteAssunto'), texto: inst.t('email.conviteTexto', { link, minutos }) }
    : { assunto: inst.t('email.linkAssunto'), texto: inst.t('email.linkTexto', { link, minutos }) };
}

export async function enviarEmail(env, config, { para, assunto, texto }) {
  const adaptador = adaptadorDe(config);
  if (adaptador === 'nenhum') return { enviado: false, adaptador, motivo: 'sem-adaptador' };
  if (adaptador === 'cloudflare-email') return { enviado: false, adaptador, motivo: 'cloudflare-nao-implementado' };
  if (!env.RESEND_API_KEY || !env.EMAIL_REMETENTE) return { enviado: false, adaptador, motivo: 'resend-sem-credenciais' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_REMETENTE, to: [para], subject: assunto, text: texto })
    });
    return r.ok ? { enviado: true, adaptador } : { enviado: false, adaptador, motivo: 'resend-recusou-' + r.status };
  } catch (e) {
    return { enviado: false, adaptador, motivo: 'resend-inacessivel' };
  }
}
