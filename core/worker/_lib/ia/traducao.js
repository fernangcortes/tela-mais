/* ia/traducao.js — traduz uma legenda inteira, mantendo os TEMPOS.
 *
 * O modelo só vê o texto de cada cue (numerado); os tempos nunca passam por ele, então não há como bagunçá-los. A legenda sai
 * em lotes (uma chamada por lote, cada uma com a mesma validação e a mesma retentativa do gerarTexto) e o resultado só existe
 * se TODOS os lotes passarem: tradução pela metade não é devolvida. Sai como sugestão `legenda-<idioma>`, para revisão. */
import { gerarTexto } from './texto.js';
import { paraSrt, emLotes } from './srt.js';

export const CUES_POR_LOTE = 80;

export async function traduzirLegenda({ cues, de, para, titulo, config, env, fetch, orcamento, agora, cuesPorLote = CUES_POR_LOTE }) {
  if (!Array.isArray(cues) || !cues.length) return { estado: 'falhou', codigo: 'ia-entrada-invalida', detalhe: 'legenda vazia', custoUSD: 0 };
  const numeradas = cues.map((c, i) => ({ n: i + 1, texto: c.texto }));
  const traduzidas = [];
  let custoUSD = 0;
  let marca = null;
  for (const lote of emLotes(numeradas, cuesPorLote)) {
    const r = await gerarTexto({ tarefa: 'traducao-legenda', entrada: { titulo, cues: lote, de, para }, config, env, fetch, orcamento, agora });
    custoUSD += r.custoUSD || 0;
    if (r.estado !== 'ok') return { estado: 'falhou', codigo: r.codigo || 'ia-resposta-invalida', detalhe: r.detalhe || '', custoUSD, concluidas: traduzidas.length };
    traduzidas.push(...r.valor);
    marca = r.proveniencia;
  }
  const saida = cues.map((c, i) => ({ inicio: c.inicio, fim: c.fim, texto: traduzidas[i].texto }));
  return { estado: 'ok', cues: saida, srt: paraSrt(saida), custoUSD: Math.round(custoUSD * 1e6) / 1e6, proveniencia: Object.assign({}, marca, { tarefa: 'traducao-legenda' }) };
}
