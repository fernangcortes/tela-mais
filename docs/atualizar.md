# Atualizar o produto, fazer backup e publicar automático

Este guia é para quem cuida do site depois que ele está no ar. Tudo aqui é **opcional**: o site
funciona sem nada disto. Mas backup e atualização são o que mantém o site vivo a longo prazo.

## A ideia: três camadas que não se misturam

| Camada | O que é | Quem muda | A atualização... |
|---|---|---|---|
| **Produto** | `core/`, `scripts/`, `tests/`, `docs/`, as instruções dos agentes (`AGENTS.md`...) e o esquema `config/site.schema.json` | quem mantém o produto | **substitui** |
| **Sua configuração** | `config/site.json`, `config/fontes/`, `wrangler.jsonc`, a sua marca (`core/site/marca/`) | você | **nunca toca** |
| **Seu conteúdo** | o catálogo e os vídeos (no KV e no provedor), `dados/`, os segredos do Worker | você | **nunca toca** |

Por isso atualizar não dá conflito: você não edita o produto, e o produto não edita o que é seu.
(O esquema `config/site.schema.json` é o único arquivo de `config/` que é do produto: ele só diz o
que é válido no seu `site.json`.) Se você precisa de algo que a configuração não permite, peça a
quem indicou o produto em vez de editar `core/`: a próxima atualização apagaria a sua edição.

## Como saber que há versão nova

- O `/admin` mostra o aviso "Há versão nova" quando a última release pública do produto é mais nova
  que o arquivo `.core-version` da sua cópia. Se a internet falhar na hora, o aviso só não aparece.
- O arquivo `CHANGELOG.md` conta o que mudou em cada versão, sempre com quatro partes:
  **Novidades**, **Correções**, **Segurança** e **Precisa de ação sua**. Leia esta última primeiro:
  se disser "Nenhuma", basta conferir e publicar. Correções de segurança vêm destacadas.

## Três jeitos de atualizar (do mais fácil ao mais manual)

### 1. Pedindo ao seu agente de IA

Diga: "atualize o produto". O agente roda, na pasta do projeto:

```bash
node scripts/atualizar-core.mjs --baixar --simular     # mostra o que mudaria, sem gravar
node scripts/atualizar-core.mjs --baixar               # baixa a última release, confere o sha256 e aplica
node scripts/migrar-config.mjs                         # leva o seu site.json ao formato novo, se mudou
npm run config:validar && npm run config:aplicar       # regera os arquivos do site com a SUA marca
npm test                                               # (só na cópia com a marca de exemplo; veja abaixo)
```

e mostra a você o "Precisa de ação sua" antes de publicar (`node scripts/setup.mjs deploy`).

### 2. Pull Request automático (recomendado para quem usa GitHub)

O fluxo `.github/workflows/atualizar-core.yml` roda **todo domingo** (e quando você clicar em
"Run workflow"): baixa a release nova, aplica só o produto, migra a configuração, regera os
arquivos, confere e **abre um Pull Request** com um resumo de poucas linhas, o "Precisa de ação
sua" e o changelog. **Você só olha e clica em Merge.** Para voltar atrás, o botão "Revert" do
próprio GitHub.

Para funcionar, ligue uma vez: *Settings > Actions > General > "Allow GitHub Actions to create and
approve pull requests"*. Sem isso o fluxo avisa e para.

Atenção: Pull Requests abertos com o token padrão do GitHub **não disparam** os outros fluxos (é uma
regra do GitHub). Por isso o fluxo já roda as conferências antes de abrir o PR. Se quiser os testes
rodando também no PR, crie um token fino (só neste repositório, *Contents* e *Pull requests* com
leitura e escrita) e guarde como segredo `ATUALIZAR_TOKEN`.

### 3. À mão, com a pasta da release

Baixe `core-vX.Y.Z.tar.gz` e `core-vX.Y.Z.sha256` da página de releases do produto e rode
`node scripts/atualizar-core.mjs --de caminho/para/core-vX.Y.Z.tar.gz`. O script faz tudo igual.

### O que a atualização garante

- Só toca as pastas e arquivos do **Produto** (tabela acima). Não toca em `config/site.json`,
  `config/fontes/`, `wrangler.jsonc`, `core/site/marca/`, `dados/`, `.env`, `README.md` nem em
  `.github/workflows/` (o GitHub não deixa um fluxo trocar outros fluxos; se um fluxo novo for
  preciso, o `CHANGELOG` diz em "Precisa de ação sua").
- Recusa versão **mais antiga** que a instalada e arquivo cujo `sha256` não confere.
- Não faz commit nem publica sozinho: quem faz é o Pull Request (e o seu "Merge") ou você.
- Se uma versão mudar o formato do `site.json`, o `migrar-config.mjs` faz a conversão e guarda a
  cópia anterior em `config/site.json.antes-da-migracao`. Se o seu `site.json` for **mais novo** que o
  core instalado, o script para e pede para atualizar o core primeiro.

### Os testes do produto e a sua marca

Os testes do produto conferem a marca neutra "Plataforma Exemplo". Numa cópia já personalizada eles
falham por isso, e **não é defeito seu**: o fluxo `testes.yml` e o `setup.mjs deploy` pulam essa
parte sozinhos e rodam o resto (configuração válida, arquivos gerados em dia, varredura de segredos).

## Backup e restauração

**O que o backup guarda:** o catálogo (com a estrutura da home e os ajustes do player), a configuração
operacional que você edita no `/admin` (home, textos, player, recursos) e, só pelo botão do `/admin`, os
textos de privacidade e termos. **Opcional:** a equipe (`--com-contas`: traz hash de senha, trate como
dado sensível) e, só pelo botão do `/admin` e só do superadmin, os espectadores (e-mail, nome, estado;
nunca senha nem sessão).

**O que NÃO guarda** (e como protegê-lo):

| O que | Onde fica | Como proteger |
|---|---|---|
| Os vídeos | no provedor (Bunny, Stream...) | guarde o arquivo-mestre original (HD, nuvem). Apagar no provedor é irreversível |
| Segredos do Worker | na Cloudflare | guarde a senha de admin e as chaves no seu gerenciador de senhas |
| Histórico de versões do catálogo | KV | é memória do `/admin`; a restauração cria uma publicação nova |
| Índice da busca | KV | se refaz pelo `/admin` (reindexar) |
| Cadastros de espectadores e sessões (pelo terminal) | banco D1 | o botão do `/admin` exporta os espectadores; `npx wrangler d1 export NOME --remote --output=d1.sql` exporta tudo (a Cloudflare também mantém o Time Travel por alguns dias) |
| Sua configuração | `config/` no seu repositório Git | o próprio Git já é o backup |

### Três jeitos de fazer backup

1. **Pelo `/admin`:** botão "Baixar backup" (a equipe baixa o básico; só o superadmin inclui contas). É o
   mais completo e o mais simples para um backup antes de uma mudança grande.
2. **Pelo terminal:** `node scripts/exportar-kv.mjs` grava `dados/backup-AAAA-MM-DD.json` (a pasta
   `dados/` nunca vai para o Git). Precisa de `wrangler login`. Só **lê**: não altera nada
   (`--registrar` é a exceção: anota "backup feito agora" para a tela Saúde e precisa de escrita no KV).
3. **Automático, todo dia, para um repositório privado separado:** fluxo `backup.yml`
   (**desligado por padrão**), veja abaixo.

O arquivo é o **mesmo** nos três jeitos (formato e verificação em `core/worker/_lib/backup.js`): um
backup baixado pelo `/admin` restaura pelo script e vice-versa. Cada parte e o conjunto têm uma
impressão digital (SHA-256): se o arquivo for alterado ou ficar incompleto, a restauração recusa antes
de tocar em qualquer coisa.

### Restaurar

```bash
node scripts/importar-kv.mjs dados/backup-2026-10-02.json          # SÓ confere e mostra o que mudaria
node scripts/importar-kv.mjs dados/backup-2026-10-02.json --yes    # restaura (sobrescreve o catálogo atual!)
```

- Sem `--yes` nada é alterado: o script confere o arquivo e mostra o que seria restaurado.
- Com `--yes` ele **primeiro guarda o estado atual** em `dados/pre-restauracao-*.json`, depois restaura
  como uma **publicação nova** (a revisão do catálogo sobe e entra no histórico: dá para voltar pelo
  `/admin`) e por fim **relê o KV e confere o hash do catálogo** contra o do arquivo. Se não bater, avisa.
- Por padrão restaura o catálogo e a configuração operacional (`--partes` escolhe). A equipe só volta com
  `--com-contas`, e **nunca sobrescreve uma conta que já existe**. Nunca apaga chaves.
- Textos legais e espectadores (banco D1) só se restauram pelo botão do `/admin`.
- Depois, reindexe a busca pelo `/admin` se você usa a busca pela fala ou por sentido.
- **Teste a restauração uma vez**, num projeto de teste (`--namespace-id` de outro KV): backup que
  nunca foi restaurado não é backup. Para comparar: exporte de novo e veja que `hashDoCatalogo` é o
  mesmo (a revisão anda, o conteúdo não).

### Backup automático (`backup.yml`)

Passo a passo, uma vez só:

1. Crie um repositório **privado e vazio** no GitHub só para os backups (ex.: `backup-da-minha-tela`).
2. No repositório do **site**, *Settings > Secrets and variables > Actions*:
   - Variables: `BACKUP_LIGADO` = `true`; `BACKUP_REPOSITORIO` = `seu-usuario/backup-da-minha-tela`;
     (opcional) `BACKUP_COM_CONTAS` = `true`; (opcional) `BACKUP_REGISTRAR` = `true`, para a tela Saúde
     do `/admin` mostrar o "último backup" (exige que o token da Cloudflare também tenha escrita no KV).
   - Secrets: `CLOUDFLARE_ACCOUNT_ID`; `CLOUDFLARE_API_TOKEN` **só de leitura** (veja abaixo);
     `BACKUP_REPO_TOKEN` (token fino do GitHub com acesso **só** ao repositório de backup, *Contents:
     Read and write*).
3. Em *Actions > backup > Run workflow*, rode uma vez à mão e confira o arquivo no repositório de backup.

O fluxo exporta o KV, valida o arquivo, guarda em `backups/backup-AAAA-MM-DD.json`, mantém **30
diários e 12 mensais** (`scripts/podar-backups.mjs`) e **recusa** seguir se o repositório de backup
for público.

## Publicar automático (`deploy.yml`)

A cada push na `main` o fluxo roda os testes e, **só se passarem**, publica com `wrangler deploy`.
Vem **desligado**: sem os dois segredos abaixo ele roda os testes e para, sem erro. A publicação
manual (`node scripts/setup.mjs deploy`) continua funcionando.

Segredos do repositório (*Settings > Secrets and variables > Actions*):

| Segredo | O que é |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | o ID da sua conta (32 caracteres, na barra lateral do painel da Cloudflare) |
| `CLOUDFLARE_API_TOKEN` | um token **criado só para isto**, com o mínimo de permissão |

Crie o token em *Cloudflare > Meu perfil > Tokens de API > Criar token > Criar token personalizado*:

- **Para publicar (`deploy.yml`):** *Conta > Workers Scripts > Editar* e *Conta > Configurações da conta > Ler*.
  Restrinja o token a **uma conta** e defina uma **data de expiração**. (Restringir por IP não serve
  em CI: os endereços dos servidores do GitHub mudam.)
- **Para o backup (`backup.yml`):** apenas *Conta > Workers KV Storage > Ler* e *Conta > Configurações
  da conta > Ler* (com `BACKUP_REGISTRAR`, *Workers KV Storage > Editar*). **Outro token**, nunca o mesmo da publicação.
- Não use a "Chave de API global" nem o modelo "Editar Cloudflare Workers" inteiro (dá mais permissão
  que o necessário). Se o primeiro deploy reclamar de permissão, o erro diz qual falta: acrescente só ela.
  (As permissões acima são o ponto de partida; **confirme no primeiro deploy**.)
- Os segredos do Worker (`ADMIN_PASSWORD`, `SESSION_SECRET`, chaves do provedor) **não** vão para o GitHub:
  já estão na Cloudflare, e o `wrangler deploy` não os lê nem os muda.

Opcional: a variável `SITE_URL` (endereço do site) liga um teste de fumaça depois de publicar.
Para desligar tudo de novo, apague o segredo `CLOUDFLARE_API_TOKEN`.

## Para quem mantém o produto: lançar uma release

1. Escreva a seção `## [X.Y.Z] - AAAA-MM-DD` no `CHANGELOG.md` (as quatro partes).
2. `node scripts/preparar-release.mjs --versao X.Y.Z --data AAAA-MM-DD` muda a versão em
   `.core-version`, `package.json` (é dali que a tela Saúde lê a versão) e nos parâmetros do `LICENSE`
   (**Change Date = 4 anos depois da publicação**, o máximo da BSL; o texto-base não é tocado).
3. `node scripts/preparar-release.mjs --verificar` confere que tudo concorda; `npm test`.
4. Faça o commit e a tag `vX.Y.Z`. O fluxo `release.yml` gera `core-vX.Y.Z.tar.gz` e
   `core-vX.Y.Z.sha256` e publica a release com as notas do changelog: é o que as cópias dos clientes
   baixam.
