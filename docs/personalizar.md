# Personalizar a home, o player e o vídeo de fundo

Guia para quem não programa. Tudo o que está aqui se escolhe em `config/site.json`. Depois de mudar o arquivo, rode
`node scripts/aplicar-config.mjs` (e `npm run config:validar` se quiser conferir antes). Parte da home também se
edita no `/admin`, na tela **Ajustes › Home**; o que a equipe escolhe lá vale **por cima** do arquivo.

**Regra de ouro:** com a configuração padrão, a home é a de sempre e **nada toca, nada avança e nada retoma
sozinho**. Cada opção abaixo é um passo consciente para sair disso.

## 1. Montar a home por blocos

A home é uma lista de blocos, na ordem em que aparecem. Cada bloco tem um `tipo`. Todos aceitam também `id`,
`titulo` (um texto por idioma), `escondido` (fica guardado e não aparece) e `visibilidade`: `todos`, `logado` (só
quem entrou) ou `anonimo` (só quem não entrou).

Tipos: `destaque`, `continuar-assistindo`, `minha-lista`, `prateleira-recentes` (novidades), `prateleira-duracao`,
`prateleira-por-serie`, `prateleira-colecao`, `carrossel` (seleção manual), `prateleira-restante`, `texto`,
`banner` e `busca`. A tabela com as opções de cada um está em `docs/home-e-colecoes.md`.

Exemplo: destaque, busca grande, novidades, a lista de quem entrou e, no fim, o que sobrou.

```json
"home": {
  "blocos": [
    { "tipo": "destaque" },
    { "tipo": "busca" },
    { "id": "novidades", "tipo": "prateleira-recentes", "limite": 12,
      "titulo": { "pt-BR": "Novidades", "en": "New", "es": "Novedades" } },
    { "id": "minha-lista", "tipo": "minha-lista", "visibilidade": "logado" },
    { "id": "resto", "tipo": "prateleira-restante", "garantirQueTodoTituloApareca": true }
  ]
}
```

**Nenhum título some.** O bloco `prateleira-restante` recolhe todo título que nenhuma fileira de série ou de coleção
mostra. Se você apagar um bloco ou criar uma série nova, o vídeo continua na home. Esconder um bloco é escolha sua e
não solta os títulos dele; a tela Home avisa quantos ficariam de fora.

Para voltar ao padrão: apague `home.blocos` (ou use "Voltar à home padrão" no /admin).

## 2. Coleções e modelo de conteúdo

Coleções são grupos livres de séries, tags ou títulos que viram fileiras. Cada uma tem `id`, `nome` por idioma e uma
`classe`: `pedagogica` (só uma seleção), `curta` (séries de poucos minutos, só na fileira da coleção) ou
`institucional` (fora das fileiras de série).

```json
"catalogo": {
  "modeloDeConteudo": "seriado",
  "colecoes": [
    { "id": "palestras", "classe": "pedagogica",
      "nome": { "pt-BR": "Palestras", "en": "Talks", "es": "Charlas" },
      "series": ["palestras-2025", "palestras-2026"] },
    { "id": "bastidores", "classe": "institucional",
      "nome": { "pt-BR": "Bastidores", "en": "Behind the scenes", "es": "Detrás de cámaras" },
      "series": ["bastidores"] }
  ]
}
```

`modeloDeConteudo`: `seriado` (temporadas e episódios) ou `avulso` (filmes e aulas soltas: some o "T1 E3", o link
Séries e a fileira por série).

## 3. Minha lista

Quando o site tem contas (modos `cadastro` ou `privado`), cada pessoa guarda títulos pelo botão "Guardar na minha
lista". Fica no banco D1, até 200 títulos, e é apagada com a conta. Para o bloco aparecer, use o tipo `minha-lista`.
Para desligar: `"recursos": { "minhaLista": false }`.

## 4. Regras do player

```json
"player": {
  "autoplay": { "modo": "nunca" },
  "proximoEpisodio": { "modo": "perguntar", "segundosDeContagem": 8 },
  "retomar": { "modo": "perguntar" },
  "velocidades": [0.75, 1, 1.25, 1.5, 2],
  "legenda": { "idiomaPadrao": "pt-BR" },
  "marcaDagua": { "ligada": false }
}
```

- **`autoplay.modo`:** `nunca` (padrão), `mudo` ou `com-som-apos-interacao`. Com `nunca`, nenhum vídeo começa sem
  um clique ou toque. **Nenhuma opção faz som sozinho:** o início sem gesto sai mudo, e o modo
  `com-som-apos-interacao` só vale depois de a pessoa já ter clicado, tocado ou digitado na página.
- **`proximoEpisodio.modo`:** `nunca` (padrão), `perguntar` (cartão "A seguir", espera o clique) ou `automatico`
  (contagem em segundos; só vale se o autoplay não for `nunca`, senão vira `perguntar`).
- **`retomar.modo`:** `nunca` (padrão), `perguntar` (cartão "Continuar de onde parou?") ou `automatico` (posiciona
  ao apertar play, nunca toca sozinho).
- **Outros:** `velocidades`, idioma de legenda padrão, marca d'água e download (só aparece quando o provedor entrega
  um MP4). Se o vídeo falhar, a pessoa vê uma mensagem clara, traduzida, com "Tentar de novo".

Detalhes e a tabela completa: `docs/player.md`.

## 5. Vídeo de fundo do destaque

```json
"home": {
  "destaque": {
    "fundo": { "tipo": "video-mudo", "somenteDesktop": true, "atrasoMs": 1200, "repeticoes": 2 }
  }
}
```

`tipo`: `capa` (padrão, só a imagem), `previa-animada` ou `video-mudo` (um clipe curto, de 15 a 30 s e 2 a 4 MB).

Garantias que **não se desligam**: sempre mudo; nunca carrega com "reduzir movimento" ou economia de dados; só toca
com o destaque à vista; tem botão de pausa sempre visível; a capa é o poster; não conta como reprodução (não entra
em "Continuar assistindo"). No celular fica desligado por padrão. O fundo nunca usa o vídeo principal do título.
Hoje funciona a prévia animada do provedor; o clipe curto próprio depende de o provedor entregá-lo.

## 6. Instalar no celular (PWA)

O manifesto e os ícones saem do `site.json`. O service worker é opcional e **desligado por padrão**
(`recursos.pwaCacheDoShell`): guarda só a casca do site, nunca vídeo, API ou /admin. Riscos e como desligar:
`docs/home-e-colecoes.md`.

## Depois de mexer

```bash
npm run config:validar
node scripts/aplicar-config.mjs
npm test
```
