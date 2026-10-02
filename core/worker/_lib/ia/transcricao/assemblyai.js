/* ia/transcricao/assemblyai.js — AssemblyAI (a mesma API que o scripts/legendas-assembly.mjs já usava, testada em 02/09).
 *
 * Fluxo: POST /v2/upload (bytes) -> POST /v2/transcript { audio_url, language_code, speech_models:[modelo], punctuate,
 * format_text } -> consulta GET /v2/transcript/{id} até `completed` -> GET /v2/transcript/{id}/srt. O campo é `speech_models`
 * (PLURAL, array), conferido pelo script antigo. Transcrição concluída e VAZIA = sem fala (o /srt recusa esse caso com 400).
 * É assíncrono: `iniciar` devolve { pendente, trabalho } e `consultar` retoma, no Worker ou num script. */
import { ErroIA } from '../erros.js';
import { pedir, exigirJson, detalheDeErro } from '../texto/http.js';
import { analisarLegenda } from '../srt.js';
import { idiomaCurto } from './limpeza.js';

export const ID = 'assemblyai';
export const ACEITA_PEDACOS = false;
const API = 'https://api.assemblyai.com/v2';

export async function iniciar({ audio, url, idioma, modelo, chave, fetch }) {
  let audioUrl = url;
  if (!audioUrl) {
    const up = exigirJson(await pedir(fetch, API + '/upload', {
      method: 'POST', headers: { authorization: chave, 'content-type': 'application/octet-stream' }, body: audio
    }, { tempoMs: 300000 }));
    audioUrl = up.upload_url;
    if (!audioUrl) throw new ErroIA('ia-provedor-recusou', { detalhe: 'o envio não devolveu upload_url' });
  }
  const corpo = { audio_url: audioUrl, language_code: idiomaCurto(idioma), punctuate: true, format_text: true };
  if (modelo) corpo.speech_models = [modelo];
  const t = exigirJson(await pedir(fetch, API + '/transcript', {
    method: 'POST', headers: { authorization: chave, 'content-type': 'application/json' }, body: JSON.stringify(corpo)
  }));
  if (!t.id) throw new ErroIA('ia-provedor-recusou', { detalhe: 'o pedido não devolveu id' });
  return { pendente: true, trabalho: { provedor: ID, id: t.id } };
}

export async function consultar({ trabalho, chave, fetch }) {
  const t = exigirJson(await pedir(fetch, API + '/transcript/' + encodeURIComponent(trabalho.id), { method: 'GET', headers: { authorization: chave } }));
  if (t.status === 'error') throw new ErroIA('ia-provedor-recusou', { detalhe: detalheDeErro(t) || t.error || 'a transcrição falhou' });
  if (t.status !== 'completed') return { pendente: true, trabalho };
  const duracaoSeg = Number(t.audio_duration) || null;
  if (!t.text || !String(t.text).trim()) return { segmentos: [], texto: '', duracaoSeg };
  const r = await pedir(fetch, API + '/transcript/' + encodeURIComponent(trabalho.id) + '/srt', { method: 'GET', headers: { authorization: chave } });
  const segmentos = analisarLegenda(r.texto);
  return { segmentos, texto: String(t.text), duracaoSeg };
}
