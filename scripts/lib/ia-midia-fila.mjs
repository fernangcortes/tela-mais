/* scripts/lib/ia-midia-fila.mjs — o caminho "site" dos scripts de mídia (capas.mjs e trailer.mjs com --fila), usado pelo executor
 * do GitHub (.github/workflows/gerar-midia.yml): o catálogo vem do site, o vídeo vem do provedor (URL), o resultado vai ao R2 e a
 * SUGESTÃO entra na fila da tela IA do /admin (`midia_clipe`, `midia_trailer`). Nada vai ao ar: o clipe só passa a tocar no fundo da
 * home quando uma pessoa aceita a sugestão (aí vira `item.midia_gerada`, com `revisado:true`). */
import { montarMidia } from '../../core/worker/_lib/provedores/index.js';
import { transcricaoDoItem } from '../../core/worker/_lib/ia/pipeline.js';

/** Quanto tempo vale a URL assinada do vídeo de origem (só no modo privado): o tempo de baixar e cortar. */
export const VALIDADE_ORIGEM_SEG = 7200;

/* `midia.mp4` é um texto ou um objeto { '360p': url, '720p': url }: escolhe a maior rendição até 1080p (boa para cortar, sem baixar o original). */
function melhorMp4(mp4) {
  if (typeof mp4 === 'string') return mp4 || null;
  if (!mp4 || typeof mp4 !== 'object') return null;
  const lista = Object.entries(mp4).filter(([, u]) => typeof u === 'string' && u).map(([k, u]) => [parseInt(k, 10) || 0, u]).sort((a, b) => a[0] - b[0]);
  if (!lista.length) return null;
  const ate = lista.filter(([h]) => h <= 1080);
  return (ate.length ? ate[ate.length - 1] : lista[0])[1];
}

/** { mp4, hls } -> a melhor URL para o ffmpeg ler (mp4 busca melhor; HLS serve também). `null` se não houver. */
export function urlDeOrigem(midia) {
  if (!midia) return null;
  return melhorMp4(midia.mp4) || (typeof midia.hls === 'string' && midia.hls ? midia.hls : null);
}

/**
 * Os títulos escolhidos, com a URL do vídeo e, se `comTranscricao`, a legenda (para o modelo ler).
 * `provedor` é o adaptador (provedorDoAmbiente). Título sem vídeo no provedor é pulado, com o motivo em `pulados`.
 */
export async function alvosDaFila({ cliente, provedor, config, ids, comTranscricao = false, idioma = 'pt', fetch }) {
  const catalogo = await cliente.catalogo();
  const itens = (catalogo && catalogo.itens) || [];
  const falta = ids.filter((id) => !itens.some((i) => i.id === id));
  if (falta.length) throw new Error('id não encontrado no catálogo do site: ' + falta.join(', '));
  const acesso = (config && config.acesso) || {};
  const assinar = acesso.modo && acesso.modo !== 'publico' && acesso.privado && acesso.privado.assinarMidia === true;
  const alvos = []; const pulados = [];
  for (const item of itens.filter((i) => ids.includes(i.id))) {
    let url = null;
    try { url = urlDeOrigem(await montarMidia(provedor, item, assinar ? { assinar: true, validadeSeg: VALIDADE_ORIGEM_SEG } : {})); } catch (e) { url = null; }
    if (!url) { pulados.push({ id: item.id, motivo: 'sem endereço de vídeo no provedor' }); continue; }
    const alvo = { id: item.id, titulo: item.titulo || '', serie: item.serie || '', item, video: url, transcricao: '', blocos: null };
    if (comTranscricao) {
      const t = await transcricaoDoItem({ provedor, item, idioma, fetch }).catch(() => null);
      if (t) { alvo.transcricao = t.texto; alvo.blocos = t.blocos; }
    }
    alvos.push(alvo);
  }
  return { alvos, pulados };
}

/**
 * Registra o resultado de `gerarTrailerEClipe` na fila do /admin. `urls` são os endereços https do R2 (de `entregar`).
 * Devolve a lista [{ campo, ok, codigo? }]. Mídia só de ffmpeg nasce `origem:'automatica'`; se o modelo escolheu os trechos, 'ia'.
 */
export async function sugerirNaFila({ cliente, itemId, resultado, urls, agora = () => new Date().toISOString() }) {
  const prov = { origem: resultado.origemTrechos === 'ia' ? 'ia' : 'automatica', modelo: resultado.modelo || null, provedor: null, tarefa: 'trailer', data: agora(), revisado: false };
  const enviar = async (campo, valor) => {
    const r = await cliente.entregar({ itemId, campo, valor, proveniencia: prov, custoUSD: 0, atual: null });
    return { campo, ok: r.ok, codigo: r.ok ? undefined : ((r.json && r.json.codigo) || r.status) };
  };
  const saida = [];
  if (resultado.clipe && urls.clipe) {
    saida.push(await enviar('midia_clipe', semNulos({ url: urls.clipe, posterUrl: urls.clipePoster, duracao: resultado.clipe.duracao, bytes: resultado.clipe.bytes })));
  }
  if (resultado.trailer && urls.trailer) {
    saida.push(await enviar('midia_trailer', semNulos({
      url: urls.trailer, posterUrl: urls.trailerPoster, duracao: resultado.trailer.duracao, bytes: resultado.trailer.bytes,
      trechos: (resultado.trailer.trechos || []).map((t) => semNulos({ inicio: t.inicio, fim: t.fim, motivo: t.motivo ? String(t.motivo).slice(0, 300) : undefined }))
    })));
  }
  return saida;
}

function semNulos(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}
