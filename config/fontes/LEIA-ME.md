# Fontes do cliente

Coloque aqui os arquivos `.woff2` das letras da sua marca e peça no `config/site.json`:

```json
"tema": {
  "tipografia": {
    "corpo":  { "familia": "Minha Fonte", "origem": "arquivo",
                "arquivos": ["MinhaFonte-Regular.woff2", "MinhaFonte-Bold.woff2"], "pesos": [400, 700] },
    "titulo": { "familia": "Minha Fonte Titulo", "origem": "arquivo", "arquivos": ["Titulo-Variavel.woff2"] }
  }
}
```

- Só `.woff2`, só o nome do arquivo (sem pasta). Um arquivo sem `pesos` vale como fonte variável (100 a 900).
- Depois rode `node scripts/aplicar-config.mjs`: ele copia os arquivos para `core/site/fontes/` (pasta gerada, não edite) e escreve o `@font-face` no `theme.css`. Fonte que você deixar de usar é removida de lá.
- Nunca usamos fonte baixada de site de terceiros (Google Fonts, Adobe Fonts etc.): a letra sai do seu próprio site, sem entregar o IP de quem assiste e sem abrir a política de segurança.
- Confira a licença da fonte: muitas permitem uso na web (como a SIL OFL), outras exigem licença paga.
- Sem fonte própria, use `"origem": "sistema"` (ex.: Georgia, Verdana): vale a que já está instalada no aparelho, e há sempre uma fonte de reserva (`tema.tipografia.reserva`) enquanto a sua carrega.
