# core/locales/

Todo texto de interface do produto, por idioma. O `pt-BR.json` é a **referência**: a chave
nasce nele, e `en.json` e `es.json` a traduzem (de verdade, não por cópia). Os três têm sempre
as mesmas chaves, os mesmos `{parâmetros}` e as mesmas formas de plural:
`node scripts/i18n-faltando.mjs` precisa dar 0 (o `npm test` cobra).

## Formato

```json
{
  "site.verTudo": "Ver tudo",
  "site.verTudoDe": "Ver tudo de {titulo}",
  "comum.titulos": { "one": "{n} título", "other": "{n} títulos" },
  "api.nao-autorizado": "não autorizado"
}
```

- **Chave**: `namespace.nome`. Os namespaces: `comum` (o que todos usam), `site` (o catálogo
  público), `player`, `catalogo` (rótulos que o core calcula), `pendencia` e `permissao*`
  (tabelas do core), `mesa`, `painel` e `telas` (a mesa de curadoria), `operacao`, `assistente`,
  `saude`, `backup` e `custos` (as telas de operação do /admin: o servidor só manda códigos e
  parâmetros, e a frase sai de `saude.c.<codigo>`, `saude.f.<codigo>`, `assistente.erro.<codigo>`...)
  e `api` (as mensagens de erro das APIs: a chave é `api.<codigo>`, o mesmo `codigo` que a resposta traz).
  As chaves de `painel.` e `telas.` nasceram do próprio texto em português (`painel.salvar`);
  se o texto mudar, a chave não precisa mudar.
- **Parâmetros**: `{nome}` entre chaves. `{marca}`, `{marcaCurta}` e `{organizacao}` são
  preenchidos sozinhos com os dados da marca (por isso nenhum catálogo traz o nome do cliente).
- **Plural**: um objeto com as categorias do CLDR (`zero`, `one`, `two`, `few`, `many`, `other`;
  `um`/`outro` valem como apelido de `one`/`other`) e/ou `"=0"`, `"=1"`... para um número exato.
  A chamada passa `n`. A regra de plural é a do idioma em que o texto foi escrito.
- Valor é sempre texto puro: nada daqui vira HTML.

## Como o texto chega à tela

`tr('chave', { parametros })` (alias de `AppI18n.t`, em `core/site/i18n.js`). A ordem de
resolução: texto do cliente no idioma atual > catálogo do idioma > texto do cliente no idioma
padrão > catálogo do idioma padrão > pt-BR > a própria chave (e ela fica em `faltantes()`).

O cliente troca textos em `config/site.json` (`textos.<idioma>`, chave completa ou, para as do
M4, a curta: `rodape` = `site.rodape`) ou acrescenta um idioma inteiro em
`config/locales/<idioma>.json` (o que faltar cai no idioma padrão).
`node scripts/aplicar-config.mjs` junta tudo e grava `core/site/locales/<idioma>.json`
(gerado; o navegador baixa só o do idioma em uso). Em Node e no Worker o pt-BR já vem
embutido; o Worker empacota os três para as mensagens de erro das APIs.

## O que NÃO vai aqui

Dado que não é texto de tela: rótulo da faixa de legenda, valor de enum gravado no catálogo,
lista de palavras da busca. Esses literais levam o marcador `i18n-ignorar` na linha (com o
motivo), e `node scripts/i18n-literais.mjs` mostra o que sobrou.
Os diagnósticos de instalação (`config-validar`, `config.js`, `tema.mjs`) ficam em pt-BR
de propósito: quem os lê é quem instala.
