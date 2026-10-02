# IA de conteúdo: o que faz, quanto custa e como ligar

A IA é **opcional, paga e nasce desligada**. Ela ajuda a escrever textos, legendar e montar trailer e clipe de fundo,
mas **nunca publica nada sozinha**: tudo que ela gera cai na tela **IA** do `/admin` como **sugestão**, ao lado do que está
no ar hoje. Você lê, aceita, edita ou descarta. Só o que você aceita vai para o site.

Se você não ligar nada, nada muda, não há custo e nenhum conteúdo sai da sua conta.

## O que cada recurso faz

| Recurso | O que entrega | Do que precisa |
|---|---|---|
| Sinopse curta | Um parágrafo para o cartão do título | Legenda do vídeo |
| Sinopse longa | Texto maior para a página do título | Legenda |
| Capítulos | Marcas de tempo com título (vídeo de 2 minutos ou mais) | Legenda com tempos |
| Tema e tags | Um tema e tags para busca e coleções (pode usar só uma lista sua) | Legenda |
| Título alternativo | Uma segunda opção de título | Legenda |
| Descrição para acessibilidade | Texto curto que leitores de tela leem | Legenda |
| Tradução de legendas | A legenda em outro idioma, com os mesmos tempos | Legenda |
| Transcrição | A **legenda** do vídeo, a partir do áudio | O vídeo (o áudio é lido pelo provedor) |
| Trailer e clipe de fundo | Trailer de 30 a 60 s e um clipe **mudo** de 6 a 10 s (até 4 MB) para o fundo do destaque da home | ffmpeg (grátis) e, se quiser, a IA escolhendo os trechos |
| Capas (sem IA) | 3 capas candidatas por título, tiradas do próprio vídeo, com título e marca | ffmpeg (grátis) |

**Regra anti-invenção.** A IA só pode usar o que está na legenda. Se a legenda não sustenta o texto, ela responde
"insuficiente" e **nada é criado**. Nome de pessoa ou lugar que não aparece na legenda, no título, na série ou na sua
lista de nomes (`ia.textos.estilo.glossario`) é recusado pelo próprio sistema. Mesmo assim ela pode errar: por isso você revisa.

**Marca de origem.** Cada campo gerado leva `{ origem: "ia", modelo, data, revisado: false }`. Aceitar sem mexer não conta como
revisado; editar antes de aceitar conta.

## Quanto custa (estimativas de 2026-10-02: reconfira no site de cada provedor)

Os preços mudam. A tela IA mostra a **estimativa antes de cada lote**, com 20% de margem, e **recusa o lote que não cabe** no teto
do mês (`ia.orcamentoMensalUSD`, padrão US$ 5). Um preço que não foi conferido na página oficial é marcado "não conferido", e
você corrige em `ia.precos` no `config/site.json`.

Para **um vídeo de 1 hora**, todos os textos de uma vez, com a tradução para um idioma (já com a margem; a transcrição e o trailer ficam nas tabelas e no texto abaixo):

| Provedor de texto | Todos os textos juntos | Só uma sinopse |
|---|---|---|
| Claude Sonnet 5.5 (`claude-sonnet-5-5`; US$ 2 e US$ 10 por milhão de tokens, conferido) | cerca de US$ 0,56 (a tradução de legenda é a maior parte, cerca de US$ 0,29 por idioma) | cerca de US$ 0,04 |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`; US$ 1 e US$ 5, conferido) | cerca de US$ 0,28 | cerca de US$ 0,02 |
| Workers AI (`gemma-4-26b-a4b-it`, dentro da Cloudflare; US$ 0,10 e US$ 0,30, conferido) | cerca de US$ 0,02 | cerca de US$ 0,002 |
| OpenAI (`gpt-5-mini`) e Gemini (`gemini-3.5-flash-lite`) | **preço não conferido** na página oficial: use a estimativa da tela e confira com o fornecedor | |

| Transcrição | Preço por hora de áudio |
|---|---|
| Whisper no Workers AI (padrão) | cerca de US$ 0,03 (conferido) |
| AssemblyAI | de US$ 0,21 a US$ 0,45 (as fontes divergem; **não conferido**) |
| OpenAI (`whisper-1`) | cerca de US$ 0,36 (**não conferido**) |
| Legenda do próprio provedor de vídeo | Cloudflare Stream: sem custo extra; Bunny cobra por idioma (**não conferido**) |

O **ffmpeg é grátis** (capas, corte do trailer e do clipe). O **R2** (onde o trailer e o clipe ficam) tem 10 GB grátis e não cobra a
entrega; um clipe de ~1 a 3 MB mais um trailer de ~3 a 25 MB por título custam centavos por mês. A execução no GitHub é grátis até a
cota do seu plano (repositório público: sem limite prático; privado: veja a cota de minutos).

Limite honesto: a conta do mês é guardada no seu catálogo e não é atômica. Para lotes um após o outro basta; o **teto de verdade** é
o limite de gasto que você pode definir na conta do provedor de IA. Defina um.

## Privacidade: para onde vai o seu conteúdo

- **Workers AI (Cloudflare):** o conteúdo fica na sua conta Cloudflare.
- **Anthropic, OpenAI, Gemini, AssemblyAI:** a **legenda e o título** dos vídeos que você gerar são **enviados** a esse provedor,
  que os processa segundo os termos dele. Não ligue para vídeo que não pode sair da sua conta. Leia os termos do provedor sobre
  retenção e treino de modelos.
- O vídeo em si **não** vai ao provedor de texto. Só a transcrição por AssemblyAI, OpenAI ou Whisper recebe o **áudio**.
- **Execução pelo GitHub (opcional):** o executor (o computador do GitHub, chamado de runner) **lê o vídeo e o áudio** pelo endereço
  HLS e roda o ffmpeg lá, então o conteúdo também passa por um **terceiro** (o GitHub), além do provedor de IA. Além disso, a senha do
  superadmin (`APP_SENHA`) vira **segredo do GitHub**, o que **aumenta o raio de dano** se alguém ganhar acesso ao repositório.
  Se isso não for aceitável, rode no seu computador (`npm run ia:...`) e deixe o executor desligado.
- As chaves nunca aparecem na tela nem no catálogo: o `/admin` só mostra "chave guardada" ou "falta a chave".
- A legenda é tratada como **dado**, não como instrução: um vídeo que diga "ignore as ordens" não muda o comportamento.

## Como ligar, passo a passo

1. **Escolha o provedor** em `config/site.json` (nunca escreva a chave ali; só o **nome** da variável):
   ```json
   "ia": {
     "textos": { "provedor": "anthropic", "modelo": "claude-haiku-4-5-20251001", "chave": { "$env": "ANTHROPIC_API_KEY" } },
     "transcricao": { "provedor": "workers-ai-whisper", "idioma": "pt" },
     "orcamentoMensalUSD": 5
   }
   ```
   Modelos sugeridos: `claude-sonnet-5-5` (melhor texto) ou `claude-haiku-4-5-20251001` (mais barato). O nome exato de modelo de
   OpenAI e Gemini muda com o tempo: confirme na página do fornecedor.
2. **Guarde a chave** no prompt oculto (o valor não passa pelo chat nem por arquivo versionado):
   `node scripts/setup.mjs segredo ANTHROPIC_API_KEY`. Rode `node scripts/setup.mjs doctor --only=ia` para ver o que falta.
   Para o botão "Gerar agora" do `/admin` a chave precisa estar **no Worker**; para os scripts do seu computador, no `.env`
   (`node scripts/setup.mjs segredo ANTHROPIC_API_KEY --destino env`); para o GitHub, nos segredos do GitHub.
   O Workers AI dentro do Worker não usa chave: precisa só do `"ai": { "binding": "AI" }` no `wrangler.jsonc`.
3. **Publique** (`node scripts/setup.mjs deploy`) e abra `/admin`, tela **IA**.
4. **Ligue um recurso por vez**. O botão pede confirmação e lembra que o conteúdo vai ao provedor. Só o superadministrador liga.
5. **Gere para poucos títulos** (até 3 por vez na tela; lotes maiores pelos scripts ou pelo GitHub). Veja a estimativa, confirme.
6. **Revise a fila**: a sugestão aparece ao lado do que está no ar. Aceitar, Editar e aceitar, ou Descartar. O catálogo grava com
   histórico (dá para desfazer). Se o título mudou depois da sugestão, a tela avisa antes de sobrescrever.

## Em lote, pelo terminal (`npm run ia:...`)

Todos mostram a **estimativa antes** e só seguem com `--yes`; `--simular` só mostra. Precisam de `APP_SITE_URL` e `APP_SENHA`
(login do superadmin) no `.env`, e o recurso ligado na tela IA.

```bash
npm run ia:textos -- --tarefa sinopse-curta,tags --item id1,id2 --simular
npm run ia:textos -- --tarefa traducao-legenda --idiomas en,es --item id1 --yes
npm run ia:transcrever -- --item id1,id2 --yes
npm run ia:capas -- --item id1                       # 3 candidatas em dados/midia-gerada/ (ffmpeg, de graça)
npm run ia:trailer -- --video arquivo.mp4 --simular   # trailer + clipe de fundo; sem --ia usa a amostra automática (de graça)
npm run ia:trailer -- --video arquivo.mp4 --transcricao legenda.vtt --ia --yes
```

O custo real de cada chamada é registrado no site na hora, então o teto do mês vale para todo mundo.

## Trailer e clipe de fundo

1. O **ffmpeg** acha os cortes de cena e as pausas na fala.
2. Os **trechos** vêm de: um arquivo seu (`--trechos`), do modelo lendo a legenda (`--ia`), ou de uma amostra automática.
3. Cada trecho é encaixado no corte e na pausa mais próximos (nada começa no meio de uma fala).
4. Sai um **trailer** (até 60 s, com fade) e um **clipe mudo** de 6 a 10 s, sem corte no meio, de até 4 MB, com imagem de capa.
5. O arquivo vai para o **R2** (`ia.midia`: `destino: "r2"`, `bucket`, `urlBase`; o endereço entra sozinho na política de segurança do site) e
   a sugestão cai na tela IA. **Assista antes de aceitar.**
6. Aceito o clipe, o destaque da home passa a usá-lo como fundo se `home.destaque.fundo.tipo` for `"video-mudo"` (e `usarTrailer`
   não for `false`). Nada toca sozinho: o vídeo de fundo respeita o guardião do player (sem movimento reduzido, sem economia de dados,
   com botão de pausa).

Nenhum provedor de vídeo aceita clipe hoje; por isso o R2 da própria conta. Não gostou do clipe? Descarte a sugestão: o site continua só com a capa.

## Gerar no GitHub (opcional, desligado por padrão)

O Worker não roda ffmpeg. O fluxo `.github/workflows/gerar-midia.yml` roda os scripts no GitHub, com o ffmpeg de lá e as chaves guardadas
como segredos do GitHub. Dois jeitos de disparar, os dois **manuais**: a aba **Actions** do repositório (Run workflow) ou o botão
**Gerar no GitHub** da tela IA.

Para ligar:

1. No repositório, em Settings, Secrets and variables, Actions: variável `IA_EXECUTOR_LIGADO` = `true`, variável `APP_SITE_URL`, segredo
   `APP_SENHA` e os segredos do provedor de IA e de vídeo que você usa (a lista está no topo do arquivo do fluxo).
2. Para o **botão** do `/admin`: crie um token **fino** do GitHub, **só neste repositório**, com a permissão **Actions: Read and write**
   e **mais nenhuma**. Guarde-o no Worker: `node scripts/setup.mjs segredo GITHUB_DISPATCH_TOKEN`. Em `config/site.json`:
   `"ia": { "executor": { "github": { "ligado": true, "repositorio": "dono/repositorio" } } }`.
3. Confira: `node scripts/setup.mjs doctor --only=ia`.

O token nunca é devolvido por rota nenhuma (o `/admin` só sabe se ele existe). As entradas do fluxo são validadas e passam por variável
de ambiente, nunca coladas em comando. Só o superadministrador aperta o botão.

## Quando algo dá errado

| Mensagem | O que fazer |
|---|---|
| "Lote recusado: custaria X e o mês só tem Y" | Gere para menos títulos, escolha um modelo mais barato ou aumente `ia.orcamentoMensalUSD`. |
| "a legenda não sustenta (nada foi inventado)" | O vídeo tem pouca fala. Gere a legenda antes (Transcrição) ou escreva o texto à mão. |
| "falta a chave" | `node scripts/setup.mjs doctor --only=ia` diz qual; guarde com `setup.mjs segredo NOME`. |
| "falhou (nada foi gravado)" | O modelo respondeu fora do formato duas vezes. Tente de novo ou troque de modelo. Nada foi gravado, mas **a retentativa é cobrada**: o provedor cobra as duas chamadas (a recusada também), então uma tarefa que falha custa aproximadamente o dobro. O gasto real de cada chamada entra na conta do mês. |
| "O catálogo mudou enquanto você revisava" | Recarregue a tela e confira de novo antes de aceitar. |

## O que não foi confirmado

Os formatos atuais e os preços de **OpenAI** (chat e transcrição) e **Gemini** (`generateContent` e o modelo `gemini-3.5-flash-lite`)
e o preço do **AssemblyAI** não puderam ser lidos nas páginas oficiais na data desta pesquisa (2026-10-02). Eles funcionam pelo formato
publicado antes e estão marcados "não conferido" na estimativa. Também não foram confirmados ao vivo: a opção `--remote` do
`wrangler r2 object put` e o formato da API de imagem do Workers AI (capa por modelo de imagem, que existe como opção **desligada** e só
roda com `--modelo-imagem workers-ai --confirmo-custo`). Antes de apostar num deles, rode um teste com UM título.
