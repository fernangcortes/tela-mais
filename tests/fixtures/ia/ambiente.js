/* Fixtures da IA (M9): respostas das APIs de IA como elas vêm (Anthropic, OpenAI, Gemini, Workers AI, Whisper, AssemblyAI),
 * um fetch de mentira que as entrega em ordem e registra o que foi pedido, um KV em memória que registra as escritas e a
 * transcrição de exemplo. Nada aqui faz rede. Os nomes de pessoa e lugar são inventados e neutros. */
'use strict';

/* ------------------------------------------------------------ a transcrição de exemplo */

const CUES = [
  [0, 6, 'Bom dia, pessoal. Hoje a gente vai falar sobre como montar uma horta em casa.'],
  [6, 14, 'Quem me ensinou foi a Joana Batista, que cuida da Horta Comunitária Vila Nova há dez anos.'],
  [14, 26, 'Primeiro, escolha um lugar com sol de manhã. A maioria das hortaliças precisa de pelo menos seis horas de luz.'],
  [26, 40, 'Depois, prepare a terra: misture adubo orgânico e deixe descansar uma semana antes de plantar.'],
  [40, 58, 'Alface, cebolinha e salsa são boas para começar, porque crescem rápido e quase não dão trabalho.'],
  [58, 75, 'Regue de manhã cedo, sem encharcar. O truque é enfiar o dedo na terra: se estiver úmida, espere.'],
  [75, 92, 'Por fim, colha as folhas de fora e deixe o miolo crescer. Assim a planta rende por muito mais tempo.'],
  [92, 110, 'Se tiver pouco espaço, use vasos, garrafas e caixotes. O importante é começar e cuidar todo dia.']
];

const carimbo = (s) => {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const seg = String(Math.floor(s % 60)).padStart(2, '0');
  return h + ':' + m + ':' + seg;
};

const SRT = CUES.map((c, i) => (i + 1) + '\n' + carimbo(c[0]) + ',000 --> ' + carimbo(c[1]) + ',000\n' + c[2] + '\n').join('\n');
const VTT = 'WEBVTT\n\n' + CUES.map((c) => carimbo(c[0]) + '.000 --> ' + carimbo(c[1]) + '.000\n' + c[2] + '\n').join('\n');
const TEXTO = CUES.map((c) => c[2]).join(' ');
const BLOCOS = CUES.map((c) => ({ inicio: c[0], texto: c[2] }));
/* mais capítulos: um vídeo de 10 minutos com blocos de 30 s */
const BLOCOS_LONGOS = Array.from({ length: 20 }, (_, i) => ({ inicio: i * 30, texto: 'Trecho ' + (i + 1) + ' sobre a horta, a terra, a rega e a colheita das folhas, explicado com calma para quem está começando agora.' }));

const ENTRADA = { titulo: 'Horta em casa', serie: 'Mão na terra', duracaoSeg: 110, transcricao: TEXTO, blocos: BLOCOS };
const ENTRADA_LONGA = { titulo: 'Horta em casa', serie: 'Mão na terra', duracaoSeg: 600, transcricao: BLOCOS_LONGOS.map((b) => b.texto).join(' '), blocos: BLOCOS_LONGOS };

const SINOPSE_BOA = 'Ensina a montar uma horta em casa: escolher um lugar com sol, preparar a terra com adubo orgânico, plantar alface, cebolinha e salsa e regar com cuidado. Mostra também como colher sem prejudicar a planta e como usar vasos quando falta espaço.';
const SINOPSE_COM_NOME_INVENTADO = 'A horticultora Carlos Andrade ensina a montar uma horta em casa, escolhendo um lugar com sol e preparando a terra com adubo orgânico antes de plantar.';

/* ------------------------------------------------------------ respostas das APIs de texto */

const anthropic = (texto, uso = { input_tokens: 1300, output_tokens: 110 }, extra = {}) => ({
  id: 'msg_01Fixture', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', stop_sequence: null, usage: uso, ...extra
});
const openai = (texto, uso = { prompt_tokens: 1300, completion_tokens: 110 }, extra = {}) => ({
  id: 'chatcmpl-fixture', object: 'chat.completion', model: 'gpt-5-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: texto, refusal: null }, finish_reason: 'stop' }],
  usage: Object.assign({ total_tokens: uso.prompt_tokens + uso.completion_tokens }, uso), ...extra
});
const gemini = (texto, uso = { promptTokenCount: 1300, candidatesTokenCount: 110 }) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: texto }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: Object.assign({ totalTokenCount: uso.promptTokenCount + uso.candidatesTokenCount }, uso), modelVersion: 'gemini-3.5-flash-lite'
});
const workersAi = (texto, uso = { prompt_tokens: 1300, completion_tokens: 110 }) => ({
  id: 'chatcmpl-wai', object: 'chat.completion', model: '@cf/google/gemma-4-26b-a4b-it',
  choices: [{ index: 0, message: { role: 'assistant', content: texto }, finish_reason: 'stop' }], usage: uso
});
const workersAiRest = (texto, uso) => ({ result: workersAi(texto, uso), success: true, errors: [], messages: [] });

/* ------------------------------------------------------------ respostas de transcrição */

const whisper = (segmentos, duracao = 110) => ({
  transcription_info: { language: 'pt', language_probability: 0.99, duration: duracao, duration_after_vad: duracao },
  text: segmentos.map((s) => s.text).join(' '), word_count: segmentos.join(' ').split(' ').length,
  segments: segmentos.map((s) => Object.assign({ avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }, s)),
  vtt: 'WEBVTT\n\n'
});
const SEGMENTOS_WHISPER = CUES.slice(0, 4).map((c) => ({ start: c[0], end: c[1], text: c[2] }));

/* ------------------------------------------------------------ fetch e KV de mentira */

/* `roteiro`: lista de respostas na ordem das chamadas — { status?, json?, texto?, lancar? } — ou uma função (url, init) -> resposta. */
function fetchFalso(roteiro) {
  const chamadas = [];
  let i = 0;
  const f = async (url, init = {}) => {
    const chamada = { url: String(url), metodo: init.method || 'GET', cabecalhos: init.headers || {}, corpo: init.body, corpoTexto: typeof init.body === 'string' ? init.body : null };
    chamada.json = chamada.corpoTexto ? (() => { try { return JSON.parse(chamada.corpoTexto); } catch (e) { return null; } })() : null;
    chamadas.push(chamada);
    const r = typeof roteiro === 'function' ? roteiro(chamada.url, init, chamadas.length - 1) : roteiro[Math.min(i++, roteiro.length - 1)];
    if (!r) throw new Error('fetch sem resposta para ' + url);
    if (r.lancar) throw new Error(r.lancar);
    const corpo = r.texto !== undefined ? r.texto : JSON.stringify(r.json === undefined ? {} : r.json);
    return new Response(corpo, { status: r.status || 200, headers: { 'content-type': r.texto !== undefined ? 'text/plain' : 'application/json' } });
  };
  f.chamadas = chamadas;
  return f;
}

function kvEmMemoria(inicial) {
  const dados = Object.assign({}, inicial);
  const escritas = [];
  const ler = (chave, tipo) => (dados[chave] == null ? null : (tipo === 'json' || (tipo && tipo.type === 'json') ? JSON.parse(dados[chave]) : dados[chave]));
  return {
    dados, escritas,
    get: async (chave, tipo) => ler(chave, tipo),
    getWithMetadata: async (chave, tipo) => ({ value: ler(chave, tipo), metadata: null }),
    put: async (chave, valor) => { dados[chave] = String(valor); escritas.push(chave); },
    delete: async (chave) => { delete dados[chave]; escritas.push('-' + chave); },
    list: async ({ prefix = '' } = {}) => ({ keys: Object.keys(dados).filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true })
  };
}

/* ------------------------------------------------------------ config */

function configIA(extra) {
  const base = {
    idiomas: { padrao: 'pt-BR' },
    ia: {
      textos: { provedor: 'anthropic', chave: { $env: 'ANTHROPIC_API_KEY' } },
      transcricao: { provedor: 'nenhum', idioma: 'pt' },
      orcamentoMensalUSD: 5
    }
  };
  if (!extra) return base;
  return {
    ...base, ...extra,
    ia: { ...base.ia, ...(extra.ia || {}), textos: { ...base.ia.textos, ...((extra.ia && extra.ia.textos) || {}) }, transcricao: { ...base.ia.transcricao, ...((extra.ia && extra.ia.transcricao) || {}) } }
  };
}

const CHAVE = 'sk-ant-teste-0123456789abcdef0123456789';
const ENV_TEXTO = { ANTHROPIC_API_KEY: CHAVE, OPENAI_API_KEY: 'sk-openai-teste-0123456789abcdef', GEMINI_API_KEY: 'AIzaTeste0123456789012345678901234567', ASSEMBLYAI_API_KEY: 'aai-chave-de-teste-123' };

module.exports = {
  CUES, SRT, VTT, TEXTO, BLOCOS, BLOCOS_LONGOS, ENTRADA, ENTRADA_LONGA, SINOPSE_BOA, SINOPSE_COM_NOME_INVENTADO,
  anthropic, openai, gemini, workersAi, workersAiRest, whisper, SEGMENTOS_WHISPER,
  fetchFalso, kvEmMemoria, configIA, CHAVE, ENV_TEXTO
};
