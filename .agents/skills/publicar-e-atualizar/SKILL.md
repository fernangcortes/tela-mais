---
name: publicar-e-atualizar
description: Publica o streaming na Cloudflare e publica atualizações depois, só com o diagnóstico verde, e confere o site no ar. Use quando pedirem para publicar, colocar no ar, atualizar o site ou mudar o domínio.
---

# Publicar e atualizar

Publicar muda o que o público vê e pode custar dinheiro: peça "posso publicar agora?" e espere o "sim".

## Antes de publicar

1. `node scripts/setup.mjs doctor --json`: nenhum `erro` (avisos: explique cada um e deixe a pessoa decidir).
2. `npm run config:validar && node scripts/aplicar-config.mjs --verificar`: config válida e arquivos gerados em dia (se não, `npm run config:aplicar`).
3. `node scripts/setup.mjs scan-secrets`: nenhum segredo no que será versionado ou publicado.
4. `npm test` e `node scripts/anti-marca.mjs` só se o código do produto foi alterado. Num site personalizado para um cliente o `npm test` falha de propósito (espera a marca neutra) e o `deploy` já o pula; nunca use `--sem-testes` para contornar.

## Publicar

1. `node scripts/setup.mjs deploy --dry-run` mostra o plano completo e o que ainda impede de publicar (sai 1 se algo impede); com o "sim", `node scripts/setup.mjs deploy`.
2. Checkpoint: `node scripts/setup.mjs doctor --remote --json`. Esperado: site responde 200; no modo `privado`/`cadastro`, catálogo e HLS anônimos falham (401/403); segredos esperados presentes (só nomes).
3. Informe a URL e confirme que a pessoa abriu e viu o site. Se o checkpoint falhar, não diga que deu certo: siga a skill `diagnosticar`.

## Atualizar

Mudança de config ou de vídeo: repita "Antes de publicar" e "Publicar". Atualização do produto (novo core): leia o `CHANGELOG`
(seção "precisa de ação sua") se existir, aplique, rode `npm test` e só então publique. Trocar segredo: `setup.mjs segredo NOME`
(prompt oculto), publique e peça para a pessoa revogar a chave antiga no painel do serviço.

## Domínio próprio (opcional)

Conecte o domínio no painel da Cloudflare (Workers, Configurações, Domínios e rotas): ele precisa estar na Cloudflare ou ter o DNS apontado; HTTPS é automático.
Depois ponha o endereço em `marca.dominio` na config, rode `config:aplicar`, publique de novo e `doctor --remote`.

Não faça commit nem push a menos que a pessoa peça.
