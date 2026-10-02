---
name: montar-streaming
description: Monta do zero o streaming (tela mAIs) de uma pessoa leiga na conta Cloudflare dela, em 9 etapas com checkpoint verificável. Use quando pedirem para instalar, montar, configurar ou colocar o streaming no ar.
---
<!-- GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents". Fonte: AGENTS.md a13858a39e83 -->

# Montar o streaming, do zero ao primeiro vídeo

Antes de tudo leia `AGENTS.md` (regras invioláveis). A pessoa é leiga: **uma pergunta por vez**, português simples,
explique cada termo novo. Você roda os comandos; ela só decide, cria contas e clica "Permitir".

## Como começar

1. Rode `node scripts/setup.mjs status --json`. Ele diz a etapa atual e a próxima. Retome dali, nunca do zero.
2. Se `node` não existir ou for anterior ao 22, guie a instalação (nodejs.org, versão LTS) e peça para abrir um terminal novo.
3. Diga em 3 linhas o que vai acontecer: perguntas, contas gratuitas, e que nada é publicado nem gasto sem o "sim" dela.

## Etapas

A tabela das 9 etapas (pergunta, comando e checkpoint de cada uma) mora **só** no `AGENTS.md`, para não haver duas versões.
Siga-a. A numeração do `status` é a mesma (0 a 9). Aqui ficam só os cuidados que a tabela não cabe:

- **0 Preparar:** o wrangler é baixado pelo `npx` (precisa de internet na primeira vez); diga isso se o `doctor` reclamar dele.
- **1 Identidade:** pergunte nome, tipo de organização, idioma. `init` sem as respostas sai com 3/`agente`: pergunte e rode de novo
  com as opções. Cor: se a que ela quer não tem contraste, o `marca` NÃO troca sozinho: mostre a sugestão e só rode com `--yes`
  se ela aceitar. O logo e os ícones gerados são provisórios; peça o logo dela quando tiver.
- **2 Acesso:** o comando imprime o que o modo significa na prática (quem convida quem, como o aluno entra) e o aviso de que
  nenhum modo impede gravar a tela: leia isso para a pessoa. `cadastro` exige Turnstile antes de publicar.
- **3 Cloudflare:** o login é da pessoa, num **segundo terminal** (`docs/contas-e-chaves.md`, "Como abrir um terminal" e
  "Se o navegador não abrir"). Você não digita por ela. Depois: `setup.mjs cloudflare verificar`.
- **4 Recursos:** rode `setup.mjs cloudflare provisionar --dry-run` para mostrar o plano e o custo; com o "sim", rode sem `--dry-run`.
  O `SESSION_SECRET` é gerado sozinho depois da primeira publicação.
- **5 Vídeo:** antes de rodar, diga onde achar cada chave (o comando também mostra). Avise do cartão internacional e do limite de banda.
- **6 Administrador:** avise ANTES: senha com pelo menos 12 caracteres, digitada duas vezes, guardada num gerenciador de senhas.
- **7 Publicar:** `deploy --dry-run` mostra o plano e o que ainda impede; só então peça o "sim". Num site já personalizado o deploy
  não roda os testes do produto (eles esperam a marca neutra); isso é esperado, não use `--sem-testes`.
- **8 e 9:** o primeiro vídeo é enviado pela pessoa no `/admin`. Turnstile, domínio, backup e alerta de gasto são opcionais, exceto
  Turnstile no `cadastro`.

Falhou 3 vezes no mesmo checkpoint: pare e peça ajuda (regra do `AGENTS.md`).

## Presets por tipo de organização (pergunte e aplique na etapa 1)

- **Escola/universidade**: tema `institucional`, acesso sugerido `cadastro` com aprovação da secretaria (exige Turnstile); se a escola quer só alunos convidados, escolha `privado` e explique: ela convida cada aluno pelo `/admin`. Séries por disciplina, legendas ligadas.
- **Igreja**: tema `aconchegante`, acesso `publico`, séries de pregação.
- **Empresa/treinamento**: tema `institucional`, acesso `privado`, trilhas.
- **Infoprodutor/curso**: tema `aconchegante`, acesso `privado` (alunos), módulos como coleções.
- **Festival/cinema**: tema `cinema`, acesso `publico`, vídeo de fundo no destaque.
- **Prefeitura/órgão**: tema `alto-contraste` ou `institucional`, acesso `publico`, legendas ligadas.
- **Criador de conteúdo**: tema `vibrante`, acesso `publico` ou `cadastro`.

## Segredos (regra central)

Nunca peça chave no chat. Na etapa 5 e na 6 diga: "Vou abrir um campo escondido no seu terminal. Cole a chave ali e
tecle Enter; ela não aparece na tela e eu não a vejo." Depois rode o comando e confira só o resultado do `doctor`
(que mostra só os nomes). Sem terminal disponível, `segredo` e `video` saem com código 3 (`quem: pessoa`) e mostram o comando: peça que a pessoa o rode num segundo terminal dela (ou use o caminho do assistente web do `/admin`).

## Ao terminar

Mostre a URL, o que foi criado, o custo mensal estimado e o que ela deve guardar (senha de admin, conta Cloudflare).
Rode a checklist de go-live de `docs/contas-e-chaves.md` e `setup.mjs scan-secrets`. Não faça commit sem a pessoa pedir.
