# Contas e chaves: passo a passo

Para quem instala o site (sem precisar entender de programação) e para o agente que ajuda. Os links abaixo levam
direto às páginas dos painéis. **Os painéis mudam de lugar e de nome de vez em quando**: se um link não abrir na tela
certa, entre no painel e procure o nome em negrito.

## Regras que valem para tudo

1. **Chave nunca vai para o chat, para e-mail ou para arquivo do projeto.** Ela entra pelo campo escondido do terminal
   (`node scripts/setup.mjs segredo NOME`, que usa o `wrangler secret put` por baixo) ou pelo painel da Cloudflare em
   "Variables and Secrets", tipo **Secret**.
2. Chave de **teste local** vai em `.env` ou `.dev.vars` (ignorados pelo git). Chave de **produção** vai nos segredos do Worker.
3. Guarde senhas no gerenciador de senhas. Ligue **2FA** em tudo (Cloudflare, GitHub, serviço de vídeo).
4. Escopo mínimo: token só com o que precisa, só na sua conta, com data de validade. **Nunca** use a "Global API Key".
5. Vazou? Revogue a chave no painel, crie outra, recoloque pelo campo escondido e rode `node scripts/setup.mjs scan-secrets`.

## 1. Cloudflare (grátis)

| O que fazer | Link |
|---|---|
| Criar a conta e confirmar o e-mail | https://dash.cloudflare.com/sign-up |
| Ligar a verificação em duas etapas | https://dash.cloudflare.com/profile/authentication |
| Ver Workers (o seu site) | https://dash.cloudflare.com/?to=/:account/workers-and-pages |
| Ver o KV (catálogo) | https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces |
| Ver o D1 (contas das pessoas) | https://dash.cloudflare.com/?to=/:account/workers/d1 |
| Turnstile (anti-robô, grátis; obrigatório no modo `cadastro`) | https://dash.cloudflare.com/?to=/:account/turnstile |
| Alertas de gasto (Notificações) | https://dash.cloudflare.com/?to=/:account/notifications |
| Tokens de API | https://dash.cloudflare.com/profile/api-tokens |

**Como abrir um terminal (para você digitar senhas e chaves):** o agente não pode digitar por você. Abra uma janela **nova**
de terminal na pasta do projeto, separada da conversa com o agente.

- **Windows:** abra a pasta do projeto no Explorador de Arquivos, clique na barra de endereço, apague o texto, digite `cmd` e tecle Enter.
- **Mac:** no Finder, clique com o botão direito (ou Control + clique) na pasta do projeto e escolha "Novo Terminal na Pasta"
  (se não aparecer, ative em Ajustes do Sistema, Teclado, Atalhos, Serviços). Ou abra o app Terminal e digite `cd ` (com espaço), arraste a pasta para a janela e tecle Enter.
- **Linux:** clique com o botão direito dentro da pasta e escolha "Abrir no terminal".

Cole ali o comando que o agente mostrou, tecle Enter e siga as perguntas. Quando terminar, diga ao agente "terminei".
(Digitar o comando na própria conversa do agente não serve: lá não existe campo escondido.)

**Login sem chave colada:** `npx wrangler login` abre o navegador e você clica **Permitir**
(equivale ao `wrangler login`). Isso basta para criar e publicar. Se existir a variável `CLOUDFLARE_API_TOKEN` no seu
computador, ela atrapalha o login pelo navegador; o `doctor` avisa e você a remove do ambiente.

**Se o navegador não abrir sozinho:** o terminal mostra um endereço comprido (começa com `https://dash.cloudflare.com/oauth2/auth`).
Copie e cole no navegador **do mesmo computador**; depois de clicar **Permitir**, volte ao terminal e espere terminar.
**Se o computador for remoto** (conexão SSH, máquina na nuvem, sandbox do agente), o login pelo navegador não completa,
porque a volta acontece neste computador: use o Caminho B do `COMECE-AQUI.md` ou peça ajuda a quem indicou o produto.
Um token de API só entra como último recurso, com as permissões mínimas da tabela abaixo, digitado no campo escondido e nunca no chat.

**ID da conta** (`CLOUDFLARE_ACCOUNT_ID`, 32 caracteres, não é segredo): aparece na URL do painel depois de entrar
e na página **Workers e Pages**, barra lateral direita.

**Turnstile** (só para o modo `cadastro`): em Turnstile, "Adicionar widget", informe o endereço do seu site. Você recebe
duas coisas: a **chave do site** (`TURNSTILE_SITE_KEY`, pública, vai em `config/site.json`) e a **chave secreta**
(`TURNSTILE_SECRET`, vai por `setup.mjs segredo TURNSTILE_SECRET`).

### Token de API só quando for preciso

Para publicar pelo seu computador, o login pelo navegador basta. Token só é necessário para automações (por exemplo
publicar pelo GitHub Actions). Em https://dash.cloudflare.com/profile/api-tokens, "Criar token", **personalizado**:

| Para quê | Permissão mínima | Escopo |
|---|---|---|
| Publicar o Worker pelo GitHub Actions | Contas: **Workers Scripts: Edit**; Contas: **Workers KV Storage: Edit**; Contas: **D1: Edit** | só a sua conta |
| Cloudflare Stream como provedor de vídeo | Contas: **Stream: Edit** | só a sua conta |

Defina uma **data de validade**. O token só aparece uma vez: ele vai direto para o campo escondido, nunca para o chat.
Os nomes das permissões podem variar um pouco no painel.

## 2. Bunny Stream (serviço de vídeo, opção mais barata)

| O que fazer | Link |
|---|---|
| Criar a conta | https://dash.bunny.net/auth/register |
| Painel de Stream (bibliotecas de vídeo) | https://dash.bunny.net/stream |
| Faturamento e limites | https://dash.bunny.net/account/billing |

Passo a passo:

1. Crie a conta, confirme o e-mail e ligue o 2FA. Cadastre o cartão (o Bunny cobra a partir de US$ 1 por mês).
2. Em **Stream**, "Add Video Library". Escolha um nome e as regiões de armazenamento.
3. Abra a biblioteca. Anote:
   - **Library ID** (o número da biblioteca): `BUNNY_LIBRARY_ID`. Não é segredo.
   - **Stream API Key** (na aba **API** da biblioteca): `BUNNY_API_KEY`. **Segredo.** Use a chave **da biblioteca**, não a "Account API Key".
   - **Endereço de entrega** (a "pull zone" da biblioteca, algo como `vz-xxxxxxxx-xxx.b-cdn.net`): `BUNNY_PULLZONE`. Não é segredo.
4. Só para os modos `privado` e `cadastro` (links assinados): na biblioteca, em **Security**, ligue a autenticação por token
   e copie a chave: `BUNNY_TOKEN_KEY` (**segredo**). Opcional: `BUNNY_EMBED_KEY`.
5. Configure o **limite de banda mensal** e o alerta de gasto no painel (é o único teto de gasto real do Bunny; ao
   atingir o limite os vídeos param, então deixe uma folga).
6. Rode `node scripts/setup.mjs video`: ele pede, na ordem, o Library ID e o endereço de entrega (números e endereços aparecem na tela, para você conferir) e as chaves secretas (campo escondido). Nos modos `privado` e `cadastro` ele pede também a chave de token e o endereço de entrega; no modo `publico`, só o Library ID e a Stream API Key. Depois: `setup.mjs doctor --only=video`.

## 3. Cloudflare Stream (serviço de vídeo na mesma conta)

| O que fazer | Link |
|---|---|
| Ativar e ver o Stream | https://dash.cloudflare.com/?to=/:account/stream |
| Criar token de API | https://dash.cloudflare.com/profile/api-tokens |

1. Ative o Stream na sua conta (exige plano pago; cobra por minuto guardado e assistido, veja `docs/provedores.md`).
2. Anote o **ID da conta**: `CLOUDFLARE_ACCOUNT_ID` (não é segredo).
3. Crie um token com a permissão **Stream: Edit** (veja a tabela acima): `CLOUDFLARE_STREAM_TOKEN` (**segredo**).
4. Na página do Stream, copie o **subdomínio de clientes** (algo como `customer-xxxx`): `CLOUDFLARE_STREAM_SUBDOMINIO`. Não é segredo.
5. Modo `privado`: chave de assinatura (`CLOUDFLARE_STREAM_KEY_ID` e `CLOUDFLARE_STREAM_KEY_JWK` ou `..._PEM`), criada
   pela API do Stream; o agente roda a criação e guarda por `setup.mjs segredo`. Detalhes em `docs/provedores.md`.

## 4. Onde fica cada chave

| Nome | Segredo? | Onde mora em produção | Quem cria |
|---|---|---|---|
| `SESSION_SECRET` | sim | segredo do Worker | gerado pelo `setup.mjs` |
| `ADMIN_PASSWORD` | sim | segredo do Worker | você escolhe (mínimo 12 caracteres) e digita duas vezes no campo escondido; guarde no gerenciador de senhas |
| `BUNNY_API_KEY`, `BUNNY_TOKEN_KEY`, `BUNNY_EMBED_KEY` | sim | segredo do Worker | painel do Bunny |
| `BUNNY_LIBRARY_ID`, `BUNNY_PULLZONE` | não | `.env` / variável da config | painel do Bunny |
| `CLOUDFLARE_STREAM_TOKEN`, chave de assinatura | sim | segredo do Worker | painel da Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_SUBDOMINIO` | não | variável da config | painel da Cloudflare |
| `TURNSTILE_SECRET` | sim | segredo do Worker | Turnstile |
| `TURNSTILE_SITE_KEY` | não (pública) | `config/site.json` | Turnstile |

O arquivo `.env.example` lista só os nomes. `node scripts/setup.mjs doctor` mostra quais segredos existem **pelo nome**,
nunca o valor.

## 5. Checklist antes de divulgar o site

Um comando roda a verificação de cada item e imprime **OK**, **FALHA** ou **MANUAL** (o que só uma pessoa confirma):

```bash
node scripts/setup.mjs go-live --url https://seu-site.exemplo.com --video-id ID_DO_VIDEO
node scripts/setup.mjs go-live --json     # o mesmo, para programas (dados.itens[] com id, estado, detalhe, comando)
```

Códigos de saída: `1` se algum item der FALHA (cada um diz como corrigir); `3` se só faltarem itens MANUAL (o agente lê cada um à
pessoa, uma pergunta por vez, e confirma com `--confirmado id1,id2`); `0` quando tudo está OK ou confirmado. O teste do limite
de login envia 12 tentativas com senha errada a uma conta que não existe (`go-live-teste`); `--pular-limite` não o faz.
Sem o programa `gh` (GitHub CLI) logado, os itens do GitHub viram MANUAL, nunca FALHA de mentira.

Cada caixa abaixo traz o `id` do item e o comando exato que o confere. **auto** = o `go-live` decide sozinho; **manual** = só a
pessoa confirma, e o comando diz onde olhar.

**A. Contas e acesso**

- [ ] `2fa-cloudflare` (manual) 2FA ligado na Cloudflare. Onde: abrir https://dash.cloudflare.com/profile/authentication
- [ ] `2fa-github` (manual) 2FA ligado no GitHub. Onde: abrir https://github.com/settings/security
- [ ] `2fa-video` (manual) 2FA ligado no serviço de vídeo. Onde: painel do provedor, em Segurança
- [ ] `repo-privado` (auto, com `gh`) repositório do site privado. Comando: `gh repo view --json isPrivate`

**B. Segredos e configuração**

- [ ] `config-valida` (auto) config válida e arquivos gerados em dia. Comando: `npm run config:validar && npm run config:aplicar`
- [ ] `segredos-presentes` (auto) segredos presentes no Worker, só os nomes. Comando: `node scripts/setup.mjs doctor --only admin,video`
- [ ] `sem-segredo-no-git` (auto) nenhum segredo nos arquivos e `.env` fora do git. Comando: `node scripts/setup.mjs scan-secrets`
- [ ] `senhas-guardadas` (manual) senha de admin e e-mail de recuperação no gerenciador de senhas. Pergunte à pessoa; nunca peça a senha.

**C. Modo de acesso**

- [ ] `modo-testado-de-fora` (auto) no `privado` e no `cadastro`, catálogo e vídeo sem entrar **falham** (401/403). Comando: `node scripts/setup.mjs doctor --remote --video-id ID_DO_VIDEO`
- [ ] `turnstile` (auto) no modo `cadastro`, Turnstile ligado. Comando: `node scripts/setup.mjs turnstile` e `node scripts/setup.mjs doctor --only acesso`
- [ ] `limite-de-login` (auto) a 11ª tentativa de login em 10 s é recusada. Comando: `node scripts/setup.mjs go-live`
- [ ] `referrers-do-provedor` (manual) só o seu domínio como origem permitida e autenticação por token ligada. Onde: Bunny, pull zone, Security (Allowed Referrers e Token Authentication)

**D. Conteúdo e custos**

- [ ] `video-de-teste` (manual) um vídeo de teste processado e tocando no celular **e** no computador. Onde: o site, entrando se o modo for restrito; o `/admin` mostra o estado do envio
- [ ] `custo-aceito` (manual) custo mensal estimado aceito por você. Onde: `/admin`, tela Custos, ou `docs/custos.md`
- [ ] `alertas-de-gasto` (manual) limite de banda do Bunny e alerta de gasto da Cloudflare. Onde: Cloudflare, Notificações, Billable Usage; Bunny, Billing, Usage Limits

**E. Operação**

- [ ] `dominio-https` (auto) domínio próprio com HTTPS e `www` redirecionando. Comando: `curl -sI https://SEU-DOMINIO/ ; curl -sI https://www.SEU-DOMINIO/` (o `go-live` faz isso com o `marca.dominio` da config)
- [ ] `deploy-automatico` (auto, com `gh`) deploy automático funcionando, com testes verdes antes. Comando: `gh run list --workflow deploy.yml --limit 3`
- [ ] `backup-recente` (auto, com `gh`) backup rodado há menos de 48 h. Comando: `gh run list --workflow backup.yml --limit 3` (ou rode um agora: `npm run backup`)
- [ ] `restauracao-testada` (manual) backup restaurado num projeto de teste. Comando: `node scripts/importar-kv.mjs backup.json` (sem `--yes` só mostra o que mudaria)
- [ ] `monitor-de-saude` (manual) monitor externo em `/api/saude` com alerta no seu e-mail. Comando: `curl -s -o /dev/null -w "%{http_code}" https://SEU-SITE/api/saude` (esperado 401 sem entrar)
- [ ] `atualizar-core` (auto, com `gh`) atualização semanal do core ligada. Comando: `gh workflow list` (o fluxo `atualizar-core` deve estar ativo)
- [ ] `segundo-administrador` (manual) uma segunda pessoa de confiança sabe como recuperar a conta.

**F. Legal**

- [ ] `politica-e-termos` (auto) política de privacidade e termos preenchidos (peça orientação jurídica; isto não é aconselhamento jurídico). Comando: `curl -s https://SEU-SITE/api/legal`
- [ ] `direito-de-exibir` (manual) você tem direito de exibir todo o conteúdo publicado.

Antes de rodar o `go-live`, rode também `node scripts/setup.mjs doctor --remote`: sem erros e sem avisos.
