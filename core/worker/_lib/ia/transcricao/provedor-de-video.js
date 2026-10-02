/* ia/transcricao/provedor-de-video.js — a legenda que o PRÓPRIO provedor de vídeo gera (capacidade `legendaIA`).
 *
 * Cloudflare Stream gera legendas sem custo adicional; o Bunny cobra por idioma (US$ 0,10/min, pesquisa de 2026-10-01) e hoje
 * `legendaIA` está desligada no adaptador dele. É assíncrono: se a faixa do idioma já existe, é lida; se não, pede-se ao provedor
 * (`gerarLegendaIA`) e o resultado fica `pendente` até a faixa aparecer. Sem a capacidade, falha com a razão. */
import { ErroIA } from '../erros.js';
import { pedir } from '../texto/http.js';
import { analisarLegenda } from '../srt.js';
import { idiomaCurto } from './limpeza.js';

export const ID = 'provedor-de-video';
export const ACEITA_PEDACOS = false;

async function acharFaixa({ provedor, video, idioma, fetch, referer }) {
  const faixas = await provedor.legendas(video.id, { extras: video.extras });
  const curto = idiomaCurto(idioma);
  const faixa = (faixas || []).find((f) => f.idioma === idioma) || (faixas || []).find((f) => idiomaCurto(f.idioma) === curto);
  if (!faixa || !faixa.url) return null;
  const r = await pedir(fetch, faixa.url, { method: 'GET', headers: referer ? { Referer: referer } : {} });
  const segmentos = analisarLegenda(r.texto);
  return { segmentos, texto: segmentos.map((s) => s.texto).join(' '), duracaoSeg: segmentos.length ? segmentos[segmentos.length - 1].fim : null, origemDaFaixa: faixa.origem || 'desconhecida' };
}

export async function iniciar({ provedor, video, idioma, fetch, referer }) {
  if (!provedor || !video || !video.id) throw new ErroIA('ia-entrada-invalida', { detalhe: 'falta o provedor de vídeo e o id do vídeo' });
  const ja = await acharFaixa({ provedor, video, idioma, fetch, referer });
  if (ja) return ja;
  const caps = typeof provedor.capacidades === 'function' ? provedor.capacidades() : {};
  if (!caps.legendaIA || typeof provedor.gerarLegendaIA !== 'function') {
    throw new ErroIA('ia-provedor-recusou', { detalhe: 'o provedor "' + provedor.id + '" não gera legenda por IA (capacidade legendaIA desligada)' });
  }
  await provedor.gerarLegendaIA(video.id, { idioma: idiomaCurto(idioma) });
  return { pendente: true, trabalho: { provedor: ID, id: video.id, idioma } };
}

export async function consultar({ trabalho, provedor, video, idioma, fetch, referer }) {
  const faixa = await acharFaixa({ provedor, video: video || { id: trabalho.id }, idioma: idioma || trabalho.idioma, fetch, referer });
  return faixa || { pendente: true, trabalho };
}
