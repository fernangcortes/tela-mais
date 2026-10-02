# Comece aqui: colocar o seu streaming no ar

Este guia é para quem **não é técnico**. Você vai ter um site de vídeos (no estilo das grandes plataformas) com a
sua marca, hospedado na sua própria conta. Quem faz o trabalho pesado é um assistente de inteligência artificial
(um "agente"); você responde algumas perguntas, cria duas contas e clica em "Permitir".

> **Aviso honesto:** o projeto ainda está sendo construído e não é recomendado para produção. Nenhum site impede
> que alguém grave a tela do vídeo; o que fazemos é dificultar o caminho mais fácil.

## Escolha o seu caminho

| Você tem... | Caminho |
|---|---|
| Um agente que roda no seu computador (Claude Code, Codex CLI, Gemini CLI, Cursor...) | **Caminho A**, o principal, abaixo |
| Só um chat na internet (sem acesso ao seu computador) ou não quer instalar nada | **Caminho B**: botão "Deploy to Cloudflare" + assistente do `/admin` (veja mais abaixo) |

## O que você vai precisar

1. **Conta na Cloudflare** (grátis). É onde o seu site fica. Cadastro: https://dash.cloudflare.com/sign-up
2. **Conta em um serviço de vídeo**: ele recebe os seus arquivos, converte e entrega.
   - **Bunny Stream** (https://bunny.net): o mais barato e simples. Pode pedir cartão de crédito.
   - **Cloudflare Stream**: usa a mesma conta da Cloudflare, mas exige cartão e plano pago.
3. **Cartão de crédito ou débito internacional**, se o serviço de vídeo cobrar (a cobrança costuma ser em dólar).
4. **Um computador** com Windows, Mac ou Linux, com Node 22 ou mais novo (https://nodejs.org, versão "LTS") e git (https://git-scm.com). O agente ajuda a instalar.
5. **Um gerenciador de senhas** (ou um lugar seguro) para guardar as senhas que o sistema vai gerar.
6. Os seus vídeos e a sua logo. Só use vídeos que você tem direito de exibir.

Ligue a **verificação em duas etapas (2FA)** na Cloudflare e no serviço de vídeo. O agente lembra você.

## Quanto custa (em linguagem simples)

Valores aproximados, conferidos em 2026-10-01; confirme nos sites antes de decidir, pois preços mudam.

- **O site em si (Cloudflare):** **grátis** para começar. O limite grátis é de cerca de 100 mil chamadas por dia
  (algo como 30 a 40 mil visitas por dia). Se o site crescer ou se tiver cadastro aberto com muito público,
  o plano pago do Worker custa a partir de **US$ 5 por mês**.
- **Vídeos no Bunny Stream:** mínimo de **US$ 1 por mês**; para um acervo pequeno com pouco público, na ordem de **US$ 9 por mês**.
  Paga-se pelo espaço guardado e pelos dados entregues; público só no Brasil sai mais caro por GB.
- **Vídeos no Cloudflare Stream:** **US$ 5 a cada 1.000 minutos guardados** e **US$ 1 a cada 1.000 minutos assistidos**
  por mês. Fácil de prever, mas pesa se o acervo é grande e pouco assistido.
- **Domínio próprio** (opcional): cerca de R$ 40 a R$ 80 por ano, no registrador que você escolher.
- O agente **sempre avisa o custo antes** de ligar algo pago. Configure também um alerta de gasto (o guia mostra como).

Mais detalhes: `docs/provedores.md`.

## Caminho A: com um agente no seu computador

1. Crie o seu repositório a partir deste projeto: copie (fork) ou baixe o código para uma pasta do seu computador e abra um terminal nela.
2. Abra o seu agente nessa pasta (por exemplo `claude`, `codex` ou `gemini`; no Cursor, abra a pasta).
3. Cole este pedido e siga as perguntas:

```text
Leia o arquivo AGENTS.md deste repositório e siga as instruções para montar o meu streaming.
Eu não sou técnico: faça uma pergunta de cada vez, em português simples, e peça a minha
aprovação antes de criar contas, gastar dinheiro ou publicar. Nunca me peça para colar
senhas ou chaves no chat: quando precisar de uma, abra o campo escondido no meu terminal.
Comece rodando "node scripts/setup.mjs status" para ver em que etapa estamos.
```

O que você faz: responder, criar a conta Cloudflare, clicar **Permitir** quando o navegador abrir, criar a conta do
vídeo e **colar a chave no campo escondido do terminal** (ela não aparece na tela e o agente não a vê).
O que o agente faz: o resto, conferindo cada etapa com um teste antes de seguir.

### Como abrir um segundo terminal (você vai precisar)

Em alguns momentos o agente vai pedir que **você mesmo** digite algo: entrar na Cloudflare, escolher a senha de
administrador, colar uma chave do serviço de vídeo. Isso precisa ser feito numa janela de terminal **separada** da conversa
com o agente, aberta na pasta do projeto (só assim existe o campo escondido):

- **Windows:** abra a pasta do projeto no Explorador de Arquivos, clique na barra de endereço, digite `cmd` e tecle Enter.
- **Mac:** no Finder, clique com o botão direito na pasta do projeto e escolha "Novo Terminal na Pasta".
- **Linux:** clique com o botão direito dentro da pasta e escolha "Abrir no terminal".

Cole o comando que o agente mostrou, siga as perguntas e depois diga ao agente "terminei". Se o navegador não abrir no
login da Cloudflare, ou se o seu computador é remoto, veja `docs/contas-e-chaves.md` ("Se o navegador não abrir").

**Regra de ouro:** nunca cole uma senha ou chave no chat com o agente. Se isso acontecer, revogue a chave no painel
do serviço e crie outra; o agente vai explicar.

Passo a passo das contas e de onde ficam as chaves: `docs/contas-e-chaves.md`.

## Caminho B: sem agente (botão Deploy + assistente do /admin)

1. Clique em **Deploy to Cloudflare**: https://deploy.workers.cloudflare.com/?url=https://github.com/fernangcortes/tela-mais
   A Cloudflare copia o projeto para a sua conta do GitHub e cria o site e os bancos. Siga as telas dela até aparecer o endereço do site.
2. Na Cloudflare, abra **Workers e Pages**, o seu site, **Configurações**, **Variáveis e segredos**, e crie o segredo
   `ADMIN_PASSWORD` (mínimo 12 caracteres; guarde no gerenciador de senhas) e o `SESSION_SECRET` (a chave interna das sessões: **no mínimo 32 caracteres** e **diferente** da senha do administrador).
   Para criar o `SESSION_SECRET`, use o gerador de senhas do seu gerenciador de senhas (ou do navegador) com 40 caracteres e cole o resultado.
   Se esquecer um dos dois, o `/admin` avisa qual está faltando.
   Depois de salvar, a Cloudflare republica sozinha.
3. Abra `endereço-do-seu-site/admin` e entre como administrador. O **assistente de configuração** abre sozinho e leva você por 7 passos:
   nome e logo, cores (com prévia e aviso se o texto ficar ilegível), modelo para o seu tipo de organização, quem pode ver o site,
   serviço de vídeo, idiomas e página inicial.
4. No passo do vídeo, o assistente mostra o **nome exato de cada chave** e onde colá-la no painel da Cloudflare (o mesmo caminho do passo 2).
   Chaves nunca são digitadas no assistente. Depois de colar, ele testa se ficou certo.
5. No último passo, baixe o `site.json` gerado e coloque na pasta `config/` do seu repositório: mudanças de identidade e acesso só
   valem depois de republicar (a Cloudflare faz isso sozinha quando o repositório muda).
6. Depois de no ar: a tela **Saúde** do `/admin` diz se está tudo certo e o que corrigir; **Backup** baixa uma cópia do catálogo;
   **Custos** estima a conta do mês. Envie o primeiro vídeo pelo `/admin`.

Se travar, copie o pedido pronto da tela Saúde e cole num agente de IA, ou chame quem indicou o produto.

## Palavras que você vai ouvir

- **Worker:** o programa que roda o seu site na Cloudflare, sem servidor para você cuidar.
- **Modelo (preset):** um ponto de partida pronto para o seu tipo de organização (escola, igreja, empresa...). Dá para mudar tudo depois.
- **Acesso:** quem pode assistir: todos (`publico`), quem criar conta (`cadastro`) ou só convidados (`privado`).
- **KV e D1:** o "armazenamento do catálogo" e o "banco de contas" do seu site, dentro da Cloudflare. Cabem no plano grátis.
- **wrangler:** o programa da Cloudflare que o assistente usa por baixo; o login dele é o "Permitir" no navegador.
- **2FA (verificação em duas etapas):** além da senha, um código no celular. Protege a sua conta.
- **Campo escondido:** onde você digita senhas e chaves no terminal; elas não aparecem na tela e o agente não as vê.
- **HLS:** o formato em que o vídeo é entregue para tocar sem travar em qualquer aparelho. Quem cuida é o serviço de vídeo.
- **Pull zone (Bunny):** o endereço pelo qual o Bunny entrega os seus vídeos. Não é senha.
- **Token / chave de assinatura:** o que faz o endereço do vídeo ser temporário, para o link copiado não funcionar para sempre.
- **Turnstile:** a proteção anti-robô gratuita da Cloudflare. No acesso por cadastro ela é obrigatória.

## Se travar

Diga ao agente "rode o diagnóstico". Se mesmo assim não resolver, ou se a Cloudflare pedir verificações que você não
entende, pare e peça ajuda a quem indicou o produto. É melhor parar do que arriscar dinheiro ou uma chave vazada.
