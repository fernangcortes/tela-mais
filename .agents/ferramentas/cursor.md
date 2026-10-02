Leia e siga `AGENTS.md` na raiz do repositório antes de qualquer alteração ou instalação.

Resumo das regras que nunca se quebram:

- Nunca peça segredo (chave, senha, token) no chat e nunca o imprima. Rode `node scripts/setup.mjs segredo NOME`, que abre um prompt oculto no terminal da pessoa.
- Nunca leia nem edite `.env`, `.dev.vars` ou chaves; nunca grave segredo em arquivo versionado.
- Nada de comando destrutivo, mudança para acesso mais aberto ou gasto sem um "sim" explícito da pessoa.
- Não publique sem `node scripts/setup.mjs doctor` verde.
- A pessoa que monta o streaming costuma ser leiga: uma pergunta por vez, em português simples.

Skills do projeto: `.agents/skills/*/SKILL.md` (comece por `montar-streaming`).
