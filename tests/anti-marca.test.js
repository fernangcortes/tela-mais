// Roda a varredura anti-marca como teste: falha se algum termo do cliente
// original voltar para o repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('anti-marca: nenhuma referência ao cliente original', () => {
  const r = spawnSync(process.execPath, [resolve(RAIZ, 'scripts/anti-marca.mjs')],
    { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(r.status, 0, `ocorrências encontradas:\n${r.stdout}${r.stderr}`);
});
