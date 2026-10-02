/* scripts/lib/empacotar.mjs — a lista de arquivos que entram no tarball de uma release (só o PRODUTO). */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const FORA = new Set(['node_modules', '.git', '.wrangler', 'dados', '.DS_Store']);

async function andar(raiz, rel) {
  const saida = [];
  for (const it of await readdir(path.join(raiz, rel), { withFileTypes: true })) {
    if (FORA.has(it.name) || it.isSymbolicLink()) continue;
    const r = `${rel}/${it.name}`;
    if (it.isDirectory()) saida.push(...await andar(raiz, r));
    else if (it.isFile()) saida.push(r);
  }
  return saida;
}

export async function listarArquivosDoProduto(raiz, produto) {
  const { stat } = await import('node:fs/promises');
  const todos = [];
  for (const p of produto.pastas) { try { todos.push(...await andar(raiz, p)); } catch { /* pasta opcional ausente */ } }
  for (const a of produto.arquivos) { try { if ((await stat(path.join(raiz, a))).isFile()) todos.push(a); } catch { /* arquivo opcional ausente */ } }
  return [...new Set(todos)].sort();
}
