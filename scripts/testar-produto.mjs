#!/usr/bin/env node
/* Roda a suíte do produto sem depender da personalização da instalação.
 * Uma cópia temporária recebe a configuração e o wrangler neutros; os arquivos
 * reais do cliente não são alterados. Segredos e dados locais não são copiados. */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(RAIZ, 'tests', 'fixtures');

function rodar(comando, args, cwd) {
  const r = spawnSync(comando, args, { cwd, stdio: 'inherit', env: process.env });
  if (r.error) throw r.error;
  return r.status === null ? 1 : r.status;
}

function copiarProjeto(destino) {
  cpSync(RAIZ, destino, {
    recursive: true,
    filter(origem) {
      const rel = path.relative(RAIZ, origem);
      if (!rel) return true;
      const primeiro = rel.split(path.sep)[0];
      if (['.git', 'node_modules', 'dados'].includes(primeiro)) return false;
      if (rel === '.dev.vars' || rel.startsWith('.dev.vars.')) return false;
      if ((rel === '.env' || rel.startsWith('.env.')) && rel !== '.env.example') return false;
      return true;
    }
  });
}

let temporario;
let codigo = 1;
try {
  /* Validar o JSON antes de copiar evita apagar uma mensagem útil no meio da suíte. */
  const configNeutra = readFileSync(path.join(FIXTURES, 'site.neutro.json'), 'utf8');
  JSON.parse(configNeutra);
  const wranglerNeutro = readFileSync(path.join(FIXTURES, 'wrangler.neutro.jsonc'), 'utf8');

  temporario = mkdtempSync(path.join(tmpdir(), 'tela-testes-produto-'));
  copiarProjeto(temporario);
  writeFileSync(path.join(temporario, 'config', 'site.json'), configNeutra);
  writeFileSync(path.join(temporario, 'wrangler.jsonc'), wranglerNeutro);

  console.log('Rodando a suíte completa numa cópia temporária com a configuração neutra.');
  console.log('A configuração e o wrangler desta instalação não serão alterados.');
  codigo = rodar(process.execPath, ['scripts/aplicar-config.mjs'], temporario);
  /* A varredura anti-marca usa `git ls-files`; um índice novo basta, sem commit. */
  if (codigo === 0) codigo = rodar('git', ['init', '-q'], temporario);
  if (codigo === 0) codigo = rodar('git', ['add', '-A'], temporario);
  if (codigo === 0) codigo = rodar(process.execPath, ['--test'], temporario);
} catch (erro) {
  console.error(`Não consegui preparar a suíte isolada: ${erro.message}`);
  codigo = 1;
} finally {
  if (temporario) rmSync(temporario, { recursive: true, force: true });
}
process.exitCode = codigo;
