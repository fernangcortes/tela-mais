---
name: adicionar-videos
description: Ajuda a enviar o primeiro vídeo e os seguintes, cadastrar títulos, capas, legendas e coleções, e a conferir que tocam. Use quando pedirem para subir, adicionar, cadastrar ou organizar vídeos.
---
<!-- GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents". Fonte: AGENTS.md a13858a39e83 -->

# Adicionar vídeos

O tela mAIs não converte vídeo sozinho: quem recebe o arquivo é o provedor (`video.provedor` em `config/site.json`;
`docs/provedores.md`). Confirme antes: `node scripts/setup.mjs doctor --only=video --json` verde.

## Caminho para a pessoa leiga: pelo /admin

1. Ela abre `<URL do site>/admin`, entra com o administrador e usa "Adicionar vídeo". O envio segue o plano que o servidor devolve (endpoint e cabeçalhos vêm do servidor; a chave nunca vai ao navegador).
2. Título, sinopse e capa: preenchidos na própria tela; se não houver capa, o provedor gera uma do vídeo.
3. Espere o processamento (alguns minutos, conforme o tamanho). Você acompanha com `node scripts/status.mjs`.
4. Checkpoint: o título aparece no catálogo e **toca no celular e no computador**. Peça para ela confirmar nos dois.

## Em lote (quem tem muitos arquivos)

`node scripts/upload.mjs` (envia), `node scripts/cadastrar-hls.mjs` (provedor `hls-generico`, endereços `.m3u8` já existentes),
`node scripts/capas-legendas.mjs`, `node scripts/series.mjs` e `node scripts/sinopses.mjs`. Leia `scripts/LEIA-ME.md` antes. Lotes
GASTAM armazenamento e processamento: diga a quantidade e o custo estimado e peça "sim". Faça um teste com UM vídeo antes.

## Organização

Coleções livres e blocos da home: `docs/home-e-colecoes.md`. Nada toca sozinho por padrão (regras do player: `docs/player.md`).

## Cuidados

Só envie conteúdo que a pessoa tem direito de exibir (pergunte). Em modo `privado`, o link do vídeo sai assinado e vence;
não copie URLs de vídeo para documentos públicos. Apagar vídeo é irreversível no provedor: peça "sim" explícito.
