# Acesso, contas e privacidade

Guia para quem instala e opera o site. O código está em `core/worker/` (rotas em `api/auth/`, `api/conta/`,
`api/convites.js`, `api/espectadores.js`, `api/legal.js`; regras em `_lib/contas*.js`, `_lib/sessoes.js`,
`_lib/limite.js`, `_lib/turnstile.js`, `_lib/email.js`) e as telas em `core/site/` (`entrar.html`,
`cadastro.html`, `conta.html`, `privacidade.html`, `termos.html`, e a tela **Acesso** do `/admin`).

Versão para leigos: `docs/modos-de-acesso.md`.

## Os três modos (`acesso.modo` em `config/site.json`)

| | `publico` | `cadastro` | `privado` (padrão) |
|---|---|---|---|
| Catálogo e busca | abertos | exigem sessão | exigem sessão |
| Quem entra | todos | quem se cadastrar | só convidados |
| Contas de espectador | não existem | sim (D1) | sim (D1) |
| Anti-abuso | limite nas entradas | **Turnstile obrigatório** + limite + teto de sessões | Turnstile (se configurado), limite, bloqueio progressivo |
| Capa na home (preload) | ligada | desligada | desligada |

Config ausente, quebrada ou com modo inventado vale `privado`. Atenção: **login não impede gravação de tela**. O
vídeo só fica protegido de verdade com endereço assinado (`acesso.privado.assinarMidia`, ver `docs/provedores.md`).

## O que precisa existir no Cloudflare

- **D1** (binding `DB`, já declarado em `wrangler.jsonc`). As tabelas nascem sozinhas na primeira requisição que
  precisa delas (`core/migrations/`); se preferir, `wrangler d1 migrations apply DB --remote` aplica o mesmo SQL.
  Sem D1 só a equipe entra (as contas dela voltam a morar no KV) e os recursos de espectador respondem 503
  `banco-ausente`: **falha fechada**.
- **`SESSION_SECRET`** (secret, 32+ caracteres, diferente da senha do admin) e **`ADMIN_PASSWORD`**. O
  superadmin continua sendo a variável de ambiente: é o caminho de recuperação se o banco estiver vazio.
- **`APP_SITE_URL`** (variável): o endereço público do site. É com ele que os links de convite e de acesso são
  montados; sem ele vale o endereço do pedido.
- **Cadastro aberto** (`modo: cadastro`) só abre com **`TURNSTILE_SECRET`** (secret) e **`TURNSTILE_SITE_KEY`**
  (variável, a chave pública). Sem os dois o cadastro fica fechado, e a tela Acesso diz o motivo. Se o
  siteverify da Cloudflare não responder, o cadastro é recusado (falha fechada). `acesso.cadastro.turnstile: false`
  não desliga isto, vale só para o login.
- **E-mail** (`acesso.email.adaptador`): `nenhum` (padrão), `resend` ou `cloudflare-email`.
  - `nenhum`: nada é enviado. A tela **Acesso** gera o link e você o copia e manda por WhatsApp. Cabe 100% no plano
    grátis. O cadastro por link mágico precisa de e-mail; sem ele use `acesso.cadastro.metodo: "email-e-senha"`.
  - `resend`: secret `RESEND_API_KEY` e variável `EMAIL_REMETENTE` (`Nome <aviso@seu-dominio.com>`, domínio verificado no
    Resend). O envio é uma chamada `fetch`, sem biblioteca.
  - `cloudflare-email`: opção futura (Email Service da Cloudflare, ainda beta e do plano pago). Hoje não envia: o fluxo
    cai no link copiável.
- Opcional: o binding de **Rate Limiting** (`LIMITE_ENTRADA`, exemplo comentado em `wrangler.jsonc`) poupa uma
  escrita de D1 por tentativa de entrada.

## Como a pessoa entra

1. **Convite** (principal no `privado`): na tela Acesso, digite o e-mail e copie o link (vale 7 dias, uso único).
   A pessoa abre o link, aceita a política e os termos e entra.
2. **Link mágico**: a pessoa digita o e-mail e recebe um link de 15 minutos, de uso único. O e-mail pode ser de
   quem já tem conta, de `acesso.privado.listaDeEmails` (modo `privado`) ou de quem se cadastrou.
3. **Cadastro** (modo `cadastro`): e-mail, aceite e desafio anti-robô; confirma o e-mail pelo link. Com `metodo:
   "email-e-senha"` há senha (mínimo `acesso.senha.tamanhoMinimo`); com verificação de e-mail a senha é definida
   na página do link, por quem é dono do e-mail. `acesso.cadastro.aprovacaoManual` deixa a conta `pendente` até a
   equipe aprovar. `dominiosPermitidos` restringe os domínios.

O token do link vai no **fragmento** do endereço (`entrar.html#t=...`): não chega ao servidor, não entra em log nem em
Referer, e **abrir o link não o gasta**. Quem gasta é o botão "Entrar" (POST): pré-visualizadores de e-mail e de
mensageiro não queimam o link.

Ao trocar `cadastro` por `privado`, as contas já criadas continuam valendo: bloqueie ou exclua quem não deve ficar.

## Segurança, em resumo

- Sessão por **cookie opaco** (`__Host-sessao`, `HttpOnly; Secure; SameSite=Lax; Path=/`), 32 bytes sorteados. No banco
  fica só o **SHA-256**. Apagar a linha revoga na hora (sair, bloquear, derrubar sessões, excluir a conta). Duração:
  `acesso.sessao.horasEspectador` (padrão 30 dias, renovada no máximo uma vez por dia); equipe, `horasEquipe` (8 h).
  `acesso.sessao.maximoSimultaneas` (padrão 5) derruba a sessão mais antiga ao passar do teto.
- A equipe e o superadmin seguem com o token **Bearer** (HMAC por `SESSION_SECRET`): a mesa e os scripts de carga
  não mudaram. As contas da equipe agora moram no D1; as que estavam no KV (`admins`) são importadas sozinhas na
  primeira execução, com a mesma versão (os tokens abertos continuam valendo). A chave do KV fica como cópia.
- **Anti-enumeração**: pedir link, cadastrar e entrar respondem igual para e-mail existente, inexistente ou bloqueado, e
  também **no mesmo tempo**: criar o link, gravar o aceite e enviar o e-mail rodam fora da resposta (`waitUntil`), e quem
  não tem conta passa por um trabalho vazio no mesmo lugar. A senha errada custa o mesmo com ou sem conta (hash de mentira).
- **Limites**: 10 tentativas em 10 s por IP (11ª recusada, 429); 5 links por e-mail a cada 15 min; bloqueio
  progressivo por IP + conta a partir da 5ª senha errada (1 min, 2, 4... até 1 h). A chave do limite é um hash: o
  IP e o e-mail não ficam em claro. Além disso há um **teto por conta**, de qualquer IP: 50 senhas erradas por hora
  contra o mesmo e-mail (existente ou não) recusam a senha (429) até a janela passar. Só conta falha, então o dono que
  erra uma ou duas vezes nunca chega perto; o link mágico e o convite do admin continuam abertos para ele. Quem usa
  `email-e-senha` e quer ainda mais folga contra adivinhação pode subir `SENHA_ITERACOES` (padrão 10000, calibrado para os
  10 ms de CPU do plano gratuito; no plano pago, 100000 ou mais; o número fica gravado em cada senha, e as antigas seguem
  valendo). A senha mínima é de 12 caracteres.
- **CSRF**: cookie SameSite=Lax, e um POST com `Origin` de outro site (ou `Sec-Fetch-Site: cross-site`) vale como anônimo.
  Em **toda** rota que muda estado em `/api/auth/*`, com cookie ou sem, esse pedido é recusado com 403 `origem-invalida`
  (senão um formulário de outro site abriria no navegador da vítima uma sessão do atacante).
- **Janela da mídia assinada**: a URL do vídeo é emitida por `validadeDaAssinaturaSeg` (padrão **1 hora**, e nunca mais
  que o resto da sessão). Quem for bloqueado, tiver a sessão revogada ou a conta excluída para de receber URLs novas na
  hora, mas **a URL já emitida continua valendo até vencer**, e quem a tem pode repassá-la (ela não é presa ao IP).
  Para fechar essa janela, baixe a validade (mínimo 60 s) ou troque a chave de token do provedor (derruba todas).
- Custo de D1 por requisição autenticada: **1 consulta, 2 linhas lidas, por índice** (`tests/contas-d1.test.js`
  confere com `EXPLAIN QUERY PLAN`). Escritas só no login, no aceite e nas telas de gestão.
- Safari não aceita cookie `Secure` em `http://localhost`: para `npm run dev` use Chrome ou Firefox.

## LGPD

O **cliente é o controlador** dos dados. `privacidade.html` e `termos.html` mostram um **texto modelo neutro**
(`legal.*` nos catálogos de idioma) preenchido com os campos que o cliente escreve na tela Acesso (controlador,
contato, retenção), ou um texto próprio por idioma. **É um ponto de partida, não parecer jurídico: valide com o seu
jurídico antes de abrir o cadastro.** Cada alteração sobe a **versão**, o consentimento grava a versão aceita
(com o hash do IP, nunca o IP) e quem não aceitou a vigente é barrado até aceitar.

Em **Minha conta** (`conta.html`) a pessoa vê os dados, baixa um JSON com tudo o que guardamos (sem hash nenhum) e
**exclui a conta**: apaga `usuarios`, `sessoes`, `convites`, `links_magicos` (e `consentimentos`) numa transação.
Se o e-mail foi enviado a um provedor (Resend), apagar lá é com o cliente (art. 18, §6º).

Retenção: um **cron diário** (`triggers.crons` em `wrangler.jsonc`, `scheduled` em `core/worker/index.js`) apaga
sessões vencidas, links vencidos há mais de 1 dia, convites vencidos há mais de 30 dias e contadores de tentativa
velhos. Excluir contas inativas ainda não está implementado (decisão do cliente).

## Para quem mexe no código

- `sessaoDaRequisicao(request, env, { waitUntil?, horasEspectador? })` (`_lib/sessoes.js`) devolve `{ papel,
  usuarioId?, conta?, email?, origem? }`; papel é `anonimo | espectador | equipe | super`. O middleware a chama e põe
  em `data.sessao` (e `data.politica`, de `politicaDeAcesso(config)`): quem decide conteúdo por sessão usa isso.
- Rota nova de conta: entrada em `permissoes.js` (`'conta'` exige sessão em qualquer modo) e em `rotas.js`; o teste de
  matriz cobra as duas.
- Migração nova: `core/migrations/NNNN_nome.sql` **e** uma entrada em `core/migrations/indice.mjs` (o Worker não lê disco;
  `tests/contas-d1.test.js` confere que os dois dizem a mesma coisa). Nunca edite uma migração já aplicada.
- Testes: `tests/contas-*.test.js` com um D1 em memória sobre o `node:sqlite` (`tests/fixtures/d1-falso.js`).
