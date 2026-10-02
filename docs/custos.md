# Quanto custa manter o streaming no ar

Este guia ajuda a estimar a conta mensal. **Todos os valores são estimativas feitas em
2026-10-01**, a partir de tabelas públicas dos provedores e de fontes de terceiros (as páginas
oficiais de preço não puderam ser lidas diretamente). **Reconfira no site de cada provedor antes
de decidir.** Preço muda, e o dólar também (aqui, R$ 5,18).

A mesma conta roda na tela **Custos** do `/admin`: ela usa o módulo `core/worker/_lib/custos.js`,
e os números dos dois lugares sempre batem. Para mexer num preço, mude `PRECOS` e `DATA_DOS_VALORES`
nesse arquivo (e esta página).

## As três contas separadas

| O que | Quem cobra | Como é cobrado |
|---|---|---|
| **Hospedar o site** (Worker, arquivos, catálogo) | Cloudflare | Grátis até um limite; depois US$ 5 por mês |
| **Guardar e entregar os vídeos** | Bunny, Cloudflare Stream ou o seu serviço de HLS | Por gigabyte (Bunny) ou por minuto (Stream) |
| **Recursos opcionais** (IA, busca por sentido) | Cloudflare | Por uso; **nascem desligados**. Ligar pede o seu "sim" e mostra a estimativa antes |

## Como a calculadora pensa

Você informa:

- **vídeos**: quantos títulos no acervo;
- **horas por vídeo**: duração média (padrão 1 hora);
- **visualizações por mês**: quantas vezes alguém aperta play;
- **minutos por visualização**: quanto a pessoa costuma assistir (padrão 20 minutos);
- **público**: Brasil (entrega mais cara no Bunny) ou EUA/Europa;
- **modo de acesso**: no `privado` e no `cadastro` quase toda chamada passa pelo Worker.

Premissas fixas: 1 hora de vídeo guardada em várias qualidades (mais o original) ocupa cerca de **2 GB**; 1 hora
assistida baixa cerca de **1,125 GB** (0,375 GB a cada 20 minutos).

### Bunny Stream

- Armazenamento: **US$ 0,01 por GB por mês**.
- Entrega: **US$ 0,045 por GB** com público no Brasil; a partir de **US$ 0,01 por GB** nos EUA e na Europa.
- Mínimo de **US$ 1 por mês**. Codificação e player sem cobrança extra.
- Não confirmado: se o Stream do Bunny pode usar a rede "Volume" (a partir de US$ 0,005 por GB).

### Cloudflare Stream

- **US$ 5 por 1.000 minutos guardados** e **US$ 1 por 1.000 minutos assistidos**, por mês.
- Codificação e banda sem cobrança extra. Previsível, mas fica caro com acervo grande e pouco assistido.

### HLS genérico

O site só toca. O custo é o do serviço onde estão os seus arquivos `.m3u8`: a calculadora
não estima.

### Hospedagem na Cloudflare (Worker)

- **Plano grátis**: 100 mil chamadas de Worker por dia (ao passar disso, o site para de
  responder até a meia-noite UTC), 10 ms de CPU por chamada. Arquivos estáticos não contam.
- **Plano pago (US$ 5 por mês)**: 10 milhões de chamadas por mês incluídas, depois US$ 0,30 por
  milhão extra.
- Cada visita faz de 3 (público) a 6 (privado) chamadas. Regra prática: até **cerca de 5 mil
  visitas por dia** o grátis serve; com cadastro aberto ou modo privado, **assuma o plano pago**.
- Veja `docs/limites.md` para os tetos de catálogo e de CPU.

## Cenários (estimativa de 2026-10-01, vídeos de 1 hora, 20 minutos por visualização)

| Cenário | Bunny (Brasil) | Cloudflare Stream | Hospedagem do site |
|---|---|---|---|
| **Pequeno**: 50 vídeos, 500 visualizações/mês | ~US$ 9,44 (R$ 49, com IOF R$ 52) | US$ 25 (R$ 130, com IOF R$ 137) | grátis |
| **Médio**: 300 vídeos, 10 mil visualizações/mês | ~US$ 175 (R$ 905, com IOF R$ 960) | US$ 290 (R$ 1.502, com IOF R$ 1.592) | grátis no `publico`; US$ 5 no `cadastro` |
| **Grande**: 2.000 vídeos, 200 mil visualizações/mês | ~US$ 3.415 (R$ 17,7 mil, com IOF R$ 18,8 mil) | US$ 4.600 (R$ 23,8 mil, com IOF R$ 25,3 mil) | US$ 5 a US$ 6 |

Com público fora do Brasil o Bunny cai bastante (o grande vai a cerca de US$ 790). Para público
grande e pouco acervo, o Bunny costuma custar menos; para acervo pequeno e previsibilidade, o
Stream é simples de entender.

## O que não está na conta

- **Cartão internacional e IOF** (cerca de 6%): nenhum dos dois provedores cobra em reais.
- **Imposto sobre serviços digitais** e variação do dólar.
- **Domínio próprio** (cerca de R$ 40 por ano no `.com.br`, fora da Cloudflare ou nela).
- **Recursos de IA** (legendas, capas, busca por sentido): custo por uso, sempre com estimativa e
  confirmação antes.

## Como se proteger de conta surpresa

1. **Alerta de gasto da Cloudflare** (Faturamento, Alertas de orçamento): avisa por e-mail,
   **não pausa nada**. Configure no go-live.
2. **Bunny: limite mensal de banda** na pull zone. É o **único teto duro**: ao atingir, os vídeos
   saem do ar até o mês virar. Ligue com folga de 2 vezes o uso esperado e avise a equipe.
3. **Limites de envio** por conta de equipe (`maxVideos`, `maxDuracaoSeg`, autorização manual).
4. No plano grátis, o próprio limite diário do Worker funciona como teto de custo.
5. Rode o checklist de go-live: `node scripts/setup.mjs go-live` (itens e comandos em `docs/contas-e-chaves.md`, seção 5).
