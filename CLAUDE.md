<!-- GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents". Fonte: AGENTS.md a155fc3cf439 -->
@AGENTS.md

# Notas para o Claude Code

- As regras de `AGENTS.md` valem integralmente. As skills do projeto estão em `.agents/skills/`; `node scripts/setup.mjs sync-agents` as espelha para `.claude/skills/`.
- `.claude/settings.json` nega leitura e escrita de `.env`, `.dev.vars` e chaves, e um hook (`.claude/hooks/bloquear-segredos.mjs`) recusa comandos que imprimiriam segredos. Não tente contornar: se um comando for bloqueado, rode o caminho seguro (`setup.mjs segredo NOME`, prompt oculto no terminal da pessoa).
- Para montar o streaming de um cliente, comece por `node scripts/setup.mjs status --json` e siga a skill `montar-streaming`.
