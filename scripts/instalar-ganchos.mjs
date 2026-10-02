#!/usr/bin/env node
// Instala (opcional) o gancho de pre-commit: antes de cada commit roda
// scan-secrets (nenhum segredo nos arquivos preparados) e anti-marca.
// Node puro. Uso:
//   node scripts/instalar-ganchos.mjs            instala
//   node scripts/instalar-ganchos.mjs --remover  desinstala
//   node scripts/instalar-ganchos.mjs --dry-run  mostra o que faria
// Idempotente. Não sobrescreve um pre-commit seu (sem a marca desta ferramenta).

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARCA = '# GANCHO tela mAIs (instalar-ganchos.mjs)';

export const CONTEUDO = `#!/bin/sh
${MARCA}
# Bloqueia o commit se houver segredo nos arquivos preparados ou marca de outro cliente.
# Para pular uma vez (só se tiver certeza): git commit --no-verify
node scripts/setup.mjs scan-secrets --staged || {
  echo "Commit bloqueado: achei um possível segredo. Tire-o do arquivo e guarde com: node scripts/setup.mjs segredo NOME" >&2
  exit 1
}
node scripts/anti-marca.mjs || {
  echo "Commit bloqueado: a varredura anti-marca achou algo (veja acima)." >&2
  exit 1
}
`;

function git(raiz, args) {
  return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Instala ou remove. Retorna { ok, mensagens[] }. */
export function instalarGanchos(raiz, { remover = false, dryRun = false } = {}) {
  const msgs = [];
  const dir = join(raiz, '.githooks');
  const arq = join(dir, 'pre-commit');
  if (!existsSync(join(raiz, '.git'))) {
    return { ok: false, mensagens: ['Esta pasta ainda não é um repositório git. Rode "git init" primeiro.'] };
  }
  const atual = existsSync(arq) ? readFileSync(arq, 'utf8') : null;
  if (atual !== null && !atual.includes(MARCA)) {
    return { ok: false, mensagens: ['Já existe um .githooks/pre-commit que não é desta ferramenta. Não mexi nele.'] };
  }
  let configurado = '';
  try { configurado = git(raiz, ['config', '--local', '--get', 'core.hooksPath']); } catch { /* não definido */ }

  if (remover) {
    if (dryRun) return { ok: true, mensagens: ['Simulação: removeria .githooks/pre-commit e o core.hooksPath.'] };
    if (atual !== null) { rmSync(arq); msgs.push('Gancho removido.'); } else msgs.push('O gancho não estava instalado.');
    if (configurado === '.githooks') { git(raiz, ['config', '--local', '--unset', 'core.hooksPath']); msgs.push('git deixou de usar .githooks.'); }
    return { ok: true, mensagens: msgs };
  }

  if (configurado && configurado !== '.githooks') {
    return { ok: false, mensagens: [`O git já usa outra pasta de ganchos (${configurado}). Não mudei nada.`] };
  }
  if (dryRun) return { ok: true, mensagens: ['Simulação: criaria .githooks/pre-commit e rodaria git config core.hooksPath .githooks.'] };
  if (atual === CONTEUDO && configurado === '.githooks') return { ok: true, mensagens: ['O gancho já estava instalado. Nada a fazer.'] };
  mkdirSync(dir, { recursive: true });
  writeFileSync(arq, CONTEUDO, { encoding: 'utf8', mode: 0o755 });
  try { chmodSync(arq, 0o755); } catch { /* Windows */ }
  git(raiz, ['config', '--local', 'core.hooksPath', '.githooks']);
  msgs.push('Gancho instalado: antes de cada commit rodam scan-secrets e anti-marca.');
  return { ok: true, mensagens: msgs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const validos = new Set(['--remover', '--dry-run', '--help']);
  const ruim = args.find((a) => !validos.has(a));
  if (ruim || args.includes('--help')) {
    console.log('Uso: node scripts/instalar-ganchos.mjs [--remover] [--dry-run]');
    process.exit(ruim ? 2 : 0);
  }
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let r;
  try { r = instalarGanchos(raiz, { remover: args.includes('--remover'), dryRun: args.includes('--dry-run') }); }
  catch (e) { r = { ok: false, mensagens: [`Falhou: ${e.message}`] }; }
  for (const m of r.mensagens) console.log(m);
  process.exit(r.ok ? 0 : 1);
}
