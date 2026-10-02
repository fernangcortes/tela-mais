# Player e vídeo de fundo

Guia para quem configura o player e o fundo do destaque. Tudo se escolhe em `config/site.json`
(`player` e `home.destaque.fundo`) ou no /admin; o padrão é o de sempre: **nada toca, nada avança,
nada retoma sozinho**.

## O guardião (`core/site/guardiao.js`)

Só existem dois lugares no player que chamam `play()`: `tocarPorGesto` (a pessoa apertou play,
tecla ou toque) e `tocarAutomatico`, que **começa perguntando ao guardião**
(`podeIniciarSozinho(contexto, config)`). O vídeo de fundo tem o seu `play()` em
`destaque-fundo.js`, também atrás do mesmo guardião. Regras que valem para qualquer config:

- `player.autoplay.modo: "nunca"` (padrão): nenhum vídeo começa sem gesto.
- Nenhuma opção produz som sem gesto: o início sem gesto sai **mudo**, exceto no modo
  `com-som-apos-interacao`, que só vale depois de a pessoa já ter clicado, tocado ou digitado na página.
- A prévia do /admin (`?mesa=1` dentro de um quadro) nunca começa nada sozinha.

## `player.*`

| Opção | Valores | Padrão |
|---|---|---|
| `autoplay.modo` | `nunca` · `mudo` · `com-som-apos-interacao` | `nunca` |
| `autoplay.somenteDesktop`, `respeitarEconomiaDeDados` | verdadeiro/falso | verdadeiro |
| `proximoEpisodio.modo` | `nunca` · `perguntar` (cartão "A seguir", espera o clique) · `automatico` (contagem até o fim do vídeo) | `nunca` |
| `proximoEpisodio.segundosDeContagem`, `mostrarCartaoNosUltimosSeg` | segundos | 8 · 20 |
| `retomar.modo` | `nunca` · `perguntar` (cartão) · `automatico` (posiciona ao apertar play; nunca dá play sozinho) | `nunca` |
| `retomar.guardarPosicao` | verdadeiro/falso | verdadeiro |
| `velocidades` | lista entre 0,25 e 4 (o 1× sempre entra) | 0,25 a 2 |
| `legenda.idiomaPadrao` | ex.: `pt-BR` (vale quando o título tem essa faixa) | primeira faixa |
| `marcaDagua` | `{ ligada, texto }` | desligada |
| `download.ligado` | só aparece quando o provedor entrega um MP4 do título (HLS puro não se baixa) | desligado |

`proximoEpisodio.modo: "automatico"` só vale com `autoplay.modo` diferente de `nunca`; sem isso
vira `perguntar`.

Quando o vídeo não carrega, o player mostra uma mensagem em português claro (no idioma da pessoa)
e o botão "Tentar de novo". **A mensagem aparece em até 15 segundos** do primeiro erro de rede: o player
não usa as tentativas padrão do hls.js (que somavam cerca de 52 s), e sim um prazo próprio, com poucas
tentativas por segmento e por manifesto e um relógio que corre desde o primeiro erro (`configHls` e
`ESPERA_REDE_MS` em `core/site/player-core.js`; `orcamentoDeFalhaMs()` faz a conta e um teste a confere).
Ao aparecer a mensagem, o player também tira os estados de "tocando" e "carregando".

## `home.destaque.fundo`

`tipo`: `capa` (padrão) · `previa-animada` (prévia animada do provedor, `item.midia.previa`) ·
`video-mudo` (clipe curto: `item.midia.clipe`, HLS do adaptador, ou uma prévia em MP4/WebM). O fundo
**nunca usa a mídia principal nem som**.

> **Não espere vídeo por enquanto.** Nenhum adaptador de provedor atual emite `midia.clipe`, e o
> `hls-generico` não emite `previa`. Na prática, `video-mudo` só produz vídeo se o título trouxer uma
> prévia MP4/WebM, e nenhum adaptador a entrega hoje. Sem fonte o fundo fica na capa, sem erro. A
> opção existe para quando um adaptador (ou um item cadastrado à mão com `midia.clipe`) trouxer o clipe.

- Não carrega nada com "reduzir movimento" ou economia de dados (`saveData` ou conexão 2G): esses
  dois portões não se desligam.
- Desligado no celular por padrão (`somenteDesktop: true`).
- Só toca com o destaque à vista e a aba visível; espera a capa (o LCP) e `atrasoMs`.
- Botão de pausa sempre visível (WCAG 2.2.2); a capa é o poster e o fallback.
- Depois de `repeticoes` voltas, descansa na capa (não é loop infinito).
- Não conta como reprodução: não grava "onde parou" nem aparece em "Continuar assistindo".
- Custo: um clipe em R2 ou estático (alvo de 15 a 30 s e 2 a 4 MB) custa quase nada; o mesmo clipe
  no Stream do provedor é cobrado por minuto entregue.

## Orçamento de LCP da home

O LCP da home é a capa do destaque. Medido com `node scripts/medir-lcp.mjs` (Chromium via Playwright,
9 rodadas, mediana; serve `core/site` com um catálogo de 6 títulos e capas de ~80 KB). Números de
02/10/2026, em laboratório:

| Cenário | Desktop, sem limite | Desktop, CPU 4x e rede 1,6 Mbps / 150 ms |
|---|---|---|
| Home padrão (`fundo.tipo: capa`) | 92 ms | 5,49 s |
| Com `video-mudo` (clipe WebM de 4 s) | 2,71 s | 5,48 s (o clipe nem começou antes da capa) |

**Orçamento acordado**

- **Home padrão:** não pode passar de **+10 %** (ou +150 ms, o que for maior) sobre os números da primeira
  linha. É o que impede um bloco ou um script novo de piorar a chegada de quem não ligou nada. O número
  absoluto no perfil lento (5,5 s) está acima da meta de 2,5 s do Web Vitals: é custo do `app.js`, do CSS e
  do catálogo, e fica registrado como dívida, não como aceitável.
- **Com fundo de vídeo:** a regressão máxima aceita é de **+3 s no desktop sem limite**, e só para quem liga o
  fundo (opt-in, desligado no celular). Motivo medido: o primeiro quadro do vídeo é candidato a LCP (maior
  que a capa), então o LCP passa a ser "atraso + início do clipe". Em rede lenta o clipe só começa depois da
  capa e a medida não muda.

O que já protege o LCP: nada do fundo baixa antes da capa do destaque (`depoisDaCapaPrincipal`); a camada do
fundo nasce com `opacity: 0` e só aparece com movimento (medido antes disso: o poster em tela cheia,
pintado 1,2 s depois, subia o LCP de 92 ms para 1,08 s sem nem haver vídeo); e `atrasoMs` empurra o início.
`tests/fundo-geometria.test.js` trava a camada invisível e a geometria. Quem ligar o fundo e se importar
com o LCP deve medir com `scripts/medir-lcp.mjs` antes de publicar.
