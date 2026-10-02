---
name: trocar-marca-e-tema
description: Define nome, slogan, logo, cores, tema, fonte, idiomas e textos do streaming do cliente, validando contraste. Use quando pedirem para personalizar a aparência, trocar a marca, as cores ou os textos.
---
<!-- GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents". Fonte: AGENTS.md a155fc3cf439 -->

# Marca, tema e textos

Tudo em `config/site.json` (sem segredos). Guia da pessoa: `docs/personalizar.md`; temas: `core/presets/temas/LEIA-ME.md`.

## Perguntas (uma por vez)

Nome do streaming; slogan; cor principal (peça um exemplo: "a cor do seu logo"); tem logo (arquivo PNG/SVG)?;
idioma principal (pt-BR, en, es); tipo de organização (para sugerir o tema).

## Passos

1. `node scripts/setup.mjs marca --dry-run` (ou edite `config/site.json` nos campos de identidade). Mostre o antes e o depois.
2. Tema: `tema.preset` entre `cinema`, `claro`, `alto-contraste`, `institucional`, `vibrante`, `aconchegante`; `tema.modo` entre `auto`, `escuro`, `claro`.
   Cores próprias em `tema.cores.escuro` / `tema.cores.claro`. O validador recusa contraste abaixo de 4,5:1 (texto) ou 3:1 (controles) e sugere outra cor: explique isso em termos simples ("o texto ficaria difícil de ler").
   O comando `marca --cor` NÃO troca a cor da pessoa sem avisar: se faltar contraste ele sai com 3/`agente` e nada é gravado. Mostre a cor sugerida, pergunte se serve e só então rode com `--yes` (ou peça outra cor). Os ícones e o favicon gerados são provisórios (a inicial do nome na cor da marca): diga isso e peça o logo quando ela tiver (`marca --logo arquivo.svg`).
   O comando `marca --cor` NÃO troca a cor da pessoa sem avisar: se faltar contraste ele sai com 3/`agente` e nada é gravado. Mostre a cor sugerida, pergunte se serve e só então rode com `--yes` (ou peça outra cor). Os ícones e o favicon gerados são provisórios (a inicial do nome na cor da marca): diga isso e peça o logo quando ela tiver (`marca --logo arquivo.svg`).
3. Logo e fontes: arquivos em `config/` (fontes woff2 em `config/fontes/`). Não ponha o logo de terceiros sem a pessoa afirmar que tem direito de uso.
4. Textos: `textos.<idioma>` ou `config/locales/<idioma>.json`. Não escreva a marca do cliente de origem; a padrão é neutra.
5. `npm run config:validar && npm run config:aplicar` (gera `theme.css`, manifest, robots e afins), depois `node scripts/anti-marca.mjs` e `node scripts/cores-literais.mjs` (precisam dar zero).
6. Mostre o resultado local (`npm run dev`) se a pessoa puder abrir o navegador; peça aprovação antes de publicar.

Nunca escreva cor literal em CSS ou JS do `core/site/`: sempre pelo tema.
