/* scripts/lib/config-carregar.mjs — lê e valida config/site.json para os scripts de Node.
 *
 * O validador em si mora em core/worker/_lib/config-validar.mjs (o mesmo que o
 * Worker usa); aqui só entram a leitura dos arquivos e as mensagens de
 * "arquivo não existe" / "JSON quebrado", em português claro.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarConfig } from '../../core/worker/_lib/config-validar.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_PADRAO = path.resolve(AQUI, '..', '..');

async function lerJson(arquivo, rotulo) {
  let texto;
  try {
    texto = await readFile(arquivo, 'utf8');
  } catch (e) {
    return { erro: { caminho: rotulo, mensagem: `não encontrei o arquivo (${arquivo}). Ele precisa existir.` } };
  }
  try {
    return { valor: JSON.parse(texto) };
  } catch (e) {
    return { erro: { caminho: rotulo, mensagem: `o arquivo não é um JSON válido (${e.message}). Confira vírgulas, aspas e chaves.` } };
  }
}

/* Devolve { ok, erros, config, bruto, schema }. Nunca lança. */
export async function carregarConfig({ raiz = RAIZ_PADRAO, arquivo } = {}) {
  const caminhoSite = arquivo ? path.resolve(arquivo) : path.join(raiz, 'config', 'site.json');
  const caminhoSchema = path.join(raiz, 'config', 'site.schema.json');
  const schema = await lerJson(caminhoSchema, 'config/site.schema.json');
  if (schema.erro) return { ok: false, erros: [schema.erro], config: null, bruto: null, schema: null };
  const site = await lerJson(caminhoSite, 'config/site.json');
  if (site.erro) return { ok: false, erros: [site.erro], config: null, bruto: null, schema: schema.valor };
  const r = validarConfig(schema.valor, site.valor);
  return { ok: r.ok, erros: r.erros, config: r.config, bruto: site.valor, schema: schema.valor };
}
