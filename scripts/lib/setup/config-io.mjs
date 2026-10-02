/* scripts/lib/setup/config-io.mjs — ler, mesclar, validar e gravar config/site.json.
 *
 * Toda gravação passa pelo MESMO validador do Worker (config-validar.mjs): config inválida não é gravada.
 * Se o resultado for igual ao que já está no arquivo, o arquivo nem é tocado (mantém a formatação do cliente). */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validarConfig, formatarErros } from '../../../core/worker/_lib/config-validar.mjs';
import { ErroSetup, falha } from './erros.mjs';

export const caminhoSite = (raiz) => path.join(raiz, 'config', 'site.json');

export function ehObjeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

export function mesclar(base, extra) {
  const saida = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    saida[k] = ehObjeto(v) && ehObjeto(base?.[k]) ? mesclar(base[k], v) : (v === undefined ? base?.[k] : JSON.parse(JSON.stringify(v)));
  }
  return saida;
}

export function lerCaminho(obj, caminho) {
  return caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function definirCaminho(obj, caminho, valor) {
  const partes = caminho.split('.');
  let o = obj;
  for (const k of partes.slice(0, -1)) {
    if (!ehObjeto(o[k])) o[k] = {};
    o = o[k];
  }
  o[partes[partes.length - 1]] = valor;
  return obj;
}

export async function lerSite(raiz) {
  let texto;
  try { texto = await readFile(caminhoSite(raiz), 'utf8'); } catch { return { existe: false, bruto: {}, texto: '' }; }
  try { return { existe: true, bruto: JSON.parse(texto), texto }; }
  catch (e) { throw falha('config-quebrada', `config/site.json não é um JSON válido (${e.message}).`, { dica: 'Confira vírgulas, aspas e chaves, ou restaure o arquivo com git.' }); }
}

export async function lerSchema(raiz) {
  const texto = await readFile(path.join(raiz, 'config', 'site.schema.json'), 'utf8');
  return JSON.parse(texto);
}

export async function validarBruto(raiz, bruto) {
  return validarConfig(await lerSchema(raiz), bruto);
}

/* Valida e grava. Devolve { mudou, config }. Lança ErroSetup('config-invalida') com as mensagens do validador. */
export async function gravarSite(raiz, novoBruto, { dryRun = false } = {}) {
  const r = await validarBruto(raiz, novoBruto);
  if (!r.ok) {
    throw new ErroSetup('config-invalida', 'não gravei config/site.json porque o resultado teria problemas:\n' + formatarErros(r.erros),
      { dica: 'Nada foi alterado. Corrija o valor informado e rode de novo.', dados: { erros: r.erros } });
  }
  const atual = await lerSite(raiz);
  if (atual.existe && isDeepStrictEqual(atual.bruto, novoBruto)) return { mudou: false, config: r.config };
  if (!dryRun) await writeFile(caminhoSite(raiz), JSON.stringify(novoBruto, null, 2) + '\n', 'utf8');
  return { mudou: true, config: r.config };
}

/* ------------------------------------------------------------------ presets de caso de uso */

export async function listarPresets(raiz) {
  const pasta = path.join(raiz, 'core', 'presets');
  const saida = [];
  let nomes = [];
  try { nomes = (await readdir(pasta)).filter((n) => n.endsWith('.json')).sort(); } catch { /* sem presets */ }
  for (const n of nomes) {
    try {
      const p = JSON.parse(await readFile(path.join(pasta, n), 'utf8'));
      if (p && typeof p.id === 'string' && ehObjeto(p.config)) saida.push({ id: p.id, nome: p.nome || p.id, resumo: p.resumo || '', config: p.config });
    } catch { /* arquivo quebrado: o teste de presets pega */ }
  }
  return saida;
}

export async function carregarPreset(raiz, id) {
  const todos = await listarPresets(raiz);
  const p = todos.find((x) => x.id === id);
  if (!p) throw falha('preset-desconhecido', `não existe o preset "${id}".`, { dica: 'Presets: ' + (todos.map((x) => x.id).join(', ') || '(nenhum encontrado em core/presets/)') });
  return p;
}
