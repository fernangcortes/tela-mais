/* scripts/sinopses.mjs — REDIRECIONAMENTO. O script antigo exigia `npm install @anthropic-ai/sdk`, fixava um modelo e
 * gravava a sinopse direto no catálogo, fora do orçamento, da fila de sugestões e da proveniência. Foi substituído pelo
 * M9: `npm run ia:textos` (estimativa de custo antes, orçamento mensal, sugestão para revisar no /admin, sem dependências). */
console.error([
  'scripts/sinopses.mjs foi substituído.',
  'Use:  npm run ia:textos -- --tarefa sinopse-curta   (mostra a estimativa antes; só segue com --yes)',
  'As sinopses caem como SUGESTÃO na tela IA do /admin; nada vai ao ar sem a sua revisão. Guia: docs/ia.md'
].join('\n'));
process.exit(2);
