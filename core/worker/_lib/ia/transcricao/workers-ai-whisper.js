/* ia/transcricao/workers-ai-whisper.js — Whisper large-v3-turbo no Workers AI (a conta Cloudflare do próprio cliente).
 *
 * CONFERIDO no catálogo de modelos da Cloudflare (cloudflare-docs, 2026-10-02) para `@cf/openai/whisper-large-v3-turbo`:
 *   entrada  { audio (base64), language, task, vad_filter, initial_prompt, condition_on_previous_text, no_speech_threshold... }
 *   saída    { text, word_count, segments:[{ start, end, text, avg_logprob, no_speech_prob... }], vtt, transcription_info:{ duration } }
 * Preço: US$ 0,0005/min (pesquisa de 2026-10-01; reconferir). O áudio vai em base64 NO CORPO: fatie em pedaços de poucos MB
 * (5 min em mono, 16 kHz, 48 kbps dão ~2 MB). Quem fatia é o chamador (scripts/ia-transcrever.mjs); `origem.pedacos` os traz. */
import { ErroIA } from '../erros.js';
import { pedir, exigirJson, detalheDeErro } from '../texto/http.js';
import { paraBase64, idiomaCurto } from './limpeza.js';

export const ID = 'workers-ai-whisper';
export const ACEITA_PEDACOS = true;
export const LIMITE_BYTES = 6 * 1024 * 1024;
const BASE = 'https://api.cloudflare.com/client/v4/accounts/';

function lerSaida(r) {
  const o = r || {};
  const segmentos = (Array.isArray(o.segments) ? o.segments : []).map((s) => ({
    inicio: Number(s.start), fim: Number(s.end), texto: s.text, semFalaProb: s.no_speech_prob, logprob: s.avg_logprob
  }));
  return { segmentos, texto: typeof o.text === 'string' ? o.text : '', duracaoSeg: o.transcription_info && Number(o.transcription_info.duration) || null };
}

export async function iniciar({ audio, idioma, modelo, chave, binding, contaId, fetch, glossario }) {
  const entrada = { audio: paraBase64(audio), task: 'transcribe', language: idiomaCurto(idioma), vad_filter: true, condition_on_previous_text: false };
  if (glossario && glossario.length) entrada.initial_prompt = glossario.join(', ').slice(0, 400);
  if (binding) {
    try { return lerSaida(await binding.run(modelo, entrada)); } catch (e) {
      throw new ErroIA('ia-provedor-inacessivel', { detalhe: (e && e.message) || 'o Workers AI falhou', retentavel: true });
    }
  }
  const r = await pedir(fetch, BASE + encodeURIComponent(contaId) + '/ai/run/' + modelo, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chave }, body: JSON.stringify(entrada)
  }, { tempoMs: 180000 });
  const c = exigirJson(r);
  if (c.success === false) throw new ErroIA('ia-provedor-recusou', { status: r.status, detalhe: detalheDeErro(c) });
  return lerSaida(c.result !== undefined ? c.result : c);
}
