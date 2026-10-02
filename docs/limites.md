# Limites: até onde o plano grátis vai e o que fazer quando passar

Valores de **2026-10-01**, da documentação pública da Cloudflare e de fontes de terceiros. São
**estimativas a reconferir** (links no fim). Os números do catálogo abaixo vêm do que o código faz
hoje e de uma medida real (cerca de 1,9 KB por título num acervo de 86 vídeos).

## Resumo em uma tabela

| O que | Plano grátis | Plano pago (Workers, US$ 5/mês) | Quando importa |
|---|---|---|---|
| Chamadas de Worker (a API, a home, `/admin`) | **100 mil por dia** | 10 milhões por mês incluídos | Muita gente entrando ao mesmo tempo |
| Arquivos do site (HTML, CSS, JS, imagens) | ilimitado | ilimitado | Nunca |
| Tempo de CPU por chamada | **10 ms** | até 30 s (padrão) | Catálogo grande, modo privado |
| Armazenamento KV (catálogo) | 1 GB | 1 GB incluído, depois cobrado | Histórico de versões |
| Leituras de KV | 100 mil por dia | 10 milhões por mês | Muitas visitas |
| Gravações de KV | **1.000 por dia** | 1 milhão por mês | Muita edição no `/admin` |
| Banco D1 (contas) | 5 milhões de linhas lidas e 100 mil escritas por dia | maior | Cadastro aberto com muito movimento |
| Valor de uma chave KV | **25 MiB** | 25 MiB | Catálogo muito grande |

## 1. Visitas por dia (plano grátis)

Cada visita ao site faz de 3 a 6 chamadas de Worker (catálogo, busca, assinatura do vídeo...).
Quanto mais restrito o acesso, mais chamadas:

| Modo de acesso | Chamadas por visita | Visitas por dia que cabem em 100 mil chamadas |
|---|---|---|
| `publico` | ~3 | ~33 mil |
| `cadastro` | ~5 | ~20 mil |
| `privado` | ~6 | ~16 mil |

**Regra prática:** até cerca de **5 mil visitas por dia** o plano grátis serve em qualquer modo. Com
`cadastro` aberto ou `privado` e movimento, assuma o **plano pago** (US$ 5 por mês): além do limite
diário, a CPU de 10 ms fica apertada.

**O que acontece quando passa:** no plano grátis, ao estourar as 100 mil chamadas o Worker para de
responder até a meia-noite UTC (os arquivos estáticos continuam saindo, mas a API não: o catálogo
não carrega). No plano pago não para: cobra cerca de US$ 0,30 por milhão a mais.
**Escolha consciente:** no grátis o limite funciona como teto de custo (o site para, a conta não sobe).

A calculadora do `/admin` (tela Custos) e `docs/custos.md` fazem essa conta com os seus números.

## 2. Tempo de CPU (10 ms no grátis)

O que mais gasta CPU numa chamada:

- **Ler e processar o catálogo**: o Worker lê a chave `catalogo` inteira (um JSON só) e monta a
  resposta. Quanto maior o acervo, mais CPU (veja o teto de títulos, abaixo).
- **Conferir senha (modo `cadastro` e `privado`)**: o cálculo da senha (PBKDF2) é deliberadamente
  pesado; por isso o número de iterações é baixo (`SENHA_ITERACOES`). No grátis, uma entrada pode
  chegar perto dos 10 ms: com muito movimento, o plano pago evita erros de "CPU excedida".
- **Assinar a mídia** (modos restritos): barato, mas soma por vídeo listado.

Sinais de que a CPU passou: erro 1102 ("Worker exceeded CPU time limit") nos registros do Worker
(Cloudflare, Workers, Observabilidade). Solução: plano pago, ou reduzir o catálogo por chamada.

## 3. Teto de títulos por catálogo (uma chave KV)

Todo o catálogo mora em **uma chave** do KV (`catalogo`). Isso é simples e rápido de editar, mas tem
teto: o KV aceita no máximo **25 MiB** por valor e o Worker lê o JSON inteiro a cada resposta.

Medida real: cerca de **1,9 KB por título** (com capítulos, legendas e sinopse; título enxuto fica
perto de 0,8 KB). Daí as faixas (estimativas; meça o seu):

| Títulos | Tamanho aproximado | Situação |
|---|---|---|
| até **~500** | ~1 MB | Confortável no plano grátis |
| **500 a ~1.500** | 1 a 3 MB | Funciona; no grátis a CPU de 10 ms pode apertar: prefira o plano pago |
| **1.500 a ~5.000** | 3 a 10 MB | Só no plano pago; a edição no `/admin` fica mais lenta |
| acima de **~5.000** | > 10 MB | Fora do que a versão 1 foi desenhada para entregar |
| **~13.000** | 25 MiB | **Limite duro do KV**: a gravação é recusada |

**Histórico de versões.** A cada publicação o `/admin` guarda uma cópia inteira (as 30 últimas) e um
registro de mudanças. Com catálogo de 3 MB são ~90 MB de histórico: cabe no 1 GB grátis. Com 10 MB,
~300 MB. O custo extra aparece em **gravações** (cada publicação faz cerca de 4 operações de gravação
ou exclusão): no grátis, 1.000 por dia equivalem a umas **250 publicações por dia**, o que na prática
nunca é problema, mas um **script em lote** (carga de centenas de títulos, cada um gravando o catálogo)
pode estourá-las: use o modo em lote dos scripts (`acrescentar-ao-kv.mjs` grava uma vez só).

**Como medir o seu catálogo:**

```bash
node scripts/exportar-kv.mjs --saida -     # backup inteiro na tela: veja "titulos" no resumo
node scripts/exportar-kv.mjs               # grava dados/backup-AAAA-MM-DD.json; o tamanho do arquivo é o limite superior
```

**O que fazer ao se aproximar do teto:** (1) plano pago; (2) remover títulos que não estão
publicados; (3) tirar capítulos e sinopses longas de títulos antigos; (4) acervos maiores precisam de
catálogo repartido em várias chaves ou banco D1 (previsto para versão futura; fale com quem indicou o
produto antes de passar de ~3.000 títulos).

## 4. Banco D1 (contas de espectadores, convites e sessões)

Só entra nos modos `cadastro` e `privado`. No grátis: 5 milhões de linhas lidas e 100 mil linhas
escritas por dia, 5 GB. Cada entrada e cada verificação de sessão lê poucas linhas; a escrita aparece
em cadastro, entrada (sessão nova) e no freio de tentativas. Quem tem milhares de cadastros novos por
dia deve olhar o plano pago. A limpeza diária (cron das 03:17 UTC) apaga sessões e convites vencidos.

## 5. Outros limites que podem aparecer

| Limite | Valor | Observação |
|---|---|---|
| Chamadas externas por requisição do Worker (subrequests) | 50 no grátis, 1.000 no pago | O Worker chama o provedor de vídeo em poucos casos (envio, teste de credencial) |
| Tamanho do código do Worker | 3 MB (grátis) e 10 MB (pago), comprimido | O hls.js fica nos arquivos do site, não no Worker |
| Arquivos estáticos por site | 20 mil, até 25 MiB cada | O site tem poucas centenas |
| Registros do Worker (Workers Logs) | 200 mil eventos/dia no grátis, 3 dias | Nunca registre senha nem corpo de login |
| Turnstile (anti-robô) | grátis | Obrigatório para abrir o cadastro |
| Limite de banda do Bunny (opcional, na pull zone) | o que você definir | **Ao atingir, os vídeos saem do ar**: ligue com folga de 2 vezes o uso esperado |

## Fontes (reconferir)

- Limites e preços de Workers: https://developers.cloudflare.com/workers/platform/limits/ e https://developers.cloudflare.com/workers/platform/pricing/
- KV: https://developers.cloudflare.com/kv/platform/limits/
- D1: https://developers.cloudflare.com/d1/platform/limits/
- Registros: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
