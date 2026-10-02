<!-- GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents". Fonte: AGENTS.md a13858a39e83 -->
# GEMINI.md

Leia e siga o `AGENTS.md` na raiz do repositório antes de qualquer alteração: as regras dele valem integralmente.

Em especial: nunca peça segredo no chat (o prompt oculto do terminal da pessoa é o único caminho) e nunca imprima segredo.

Para montar o streaming de um cliente, comece por `node scripts/setup.mjs status --json` e siga a skill `montar-streaming`.

## Roteiros (skills)

Quando a tarefa combinar com um destes, leia o arquivo indicado antes de agir:

- `adicionar-videos`: Ajuda a enviar o primeiro vídeo e os seguintes, cadastrar títulos, capas, legendas e coleções, e a conferir que tocam. Use quando pedirem para subir, adicionar, cadastrar ou organizar vídeos. (`.agents/skills/adicionar-videos/SKILL.md`)
- `configurar-acesso`: Escolhe e configura quem pode ver o streaming (publico, cadastro ou privado), com Turnstile e testes de que o modo realmente protege. Use quando pedirem login, cadastro, convite, conteúdo só para alunos ou para mudar o modo de acesso. (`.agents/skills/configurar-acesso/SKILL.md`)
- `diagnosticar`: Descobre e corrige por que o streaming não funciona (site fora do ar, vídeo não toca, login falha, deploy recusado, chave inválida) usando o doctor. Use quando algo der erro, quebrar ou a pessoa disser que não funciona. (`.agents/skills/diagnosticar/SKILL.md`)
- `montar-streaming`: Monta do zero o streaming (tela mAIs) de uma pessoa leiga na conta Cloudflare dela, em 9 etapas com checkpoint verificável. Use quando pedirem para instalar, montar, configurar ou colocar o streaming no ar. (`.agents/skills/montar-streaming/SKILL.md`)
- `publicar-e-atualizar`: Publica o streaming na Cloudflare e publica atualizações depois, só com o diagnóstico verde, e confere o site no ar. Use quando pedirem para publicar, colocar no ar, atualizar o site ou mudar o domínio. (`.agents/skills/publicar-e-atualizar/SKILL.md`)
- `trocar-marca-e-tema`: Define nome, slogan, logo, cores, tema, fonte, idiomas e textos do streaming do cliente, validando contraste. Use quando pedirem para personalizar a aparência, trocar a marca, as cores ou os textos. (`.agents/skills/trocar-marca-e-tema/SKILL.md`)
