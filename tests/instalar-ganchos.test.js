const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ganchos-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  return d;
}

test('instala, é idempotente e remove', async () => {
  const { instalarGanchos, MARCA } = await import('../scripts/instalar-ganchos.mjs');
  const d = repo();
  const r1 = instalarGanchos(d);
  assert.equal(r1.ok, true);
  const arq = path.join(d, '.githooks', 'pre-commit');
  const txt = fs.readFileSync(arq, 'utf8');
  assert.ok(txt.includes(MARCA) && txt.includes('scan-secrets --staged') && txt.includes('anti-marca.mjs'));
  assert.equal(execFileSync('git', ['config', 'core.hooksPath'], { cwd: d, encoding: 'utf8' }).trim(), '.githooks');
  const r2 = instalarGanchos(d);
  assert.match(r2.mensagens[0], /já estava/);
  const r3 = instalarGanchos(d, { remover: true });
  assert.equal(r3.ok, true);
  assert.equal(fs.existsSync(arq), false);
});

test('não sobrescreve gancho alheio nem fora de repositório; dry-run não grava', async () => {
  const { instalarGanchos } = await import('../scripts/instalar-ganchos.mjs');
  const d = repo();
  fs.mkdirSync(path.join(d, '.githooks'));
  fs.writeFileSync(path.join(d, '.githooks', 'pre-commit'), '#!/bin/sh\necho meu\n');
  assert.equal(instalarGanchos(d).ok, false);
  const e = repo();
  assert.equal(instalarGanchos(e, { dryRun: true }).ok, true);
  assert.equal(fs.existsSync(path.join(e, '.githooks')), false);
  const sem = fs.mkdtempSync(path.join(os.tmpdir(), 'semgit-'));
  assert.equal(instalarGanchos(sem).ok, false);
});
