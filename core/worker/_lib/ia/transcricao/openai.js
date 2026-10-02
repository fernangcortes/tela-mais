/* ia/transcricao/openai.js — /v1/audio/transcriptions da OpenAI, por fetch puro (multipart).
 *
 * FORMATO (conhecimento da API; a página oficial não estava acessível em 2026-10-02: NÃO RECONFERIDO hoje): campos `file`,
 * `model`, `language`, `response_format`, `prompt`. Só o `whisper-1` devolve segmentos com tempo (`verbose_json`: segments[].start
 * /end/text/no_speech_prob e `duration`); os modelos `gpt-4o-*-transcribe` devolvem só `{ text }`, e então não há legenda com
 * tempo (o resultado marca `semTempos`). Limite de 25 MB por arquivo: fatie. */
import { pedir, exigirJson } from '../texto/http.js';
import { idiomaCurto } from './limpeza.js';

export const ID = 'openai';
export const ACEITA_PEDACOS = true;
export const LIMITE_BYTES = 24 * 1024 * 1024;
const URL_TRANSCRICAO = 'https://api.openai.com/v1/audio/transcriptions';

export async function iniciar({ audio, mime, idioma, modelo, chave, fetch, glossario }) {
  const comTempo = /^whisper/i.test(modelo || '');
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime || 'audio/mpeg' }), 'audio.mp3');
  form.append('model', modelo);
  form.append('language', idiomaCurto(idioma));
  form.append('response_format', comTempo ? 'verbose_json' : 'json');
  if (comTempo) form.append('timestamp_granularities[]', 'segment');
  if (glossario && glossario.length) form.append('prompt', glossario.join(', ').slice(0, 400));
  const r = await pedir(fetch, URL_TRANSCRICAO, { method: 'POST', headers: { authorization: 'Bearer ' + chave }, body: form }, { tempoMs: 180000 });
  const c = exigirJson(r);
  const segmentos = (Array.isArray(c.segments) ? c.segments : []).map((s) => ({
    inicio: Number(s.start), fim: Number(s.end), texto: s.text, semFalaProb: s.no_speech_prob, logprob: s.avg_logprob
  }));
  return { segmentos, texto: typeof c.text === 'string' ? c.text : '', duracaoSeg: Number(c.duration) || null, semTempos: !segmentos.length && Boolean(c.text) };
}
