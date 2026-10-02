# Instruções para o GitHub Copilot

As regras deste repositório estão em [AGENTS.md](../AGENTS.md). Leia e siga esse arquivo.

Em resumo: nunca peça nem imprima segredos (chaves entram só por `node scripts/setup.mjs segredo NOME`,
prompt oculto no terminal da pessoa); nunca escreva segredo em arquivo versionado; nada destrutivo ou pago sem um "sim"
explícito; não publique sem `node scripts/setup.mjs doctor` verde; texto e documentação em português do Brasil claro.
As skills estão em `.agents/skills/`.
