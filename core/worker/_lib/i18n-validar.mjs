/* core/worker/_lib/i18n-validar.mjs — confere idiomas e textos do config contra o catálogo.
 *
 * ESM puro, como o config-validar.mjs (que o chama): o mesmo código serve ao Worker,
 * ao validar-config e ao aplicar-config. Devolve erros no formato { caminho, mensagem },
 * em português claro, dizendo O QUE está errado e O QUE fazer.
 *
 * Regras:
 *   - config.textos[idioma] só aceita chaves que existem no catálogo de referência
 *     (pt-BR). A chave curta do M4 ("rodape") vale como apelido de "site.rodape".
 *     Chave desconhecida é quase sempre erro de digitação, e erro de digitação aqui
 *     significa um texto que a pessoa escreveu e que nunca aparece: melhor recusar
 *     e sugerir a chave certa.
 *   - o texto do cliente não pode usar {parametro} que o texto de fábrica não tem:
 *     o parâmetro nunca seria preenchido e a chave ficaria visível na tela.
 *   - textos de idiomas fora de `idiomas.disponiveis` e dos de fábrica nunca seriam
 *     mostrados: recusados, com o lembrete de acrescentar o idioma à lista. */
import referencia from '../../locales/pt-BR.json' with { type: 'json' };

export const IDIOMAS_DE_FABRICA = ['pt-BR', 'en', 'es'];

export function parametrosDe(valor) {
  const achados = new Set();
  const somar = (s) => { for (const m of String(s).matchAll(/\{([A-Za-z_]\w*)\}/g)) achados.add(m[1]); };
  if (typeof valor === 'string') somar(valor);
  else if (valor && typeof valor === 'object') Object.values(valor).forEach(somar);
  return achados;
}

/* A chave do catálogo para o que o cliente escreveu: a própria, ou "site.<curta>". */
export function chaveDoCatalogo(chave, ref = referencia) {
  if (chave in ref) return chave;
  if (!chave.includes('.') && (`site.${chave}` in ref)) return `site.${chave}`;
  return null;
}

/* A chave mais parecida (para a mensagem "quis dizer ..."): distância de edição pequena. */
export function chaveParecida(chave, ref = referencia) {
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  };
  let melhor = null;
  let menor = Infinity;
  for (const k of Object.keys(ref)) {
    const d = dist(chave.toLowerCase(), k.toLowerCase());
    if (d < menor) { menor = d; melhor = k; }
  }
  return menor <= Math.max(3, Math.floor(chave.length / 3)) ? melhor : null;
}

/* Confere uma tabela { chave: texto } de UM idioma. `onde` é o prefixo do caminho. */
export function validarTabela(tabela, onde, ref = referencia) {
  const erros = [];
  for (const [chave, texto] of Object.entries(tabela || {})) {
    const real = chaveDoCatalogo(chave, ref);
    if (!real) {
      const sug = chaveParecida(chave, ref);
      erros.push({
        caminho: `${onde}.${chave}`,
        mensagem: `a chave "${chave}" não existe nos textos da interface.${sug ? ` Quis dizer "${sug}"?` : ''} A lista completa está em core/locales/pt-BR.json.`
      });
      continue;
    }
    if (typeof texto !== 'string') continue;   /* o schema já recusa o que não é texto */
    const permitidos = parametrosDe(ref[real]);
    ['marca', 'marcaCurta', 'organizacao'].forEach((g) => permitidos.add(g));
    const usados = parametrosDe(texto);
    const sobra = [...usados].filter((p) => !permitidos.has(p));
    if (sobra.length) {
      const lista = [...parametrosDe(ref[real])];
      erros.push({
        caminho: `${onde}.${chave}`,
        mensagem: `o texto usa {${sobra.join('}, {')}}, que esta frase não recebe. ${lista.length ? `Os buracos que ela aceita: {${lista.join('}, {')}}.` : 'Ela não tem buracos para preencher (só {marca}, {marcaCurta} e {organizacao}).'}`
      });
    }
  }
  return erros;
}

/* Idiomas e textos de um config já com padrões aplicados. */
export function validarIdiomas(config, ref = referencia) {
  const erros = [];
  const idi = config.idiomas || {};
  const disponiveis = Array.isArray(idi.disponiveis) ? idi.disponiveis : [];
  const aceitos = new Set([...disponiveis, ...IDIOMAS_DE_FABRICA]);

  if (disponiveis.length && idi.padrao && !disponiveis.includes(idi.padrao)) {
    erros.push({ caminho: 'idiomas.padrao', mensagem: `o idioma padrão "${idi.padrao}" precisa estar na lista idiomas.disponiveis.` });
  }
  if (new Set(disponiveis).size !== disponiveis.length) {
    erros.push({ caminho: 'idiomas.disponiveis', mensagem: 'há idioma repetido na lista. Cada idioma entra uma vez só.' });
  }
  for (const [idioma, tabela] of Object.entries(config.textos || {})) {
    if (!aceitos.has(idioma)) {
      erros.push({
        caminho: `textos.${idioma}`,
        mensagem: `os textos de "${idioma}" nunca apareceriam: esse idioma não está em idiomas.disponiveis. Acrescente-o à lista (e, se não for pt-BR, en ou es, crie config/locales/${idioma}.json com a tradução).`
      });
      continue;
    }
    erros.push(...validarTabela(tabela, `textos.${idioma}`, ref));
  }
  return erros;
}
