/* scripts/lib/migracoes-config.mjs — as migrações do config/site.json entre versões do esquema.
 *
 * `versaoDoEsquema` (campo do config/site.json) só muda quando o FORMATO do arquivo muda de um jeito que quebra
 * quem já tem config. Mudança que só ACRESCENTA campo opcional não precisa de migração (o core lê os padrões do
 * schema). Cada migração sobe UMA versão e é uma função pura: recebe o objeto da config e devolve o novo.
 *
 * COMO ACRESCENTAR (quando existir a versão 2):
 *   1. config/site.schema.json passa a aceitar `versaoDoEsquema: 2` (enum [2], ou [1, 2] durante a transição);
 *   2. aqui: MIGRACOES[1] = { para: 2, descricao: '...', migrar(cfg) { ...; return { ...cfg, versaoDoEsquema: 2 }; } };
 *   3. teste em tests/migrar-config.test.js e linha "precisa de ação sua" no CHANGELOG.md.
 * Regras: não perder dado da pessoa, não inventar valor, ser idempotente, nunca tocar em segredo (a config não os tem). */

export const MIGRACOES = Object.freeze({
  /* 1: { para: 2, descricao: 'exemplo', migrar: (cfg) => ({ ...cfg, versaoDoEsquema: 2 }) } */
});
