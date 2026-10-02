#!/usr/bin/env node
/* scripts/setup.mjs — o assistente de montagem do tela mAIs (zero dependências).
 *
 *   node scripts/setup.mjs --help
 *   node scripts/setup.mjs status | init | marca | acesso | video | cloudflare | segredo | deploy | doctor | sync-agents | scan-secrets
 *
 * Em todos: --json (saída estável para agentes), --yes, --dry-run. Códigos de saída: 0 certo, 1 falhou, 2 uso incorreto,
 * 3 falta uma ação da pessoa. Segredos só entram por prompt oculto (comando `segredo`), nunca na linha de comando.
 * A lógica mora em scripts/lib/setup/. */
import { pathToFileURL } from 'node:url';

/* O package.json do projeto não declara "type": o Node avisa, a cada execução, que vai reler os módulos do Worker
 * como ESM. É inofensivo e só faz barulho no terminal de quem não é técnico: silenciamos só esse aviso. */
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') process.stderr.write(`${w.name}: ${w.message}\n`); });

const { principal } = await import('./lib/setup/index.mjs');
export { principal };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { codigo } = await principal(process.argv.slice(2));
  process.exitCode = codigo;
}
