/* core/worker/_lib/i18n-catalogos.mjs — os catálogos de fábrica, empacotados como JSON.
 *
 * Um ponto só que importa core/locales/{pt-BR,en,es}.json (import JSON do ESM, que o
 * wrangler/esbuild empacota no Worker e o Node 22 lê direto), para o Worker
 * (mensagens de erro das APIs), os scripts (aplicar-config) e os testes. O que o
 * CLIENTE acrescenta (config/locales, config.textos) entra por cima, em quem usa. */
import AppI18n from '../../site/i18n.js';
import ptBR from '../../locales/pt-BR.json' with { type: 'json' };
import en from '../../locales/en.json' with { type: 'json' };
import es from '../../locales/es.json' with { type: 'json' };

export const CATALOGOS_DE_FABRICA = { 'pt-BR': ptBR, en, es };

/* O texto de fábrica de uma chave, num idioma (cai no pt-BR se faltar). */
export function textoDeFabrica(chave, idioma, params) {
  const inst = AppI18n.criar({ idioma, padrao: idioma, catalogos: CATALOGOS_DE_FABRICA });
  return inst.t(chave, params);
}
