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
  que falam com o site; para o provedor de vídeo, as do adaptador escolhido em
  `video.provedor` (Bunny: `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY` e `BUNNY_PULLZONE`).
- **Provedor de vídeo**: `scripts/lib/provedores/index.mjs` é o espelho Node dos
  adaptadores do Worker (o MESMO código de `core/worker/_lib/provedores/`):
  `provedorDoAmbiente()` devolve o adaptador, `enviarArquivo()` manda um arquivo
  pelo plano TUS, `idDoVideo(item)` lê `item.fonte` no formato de antes e no de
  depois do M4. **Todos** os scripts de carga falam com o provedor só por esse
  adaptador (`lib/bunny.mjs` saiu): `upload.mjs`, `status.mjs` (estado normalizado),
  `publicar.mjs`, `framerate.mjs`, `capas-legendas.mjs`, `capas-menores.mjs`,
  `sincronizar-capas.mjs` e `capitulos.mjs`. O que só alguns provedores fazem fica atrás de
  capacidade (`exigirCapacidade`): trocar capa por arquivo (`capaPorUpload`), enviar legenda
  (`legendaPorUpload`), capítulos no player (`capitulosNativos`), cadastrar por endereço
  (`fontePorUrl`); o script recusa com mensagem clara em vez de falhar no meio.
  `videoDoItem`, `statusDoItem` e `dadosDoItem` levam os `fonte.extras` do item ao adaptador.
- `APP_CONFIG` (opcional) aponta para outro `site.json` (um ensaio ou a config de outra
  instalação); sem ele vale `config/site.json`.

## O que cada um faz

| script | para quê |
|---|---|
| `upload.mjs`, `status.mjs`, `publicar.mjs` | subir os vídeos ao provedor, conferir o encoding e liberar para a grade |
| `cadastrar-hls.mjs` | provedor `hls-generico`: grava no catálogo a `fonte` de cada título a partir de um mapa de endereços (`--mapa`), conferidos pelo adaptador; sem upload |
| `semear.mjs`, `acrescentar-ao-kv.mjs` | levar o catálogo local ao KV (todo, ou só os títulos novos) |
| `gerar-capas.mjs`, `capas-legendas.mjs`, `capas-menores.mjs`, `sincronizar-capas.mjs` | capas: gerar, enviar, reduzir e gravar o nome do arquivo |
| `legendas-assembly.mjs`, `sinopses.mjs`, `series.mjs` | legendas por transcrição e textos por IA |
| `capitulos.mjs`, `framerate.mjs`, `indice-busca.mjs` | capítulos, taxa de quadros e índice da busca |
| `mesa-local.mjs` | a mesa de administração em `http://127.0.0.1:8790`, com API de mentira em memória |
| `gerar-headers.mjs` | regera `core/site/_headers` (política de segurança neutra, sem host de provedor) a partir de `seguranca.js`; `--verificar` só confere |
| `gerar-marca-neutra.mjs` | regera os ícones e logos da marca neutra em `core/site/` |
| `anti-marca.mjs` | varredura que garante que nenhuma referência a um cliente anterior volte |
| `i18n-faltando.mjs` | confere que `en` e `es` têm todas as chaves do `pt-BR` (e os mesmos `{parâmetros}` e plurais); sai com 1 se faltar |
| `i18n-literais.mjs` | conta texto de interface em português escrito no código, fora de `core/locales/`; sai com 1 acima do limite |

Quase todos aceitam `--simular` (mostra o plano sem gravar nada).
