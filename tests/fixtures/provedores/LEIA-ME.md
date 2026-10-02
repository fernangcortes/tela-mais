# tests/fixtures/provedores/

Respostas gravadas dos provedores de vídeo para a suíte de contrato
(`tests/provedores-contrato.test.js`), uma pasta por adaptador (`bunny/`, `cloudflare-stream/`, `hls-generico/`).
**Nenhuma rede nos testes**: o `fetch` do adaptador é um falso que responde só o que a fixture grava; chamada não prevista
reprova. As respostas devem vir da documentação/conta de teste do provedor; não inclua segredo real (use `chave-de-teste-nao-vaza`).

## `manifesto.json`

```json
{
  "provedor": "bunny",
  "env": { "BUNNY_LIBRARY_ID": "123456", "BUNNY_API_KEY": "chave-de-teste-nao-vaza", "BUNNY_PULLZONE": "vz-exemplo-abc.b-cdn.net" },
  "segredos": ["chave-de-teste-nao-vaza"],          // nunca podem aparecer em retorno, erro, URL ou plano de upload
  "agora": 1750000000000,                            // relógio fixo (ms): assinaturas e `expiraEm` ficam determinísticos
  "idExemplo": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",  // precisa casar com `padraoId`
  "idsInvalidos": ["", "../x", "a b", "x?y=1", "..."],    // não podem casar com `padraoId`
  "tituloExemplo": "Aula 1"
}
```

## Cenários (`<nome>.json`)

```json
{
  "descricao": "texto livre",
  "entrada": { },                       // argumentos que a suíte passa à função do adaptador (quando há)
  "rotas": [                            // o que o fetch falso aceita; primeira que casar responde
    { "metodo": "POST", "url": "^https://api\\.exemplo/videos$",    // regex sobre a URL completa
      "cabecalhos": { "AccessKey": "..." },                          // opcional: cabeçalhos que a chamada DEVE trazer
      "corpoContem": { "title": "Aula 1" },                          // opcional: trecho do corpo JSON que a chamada DEVE trazer
      "resposta": { "status": 200, "corpo": { }, "texto": "...", "cabecalhos": { } } }   // `corpo` (JSON) ou `texto`
  ],
  "esperado": { }                       // trecho que o resultado da função DEVE conter (objetos e listas em profundidade)
}
```

Cenários que a suíte procura (um adaptador só precisa dos que suas capacidades pedem; os marcados * são obrigatórios):

| cenário | função | `esperado` |
|---|---|---|
| `validarCredenciais.ok`*, `validarCredenciais.recusado`* | `validarCredenciais` | (a suíte confere `ok` true/false) |
| `criarUpload`* (se `capacidades().envio`) | `criarUpload(entrada)` | trecho do plano de upload (`id`, `protocolo`, `modo`, `url`, `expiraEm`, `cabecalhos`, `fonte`) |
| `criarUpload.recusado`, `criarUpload.semId` | `criarUpload` | `{ codigo, status? }` do `ErroProvedor` |
| `retomarUpload`* (rotas `[]` se não há chamada) | `retomarUpload(id)` | trecho do plano |
| `status.enviando`*, `status.processando`*, `status.pronto`*, `status.erro`* | `statusEncoding(id)` | `{ estado, progresso, duracaoSeg, estadoBruto, ... }` normalizado |
| `obterVideo`*, `listar`*, `listar.ultima`*, `excluir`* | `obterVideo`, `listar(entrada)`, `excluir` | `{...}`, `{ n, proximo, primeiro? }`, `{ ok: true }` |
| `naoEncontrado`*, `erro500`* | consultas que falham | `{ status }` (o detalhe do erro não pode conter segredo) |
| `definirCapa`, `definirCapa.semNome`, `definirCapa.recusado` (se `capaPorUpload`) | `definirCapa(id, bytes, mime)` | `{ arquivo, versao, urlCapa }` / `{ codigo }` |
| `enviarLegenda` (se `legendaPorUpload`), `legendas.listar` | `enviarLegenda(id, entrada)`, `legendas(id)` | `{ idioma, rotulo }`, `{ idiomas, urlContem }` |
| `definirCapitulos` (se `capitulosNativos`) | `definirCapitulos(id, entrada.capitulos)` | `{ n }` |
| `webhook.pronto`, `webhook.erro`, `webhook.processando`, `webhook.outraBiblioteca` (se `webhooks`) | `receberWebhook(request)` | `{ id, evento }` ou `null`; `pedido` é o corpo do webhook |

Estado que o adaptador não tem como produzir (o HLS genérico não tem upload, logo não tem `enviando`) se declara no manifesto:
`"estadosInalcancaveis": ["enviando"]` mais `"motivoDosEstadosInalcancaveis": "..."`; a suíte não exige a fixture `status.enviando`
(e reprova se ela existir). Adaptador sem rede para `listar`/`excluir` (HLS genérico) grava esses cenários com `"rotas": []`.

Sem a pasta `manifesto.json`, a suíte do adaptador aparece como **pulada** (com o motivo), não como verde.
