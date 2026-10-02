# core/worker/_lib/ia/ — IA de conteúdo (M9): texto, transcrição, orçamento e sugestões

Tudo aqui é ESM puro, sem dependência, e só fala por `fetch` (injetável nos testes). Roda igual no Worker e nos scripts de Node.
**Regra central: nada gerado por IA vai ao ar sem uma pessoa.** O que a IA produz é *sugestão* numa fila; só `aceitar` (uma conta
humana, pelo `gravarCatalogo`, o mesmo caminho do PUT da mesa) leva o valor ao catálogo.

Importe sempre de `./index.js`.

## API

| função | o que faz |
|---|---|
| `gerarTexto({ tarefa, entrada, schema?, config, env, fetch?, orcamento?, agora? })` | uma tarefa de texto em qualquer provedor (`anthropic`, `openai`, `gemini`, `workers-ai`). Devolve `{ estado:'ok', valor, proveniencia, uso, custoUSD, tentativas }`, `{ estado:'insuficiente' }` ou `{ estado:'falhou', codigo, detalhe }`. **Nunca lança e nunca grava.** JSON validado contra o schema; se falhar, 1 retentativa (com o motivo na mensagem); se falhar de novo, `falhou`. |
| `transcrever({ origem, idioma, config, env, fetch?, orcamento?, aguardar?, glossario? })` | `workers-ai-whisper`, `assemblyai`, `openai` ou `provedor-de-video` (legenda nativa quando o adaptador tem `legendaIA`). Devolve `{ estado:'ok'\|'sem-fala'\|'pendente'\|'falhou', srt, vtt, segmentos, custoUSD, proveniencia }`. `consultarTranscricao({ trabalho, ... })` retoma o `pendente`. |
| `traduzirLegenda({ cues, de, para, ... })` | traduz a legenda inteira em lotes, mantendo os tempos; só devolve se TODOS os lotes passarem. |
| `estimarLote({ config, env, itens, tarefas, idiomasDestino?, gastoDoMesUSD })` | a estimativa ANTES do lote (por tarefa, com margem de 20%, a data dos preços e se há preço não conferido). |
| `criarOrcamento({ env, config, agora? })` | a conta do mês no KV (`ia:gasto:AAAA-MM`): `podeGastar`, `registrar`, `verificarLote` (recusa o que não cabe), `ler`. Mesma interface em `scripts/lib/ia-cliente.mjs#orcamentoRemoto`. |
| `registrarSugestao(env, { itemId, campo, valor, proveniencia, ... })` | coloca na fila (`ia:sug:<item>:<campo>`); confere campo e valor; **não toca no catálogo**; força `revisado:false`. |
| `aceitar(env, { itemId, campo, conta, edicao?, incluirTagsNovas?, provedor? })` | passa a sugestão (ou a edição da pessoa) ao catálogo via `gravarCatalogo` (permissão por campo, 409, histórico). Grava o carimbo em `item.ia[campo]`. Aceitar sem editar não marca revisado; editar marca. Legenda: envia ao provedor de vídeo antes. |
| `descartar(env, { itemId, campo, conta })` | tira da fila; a decisão fica em `ia:decisoes`. |
| `listarSugestoes`, `lerSugestao`, `comLadoALado(fila, catalogo)` | a fila, com o valor de hoje ao lado (`atual`) e `mudouDesde`. |
| `gerarSugestoes({ env, config, item, tarefas, provedor, ... })` | lê a legenda do título, gera cada tarefa e registra só o que saiu `ok`. É o que o botão do /admin e os scripts usam. |
| `estadoDaIA`, `lerLigados`, `gravarLigados` | o retrato para o /admin (nunca devolve segredo) e o liga/desliga por recurso (`ia:ligados`; tudo nasce desligado). |

Tarefas (`TAREFAS`): `sinopse-curta`, `sinopse-longa`, `capitulos`, `tags`, `titulo-alternativo`, `descricao-acessivel`,
`traducao-legenda` e `trechos-trailer` (usada por `scripts/trailer.mjs`: `[{ inicio, fim, motivo }]` validado). Cada uma traz `campo`, `schema`,
`validar` e `extrair`; tarefa nova = uma entrada em `tarefas.js` + prompt em `prompts.js`.

## Anti-alucinação (três camadas)

1. O prompt manda usar só a transcrição e responder `{"insuficiente": true}` quando ela não sustenta.
2. Transcrição curta demais nem chama o modelo (`insuficiente`, custo 0).
3. O código confere: todo nome próprio do texto gerado precisa aparecer na transcrição, no título, na série ou no glossário
   (`anti-alucinacao.js`); se não, recusa e tenta de novo uma vez. A transcrição vai entre `<transcricao>` como DADO (a marca de
   fechamento é tirada do texto): "ignore as instruções" dentro dela não faz nada.

## Proveniência

Todo campo gerado nasce `{ origem:'ia', modelo, provedor, tarefa, data, revisado:false }`. Ao aceitar vira
`item.ia[campo] = { ..., aceitoPor, aceitoEm, revisado, editado }`. `item.ia` NÃO sai no catálogo público (`paraPublico` é lista branca).

## O que foi conferido e o que não foi (2026-10-02)

Conferido na documentação oficial: Anthropic Messages API (`x-api-key`, `anthropic-version`, `usage.input_tokens/output_tokens`,
`claude-sonnet-5-5`) e preços do Sonnet 5.5 (US$ 2/10) e Haiku 4.5 (US$ 1/5); catálogo de modelos da Cloudflare para o Whisper
large-v3-turbo (entrada `audio` base64, `language`, `vad_filter`, `initial_prompt`; saída `segments`, `vtt`) e para o
`@cf/google/gemma-4-26b-a4b-it` (Chat Completions, `response_format`, US$ 0,10/0,30); AssemblyAI pelo script que já rodava em produção.

**NÃO conferido (sem acesso às páginas desta máquina):** formato atual e preços de OpenAI (chat completions e
`/v1/audio/transcriptions`), Gemini (`generateContent`, modelo `gemini-3.5-flash-lite`) e o preço do AssemblyAI (US$ 0,21/h do blog
do fornecedor × ~US$ 0,45/h de um agregador). Esses preços estão marcados `confirmado:false` em `precos.js`, a estimativa avisa, e
o cliente corrige a linha em `ia.precos`. Reconfira antes de prometer preço.
