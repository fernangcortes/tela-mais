# Guia de desenvolvimento (para quem altera o código)

Moradia das regras técnicas detalhadas que o `AGENTS.md` resume. Vale para pessoas e agentes que
mexem no código do tela mAIs. Quem só está montando o streaming de um cliente não precisa deste arquivo.

## Comandos

```bash
npm test                      # testes (Node 22+); comando oficial, equivale a `node --test`
npm run config:validar        # valida config/site.json contra config/site.schema.json (sai 1 se inválida)
npm run config:aplicar        # gera theme.css, manifest, robots.txt, config.public.json e os trechos marcados do HTML (idempotente; --verificar só confere)
npm run dev                   # wrangler dev: Worker + assets locais (segredos em .dev.vars)
node scripts/anti-marca.mjs   # varredura anti-marca; precisa dar zero ocorrências
node scripts/i18n-faltando.mjs # en e es completos em relação ao pt-BR (chaves, {parâmetros}, plurais); precisa dar 0
node scripts/i18n-literais.mjs # conta texto de interface em português escrito no código (fora de core/locales); abaixo do limite
node scripts/cores-literais.mjs # lista cor literal (#hex, rgb()...) fora de theme.css/tokens-fixos.css; precisa dar zero. Cor sempre via var(--token)
```

Depois de editar `config/site.json`, rode `config:validar` e `config:aplicar` e versione os arquivos gerados. Config ausente ou inválida faz o Worker falhar fechado (modo `privado`). Precedência: KV > arquivo > padrão do schema. Tokens de sessão usam `SESSION_SECRET`, separado de `ADMIN_PASSWORD`.

Rode `npm test` e a varredura anti-marca antes de dar uma tarefa por concluída.

## Textos da interface (i18n)

Texto que a pessoa lê **não se escreve no código**: vai em `core/locales/{pt-BR,en,es}.json`
(a chave nasce no pt-BR e é traduzida de verdade nos outros dois) e entra por `tr('namespace.chave', { parametros })`
(`AppI18n.t`, de `core/site/i18n.js`, o mesmo no site, na mesa e no Worker). Plural: o valor vira
`{ "one": "{n} título", "other": "{n} títulos" }` e a chamada passa `n`. Erro de API: `erro(status, 'codigo')`
(`core/worker/_lib/sessao.js`) devolve `{ codigo, mensagem, erro }`, e o front traduz por `api.<codigo>`. Data, hora e
duração saem do Intl pelo idioma (`AppI18n.data`, `.duracao`...), nunca com `'pt-BR'` escrito. O cliente troca textos em
`config.textos[idioma]` ou acrescenta idioma em `config/locales/<idioma>.json`; `aplicar-config` gera `core/site/locales/*.json`.
Dado que não é texto de tela (rótulo de legenda, valor de enum gravado) leva o marcador `i18n-ignorar` na linha.

## Provedor de vídeo

Guia para o cliente: `docs/provedores.md` (mantenha em dia ao mudar credenciais, capacidades ou preços). Tudo que sabe de um provedor (host, API, status, capa, legenda, assinatura) mora num **adaptador** em
`core/worker/_lib/provedores/` (`bunny.js`, `cloudflare-stream.js`, `hls-generico.js`), atrás da interface de
`contrato.js`; o provedor sai de `video.provedor` em `config/site.json` e as credenciais de variáveis de ambiente
(`{"$env":"NOME"}`). O navegador **não conhece provedor**: o servidor entrega `item.midia = { hls, mp4, capa, previa, legendas[], embed }`
pronto, e o upload do /admin segue o plano que `criarUpload` devolve (endpoint e cabeçalhos vêm do servidor). `fonte` do item é
`{ provedor, id, extras }` (o formato antigo `{ tipo, libraryId, videoId }` é migrado por `App.migrarFonte`). Nenhum host de provedor
em `core/site/` (`tests/provedores-worker.test.js` confere), nenhuma regra de provedor fora do adaptador. Adaptador novo ou
alterado: rode `node --test tests/provedores-contrato.test.js` (a mesma suíte para todos, com fixtures em
`tests/fixtures/provedores/<id>/`) e leia `core/worker/_lib/provedores/LEIA-ME.md`. Scripts de carga usam o mesmo código por
`scripts/lib/provedores/index.mjs` (nenhum script fala com um provedor por fora do adaptador; o que é de um provedor só fica atrás
de `capacidades()`). HLS genérico: a CSP libera só o host de `video.hlsGenerico.baseUrl` e os de `hostsPermitidos` (config do dono),
nunca os endereços colados nos títulos. A CSP sai dos `hostsMidia()` do adaptador; `core/site/_headers` é gerado por
`node scripts/gerar-headers.mjs` (política neutra).

## Contas e acesso

Guia para o cliente: `docs/modos-de-acesso.md` (leigo) e `docs/acesso.md` (técnico). Mídia assinada: `opcoesDeAssinatura(data)` (`_lib/provedores/index.js`) decide `assinar` só com modo ≠ publico, `assinarMidia` e sessão válida; catálogo e `/api/midia` a usam, provedor sem chave devolve 501 (nunca URL aberta); teste: `tests/contas-midia-assinada.test.js`. Modos `publico | cadastro | privado` (padrão: o mais fechado). Pessoas moram no **D1**
(binding `DB`, migrações em `core/migrations/` com cópia em `indice.mjs`; criação preguiçosa no 1º acesso), nunca no KV.
Espectador: cookie opaco `__Host-sessao` (só o SHA-256 no banco), convite com link copiável, link mágico de uso único (15 min,
gasto por POST), cadastro com Turnstile obrigatório (falha fechada), limite de tentativas (`_lib/limite.js`), consentimento
versionado, Minha conta (exportar/excluir) e cron de retenção. Equipe: token Bearer como antes, contas no D1 (importadas do
KV). O superadmin é a variável `ADMIN_PASSWORD`. Quem é a pessoa: `sessaoDaRequisicao` (`_lib/sessoes.js`), já em
`data.sessao` no handler. Toda consulta do caminho quente usa índice (`tests/contas-d1.test.js`, `EXPLAIN QUERY PLAN`):
não adicione consulta por requisição sem índice. Nada de segredo, IP ou e-mail em claro em chave de limite ou log.

## MCP (assistentes de IA)

Guia para o cliente: `docs/mcp.md`. `/mcp` (`core/worker/mcp.js`) é um servidor MCP remoto **stateless**, JSON-RPC 2.0 à mão sobre Streamable HTTP,
revisão 2025-06-18 (aceita 2025-03-26 e 2024-11-05); sem `Mcp-Session-Id`, `GET`/`DELETE` dão 405. Ordem das defesas: `mcp.ligado` (padrão `false`, senão 404)
> `Origin` de outro site (403) > token `mcp_…` (`_lib/mcp-tokens.js`; só o SHA-256 no D1, tabelas da migração 0003, validade obrigatória, revogação, escopo
`read < curate < admin`) > limite por token (60/min, `_lib/limite.js`) > escopo efetivo = o menor entre o do token e `mcp.somenteLeitura` (padrão `true`) >
auditoria de toda `tools/call` (`mcp_auditoria`, 180 dias, argumentos resumidos sem segredo/e-mail/link). As ferramentas moram em `_lib/mcp-ferramentas.js`.
**Regras que os testes cobram** (`tests/mcp-*.test.js`): (1) escrita SÓ por `gravarCatalogo` (`api/catalogo.js`), o mesmo caminho do PUT da mesa (validação,
permissão por campo com a conta `mcp:<nome>` sem poder de super, histórico, 409); nunca `CATALOGO.put` direto. (2) Ferramenta que muda o que está no ar, publica,
reorganiza a home, troca textos ou gera convite devolve antes o resumo e só age com `confirmar: true`; não existe ferramenta de apagar. (3) Todo texto do catálogo
sai dentro de `conteudoNaoConfiavel` com `aviso`; texto nunca vira ordem. (4) Nada de segredo, chave, hash de token ou e-mail de espectador na resposta (só
contagens; o link do convite é a única credencial que sai, de propósito). Ferramenta nova: entrada em `FERRAMENTAS` com `escopo`, descrição em `mcp.d.<nome>` nos
três locales, e teste de escopo, confirmação, vazamento e auditoria. O `/mcp` está na matriz (`'aberto'` para o middleware; o handler autentica) e em
`run_worker_first` do `wrangler.jsonc`. Tela: `mesa-mcp.js` + `/api/mcp-tokens` (só super). CLI: `setup.mjs mcp` (o token nunca passa pelo agente).

## Player e guardião

Guia para o cliente: `docs/player.md`. `core/site/guardiao.js` é o guardião único (`podeIniciarSozinho`) e saneia `player.*` e
`home.destaque.fundo`; `.play()` só existe em `tocarPorGesto` e `tocarAutomatico` (player.js, esta começa pelo guardião) e em
`tocarFundo` (destaque-fundo.js, também atrás do guardião). Não crie outro caminho de play: `tests/player-guardiao.test.js` e
`tests/player-fundo.test.js` quebram. O padrão (`autoplay.modo: nunca`, próximo e retomar `nunca`, fundo `capa`) é o comportamento de sempre.

## Home por blocos, coleções e Minha lista

Guia para o cliente: `docs/home-e-colecoes.md`. A chegada é uma lista de blocos (`core/site/home-blocos.js`, puro, sem DOM; recebe as
primitivas do `catalogo-core.js`, que é quem chama `App.home(itens, site, contexto)`; `App.prateleiras` é só as fileiras dela). Vale
`site.blocos` (editado na tela Home da mesa, pelo rascunho e pelo PUT do catálogo: permissão `estrutura`, histórico e 409) > `home.blocos` do
config > o padrão do código, que desenha a chegada de sempre (`tests/home-blocos.test.js` carrega o algoritmo antigo e exige o mesmo
resultado). Tipo de bloco novo: registre em `TIPOS` e `PARAMETROS`, no enum do schema (`tests/home-config.test.js` cobra os dois lados), em
`mesa-home.js` e nos três locales. Coleções livres (`catalogo.colecoes` ou `site.colecoes`) substituíram as listas `SERIES_*`. O servidor põe o
config por baixo do `site` no GET (`App.siteComPadroes`) e entrega `padroes` à parte para a mesa; `padroes` e `quem` nunca são gravados. Minha lista:
`/api/minha-lista` (D1, só espectador, teto de 200, sempre a de quem pede). `app.js` declara tudo com `function`: nome repetido substitui o
anterior em silêncio (`tests/home-site.test.js` confere). O service worker (`sw.js`, gerado) é opcional e desligado por padrão; nunca guarda API,
conta, mesa nem mídia.

## Integração do destaque e documentação

O bloco `destaque` é desenhado por `blocoDoDestaque` (app.js), que chama `ligarFundoDoDestaque`; só ele monta o fundo
(`montarFundoDoDestaque`, carregado sob demanda: `guardiao.js` e `destaque-fundo.js` não entram no `index.html`) e
guarda o `{ destruir }`. Não monte o fundo dentro de `destaqueHtml`. Guia do cliente: `docs/personalizar.md`; mantenha-o
em dia com `docs/home-e-colecoes.md` e `docs/player.md` quando mudar opção de config.

## Tema, cores e fontes

Cor **não se escreve** em `core/site/*.css` nem em JS: use `var(--token)`. Só `theme.css` (gerado) e `tokens-fixos.css`
têm cor literal; `node scripts/cores-literais.mjs` confere. Tema vem de `config/site.json`: `tema.preset` (`cinema`,
`claro`, `alto-contraste`, `institucional`, `vibrante`, `aconchegante`), `tema.modo` (`auto|escuro|claro`) e
`tema.cores.<modo>` para sobrescrever. Fonte: `tema.tipografia` com origem `sistema` ou `arquivo` (woff2 em `config/fontes/`).
O validador recusa paleta abaixo de 4,5:1 (texto) ou 3:1 (controles). Depois de mudar, rode `node scripts/aplicar-config.mjs`.

## Estilo

- Mantenha o estilo existente: ESM, funções pequenas, comentários em pt-BR explicando
  o porquê, não o quê.
- Todo comportamento novo vem com teste em `tests/`.
- Caminhos de arquivos locais são relativos à raiz do repositório.

