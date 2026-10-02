/* scripts/lib/setup/jsonc.mjs — ler e editar o wrangler.jsonc sem perder os comentários.
 *
 * `lerJsonc` entende // e /* *\/ e vírgula sobrando. As edições (`definirCampo`, `trocarString`) mexem só no
 * trecho necessário do TEXTO original: o resto, comentários inclusive, fica como estava. */

/* Mesmo tamanho do original; comentários viram espaços. `strings` = true também esvazia o conteúdo das strings. */
export function mascarar(texto, { strings = false } = {}) {
  let saida = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n && texto[j] !== '"') j += texto[j] === '\\' ? 2 : 1;
      const fim = Math.min(j + 1, n);
      saida += strings ? '"' + '_'.repeat(Math.max(0, fim - i - 2)) + (texto[fim - 1] === '"' ? '"' : '') : texto.slice(i, fim);
      i = fim;
    } else if (c === '/' && d === '/') {
      let j = i;
      while (j < n && texto[j] !== '\n') j++;
      saida += ' '.repeat(j - i);
      i = j;
    } else if (c === '/' && d === '*') {
      let j = texto.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      saida += texto.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else { saida += c; i++; }
  }
  return saida;
}

export function lerJsonc(texto) {
  const limpo = mascarar(texto).replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(limpo);
}

/* Acha o objeto { ... } que contém a primeira ocorrência de `padrao` (regex sobre o texto sem comentários). */
function objetoQueContem(texto, padrao) {
  const sem = mascarar(texto);
  const m = padrao.exec(sem);
  if (!m) return null;
  const esqueleto = mascarar(texto, { strings: true });
  let prof = 0;
  let ini = -1;
  for (let i = m.index; i >= 0; i--) {
    const c = esqueleto[i];
    if (c === '}') prof++;
    else if (c === '{') { if (prof === 0) { ini = i; break; } prof--; }
  }
  if (ini < 0) return null;
  prof = 0;
  for (let i = ini; i < esqueleto.length; i++) {
    const c = esqueleto[i];
    if (c === '{') prof++;
    else if (c === '}') { prof--; if (prof === 0) return { ini, fim: i }; }
  }
  return null;
}

/* Define `"campo": valor` no objeto que contém `padrao`. Devolve { texto, mudou, achou }. */
export function definirCampo(texto, padrao, campo, valor) {
  const obj = objetoQueContem(texto, padrao);
  if (!obj) return { texto, mudou: false, achou: false };
  const corpo = texto.slice(obj.ini, obj.fim + 1);
  const json = JSON.stringify(valor);
  const re = new RegExp(`("${campo}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\s]+)`);
  const existente = re.exec(mascarar(corpo));
  let novoCorpo;
  if (existente) {
    if (existente[2] === json) return { texto, mudou: false, achou: true };
    novoCorpo = corpo.slice(0, existente.index) + existente[1] + json + corpo.slice(existente.index + existente[0].length);
  } else {
    const semCom = mascarar(corpo);
    const multilinha = corpo.includes('\n');
    let pos = semCom.length - 1;                  /* o "}" final */
    let k = pos - 1;
    while (k > 0 && /\s/.test(semCom[k])) k--;
    const virgula = semCom[k] === ',';
    if (multilinha) {
      const linhas = corpo.split('\n');
      const indent = (linhas[1] || '').match(/^\s*/)[0] || '  ';
      novoCorpo = corpo.slice(0, k + 1) + (virgula ? '' : ',') + `\n${indent}"${campo}": ${json}` + (virgula ? ',' : '') + corpo.slice(k + 1);
    } else {
      novoCorpo = corpo.slice(0, k + 1) + (virgula ? ' ' : ', ') + `"${campo}": ${json}` + corpo.slice(k + 1);
    }
  }
  return { texto: texto.slice(0, obj.ini) + novoCorpo + texto.slice(obj.fim + 1), mudou: true, achou: true };
}

/* Troca o valor de uma string: `regexComGrupo` precisa ter um grupo (o valor atual) e roda sobre o texto sem comentários. */
export function trocarString(texto, regexComGrupo, novo) {
  const sem = mascarar(texto);
  const m = regexComGrupo.exec(sem);
  if (!m) return { texto, mudou: false, achou: false };
  const inicioGrupo = m.index + m[0].lastIndexOf(m[1]);
  if (m[1] === novo) return { texto, mudou: false, achou: true };
  return { texto: texto.slice(0, inicioGrupo) + novo + texto.slice(inicioGrupo + m[1].length), mudou: true, achou: true };
}
