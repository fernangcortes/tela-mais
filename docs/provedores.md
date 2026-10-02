# Provedores de vídeo: qual escolher e o que cada um pede

O tela mAIs não guarda nem converte vídeo sozinho. Ele usa um **provedor de vídeo**: um serviço
que recebe o arquivo, converte para vários tamanhos e entrega para o público. Você escolhe um
em `config/site.json`, no campo `video.provedor`, e troca quando quiser, sem mexer em código.

Valores aceitos: `bunny`, `cloudflare-stream` e `hls-generico`.

> **Os preços abaixo são estimativas feitas em 2026-10-01** com dólar a R$ 5,18, a partir de
> tabelas públicas dos próprios provedores e de fontes de terceiros. **Reconfira no site de
> cada um antes de decidir.** Preço muda, e alguns itens ficaram sem confirmação (marcados).

## Qual escolher, em português claro

| Se você pensa assim... | Escolha | Resumo |
|---|---|---|
| "Quero o mais barato e simples." | **Bunny Stream** | É o padrão. Serve para a maioria. Teste grátis de 14 dias sem cartão (conferir). |
| "Já uso a Cloudflare e quero uma conta só, com custo fácil de prever." | **Cloudflare Stream** | Paga por minuto guardado e por minuto assistido. Fica caro se o acervo é grande e pouco assistido. |
| "Meus vídeos já estão em outro serviço que entrega `.m3u8`." | **HLS genérico** | O site só toca. Envio e conversão ficam com o outro serviço. |

Não implementamos Vimeo (preços instáveis, pouco white label) nem Amazon IVS (é para ao vivo).
Mux, R2 com ffmpeg e AWS ficam para uma fase futura; quem precisar pode usar o HLS genérico.

## Custo mensal simulado (estimativa, reconferir)

Premissas: vídeos de 1 hora; cada visualização assiste 20 minutos (cerca de 0,375 GB);
público no Brasil. Pequeno = 50 vídeos e 500 visualizações por mês. Médio = 300 vídeos e 10 mil
visualizações. Grande = 2.000 vídeos e 200 mil visualizações.

| Provedor | Pequeno | Médio | Grande |
|---|---|---|---|
| Bunny Stream | ~US$ 9 (R$ 47) | ~US$ 175 (R$ 906) | ~US$ 3.415 (R$ 17,7 mil) |
| Cloudflare Stream | US$ 25 (R$ 130) | US$ 290 (R$ 1.502) | US$ 4.600 (R$ 23,8 mil) |
| HLS genérico | depende do serviço que você usar | depende | depende |

Observações:
- No Bunny, com público só no Brasil o preço de entrega é maior (US$ 0,045 por GB). Existe uma
  rede mais barata ("Volume"), mas não foi confirmado que vale para o Stream do Bunny.
- No Cloudflare Stream: US$ 5 por 1.000 minutos guardados e US$ 1 por 1.000 minutos entregues
  por mês. Guardar é mais caro que no Bunny.
- Nenhum dos dois cobra em reais: o cliente precisa de cartão internacional (ou virtual) e
  paga IOF (cerca de 6%). Veja isso antes de começar.
- Além do vídeo, a hospedagem do site na Cloudflare custa US$ 0 no modo público e cerca de
  US$ 5 por mês no plano pago do Worker, recomendado para cadastro aberto.

## Recursos de cada provedor

| Recurso | Bunny | Cloudflare Stream | HLS genérico |
|---|---|---|---|
| Envio de arquivo pelo /admin | Sim (TUS, retomável) | Sim (TUS, uso único por envio) | Não: você cola o endereço do `.m3u8` |
| Capa por upload de imagem | Sim | Não (escolhe-se o instante do vídeo) | Só por endereço |
| Capa por instante do vídeo | Sim | Sim | Não |
| Legenda por arquivo | Sim | Sim (SRT vira VTT) | Só por endereço |
| Legenda por IA | Sim (US$ 0,10 por minuto por idioma) | Sim (sem custo extra, conferir idiomas) | Não |
| Modo privado (URL assinada) | Previsto, implementação no marco M5 | Já implementada (chave de assinatura) | Não |
| MP4 para download | Sim | Só se habilitar no vídeo | Só por endereço |
| Excluir pelo /admin | Sim | Sim | Não (o site só esquece o título) |

## Credenciais: o que cada um pede e onde conseguir

**Regra única:** a credencial nunca vai em arquivo do projeto. No `config/site.json` você só
escreve o **nome** da variável (`{"$env": "NOME"}`) e o valor fica em `.env` (para os scripts),
em `.dev.vars` (teste local) ou em segredos do Worker (produção: `wrangler secret put NOME`).
O `.env.example` lista todos os nomes.

### Bunny Stream (`video.provedor = "bunny"`)

| Dado | Variável padrão | Onde conseguir |
|---|---|---|
| ID da biblioteca | `BUNNY_LIBRARY_ID` | Painel do Bunny, Stream, sua biblioteca (o número aparece na tela da biblioteca) |
| Chave de API da biblioteca | `BUNNY_API_KEY` | Na mesma biblioteca, "API". **Use a chave da biblioteca (Stream API Key), não a chave da conta.** |
| Endereço de entrega (pull zone) | `BUNNY_PULLZONE` | Na biblioteca, "Encoding/CDN": algo como `vz-xxxxxxxx-xxx.b-cdn.net`. Não é segredo. |
| Chave de token (opcional) | `BUNNY_TOKEN_KEY` | Só para o modo privado (M5), em "Security" da biblioteca |

### Cloudflare Stream (`video.provedor = "cloudflare-stream"`)

| Dado | Variável padrão | Onde conseguir |
|---|---|---|
| ID da conta | `CLOUDFLARE_ACCOUNT_ID` | Painel da Cloudflare: 32 caracteres na barra lateral ou na URL |
| Token de API | `CLOUDFLARE_STREAM_TOKEN` | Perfil, Tokens de API, criar token com a permissão **Stream: Edit** |
| Subdomínio de clientes | `CLOUDFLARE_STREAM_SUBDOMINIO` | Painel, Stream: algo como `customer-xxxx`. Sem ele nenhuma URL de reprodução é montada. |
| ID e JWK da chave de assinatura (opcionais) | `CLOUDFLARE_STREAM_KEY_ID`, `CLOUDFLARE_STREAM_KEY_JWK` | Criadas pela API (`POST /stream/keys`). Só para o modo privado |
| Segredo do webhook (opcional) | `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | Resposta de `PUT /stream/webhook` |

Para exigir assinatura em vídeos novos: `video.cloudflareStream.exigirAssinatura: true`.

### HLS genérico (`video.provedor = "hls-generico"`)

Não pede chave. Pede o **endereço base** onde estão os `.m3u8` (`video.hlsGenerico.baseUrl`,
sempre `https`, também aceita `HLS_BASE_URL`). Se os vídeos ou capas estão em outros
servidores, o **dono da instalação** lista os hosts em `video.hlsGenerico.hostsPermitidos`.
Isso é proposital: quem edita o catálogo não consegue mandar o navegador do público para um
servidor qualquer. Cadastro de títulos: tela "adicionar por endereço" do /admin ou
`node scripts/cadastrar-hls.mjs` para carga em lote.

## Exemplo de troca de provedor

```json
"video": {
  "provedor": "cloudflare-stream",
  "cloudflareStream": {
    "accountId": { "$env": "CLOUDFLARE_ACCOUNT_ID" },
    "tokenApi": { "$env": "CLOUDFLARE_STREAM_TOKEN" },
    "subdominioDeClientes": { "$env": "CLOUDFLARE_STREAM_SUBDOMINIO" }
  }
}
```

Depois: `npm run config:validar`, `npm run config:aplicar`. Títulos cadastrados em outro
provedor continuam no catálogo, mas sem vídeo tocável até serem recadastrados no novo
(o item guarda `fonte = {provedor, id}`), em vez de tocar uma URL errada.

## Avisos honestos

- Os adaptadores foram escritos e testados com respostas **gravadas à mão a partir da
  documentação**, sem chamar as APIs reais. Faça um teste com uma conta real antes de lançar.
- Nenhum provedor impede gravação de tela. Assinatura de URL só impede o link de ser copiado.
- O modo privado com URL assinada do Bunny chega no marco M5.
