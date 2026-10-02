/* core/worker/_lib/contraste.mjs — conta de contraste (WCAG 2.x) e checagem de paleta.
 *
 * ESM puro, sem dependências: roda igual no Node (validador, aplicar-config, testes)
 * e no Worker. Mora em core/worker/_lib/ para o /admin (editor de tema, M8) usar a
 * MESMA régua do validador: duas contas diferentes seriam duas verdades.
 *
 * A régua: 4,5:1 para texto e 3:1 para o que desenha um controle (WCAG 1.4.3 e
 * 1.4.11). Os mínimos podem ser MAIS ALTOS no config (tema.validarContraste),
 * nunca mais baixos que 3 / 1: o schema impede o resto.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ehHex(v) {
  return typeof v === 'string' && HEX.test(v);
}

/* '#abc' -> '#aabbcc' (minúsculo). Entrada inválida volta como veio. */
export function normalizarHex(v) {
  if (!ehHex(v)) return v;
  const h = v.slice(1).toLowerCase();
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
}

export function paraRgb(hex) {
  const h = normalizarHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function deRgb([r, g, b]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function luminancia(hex) {
  const canal = paraRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2];
}

export function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  const [alto, baixo] = la >= lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (baixo + 0.05);
}

/* 4.5 -> "4,5"; 3.0966 -> "3,10". Português: vírgula decimal. */
export function formatarRazao(n, casas = 2) {
  return Number(n).toFixed(casas).replace('.', ',');
}

/* Uma cor `frente` com a mesma tonalidade que passe em TODOS os `pares` ([{ fundo, minimo }]):
 * mistura a cor com preto ou com branco (o lado que mais afasta do primeiro fundo) em
 * passos de 2%, e devolve o primeiro candidato que passa em todos. Se nem o extremo
 * puro passa (pares impossíveis juntos), devolve o extremo. */
export function sugerirCor(frente, fundo, minimo) {
  return sugerirCorParaPares(frente, [{ fundo, minimo }]);
}

export function sugerirCorParaPares(frente, pares) {
  const passa = (cor) => pares.every((p) => contraste(cor, p.fundo) >= p.minimo);
  if (passa(frente)) return normalizarHex(frente);
  const alvo = luminancia(pares[0].fundo) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const base = paraRgb(frente);
  for (let p = 0.02; p <= 1.0001; p += 0.02) {
    const cand = deRgb(base.map((v, i) => v + (alvo[i] - v) * p));
    if (passa(cand)) return cand;
  }
  return deRgb(alvo);
}

/* ------------------------------------------------------------------ os pares */

/* [frente, fundo, tipo, o que descreve]. `tipo`: 'texto' (4,5) ou 'controle' (3).
 * A lista nasce do uso real no CSS: cada par é algo que a folha pinta de fato.
 * Um par só é medido se as DUAS cores existem na paleta. */
export const PARES_DE_CONTRASTE = [
  ['texto', 'fundo', 'texto', 'o texto sobre o fundo'],
  ['texto', 'superficie', 'texto', 'o texto sobre a superfície (cartões e menus)'],
  ['texto', 'marcaFraca', 'texto', 'o texto sobre o fundo da marca (item selecionado)'],
  ['texto', 'mesaFundo', 'texto', 'o texto sobre o fundo da mesa de curadoria'],
  ['texto', 'mesaPainel', 'texto', 'o texto sobre o painel da mesa de curadoria'],
  ['texto', 'mesaPainelAlto', 'texto', 'o texto sobre o painel elevado da mesa de curadoria'],
  ['textoFraco', 'fundo', 'texto', 'o texto fraco sobre o fundo'],
  ['textoFraco', 'superficie', 'texto', 'o texto fraco sobre a superfície'],
  ['textoFraco', 'marcaFraca', 'texto', 'o texto fraco sobre o fundo da marca'],
  ['textoFraco', 'mesaFundo', 'texto', 'o texto fraco sobre o fundo da mesa'],
  ['textoFraco', 'mesaPainel', 'texto', 'o texto fraco sobre o painel da mesa'],
  ['textoFraco', 'mesaPainelAlto', 'texto', 'o texto fraco sobre o painel elevado da mesa'],
  /* A marca também é cor de TEXTO (links, "Você está aqui"), por isso 4,5 e não 3. */
  ['marca', 'fundo', 'texto', 'a cor da marca (links e destaques) sobre o fundo'],
  ['marca', 'superficie', 'texto', 'a cor da marca sobre a superfície'],
  ['marca', 'marcaFraca', 'texto', 'a cor da marca sobre o fundo da marca'],
  ['marca', 'mesaPainel', 'texto', 'a cor da marca sobre o painel da mesa'],
  ['marca2', 'superficie', 'texto', 'a segunda cor da marca sobre a superfície'],
  ['marca3', 'fundo', 'texto', 'a cor de destaque sobre o fundo'],
  ['marca3', 'superficie', 'texto', 'a cor de destaque sobre a superfície'],
  ['marca3', 'mesaPainel', 'texto', 'a cor de destaque sobre o painel da mesa'],
  ['textoSobreMarca', 'marca', 'texto', 'o texto escrito sobre a cor da marca (botão principal)'],
  ['textoSobreMarca', 'marcaClara', 'texto', 'o texto escrito sobre a marca no hover'],
  ['textoSobreDestaque', 'marca3', 'texto', 'o texto escrito sobre a cor de destaque'],
  ['alerta', 'alertaFundo', 'texto', 'o texto de aviso sobre o fundo de aviso'],
  ['erro', 'erroFundo', 'texto', 'o texto de erro sobre o fundo de erro'],
  ['contorno', 'fundo', 'controle', 'o contorno dos controles sobre o fundo'],
  ['contorno', 'superficie', 'controle', 'o contorno dos controles sobre a superfície'],
  ['contorno', 'mesaPainel', 'controle', 'o contorno dos controles sobre o painel da mesa'],
  ['contorno', 'mesaPainelAlto', 'controle', 'o contorno dos controles sobre o painel elevado da mesa']
];

/* Mede a paleta inteira e devolve só as FALHAS, uma por cor de frente (a pessoa corrige
 * uma cor de cada vez, e uma sugestão que só resolve um fundo a faria falhar no seguinte):
 *   [{ campo, contra, razao, minimo, tipo, descricao, sugestao, outros[], mensagem }]
 * `campo`/`contra` são os caminhos do PIOR par; `outros` os demais fundos que também
 * reprovaram. `paleta` usa os nomes do schema (marca, fundo, textoFraco...). `prefixo`
 * é o caminho para a mensagem (ex.: "tema.cores.claro"). A cor sugerida passa em todos
 * os pares dessa cor de frente (inclusive os que já passavam). */
export function verificarPaleta(paleta, { textoMinimo = 4.5, controleMinimo = 3, prefixo = 'cores' } = {}) {
  const porFrente = new Map();
  for (const [frente, fundo, tipo, descricao] of PARES_DE_CONTRASTE) {
    if (!ehHex(paleta?.[frente]) || !ehHex(paleta?.[fundo])) continue;
    const minimo = tipo === 'texto' ? textoMinimo : controleMinimo;
    const razao = contraste(paleta[frente], paleta[fundo]);
    if (!porFrente.has(frente)) porFrente.set(frente, []);
    porFrente.get(frente).push({ fundo, tipo, descricao, minimo, razao, passa: razao >= minimo });
  }

  const falhas = [];
  for (const [frente, pares] of porFrente) {
    const ruins = pares.filter((p) => !p.passa).sort((a, b) => (a.razao / a.minimo) - (b.razao / b.minimo));
    if (!ruins.length) continue;
    const pior = ruins[0];
    const sugestao = sugerirCorParaPares(paleta[frente], pares.map((p) => ({ fundo: paleta[p.fundo], minimo: p.minimo })));
    const outros = ruins.slice(1).map((p) => `${p.fundo} (${formatarRazao(p.razao)}:1)`);
    falhas.push({
      campo: `${prefixo}.${frente}`,
      contra: `${prefixo}.${pior.fundo}`,
      razao: pior.razao, minimo: pior.minimo, tipo: pior.tipo, descricao: pior.descricao, sugestao,
      outros: ruins.slice(1).map((p) => p.fundo),
      mensagem: `contraste insuficiente entre ${frente} (${normalizarHex(paleta[frente])}) e ${pior.fundo} (${normalizarHex(paleta[pior.fundo])}): ` +
        `${pior.descricao} dá ${formatarRazao(pior.razao)}:1, e o mínimo é ${formatarRazao(pior.minimo, 1)}:1` +
        (outros.length ? `; também falha sobre ${outros.join(', ')}` : '') + '. ' +
        `Sugestão: troque ${frente} por ${sugestao} (mesma tonalidade, mais ${luminancia(sugestao) < luminancia(paleta[frente]) ? 'escura' : 'clara'}; ` +
        `passa em todos os pares), ou ajuste o fundo.`
    });
  }
  return falhas;
}
