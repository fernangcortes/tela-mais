# Home por blocos, coleções, Minha lista e PWA

Guia para quem monta a página inicial. A home é uma **lista de blocos**, na ordem em que aparecem. Dá para mexer
nela de dois jeitos: no `/admin` (menu **Ajustes › Home**, que vai ao ar pelo rascunho e pelo Publicar de sempre) ou,
como valor inicial, em `config/site.json` (`home.blocos`, `catalogo.colecoes`, `catalogo.modeloDeConteudo`).
**O que a equipe escolhe no /admin vale por cima do arquivo**; "Voltar à home padrão" apaga a escolha do /admin.
Sem nada escolhido, a home é a de sempre: o destaque, "Até 5 minutos", uma fileira por série grande, "Mais séries",
"Curtas" e "Institucional".

## Os tipos de bloco

| Tipo | O que mostra | Opções |
|---|---|---|
| `destaque` | O título em destaque do topo (capa grande, sinopse, botão de assistir). O fundo em movimento é de `home.destaque.fundo` (veja `docs/player.md`). | — |
| `continuar-assistindo` | O que a pessoa parou no meio, lido da memória do próprio navegador. Só leva à ficha: **nada retoma sozinho**. | `limite` |
| `minha-lista` | O que a pessoa guardou (precisa de conta; veja abaixo). | `limite` |
| `prateleira-recentes` | Novidades: os últimos títulos que entraram no ar. | `limite` (12) |
| `prateleira-duracao` | Títulos por duração. | `ate` e/ou `de` (segundos), `minimoDeTitulos` (3), `incluirInstitucional` (não) |
| `prateleira-por-serie` | Uma fileira por série com títulos suficientes, da maior para a menor. | `minimoDeTitulos` (3) |
| `prateleira-colecao` | Uma coleção (veja abaixo). | `colecao`, `limite` |
| `carrossel` | Uma seleção manual, na ordem escolhida. | `titulos` (ids) |
| `prateleira-restante` | O que nenhuma outra fileira mostra. | `garantirQueTodoTituloApareca` (sim) |
| `texto` / `banner` | Um aviso por idioma; o banner tem imagem e link opcionais. | `texto`, `imagem`, `link` |
| `busca` | Um campo de busca grande no meio da home (usa a mesma busca do cabeçalho). | — |

Todo bloco aceita `id` (o endereço do "Ver tudo" da fileira), `titulo` **por idioma**, `escondido` (fica guardado, mas
não aparece) e `visibilidade`: `todos` (padrão), `logado` (só quem entrou com conta) ou `anonimo` (só quem não entrou).

```json
"home": {
  "blocos": [
    { "tipo": "destaque" },
    { "tipo": "busca" },
    { "id": "novidades", "tipo": "prateleira-recentes", "limite": 12,
      "titulo": { "pt-BR": "Novidades", "en": "New", "es": "Novedades" } },
    { "id": "minha-lista", "tipo": "minha-lista", "visibilidade": "logado" },
    { "id": "palestras", "tipo": "prateleira-colecao", "colecao": "palestras" },
    { "id": "resto", "tipo": "prateleira-restante", "garantirQueTodoTituloApareca": true }
  ]
}
```

### "Todo título aparece ao menos uma vez"

O bloco `prateleira-restante`, com `garantirQueTodoTituloApareca` (o padrão), recolhe **todo título publicado que
nenhuma outra fileira de série ou de coleção mostra**. É a rede de segurança: quem apaga um bloco, ou cria uma série
nova, não faz um vídeo sumir da home. Fileiras transversais (novidades, duração, continuar, Minha lista, seleção
manual) repetem títulos de propósito e não contam como "já aparece". Esconder um bloco **não** solta os títulos dele
no restante (esconder é escolha sua), e a tela Home avisa quantos títulos ficariam de fora da chegada.

## Coleções livres

No lugar das listas de séries escritas no código, a organização é `catalogo.colecoes`: grupos de séries (e/ou de
tags, e/ou de títulos escolhidos à mão) que viram fileiras. Cada coleção tem `id`, `nome` por idioma e uma `classe`:

- `pedagogica` (padrão): uma **seleção**. As séries dela continuam nas fileiras por série.
- `curta`: séries de poucos minutos, que juntas viram uma fileira. Ficam só nela.
- `institucional`: o que não é conteúdo de aprendizado (eventos, bastidores). Sai das fileiras por série, de
  "Mais séries" e de "Até 5 minutos".

Sem `colecoes` valem duas de exemplo (`curtas` e `institucional`) com nomes de série de exemplo: **troque pelas suas**.
Uma série que não está em coleção nenhuma é tratada como pedagógica e cai em "Mais séries": o site não esconde título
por causa de uma lista desatualizada. Reclassificar uma série (tela **Estrutura**) vale por cima das listas.

## Modelo de conteúdo

`catalogo.modeloDeConteudo`: `seriado` (padrão: séries com temporada e episódio) ou `avulso` (filmes e aulas soltas).
No `avulso` a home não mostra "T1 E3", o link **Séries** do cabeçalho some e a lista padrão de blocos começa pelas
novidades e não tem a fileira por série.

## Minha lista

Cada pessoa com **conta de espectador** (modos `cadastro` e `privado`) guarda títulos para ver depois, pelo botão
"Guardar na minha lista" da ficha e do destaque. A lista mora no **banco D1** (tabela `minha_lista`, criada sozinha na
primeira vez), é sempre a de quem pede, tem teto de 200 títulos, entra na exportação de dados ("Minha conta") e é
apagada junto com a conta. Sem conta não há Minha lista (o bloco simplesmente não aparece). Desligue com
`recursos.minhaLista: false`. A equipe do /admin não tem lista.

## PWA: instalar o site no celular

O `manifest.webmanifest` e os ícones saem do `config/site.json` (`marca`, `tema`, `idiomas`): rode
`node scripts/aplicar-config.mjs` depois de mudar. Com `recursos.pwaInstalavel` ligado o navegador oferece "instalar".

### Service worker (opcional, **desligado por padrão**)

`recursos.pwaCacheDoShell: true` liga um service worker **mínimo** (`core/site/sw.js`, gerado; não edite à mão). Ele
guarda só a **casca** do site (página inicial, estilos, scripts, fontes, textos por idioma, manifest e ícones) para o
site abrir com a rede ruim.

O que ele **nunca** toca, por construção e por teste (`tests/home-pwa.test.js`):

- `/api/*` (catálogo, conta, Minha lista, mídia assinada) e o `/admin`;
- as páginas de entrar, cadastro e Minha conta;
- **vídeo**, áudio, legendas e capas (vêm do provedor; pedido com `Range` é ignorado);
- pedido de outro site, que não seja GET ou que leve credencial.

Riscos, e por que está desligado:

- **Versão velha no aparelho.** Estilo e script saem do guardado primeiro e se atualizam na visita seguinte (a página
  inicial é "rede primeiro"). Depois de um deploy, a pessoa pode ver a versão anterior por **uma** visita.
- **Difícil de depurar.** Quem tem o service worker instalado nem sempre vê o que está no ar. Em caso de dúvida,
  desligue (abaixo) e peça para recarregar duas vezes.
- **Não faz o vídeo funcionar offline.** O site abre; o vídeo continua precisando de rede.

Para **desligar** depois de ter ligado: volte `pwaCacheDoShell` para `false` e rode `aplicar-config`. O `sw.js` passa
a ser o "de desligar": na visita seguinte ele apaga os caches que guardou e se desinstala sozinho.

## Peso da home

Os blocos acrescentam um script (`home-blocos.js`, ~9,8 KB comprimido) e cerca de 0,7 KB ao `catalogo-core.js`. Os dois
carregam no fim da página, junto com o `app.js`, antes de qualquer capa de fileira: não há pedido novo na frente da capa
do destaque (o LCP), e as fileiras e o destaque continuam desenhados no mesmo quadro. Blocos que dependem da pessoa
(Continuar, Minha lista) só entram depois da resposta da lista, sem atrasar o primeiro desenho.
