/* ia/transcricao/index.js — transcrever(origem, idioma): UMA função, quatro adaptadores.
 *
 *   workers-ai-whisper   padrão recomendado: a conta Cloudflare do cliente, ~US$ 0,03/hora (estimativa de 2026-10-01)
 *   assemblyai           mais qualidade em nome próprio, ~US$ 0,21/hora (reconferir)
 *   openai               whisper-1 (com tempos) e gpt-4o-*-transcribe (só texto)
 *   provedor-de-video    a legenda nativa do Bunny/Stream, quando o adaptador tem a capacidade `legendaIA`
 *
 * origem = { audio?: Uint8Array, pedacos?: [{ audio, deslocamentoSeg }], url?: string, mime?, duracaoSeg?,
 *            provedor?: <adaptador de vídeo>, video?: { id, extras }, referer? }
 *
 * DEVOLVE (nunca lança):
 *   { estado:'ok', segmentos, texto, srt, vtt, duracaoSeg, proveniencia, custoUSD, semTempos? }
 *   { estado:'sem-fala', ... }                   o áudio não tem fala (nada a legendar)
 *   { estado:'pendente', trabalho }              o provedor ainda trabalha: `consultarTranscricao({ trabalho })` retoma
 *   { estado:'falhou', codigo, detalhe }
 * O resultado NÃO é publicado: é matéria-prima da sugestão `legenda-<idioma>` (sugestoes.js). */
import { configDeTranscricao } from '../config.js';
import { tabelaDePrecos, custoDeTranscricao } from '../precos.js';
import { HORAS_PADRAO } from '../orcamento.js';
import { paraSrt, paraVtt, textoDasCues } from '../srt.js';
import { proveniencia } from '../proveniencia.js';
import { ErroIA } from '../erros.js';
import { limparSegmentos, contarPalavras, MINIMO_DE_PALAVRAS } from './limpeza.js';
import * as whisper from './workers-ai-whisper.js';
import * as assemblyai from './assemblyai.js';
import * as openai from './openai.js';
import * as provedorDeVideo from './provedor-de-video.js';

export const ADAPTADORES_DE_TRANSCRICAO = Object.freeze({ 'workers-ai-whisper': whisper, assemblyai, openai, 'provedor-de-video': provedorDeVideo });

const falha = (codigo, extra) => Object.assign({ estado: 'falhou', codigo, detalhe: '', custoUSD: 0 }, extra || {});
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const bytesDe = (a) => (a ? (a.byteLength != null ? a.byteLength : a.length || 0) : 0);

function fechar({ bruto, cfg, config, origem, agora }) {
  const segmentos = limparSegmentos(bruto.segmentos);
  const duracaoSeg = bruto.duracaoSeg || origem.duracaoSeg || (segmentos.length ? segmentos[segmentos.length - 1].fim : 0) || 0;
  const minutos = cfg.provedor === 'provedor-de-video' ? 0 : duracaoSeg / 60;
  const custoUSD = custoDeTranscricao(tabelaDePrecos(config), { provedor: cfg.provedor, modelo: cfg.modelo, minutos });
  const base = { duracaoSeg, minutos, custoUSD, proveniencia: proveniencia({ modelo: cfg.modelo || cfg.provedor, provedor: cfg.provedor, tarefa: 'transcricao', agora }) };
  if (bruto.semTempos && bruto.texto) return Object.assign({ estado: 'ok', segmentos: [], texto: bruto.texto, srt: null, vtt: null, semTempos: true }, base);
  if (contarPalavras(segmentos) < MINIMO_DE_PALAVRAS) return Object.assign({ estado: 'sem-fala', segmentos: [], texto: '', srt: null, vtt: null }, base);
  return Object.assign({ estado: 'ok', segmentos, texto: textoDasCues(segmentos), srt: paraSrt(segmentos), vtt: paraVtt(segmentos) }, base);
}

async function contabilizar(orcamento, resultado, cfg) {
  if (orcamento && resultado.custoUSD > 0) {
    await orcamento.registrar({ usd: resultado.custoUSD, provedor: cfg.provedor, modelo: cfg.modelo, tarefa: 'transcricao', minutos: resultado.minutos });
  }
}

function preparar({ config, env }) {
  const cfg = configDeTranscricao(config, env);
  if (cfg.provedor === 'nenhum') return { erro: falha('ia-desligada') };
  if (!cfg.pronto) return { erro: falha('ia-sem-chave') };
  return { cfg, adaptador: ADAPTADORES_DE_TRANSCRICAO[cfg.provedor] };
}

export async function transcrever({ origem, idioma, config, env, fetch, orcamento, aguardar = true, esperar = dormir, tentativas = 60, intervaloMs = 5000, glossario, agora = Date.now }) {
  const p = preparar({ config, env });
  if (p.erro) return p.erro;
  const { cfg, adaptador } = p;
  const lingua = idioma || cfg.idioma;
  if (!origem || typeof origem !== 'object') return falha('ia-entrada-invalida');
  const comum = { idioma: lingua, modelo: cfg.modelo, chave: cfg.chave, binding: cfg.binding, contaId: cfg.contaId, fetch, glossario };

  try {
    /* Estimativa ANTES, sempre: sem duração conhecida, estima com 1 hora (HORAS_PADRAO, a mesma da estimativa do lote). */
    if (orcamento) {
      const minutos = origem.duracaoSeg ? origem.duracaoSeg / 60 : HORAS_PADRAO * 60;
      const previsto = custoDeTranscricao(tabelaDePrecos(config), { provedor: cfg.provedor, modelo: cfg.modelo, minutos });
      if (!(await orcamento.podeGastar(previsto))) return falha('ia-orcamento-estourado', { detalhe: 'o orçamento do mês não cobre esta transcrição' });
    }

    let bruto;
    if (cfg.provedor === 'provedor-de-video') {
      bruto = await adaptador.iniciar(Object.assign({}, comum, { provedor: origem.provedor, video: origem.video, referer: origem.referer }));
    } else if (adaptador.ACEITA_PEDACOS) {
      const pedacos = Array.isArray(origem.pedacos) && origem.pedacos.length ? origem.pedacos : [{ audio: origem.audio, deslocamentoSeg: 0 }];
      const juntos = { segmentos: [], texto: '', duracaoSeg: 0, semTempos: false };
      for (const pe of pedacos) {
        if (!pe.audio || !bytesDe(pe.audio)) return falha('ia-entrada-invalida', { detalhe: 'áudio vazio' });
        if (bytesDe(pe.audio) > adaptador.LIMITE_BYTES) return falha('ia-audio-grande', { detalhe: 'limite de ' + Math.round(adaptador.LIMITE_BYTES / 1048576) + ' MB por pedaço' });
        const r = await adaptador.iniciar(Object.assign({}, comum, { audio: pe.audio, mime: origem.mime }));
        const d = Number(pe.deslocamentoSeg) || 0;
        for (const s of r.segmentos) juntos.segmentos.push(Object.assign({}, s, { inicio: s.inicio + d, fim: s.fim + d }));
        juntos.texto += (juntos.texto ? ' ' : '') + (r.texto || '');
        juntos.semTempos = juntos.semTempos || Boolean(r.semTempos);
        juntos.duracaoSeg = Math.max(juntos.duracaoSeg, d + (r.duracaoSeg || 0));
      }
      bruto = juntos;
    } else {
      if (!origem.audio && !origem.url) return falha('ia-entrada-invalida', { detalhe: 'falta o áudio ou o endereço dele' });
      bruto = await adaptador.iniciar(Object.assign({}, comum, { audio: origem.audio, url: origem.url }));
    }

    let espera = 0;
    while (bruto.pendente) {
      if (!aguardar) return { estado: 'pendente', trabalho: bruto.trabalho, custoUSD: 0 };
      if (++espera > tentativas) return { estado: 'pendente', trabalho: bruto.trabalho, custoUSD: 0, detalhe: 'ainda processando' };
      await esperar(intervaloMs);
      bruto = await adaptador.consultar(Object.assign({}, comum, { trabalho: bruto.trabalho, provedor: origem.provedor, video: origem.video, referer: origem.referer }));
    }
    const r = fechar({ bruto, cfg, config, origem, agora });
    await contabilizar(orcamento, r, cfg);
    return r;
  } catch (e) {
    if (e instanceof ErroIA) return falha(e.codigo, { detalhe: e.detalhe, status: e.status });
    return falha('ia-provedor-inacessivel', { detalhe: (e && e.message) || '' });
  }
}

/* Retoma um trabalho `pendente` (AssemblyAI, legenda do provedor), por exemplo numa execução posterior. */
export async function consultarTranscricao({ trabalho, origem = {}, idioma, config, env, fetch, orcamento, agora = Date.now }) {
  const p = preparar({ config, env });
  if (p.erro) return p.erro;
  const { cfg, adaptador } = p;
  if (!trabalho || trabalho.provedor !== cfg.provedor || typeof adaptador.consultar !== 'function') return falha('ia-entrada-invalida', { detalhe: 'trabalho de outro provedor' });
  try {
    const bruto = await adaptador.consultar({ trabalho, chave: cfg.chave, fetch, idioma: idioma || cfg.idioma, provedor: origem.provedor, video: origem.video, referer: origem.referer });
    if (bruto.pendente) return { estado: 'pendente', trabalho, custoUSD: 0 };
    const r = fechar({ bruto, cfg, config, origem, agora });
    await contabilizar(orcamento, r, cfg);
    return r;
  } catch (e) {
    if (e instanceof ErroIA) return falha(e.codigo, { detalhe: e.detalhe, status: e.status });
    return falha('ia-provedor-inacessivel', { detalhe: (e && e.message) || '' });
  }
}
