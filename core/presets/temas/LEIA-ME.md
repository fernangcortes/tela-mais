# Temas prontos

Escolha um com `"tema": { "preset": "<nome>" }` no `config/site.json`:

| nome | modo de partida | para quê |
|---|---|---|
| `cinema` | escuro | padrão: streaming escuro, azul |
| `claro` | claro | leitura de dia, verde-esmeralda |
| `alto-contraste` | escuro | baixa visão: contraste acima de 7:1 |
| `institucional` | claro | órgãos, escolas, empresas: azul-marinho sóbrio |
| `vibrante` | escuro | público jovem: roxo e rosa |
| `aconchegante` | claro | cursos e conteúdo autoral: papel, terracota, títulos com serifa |

Todo tema traz as paletas escura e clara. `tema.modo` (`escuro`, `claro` ou `auto`, que segue o aparelho) manda; sem ele vale o modo de partida da tabela.
Troque só as cores que quiser em `tema.cores.escuro` / `tema.cores.claro` (o resto vem do preset). O validador recusa paleta sem 4,5:1 de contraste para texto e 3:1 para controles e diz qual par falhou, com uma cor sugerida.

Tema novo: arquivo `.mjs` aqui, uma linha em `index.mjs` e o nome no enum `tema.preset` do `config/site.schema.json`. `tests/tema.test.js` mede o contraste de todos.
