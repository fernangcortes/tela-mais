# AGENTS.md

Guia para qualquer agente LLM (e para pessoas) que trabalhe neste repositório.

## O que é

tela mAIs: streaming white label (vídeo sob demanda estilo Netflix) que cada cliente
instala na própria conta Cloudflare. Site estático (HTML/CSS/JS sem framework, sem
build), um Worker da Cloudflare em `core/worker/` (roteador próprio, sem
dependências; `wrangler.jsonc` na raiz) e scripts Node (`scripts/`, ESM, sem dependências).
Código e documentação em pt-BR. Estado: M4 concluído (adaptadores de vídeo bunny, cloudflare-stream e hls-generico), não pronto para produção.

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

## Roteiro de setup para leigos

Ainda não existe. Ele chega no marco M7 do plano. Até lá, não prometa instalação
guiada em documentação ou na interface.
