# scripts/

Utilitários de linha de comando em Node puro (sem dependências, exceto
`@anthropic-ai/sdk` para `sinopses.mjs` e `series.mjs`, que se instala só se você
for usá-los). Rode sempre da **raiz do repositório**: `node scripts/<nome>.mjs`.

## Caminhos e configuração

- **`.env`** fica na raiz do repositório (modelo: `.env.example`). Variáveis
  definidas no ambiente têm prioridade sobre ele.
- **Catálogo local**: por padrão `exemplo/catalogo.json` (fictício). Para usar o
  seu, defina `APP_CATALOGO=catalogo.json` no `.env` ou passe `--catalogo <arquivo>`.
  Mantenha o seu fora do git (o `.gitignore` já cobre `dados/` e `data/`).
- **Capítulos**: `exemplo/capitulos.json` (`--capitulos <arquivo>` troca).
- **Site servido pela mesa local**: `core/site/`.
- Variáveis: `APP_SITE_URL` e `APP_SENHA` (ou `ADMIN_PASSWORD`) para os scripts
  que falam com o site; `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY` e `BUNNY_PULLZONE`
  para o provedor de vídeo.

## O que cada um faz

| script | para quê |
|---|---|
| `upload.mjs`, `status.mjs`, `publicar.mjs` | subir os vídeos ao provedor, conferir o encoding e liberar para a grade |
| `semear.mjs`, `acrescentar-ao-kv.mjs` | levar o catálogo local ao KV (todo, ou só os títulos novos) |
| `gerar-capas.mjs`, `capas-legendas.mjs`, `capas-menores.mjs`, `sincronizar-capas.mjs` | capas: gerar, enviar, reduzir e gravar o nome do arquivo |
| `legendas-assembly.mjs`, `sinopses.mjs`, `series.mjs` | legendas por transcrição e textos por IA |
| `capitulos.mjs`, `framerate.mjs`, `indice-busca.mjs` | capítulos, taxa de quadros e índice da busca |
| `mesa-local.mjs` | a mesa de administração em `http://127.0.0.1:8790`, com API de mentira em memória |
| `gerar-marca-neutra.mjs` | regera os ícones e logos da marca neutra em `core/site/` |
| `anti-marca.mjs` | varredura que garante que nenhuma referência a um cliente anterior volte |
| `i18n-faltando.mjs` | confere que `en` e `es` têm todas as chaves do `pt-BR` (e os mesmos `{parâmetros}` e plurais); sai com 1 se faltar |
| `i18n-literais.mjs` | conta texto de interface em português escrito no código, fora de `core/locales/`; sai com 1 acima do limite |

Quase todos aceitam `--simular` (mostra o plano sem gravar nada).
