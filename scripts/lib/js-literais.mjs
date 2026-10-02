/* scripts/lib/js-literais.mjs — varredor de literais de texto em JavaScript.
 *
 * Um léxico mínimo (sem dependências): separa comentários, strings ('..', "..",
 * `..`) e regex, o bastante para achar TEXTO de interface escrito no código.
 * Serve ao scripts/i18n-literais.mjs (a contagem) e aos testes. Não é um parser:
 * em template literal só olha a parte fixa, e a heurística de regex usa o token
 * anterior (a mesma que os minificadores simples usam).
 */

/* Palavras de função do português: um literal com duas ou mais delas, ou com
 * acento, é texto de pessoa e não identificador. */
const PALAVRAS_PT = /\b(de|do|da|dos|das|para|não|com|um|uma|uns|que|em|no|na|nos|nas|os|as|por|sem|ou|ao|aos|se|já|ainda|mais|esta|este|esse|essa|ser|foi|são|tem|há|vazio|nenhum|nenhuma|todos|todas|erro|falha)\b/gi;
const ACENTO = /[áéíóúâêôãõçàÁÉÍÓÚÂÊÔÃÕÇ]/;

export function ehTextoPt(s) {
  const t = String(s).trim();
  if (t.length < 5) return false;
  if (/^(https?:|\/|\.|#|data:)/.test(t)) return false;
  if (/^[\w.:/#@\[\]=*>~+,() -]*$/.test(t) && !ACENTO.test(t) && !/ /.test(t)) return false;
  if (ACENTO.test(t) && /[a-zA-Z]{3}/.test(t)) return true;
  const achadas = t.match(PALAVRAS_PT) || [];
  return achadas.length >= 2 && /\s/.test(t);
}

const ANTES_DE_REGEX = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|case|in|of|delete|void|throw|new)$/;

/* Devolve [{ tipo:'string'|'template'|'comentario'|'regex', ini, fim, valor, linha }] */
export function tokenizar(fonte) {
  const saida = [];
  let i = 0;
  let linha = 1;
  let ultimo = '';
  const n = fonte.length;
  const avancar = (ate) => {
    for (let k = i; k < ate; k++) if (fonte[k] === '\n') linha++;
    i = ate;
  };
  while (i < n) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (c === '/' && d === '/') {
      let f = fonte.indexOf('\n', i); if (f < 0) f = n;
      saida.push({ tipo: 'comentario', ini: i, fim: f, linha });
      i = f; continue;
    }
    if (c === '/' && d === '*') {
      let f = fonte.indexOf('*/', i + 2); f = f < 0 ? n : f + 2;
      saida.push({ tipo: 'comentario', ini: i, fim: f, linha });
      avancar(f); continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && fonte[k] !== c && fonte[k] !== '\n') k += fonte[k] === '\\' ? 2 : 1;
      saida.push({ tipo: 'string', ini: i, fim: k + 1, valor: fonte.slice(i + 1, k), linha });
      ultimo = 's'; i = k + 1; continue;
    }
    if (c === '`') {
      let k = i + 1; let prof = 0;
      while (k < n) {
        if (fonte[k] === '\\') { k += 2; continue; }
        if (fonte[k] === '$' && fonte[k + 1] === '{') { prof++; k += 2; continue; }
        if (fonte[k] === '}' && prof) { prof--; k++; continue; }
        if (fonte[k] === '`' && !prof) break;
        k++;
      }
      saida.push({ tipo: 'template', ini: i, fim: k + 1, valor: fonte.slice(i + 1, k), linha });
      avancar(k + 1); ultimo = 's'; continue;
    }
    if (c === '/') {
      const antes = fonte.slice(Math.max(0, i - 12), i).trimEnd();
      if (ANTES_DE_REGEX.test(antes)) {
        let k = i + 1; let classe = false;
        while (k < n && fonte[k] !== '\n') {
          if (fonte[k] === '\\') { k += 2; continue; }
          if (fonte[k] === '[') classe = true;
          else if (fonte[k] === ']') classe = false;
          else if (fonte[k] === '/' && !classe) break;
          k++;
        }
        saida.push({ tipo: 'regex', ini: i, fim: k + 1, linha });
        i = k + 1; ultimo = 's'; continue;
      }
    }
    if (c === '\n') linha++;
    i++;
  }
  return saida;
}

/* Literais de texto PT de interface num arquivo JS: [{ linha, valor }]. */
export function literaisPtJs(fonte) {
  return tokenizar(fonte)
    .filter((t) => (t.tipo === 'string' || t.tipo === 'template') && ehTextoPt(t.valor))
    .map((t) => ({ linha: t.linha, valor: t.valor }));
}

/* Em HTML: texto visível entre tags e atributos de texto (title, alt, placeholder,
 * aria-label), sem <script>/<style>/comentários. */
export function literaisPtHtml(fonte) {
  const limpo = fonte
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
  const achados = [];
  const linhaDe = (pos) => limpo.slice(0, pos).split('\n').length;
  for (const m of limpo.matchAll(/>([^<>]+)</g)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (ehTextoPt(t) || (t.length >= 3 && ACENTO.test(t))) achados.push({ linha: linhaDe(m.index), valor: t });
  }
  for (const m of limpo.matchAll(/\b(?:title|alt|placeholder|aria-label|content)="([^"]+)"/g)) {
    if (ehTextoPt(m[1])) achados.push({ linha: linhaDe(m.index), valor: m[1] });
  }
  return achados;
}
