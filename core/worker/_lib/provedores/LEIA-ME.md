# core/worker/_lib/provedores/

Adaptadores de provedor de vídeo (M4). O Worker, os scripts de carga e os testes só
conhecem a interface de [`contrato.js`](contrato.js) (JSDoc de cada função); host,
caminho de API, tabela de status e nome de arquivo de capa de cada provedor ficam
**dentro** do adaptador. O navegador não conhece provedor: recebe `item.midia`.

| arquivo | o que é |
|---|---|
| `contrato.js` | a interface (JSDoc), `ErroProvedor`, `ESTADOS`, `validarAdaptador`, utilidades (`hostsLimpos`, `hostSimples`, `mascarar`, `rotuloDoIdioma`...) |
| `index.js` | o registro: `criarProvedor(config, env)`, `hostsDeMidia`, `montarMidia`, `comMidia`, `respostaDeErro` |
| `bunny.js` | Bunny Stream (referência; paridade com o comportamento de antes do M4) |
| `cloudflare-stream.js`, `hls-generico.js` | provedores seguintes, implementados a partir do contrato |

## Como um adaptador se apresenta

O módulo exporta `ID`, `CHAVE_CONFIG`, `CREDENCIAIS` e `criar(opcoes)`:

```js
export const ID = 'bunny';                       // = video.provedor do schema
export const CHAVE_CONFIG = 'bunny';             // bloco de config.video com as credenciais
export const CREDENCIAIS = {                     // nome na config -> variável padrão de ambiente
  bibliotecaId: { env: 'BUNNY_LIBRARY_ID', obrigatoria: true, segredo: true },
  ...
};
export function criar({ credenciais, config, fetch, agora }) { ... return adaptador; }
```

* `credenciais` já vem resolvida pelo registro: `video.<bloco>.<nome>` é `{"$env":"VAR"}` na config
  (nunca valor literal) e o valor sai de `env`; sem referência na config, vale `def.env`. Referência que
  aponta para variável ausente **não** cai no padrão (erro de configuração fica visível).
  `segredo: false` aceita texto literal na config (ex.: `baseUrl` do HLS genérico).
* `fetch`: use o injetado (`opcoes.fetch || globalThis.fetch`, lido **na hora da chamada**; os testes trocam o global).
  `agora`: relógio em milissegundos (`Date.now`), para assinaturas determinísticas nos testes.
* Toda `CHAVE_CONFIG` e toda chave de `CREDENCIAIS` precisam existir em `config/site.schema.json`
  (`video.<CHAVE_CONFIG>.<nome>`): há teste.

## O adaptador (resumo; o contrato completo está em `contrato.js`)

Propriedades: `id`, `configurado` (credenciais obrigatórias presentes), `padraoId` (RegExp do id do vídeo; é o
**único** lugar que sabe o formato do id: os handlers validam `videoId` com ele).

Síncronas: `capacidades()`, `hostsMidia()`.
Assíncronas: `validarCredenciais`, `criarUpload`, `retomarUpload`, `statusEncoding`, `urlReproducao`, `urlCapa`,
`definirCapa`, `urlPreview`, `legendas`, `enviarLegenda`, `obterVideo`, `listar`, `excluir`.
Opcionais (existem **se e só se** a capacidade for `true`): `gerarLegendaIA`, `definirCapitulos`, `receberWebhook`, `uso`.

Regras (a suíte `tests/provedores-contrato.test.js` confere todas):

1. Chave de API/token nunca sai: nem em retorno, nem em erro (`ErroProvedor.detalhe` passa por `mascarar`), nem em URL, nem em
   `cabecalhos` de um plano de upload (esses são credenciais de **uso único**).
2. Falha do provedor vira `ErroProvedor(codigo, { status, detalhe })`; os códigos estão em `CODIGOS_ERRO` e têm `api.<codigo>`
   nos três idiomas. Nada de exceção crua de `fetch`.
3. `padraoId` recusa o que muda caminho de URL; id inválido nunca chega à rede (`ErroProvedor('id-invalido')`).
4. `urlReproducao`/`urlCapa`/`urlPreview`/`legendas(id, { idiomas })` **não fazem rede**.
5. Nada de autoplay: o `embed.url` desliga autoplay/loop/preload quando o provedor aceita o parâmetro.
6. `urlReproducao(id, { assinar: true })` **rejeita** com `assinatura-indisponivel` enquanto `capacidades().assinatura` for `false`
   (nunca devolve URL aberta a quem pediu assinada). Com `assinar: true`, `urlCapa`, `urlPreview` e `legendas` também recebem `{ assinar, validadeSeg }`
   e assinam; `montarMidia` os passa juntos. Bunny (token de diretório, `BUNNY_TOKEN_KEY`) e Cloudflare Stream (JWT RS256 local) assinam; hls-generico não.
7. Status normalizado: `'enviando' | 'processando' | 'pronto' | 'erro'`; só `pronto` pode ir ao ar.

## O que o servidor entrega ao navegador: `item.midia`

```js
{ hls, mp4: { '240p', '360p', '720p' } | null, capa, previa, legendas: [{ idioma, rotulo, url }],
  embed: { url, scriptUrl?, controle? } | null, expiraEm }
```

`montarMidia(provedor, item)` junta `urlReproducao + urlCapa + urlPreview + legendas`. Devolve `null` se o item não tem vídeo
**neste** provedor (`fonte.provedor` diferente, ou id fora de `padraoId`). Idiomas de legenda: `item.legendas_idiomas`, ou o
idioma padrão do site (`config.idiomas.padrao`, só a raiz: `pt-BR` → `pt`).

## `fonte` do item

`{ provedor, id, extras }`. O formato antigo `{ tipo, libraryId, videoId }` é migrado por `App.migrarFonte`
(`core/site/catalogo-core.js`, pura e idempotente): o Worker migra ao **ler** e ao **gravar** o catálogo; nunca grava `midia`.

## CSP

`hostsMidia()` devolve `{ img, media, connect, frame, script }` com hosts `https://host` ou `https://*.dominio` (os estáticos de
`capacidades().hostsMidia` mais os da instalação: pull zone própria, subdomínio de clientes...). `core/worker/_lib/seguranca.js`
monta a CSP por resposta a partir deles; `core/site/_headers` é a política neutra (sem host de provedor).

## HLS genérico (`hls-generico.js`): o vídeo já está no servidor do cliente

Sem envio, sem API, sem assinatura: o site só toca um `.m3u8` em https (R2 com ffmpeg, Gumlet, api.video, servidor próprio).
O cadastro de um título é **colar endereços** (no /admin, `POST /api/midia?tipo=fonte`, ou em lote com
`scripts/cadastrar-hls.mjs`), e o adaptador (`prepararFonte`) confere cada um e escolhe o `id`.

* `fonte.id`: caminho do playlist sob `video.hlsGenerico.baseUrl` (`serie/ep1/master.m3u8`); se o endereço está fora da base
  (ou tem query), é `hls-<hash>` e o endereço fica em `extras.hls`.
* `fonte.extras`: `{ hls?, mp4?: { '720p': url }, capa?, legendas?: [{ idioma, rotulo, url }] }`, endereços absolutos em https.
  `item.capa_arquivo` (opcional) é um caminho de imagem sob a base. Nada é adivinhado por convenção de nome: sem cadastro,
  não há capa nem legenda.
* **Hosts liberados (decisão de segurança): só o host da `baseUrl` e os de `video.hlsGenerico.hostsPermitidos`**, ambos escritos
  pelo dono da instalação (config ou `HLS_BASE_URL`). A CSP NÃO é derivada dos endereços cadastrados nos títulos: quem edita o
  catálogo não amplia a política de segurança nem manda o navegador do público a um servidor qualquer. Endereço de host fora da
  lista é recusado ao cadastrar (`parametro-invalido`, detalhe `<campo>:host-nao-permitido`) e ignorado ao montar `item.midia`.
  O host dos segmentos (.ts/.m4s), se for outro, também entra em `hostsPermitidos`; o servidor precisa liberar CORS para o site.
* Estado: `statusEncoding` lê o playlist. Master (EXT-X-STREAM-INF) ou media com ENDLIST/VOD = `pronto`; media aberta (o encoder
  ainda escreve) = `processando`; HTML ou sem `#EXTM3U` = `erro`; 404/5xx = `ErroProvedor`. `enviando` não existe.
  Redirecionamento não é seguido (o host respondeu; o navegador segue).
* `excluir` não apaga nada (os arquivos são de quem hospeda: `{ ok: true, removido: false }`), `listar` é vazio, `assinar: true`
  é recusado (`assinatura-indisponivel`). O modo privado real é do provedor de quem hospeda.
* `statusEncoding`, `obterVideo`, `urlCapa` e `legendas` aceitam `{ extras }` (os `fonte.extras` do item): é como o adaptador
  enxerga o endereço guardado no item. `montarMidia` já os passa.

## Para escrever um adaptador novo

1. Copie a estrutura de `bunny.js`; implemente tudo de `FUNCOES_OBRIGATORIAS` (o que o provedor não faz rejeita com
   `ErroProvedor('recurso-indisponivel')` e fica `false` em `capacidades()`).
2. Grave fixtures em `tests/fixtures/provedores/<id>/` (formato em `tests/fixtures/provedores/LEIA-ME.md`).
   `node --test tests/provedores-contrato.test.js` roda a mesma suíte do Bunny no seu adaptador.
   Estado que o provedor não pode produzir (o HLS genérico não tem `enviando`) entra no manifesto em `estadosInalcancaveis`,
   com `motivoDosEstadosInalcancaveis`; a suíte então não exige a fixture.
3. Confira que o `CREDENCIAIS` bate com o schema e que `node scripts/anti-marca.mjs` e `npm test` seguem verdes.
