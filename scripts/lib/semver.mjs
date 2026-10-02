/* scripts/lib/semver.mjs — versões X.Y.Z (SemVer) para os scripts de atualização e de release.
 *
 * O Worker tem a sua própria conta para o aviso "há versão nova" (core/worker/_lib/saude.js, que lê a versão do
 * package.json); esta aqui entende também pré-lançamento (1.0.0-beta.1 vem ANTES de 1.0.0), que um script de
 * atualização precisa respeitar. `.core-version`, `package.json` e o LICENSE andam juntos (tests/atualizar.test.js). */

export const REPOSITORIO_OFICIAL = 'fernangcortes/tela-mais';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/* '1.2.3' / 'v1.2.3-beta.1' -> { maior, menor, correcao, pre } ou null. */
export function lerVersao(texto) {
  const m = SEMVER.exec(String(texto == null ? '' : texto).trim());
  if (!m) return null;
  return { maior: +m[1], menor: +m[2], correcao: +m[3], pre: m[4] || null };
}

/* -1 se a < b, 0 se iguais, 1 se a > b; null se uma delas não é versão. Pré-lançamento vem ANTES da versão final. */
export function compararVersoes(a, b) {
  const x = lerVersao(a), y = lerVersao(b);
  if (!x || !y) return null;
  for (const k of ['maior', 'menor', 'correcao']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const px = x.pre.split('.'), py = y.pre.split('.');
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    if (px[i] === undefined) return -1;
    if (py[i] === undefined) return 1;
    const nx = /^\d+$/.test(px[i]), ny = /^\d+$/.test(py[i]);
    if (nx && ny) { if (+px[i] !== +py[i]) return +px[i] < +py[i] ? -1 : 1; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (px[i] !== py[i]) return px[i] < py[i] ? -1 : 1;
  }
  return 0;
}
