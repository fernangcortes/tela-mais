/* _lib/mensagens.js — as mensagens de erro das APIs, no idioma de quem pediu.
 *
 * Os handlers devolvem `{ codigo, params, mensagem, erro }` (ver `erro()` em
 * sessao.js). O front traduz pelo `codigo` com o catálogo dele; esta função
 * cuida de quem NÃO tem front por trás (curl, scripts de carga, outra mesa): ela
 * reescreve `mensagem` (e `erro`, o apelido antigo) no idioma do Accept-Language,
 * entre os `idiomas.disponiveis` do cliente, e cai no `idiomas.padrao`.
 *
 * Os catálogos entram empacotados no Worker (import JSON, como config/site.json):
 * são os três de fábrica. Idioma extra do cliente (config/locales/) vale para o
 * site; para as APIs, sem catálogo próprio, cai no padrão — e o `codigo` continua
 * lá para quem quiser traduzir do outro lado. */
import AppI18n from '../../site/i18n.js';
import { CATALOGOS_DE_FABRICA as CATALOGOS } from './i18n-catalogos.mjs';

/* Os textos que o cliente trocou (config.textos[idioma]) valem também aqui. */
function overridesDe(config, idioma) {
  const t = config && config.textos && config.textos[idioma];
  return t && typeof t === 'object' ? t : {};
}

export function idiomaDoPedido(request, config) {
  const idi = (config && config.idiomas) || {};
  const disponiveis = Array.isArray(idi.disponiveis) && idi.disponiveis.length ? idi.disponiveis : ['pt-BR'];
  const padrao = idi.padrao || 'pt-BR';
  const cab = request && request.headers ? request.headers.get('accept-language') : '';
  return { idioma: AppI18n.detectarDoCabecalho(cab, disponiveis, padrao), padrao };
}

/* Só mexe em resposta JSON de erro que traga `codigo`; o resto passa intacto. */
export async function localizarResposta(resposta, request, config) {
  if (!resposta || resposta.status < 400) return resposta;
  const tipo = resposta.headers.get('content-type') || '';
  if (!/json/i.test(tipo)) return resposta;
  let corpo;
  try { corpo = await resposta.clone().json(); } catch (e) { return resposta; }
  if (!corpo || typeof corpo.codigo !== 'string') return resposta;

  const { idioma, padrao } = idiomaDoPedido(request, config);
  const inst = AppI18n.criar({
    idioma, padrao,
    catalogos: CATALOGOS,
    overrides: { [idioma]: overridesDe(config, idioma), [padrao]: overridesDe(config, padrao) }
  });
  const chave = 'api.' + corpo.codigo;
  if (!inst.tem(chave)) return resposta;
  const mensagem = inst.t(chave, corpo.params);
  const novo = Object.assign({}, corpo, { mensagem, erro: mensagem });
  const cab = new Headers(resposta.headers);
  cab.set('content-language', idioma);
  return new Response(JSON.stringify(novo), { status: resposta.status, headers: cab });
}
