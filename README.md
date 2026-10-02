# tela mAIs

Streaming white label (vídeo sob demanda, no estilo das grandes plataformas) que cada
cliente instala na **própria conta Cloudflare**, com a própria marca. Site estático em
HTML, CSS e JavaScript puros, sem framework e sem build, mais funções serverless e
scripts Node para administrar o catálogo.

## Estado atual

**Marco M1 de um plano em marcos. Ainda não está pronto para produção.** Nesta etapa o
código está sendo separado em um repositório próprio e neutro (marca padrão
"Plataforma Exemplo"). Ainda não há instalador, o roteiro de setup para leigos chega
no M7 e a conversão das funções para Cloudflare Workers é o M2.

## Licença

Business Source License 1.1 (arquivo `LICENSE`, em inglês, que prevalece). Uso em
produção é **grátis abaixo de R$ 1 milhão por ano** de faturamento ou orçamento total
da organização. Acima disso, licença comercial: veja `COMMERCIAL.md`. Explicação em
português em `LICENCA-PT.md`. A versão 0.1.0 vira Apache-2.0 em 2030-10-01.
Componentes de terceiros: `NOTICE`.

## Estrutura de pastas

```
core/site/            site estático (páginas, CSS, JS, vendor/)
core/worker/          Worker (roteador, middleware, permissões, API, _lib/ com config e segurança)
wrangler.jsonc        Worker com Static Assets (assets em core/site, binding KV CATALOGO)
scripts/              scripts Node (catálogo, legendas, sinopses...) e scripts/lib/
tests/                testes (npm test)
config/site.json      configuração do site (sem segredos; segredos ficam em variáveis de ambiente)
config/site.schema.json  esquema (JSON Schema) da configuração
exemplo/              catálogo de exemplo fictício
.github/workflows/    integração contínua
```

## Como rodar os testes

Requer Node 22 ou mais novo. Não há dependências para instalar.

```bash
npm test                        # todos os testes (equivale a `node --test`)
node scripts/anti-marca.mjs     # varredura anti-marca (deve terminar sem ocorrências)
npm run config:validar          # valida config/site.json
npm run config:aplicar          # gera theme.css, manifest, robots.txt e config.public.json
npm run dev                     # wrangler dev (Worker + site local)
```

## Contribuindo

Veja `AGENTS.md` para as regras do projeto (vale para pessoas e para agentes de IA).
