# Modos de acesso: quem pode ver o seu site

Este guia é para quem instala o site, sem precisar entender de programação. Você escolhe **um** modo em
`config/site.json`, no campo `acesso.modo`. Os detalhes técnicos ficam em `docs/acesso.md`.

## Aviso honesto, leia primeiro

**Nenhum modo impede que alguém grave a tela.** Quem consegue assistir a um vídeo consegue filmar a tela do
computador ou do celular. O que o site faz é dificultar o caminho mais fácil: impedir que um desconhecido
abra o catálogo e que um link de vídeo copiado funcione para sempre. Isso reduz o vazamento casual. Não o
elimina. Se o seu conteúdo exige garantia contra cópia, nenhum modo deste site oferece isso.

## Os três modos

### `publico`: qualquer pessoa vê

- O catálogo, a busca e os vídeos ficam abertos. Não existe login para quem assiste.
- Os endereços de vídeo saem comuns, sem assinatura. Nada muda em relação ao comportamento de sempre.
- Os buscadores (Google etc.) só encontram o site se você ligar `seo.indexavel`. Nos outros modos o site sempre
  pede aos buscadores que fiquem de fora.
- **O que exige configurar:** nada além do vídeo.

### `cadastro`: qualquer pessoa pode criar uma conta

- Para ver o catálogo é preciso entrar. A pessoa se cadastra sozinha com e-mail, aceita a política de
  privacidade e os termos, e recebe um link de acesso.
- **Exige configurar:**
  - **Turnstile** (o desafio anti-robô gratuito da Cloudflare): o segredo `TURNSTILE_SECRET` e a chave pública
    `TURNSTILE_SITE_KEY`. **Sem os dois o cadastro não abre.** Se o serviço do Turnstile ficar fora do ar, o
    cadastro também fecha (é de propósito: na dúvida, não deixa passar).
  - **E-mail**: por padrão (`acesso.email.adaptador: "nenhum"`) o site não envia e-mail e o link de confirmação
    não chega a ninguém. Para o cadastro por link, configure o adaptador `resend` (`RESEND_API_KEY` e
    `EMAIL_REMETENTE`). Alternativa sem e-mail: `acesso.cadastro.metodo: "email-e-senha"`.
  - **Chaves de token do vídeo**, se quiser vídeo assinado (veja "Vídeo assinado" abaixo).
- Você pode exigir aprovação manual (`aprovacaoManual`) ou limitar a certos domínios de e-mail.

### `privado` (padrão): só entra quem você convidar

- Ninguém cria conta sozinho. No painel (`/admin`, tela **Acesso**) você digita o e-mail da pessoa e **copia o
  link de convite**, que você manda por WhatsApp, por exemplo. O link vale 7 dias e só funciona uma vez.
- Quem já foi convidado pode pedir um novo link de acesso pelo e-mail. O site responde a mesma coisa exista o
  e-mail ou não, para que ninguém descubra quem tem conta.
- **Exige configurar:** nada para convidar por link copiável. E-mail e Turnstile são opcionais aqui.
- Se o `config/site.json` estiver ausente ou com erro, o site assume `privado`: o padrão é o mais fechado.
- **Trocar de `cadastro` para `privado` não apaga nem bloqueia as contas que já se cadastraram:** elas continuam ativas e
  entram normalmente. Para tirar alguém, bloqueie ou exclua a conta na tela Acesso do /admin.

## Vídeo assinado (`cadastro` e `privado`)

Com `acesso.privado.assinarMidia: true` (padrão), os endereços do vídeo, da capa, da prévia e das legendas
**só são entregues a quem tem sessão válida** e **valem por pouco tempo**
(`acesso.privado.validadeDaAssinaturaSeg`, padrão 1 hora; nunca mais que a duração da sessão). Quem copiar o
endereço de um vídeo o vê parar de funcionar depois disso.

**A janela que fica:** quem for bloqueado, tiver a sessão revogada ou a conta excluída deixa de receber endereços novos na
hora, mas o endereço que já recebeu continua tocando até vencer (no máximo essa validade) e pode ser repassado a outra
pessoa. Se isso importa para você, diminua `validadeDaAssinaturaSeg` (mínimo 60 segundos).

Isso exige que o provedor de vídeo tenha a proteção ligada e que a chave esteja no Worker:

| Provedor | O que configurar |
|---|---|
| Bunny | ligar "Token Authentication" na pull zone e guardar a chave em `BUNNY_TOKEN_KEY`; para o player embutido, `BUNNY_EMBED_KEY` |
| Cloudflare Stream | marcar os vídeos para exigir URL assinada e guardar a chave de assinatura (`CLOUDFLARE_STREAM_KEY_PEM`) |
| HLS genérico | **não assina.** Com modo restrito, ou o site recusa a configuração, ou você assume, escrevendo `assinarMidia: false`, que o vídeo fica aberto a quem tiver o link |

Se pedir assinatura e a chave não existir, o site **não entrega o vídeo** (erro 501) em vez de entregar um
link aberto. Para conferir de verdade, use `node scripts/provar-assinatura.mjs --video <id>`: ele tenta abrir o
vídeo sem token (deve falhar), com token (deve abrir) e com token vencido (deve falhar).

No modo `publico` nada é assinado.

## Resumo

| | `publico` | `cadastro` | `privado` |
|---|---|---|---|
| Quem vê o catálogo | todos | quem criou conta | quem foi convidado |
| Vídeo assinado e de curta duração | não | sim | sim |
| Turnstile | não | obrigatório | opcional |
| E-mail | não | recomendado (ou senha) | opcional |
| Aparece no Google | se você ligar | nunca | nunca |
| Impede gravar a tela | **não** | **não** | **não** |

Para a parte de privacidade (LGPD), o texto modelo, "Minha conta" e a limpeza automática de dados, veja
`docs/acesso.md`. Os textos modelo são um ponto de partida: revise-os com quem entende de direito antes de usar.
