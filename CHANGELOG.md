# Histórico de mudanças

Formato: uma seção por versão, da mais nova para a mais antiga. Versões seguem SemVer (X.Y.Z):
mudança que quebra a configuração só entra em versão MAIOR, com migração automática
(`scripts/migrar-config.mjs`). Cada versão tem as partes **Novidades**, **Correções**, **Segurança** e
**Precisa de ação sua**. Esta última é a que a pessoa que cuida do site precisa ler: se disser "Nenhuma",
basta conferir e publicar. As atualizações pelo `atualizar-core.yml` copiam a parte "Precisa de ação sua"
para o texto do Pull Request.

## [0.1.0] - 2026-10-02

Primeira versão pública para teste.

### Novidades
- Site de vídeo sob demanda (HLS) com home por blocos, coleções, busca por palavra e pela fala, e player
  com legendas, capítulos, "Continuar assistindo" e próximo episódio.
- Três modos de acesso (`publico`, `cadastro`, `privado`) com mídia assinada nos modos restritos.
- Provedores de vídeo: Bunny Stream, Cloudflare Stream e HLS genérico.
- Instalação guiada por qualquer agente de IA (`AGENTS.md`, `scripts/setup.mjs`) e assistente de configuração no `/admin`.
- Tela Saúde, backup e restauração (`scripts/exportar-kv.mjs`, `scripts/importar-kv.mjs`), calculadora de custo
  (`docs/custos.md`) e atualização do produto sem tocar na sua configuração (`docs/atualizar.md`).
- Servidor MCP opcional (`/mcp`, desligado por padrão e só leitura): assistentes de IA como o Claude Code consultam e organizam o catálogo com um
  token que você cria e revoga em `/admin`, Integrações (MCP), ou por `setup.mjs mcp`. Escrita só pelo caminho validado da mesa, com histórico,
  confirmação nas ações com efeito e auditoria (`docs/mcp.md`).

- IA de conteúdo opcional (M9, tudo desligado e pago por uso): sinopses, capítulos, tags, título alternativo, descrição para acessibilidade,
  tradução e transcrição de legendas, capas por template, trailer e clipe mudo de fundo para o destaque da home. Estimativa de custo antes de cada
  lote, teto mensal (`ia.orcamentoMensalUSD`), proveniência em cada campo e **nada vai ao ar sem uma pessoa aceitar** na tela IA do `/admin`.
  Executor opcional no GitHub (`gerar-midia.yml`). Guia: `docs/ia.md`.

### Correções
- A mensagem de erro do player quando o vídeo não carrega agora aparece em até 15 segundos (antes, cerca de 52).

### Segurança
- Nenhuma.

### Precisa de ação sua
- Nenhuma.
