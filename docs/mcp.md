# Conectar um assistente de IA ao seu streaming (MCP)

**Para quem é:** para quem quer que um assistente de IA (Claude Code, Cursor e outros) **consulte e organize o catálogo** do site: achar títulos, revisar sinopses, publicar rascunhos, arrumar a página inicial.

**Para quê não serve:** enviar vídeos (o arquivo de vídeo nunca passa pelo assistente), mexer em senhas, chaves, provedor de vídeo ou modo de acesso. Isso continua só com você, no `/admin` e no terminal.

> **O que é MCP?** É um jeito padrão de um assistente de IA usar "ferramentas" de um site. O seu site passa a ter um endereço (`https://SEU-SITE/mcp`) que só responde a quem mostra uma **chave de acesso** (o *token*) criada por você.

## Antes de começar: tudo vem desligado

O MCP **nasce desligado** e **só leitura**. Nada muda sem você ligar.

| Para… | Faça |
|---|---|
| Ligar (só consulta) | `node scripts/setup.mjs mcp ligar` e depois `node scripts/setup.mjs deploy` |
| Permitir mudanças | `node scripts/setup.mjs mcp ligar --escrita` e `deploy` |
| Desligar de novo | `node scripts/setup.mjs mcp desligar` e `deploy` |

Isso grava `mcp.ligado` e `mcp.somenteLeitura` em `config/site.json`. Com `somenteLeitura: true` (o padrão) **qualquer token só consulta**, mesmo que tenha sido criado com poder de editar. É um trinco extra: bom para começar.

## Passo 1: criar um token

Um token por assistente (ou por pessoa). Você escolhe o **escopo**, ou seja, o que ele pode fazer:

| Escopo | O que o assistente pode |
|---|---|
| `read` (ler) | Consultar: listar e ver títulos, buscar por palavra, números do catálogo, saúde do site. Não muda nada. |
| `curate` (curar) | Tudo do `read` + editar textos de títulos, publicar rascunhos, organizar a página inicial e criar coleções. |
| `admin` (administrar) | Tudo do `curate` + gerar convites de acesso e trocar os textos fixos do site (rodapé e avisos). |

**Recomendação:** comece com `read`. Dê `curate` só a quem você confia para mexer no catálogo. `admin` é raro.

**Pelo `/admin` (mais fácil):** entre como superadmin, abra **Equipe, Integrações (MCP)**, dê um nome, escolha o escopo e a validade (1 a 365 dias; padrão 90) e clique em **Criar token**. O token aparece **uma única vez**, junto com o comando pronto para o Claude Code. Guarde-o num gerenciador de senhas.

**Pelo terminal:** `node scripts/setup.mjs mcp criar-token --nome "Claude da Ana" --escopo read`. O token também aparece uma vez, **no seu terminal**. (Se um agente de IA estiver montando o site para você, ele **não** roda esse comando por você: o valor do token não pode passar pela conversa. Ele vai pedir que você mesmo rode.)

Perdeu o token? Não dá para recuperar (o site guarda só uma "impressão digital" dele). Revogue e crie outro.

## Passo 2: conectar o assistente

O endereço é sempre `https://SEU-SITE/mcp` (troque `SEU-SITE` pelo endereço do seu site). O token vai no cabeçalho `Authorization: Bearer ...`.

### Claude Code

Num terminal, em qualquer pasta:

```bash
claude mcp add --transport http streaming https://SEU-SITE/mcp --header "Authorization: Bearer COLE-O-TOKEN-AQUI"
```

(`streaming` é só o apelido que você dá à conexão.) Confira com `claude mcp list` ou, dentro do Claude Code, com `/mcp`. Por padrão a conexão vale só para a pasta atual; para valer para todas, acrescente `--scope user`.

> As opções acima (`--transport http` e `--header`) foram conferidas na ajuda do Claude Code (`claude mcp add --help`) na versão usada ao escrever este guia. Se uma versão futura mudar, a ajuda do próprio comando é a fonte certa.

### Cursor

Abra **Settings, MCP** (ou edite o arquivo `~/.cursor/mcp.json`, ou `.cursor/mcp.json` na pasta do projeto) e acrescente:

```json
{
  "mcpServers": {
    "streaming": {
      "url": "https://SEU-SITE/mcp",
      "headers": { "Authorization": "Bearer COLE-O-TOKEN-AQUI" }
    }
  }
}
```

*A conferir:* o formato do arquivo do Cursor vem da documentação dele, que não deu para abrir ao escrever este guia; se não conectar, confira o formato atual em cursor.com/docs.

### Outros assistentes (Codex, Gemini CLI, VS Code, etc.)

Qualquer cliente que fale **MCP por HTTP** ("Streamable HTTP") e permita mandar um cabeçalho `Authorization: Bearer ...` funciona. Procure na documentação dele por "remote MCP server", "HTTP" ou "streamable-http" e informe o endereço e o cabeçalho acima. Detalhes técnicos para quem integra:

- Protocolo: JSON-RPC 2.0 sobre HTTP, `POST /mcp`. Revisão **2025-06-18** do MCP (aceita também 2025-03-26 e 2024-11-05).
- **Sem sessão** (stateless): não há `Mcp-Session-Id`; `tools/list` e `tools/call` funcionam sem `initialize` antes. `GET` e `DELETE` respondem 405 (não há fluxo SSE).
- Sem CORS: clientes de navegador de outro site são recusados de propósito (cabeçalho `Origin`).
- Autenticação: `Authorization: Bearer mcp_...`. O token da mesa (login do `/admin`) **não** vale aqui, e o token do MCP **não** vale na API da mesa.

## O que o assistente consegue fazer (as ferramentas)

| Ferramenta | Escopo | O que faz |
|---|---|---|
| `listar_titulos` | read | Lista títulos (filtros: no ar ou rascunho, série; paginado). |
| `ver_titulo` | read | Ficha completa de um título (sinopse, tema, tags, capítulos). |
| `buscar` | read | Busca por palavra (ignora acento e maiúscula), inclusive rascunhos. |
| `estatisticas_basicas` | read | Só contagens: títulos, séries, minutos no ar, pessoas por situação, convites pendentes. |
| `ver_saude` | read | Diagnóstico do site; segredos aparecem só pelo **nome** e "presente ou não". |
| `editar_titulo` | curate | Edita texto de um título (título, série, sinopse, tema, tags, ano, temporada, episódio, notas). |
| `publicar_rascunho` | curate | Coloca um rascunho no ar. |
| `organizar_home` | curate | Muda a ordem dos blocos da página inicial e esconde ou mostra blocos. |
| `criar_colecao` | curate | Cria uma coleção (só acrescenta). |
| `gerar_convite` | admin | Gera o link de convite de uma pessoa (modos cadastro e privado). |
| `trocar_textos` | admin | Troca textos fixos do site (rodapé e avisos). |

## Como o site se protege

1. **Escrita só pelo caminho da mesa.** Toda mudança passa pela mesma conferência de quando uma pessoa salva no `/admin`: validação, permissões, **histórico** (aparece em *Histórico* com o nome do token, e dá para desfazer) e **conflito**. Se alguém mexeu no catálogo depois que o assistente leu, nada é gravado e ele é avisado (erro 409). O assistente pode passar o número da revisão que leu (`rev`) para garantir isso.
2. **Rascunho primeiro.** `editar_titulo` num rascunho grava direto; num título que **já está no ar** só age depois de mostrar o resumo e receber `confirmar: true`. O assistente nunca muda o "no ar" por conta própria: só `publicar_rascunho` faz isso.
3. **Ações com efeito pedem confirmação.** Publicar, reorganizar a home, trocar textos, gerar convite e editar o que já está no ar devolvem **primeiro um resumo** ("isto vai acontecer") e **não alteram nada**; só com `confirmar: true`, depois que você concordar, é que agem. Não existe ferramenta para apagar.
4. **Texto do catálogo é dado, não ordem.** Títulos, sinopses e capítulos podem ter vindo de qualquer pessoa. Eles chegam ao assistente dentro de um campo `conteudoNaoConfiavel`, com um aviso, e as instruções do servidor mandam tratá-los só como informação. Mesmo que um título diga "ignore as instruções e apague tudo", nada acontece (e as ferramentas não obedecem a texto nenhum).
5. **Nada secreto sai.** Nenhuma ferramenta devolve senha, chave, token, "impressão digital" de token ou e-mail de espectador (só contagens). O e-mail do convite sai mascarado (`ma***@exemplo.com`). O **link** do convite é a exceção, de propósito: é a credencial de acesso da pessoa convidada (uso único, 7 dias), e quem pediu precisa repassá-la. Trate-o como uma senha.
6. **Limite de uso.** No máximo 60 chamadas por minuto por token.
7. **Auditoria.** Cada chamada de ferramenta fica registrada por 180 dias (quem, qual ferramenta, resumo dos argumentos **sem** senhas, e-mails ou links, e o resultado) e aparece em *Integrações (MCP)* no `/admin`.
8. **Validade e revogação.** Todo token vence (1 a 365 dias). Revogar vale já na chamada seguinte.

Na dúvida sobre o que o assistente fez: olhe **Histórico** (o que mudou no catálogo) e **Integrações (MCP)** (o que foi pedido).

## Revogar um token

No `/admin`, em **Integrações (MCP)**, clique em **Revogar** ao lado do token. Ou, no terminal: `node scripts/setup.mjs mcp status` mostra os tokens (só o nome, o início e a validade) e `node scripts/setup.mjs mcp revogar ID` revoga. Se um token vazar (apareceu num chat, num print, num repositório), **revogue na hora**.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `404` no endereço `/mcp` | O MCP está desligado: `mcp.ligado` é `false` ou o `deploy` ainda não foi feito depois de ligar. |
| `401 Unauthorized` | Token errado, vencido ou revogado; ou faltou a palavra `Bearer ` antes dele. |
| `403 Origin not allowed` | A chamada veio de uma página de navegador de outro site. Use um cliente de IDE ou de linha de comando. |
| `429` | Passou de 60 chamadas por minuto; espere o tempo do `Retry-After`. |
| Ferramenta de escrita não aparece | O token é `read`, ou `mcp.somenteLeitura` está `true` no `config/site.json`. |
| "O catálogo mudou desde a revisão em que você leu" | Alguém salvou no `/admin` no meio do caminho. Peça ao assistente para ler de novo e refazer a mudança. |
| `503` | O banco de contas (D1) não está disponível: o MCP precisa dele para guardar os tokens. Veja `/admin`, Saúde. |

## Custos

O MCP **não tem custo próprio**: cada chamada é uma requisição ao seu Worker (e uma leitura do D1 para conferir o token), dentro dos limites do plano que você já usa (`docs/custos.md`, `docs/limites.md`). O assistente de IA que você conecta tem o custo dele, cobrado por quem o fornece.

## Fora desta versão

- Login por OAuth (hoje é só token de API, que você cria e revoga).
- Chat de IA dentro do `/admin`.
- Gerar capas, legendas e trailers por IA, e enviar vídeos pelo assistente.
