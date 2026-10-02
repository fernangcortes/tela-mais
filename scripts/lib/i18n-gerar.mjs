/* scripts/lib/i18n-gerar.mjs — textos de interface por idioma, no que o aplicar-config gera.
 *
 * Duas saídas, as duas funções puras (quem escreve em disco é aplicar-config.mjs):
 *   1. core/site/locales/<idioma>.json — o catálogo EFETIVO de cada idioma
 *      disponível: o que o produto traz (core/locales), o que o cliente
 *      acrescentou (config/locales) e os textos dele (config.textos), tudo
 *      mesclado. O navegador baixa um arquivo só e o `t()` não precisa saber de
 *      camadas. Sem build e sem etapa extra: é só JSON.
 *   2. os trechos do HTML marcados com data-i18n, escritos no idioma padrão: o
 *      primeiro quadro já sai no idioma certo, sem piscar e sem JavaScript.
 *
 * ORDEM DAS CAMADAS (a última vence), para um idioma X e o padrão P do cliente:
 *   pt-BR (referência, completo) < P de fábrica < P do cliente (config/locales/P.json)
 *   < textos[P] < X de fábrica < X do cliente < textos[X]
 * Um idioma só traduzido pela metade fica sem buraco: o que falta cai no padrão.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AppI18n from '../../core/site/i18n.js';
import { esc } from './config-gerar.mjs';
import { validarTabela } from '../../core/worker/_lib/i18n-validar.mjs';

export const MARCADOR_I18N_INICIO = '<!-- i18n:inicio -->';
export const MARCADOR_I18N_FIM = '<!-- i18n:fim -->';

async function lerJsonOpcional(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch (e) { return null; }
}

/* Os catálogos de fábrica moram NO PRODUTO (core/locales), onde este script está, e
 * não na raiz do projeto que se está gerando: assim um projeto de teste, ou um cliente
 * que atualizou o core, sempre gera com os textos do core que de fato roda. */
const RAIZ_DO_PRODUTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* Lê core/locales/*.json (do produto) e config/locales/*.json (do cliente, na `raiz`). */
export async function carregarCatalogos(raiz) {
  const lerPasta = async (pasta) => {
    const saida = {};
    let nomes = [];
    try { nomes = await readdir(pasta); } catch (e) { return saida; }
    for (const nome of nomes.filter((n) => n.endsWith('.json')).sort()) {
      const v = await lerJsonOpcional(path.join(pasta, nome));
      if (v && typeof v === 'object') saida[nome.slice(0, -5)] = v;
    }
    return saida;
  };
  return {
    fabrica: await lerPasta(path.join(RAIZ_DO_PRODUTO, 'core', 'locales')),
    cliente: await lerPasta(path.join(raiz, 'config', 'locales'))
  };
}

/* Confere config/locales/<idioma>.json: chave que não existe ou {parâmetro} que a frase não
 * recebe viram erro com o nome do arquivo (o que faltar é permitido: cai no padrão). */
export function validarCatalogosDoCliente(catalogos) {
  const erros = [];
  for (const [id, tabela] of Object.entries(catalogos.cliente || {})) {
    erros.push(...validarTabela(tabela, `config/locales/${id}.json`, catalogos.fabrica[AppI18n.IDIOMA_REFERENCIA]));
  }
  return erros;
}

/* Os textos do cliente aceitam a chave curta do M4 ("rodape") como apelido de
 * "site.rodape". A chave completa vence se as duas existirem. */
export function normalizarTextos(textos, referencia) {
  const saida = {};
  for (const [k, v] of Object.entries(textos || {})) {
    if (typeof v !== 'string') continue;
    if (!k.includes('.') && referencia && !(k in referencia) && (`site.${k}` in referencia)) saida[`site.${k}`] = v;
    else saida[k] = v;
  }
  return saida;
}

/* O catálogo efetivo de `idioma` para este config. */
export function catalogoEfetivo(config, catalogos, idioma) {
  const padrao = config.idiomas.padrao;
  const ref = catalogos.fabrica[AppI18n.IDIOMA_REFERENCIA] || {};
  const camadas = [
    ref,
    catalogos.fabrica[padrao], catalogos.cliente[padrao], normalizarTextos((config.textos || {})[padrao], ref)
  ];
  if (idioma !== padrao) {
    camadas.push(catalogos.fabrica[idioma], catalogos.cliente[idioma], normalizarTextos((config.textos || {})[idioma], ref));
  }
  return Object.assign({}, ...camadas.filter(Boolean));
}

/* Compacto (um arquivo que o navegador baixa) e com chaves em ordem (diff estável). */
export function serializarCatalogo(catalogo) {
  const ord = {};
  for (const k of Object.keys(catalogo).sort()) ord[k] = catalogo[k];
  return JSON.stringify(ord) + '\n';
}

/* Os idiomas que ganham arquivo em locales/: os do site (idiomas.disponiveis) e
 * os de fábrica — a mesa fala os três, mesmo que o site do cliente tenha um só. */
export function idiomasGerados(config) {
  return [...new Set([...config.idiomas.disponiveis, ...AppI18n.IDIOMAS_DE_FABRICA])];
}

/* { 'locales/<id>.json': texto } para cada idioma gerado. */
export function gerarLocales(config, catalogos) {
  const saidas = new Map();
  for (const id of idiomasGerados(config)) {
    saidas.set(`locales/${id}.json`, serializarCatalogo(catalogoEfetivo(config, catalogos, id)));
  }
  return saidas;
}

/* Instância do idioma padrão, com os parâmetros globais da marca. */
export function instanciaDoPadrao(config, catalogos) {
  const padrao = config.idiomas.padrao;
  const m = config.marca || {};
  return AppI18n.criar({
    idioma: padrao, padrao,
    catalogos: { [padrao]: catalogoEfetivo(config, catalogos, padrao) },
    globais: { marca: m.nome || '', marcaCurta: m.nomeCurto || m.nome || '', organizacao: m.organizacao || '' }
  });
}

export function gerarBlocoI18n(config) {
  return [
    `<link rel="preload" href="locales/${config.idiomas.padrao}.json" as="fetch" crossorigin>`,
    '<link rel="preload" href="config.public.json" as="fetch" crossorigin>'
  ].join('\n');
}

function trocarEntre(html, ini, fim, miolo) {
  const i = html.indexOf(ini);
  const f = html.indexOf(fim);
  if (i < 0 || f < i) return html;
  return html.slice(0, i + ini.length) + '\n' + miolo + '\n' + html.slice(f);
}

/* Reescreve o HTML no idioma padrão: lang, bloco de preload, textos e atributos.
 * Elemento com data-i18n precisa ser "folha" (sem tag dentro): o texto é a chave. */
export function aplicarI18nNoHtml(html, config, catalogos) {
  const inst = instanciaDoPadrao(config, catalogos);
  let saida = html.replace(/<html\b([^>]*?)\blang="[^"]*"/, `<html$1lang="${esc(config.idiomas.padrao)}"`);
  saida = trocarEntre(saida, MARCADOR_I18N_INICIO, MARCADOR_I18N_FIM, gerarBlocoI18n(config));
  saida = saida.replace(/(<([a-zA-Z][\w-]*)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/g,
    (todo, abre, tag, chave, miolo, fecha) => abre + esc(inst.t(chave)) + fecha);
  saida = saida.replace(/<([a-zA-Z][\w-]*)\b[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/g, (tagInteira, tag, pares) => {
    let nova = tagInteira;
    for (const par of pares.split(';')) {
      const corte = par.indexOf(':');
      if (corte < 1) continue;
      const attr = par.slice(0, corte).trim();
      const valor = esc(inst.t(par.slice(corte + 1).trim()));
      const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
      nova = re.test(nova) ? nova.replace(re, `$1${valor}$2`) : nova.replace(/(\s*\/?>)$/, ` ${attr}="${valor}"$1`);
    }
    return nova;
  });
  return saida;
}
