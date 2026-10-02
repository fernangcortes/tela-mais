# AGENTS.md

Guia para qualquer agente LLM (e para pessoas) que trabalhe neste repositório.

## O que é

tela mAIs: streaming white label (vídeo sob demanda estilo Netflix) que cada cliente
instala na própria conta Cloudflare. Site estático (HTML/CSS/JS sem framework, sem
build), funções serverless em `core/site/functions/` (serão movidas para
`core/worker/` no marco M2) e scripts Node (`scripts/`, ESM, sem dependências).
Código e documentação em pt-BR. Estado: M1, não pronto para produção.

## Comandos

```bash
npm test                      # testes (Node 22+); comando oficial, equivale a `node --test`
node scripts/anti-marca.mjs   # varredura anti-marca; precisa dar zero ocorrências
```

Rode os dois antes de dar uma tarefa por concluída.

## Regras invioláveis

1. **Nunca escreva segredos em arquivos** (chaves de API, senhas, tokens, IDs de
   conta). Use variáveis de ambiente, `.env` (ignorado pelo git) e `.dev.vars`.
2. **Nunca reintroduza marca, textos, domínios, IDs de recurso, cores ou títulos de
   acervo do cliente original** deste código. A marca padrão é neutra ("Plataforma
   Exemplo"). Confira com `node scripts/anti-marca.mjs`. Não "corrija" o script para
   fazer o teste passar: corrija o conteúdo.
3. **Nunca adicione autoplay** (vídeo ou áudio que começa sozinho) sem passar pelo
   guardião do player: nada toca sozinho sem ação explícita da pessoa.
4. **Nunca adicione dependências sem necessidade.** Sem framework, sem build, sem
   `node_modules` por padrão. Código de terceiros fica em `core/site/vendor/` com versão
   fixa e registrado em `NOTICE`.
5. O nome do produto "tela mAIs" aparece só em README, LICENSE, NOTICE, COMMERCIAL e
   nestes arquivos de agentes, nunca na interface do cliente.
6. Não modifique o texto-base da licença em `LICENSE` (só os parâmetros do topo).

## Estilo

- Mantenha o estilo existente: ESM, funções pequenas, comentários em pt-BR explicando
  o porquê, não o quê.
- Todo comportamento novo vem com teste em `tests/`.
- Caminhos de arquivos locais são relativos à raiz do repositório.

## Roteiro de setup para leigos

Ainda não existe. Ele chega no marco M7 do plano. Até lá, não prometa instalação
guiada em documentação ou na interface.
