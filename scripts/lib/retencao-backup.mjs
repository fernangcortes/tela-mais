/* scripts/lib/retencao-backup.mjs — quais arquivos `backup-AAAA-MM-DD.json` guardar. Pura (sem disco).
 *
 * Regra: guarda os últimos `diarios` DIAS (contados do dia mais novo), e, além disso, o PRIMEIRO backup de cada um
 * dos últimos `mensais` MESES. O resto sai. Arquivo com outro nome nunca é tocado. */
const NOME = /^backup-(\d{4})-(\d{2})-(\d{2})\.json$/;

export function dataDoArquivo(nome) {
  const m = NOME.exec(nome);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return { ms: d.getTime(), mes: `${m[1]}-${m[2]}` };
}

/* { guardar[], apagar[] } — `nomes` é a lista de arquivos da pasta. */
export function escolherRetencao(nomes, { diarios = 30, mensais = 12 } = {}) {
  const lidos = nomes.map((nome) => ({ nome, d: dataDoArquivo(nome) })).filter((x) => x.d);
  if (!lidos.length) return { guardar: [], apagar: [] };
  const maisNovo = Math.max(...lidos.map((x) => x.d.ms));
  const DIA = 86400000;
  const guardar = new Set();
  for (const x of lidos) if (maisNovo - x.d.ms < diarios * DIA) guardar.add(x.nome);
  const porMes = new Map();
  for (const x of lidos) {
    const atual = porMes.get(x.d.mes);
    if (!atual || x.d.ms < atual.d.ms) porMes.set(x.d.mes, x);
  }
  const meses = [...porMes.keys()].sort().slice(-mensais);
  for (const mes of meses) guardar.add(porMes.get(mes).nome);
  const ordenar = (a, b) => (a < b ? -1 : 1);
  return { guardar: [...guardar].sort(ordenar), apagar: lidos.map((x) => x.nome).filter((n) => !guardar.has(n)).sort(ordenar) };
}
