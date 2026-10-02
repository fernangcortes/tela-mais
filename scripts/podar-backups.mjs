#!/usr/bin/env node
/* scripts/podar-backups.mjs — mantém só 30 backups diários e 12 mensais numa pasta de `backup-AAAA-MM-DD.json`.
 *
 *   node scripts/podar-backups.mjs <pasta> [--diarios 30] [--mensais 12] [--simular]
 *
 * Só apaga arquivos com o nome exato `backup-AAAA-MM-DD.json` dentro da pasta informada. Usado pelo backup.yml. */
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { escolherRetencao } from './lib/retencao-backup.mjs';

export async function principal(argv) {
  const pos = [];
  const opc = { diarios: 30, mensais: 12, simular: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--simular' || a === '--dry-run') opc.simular = true;
    else if (a === '--diarios' || a === '--mensais') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return { codigo: 2, texto: `${a} precisa de um número inteiro entre 1 e 3650.\n` };
      opc[a.slice(2)] = n;
    } else if (a.startsWith('--')) return { codigo: 2, texto: `Opção desconhecida: ${a}\n` };
    else pos.push(a);
  }
  if (pos.length !== 1) return { codigo: 2, texto: 'Uso: node scripts/podar-backups.mjs <pasta> [--diarios 30] [--mensais 12] [--simular]\n' };
  const pasta = path.resolve(pos[0]);
  let nomes;
  try { nomes = await readdir(pasta); } catch { return { codigo: 1, texto: `Não consegui abrir a pasta ${pasta}.\n` }; }
  const r = escolherRetencao(nomes, opc);
  if (!opc.simular) for (const n of r.apagar) await rm(path.join(pasta, n), { force: true });
  return { codigo: 0, ...r, texto: `${opc.simular ? 'Simulação: ' : ''}guardo ${r.guardar.length}, ${opc.simular ? 'apagaria' : 'apaguei'} ${r.apagar.length}.\n` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await principal(process.argv.slice(2));
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
