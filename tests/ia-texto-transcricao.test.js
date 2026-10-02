/* Transcrição (M9): os quatro adaptadores com respostas gravadas (sem rede), a limpeza de alucinação do Whisper,
 * os pedaços de áudio com deslocamento, o trabalho assíncrono e o orçamento. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ia/ambiente.js');

const ia = () => import('../core/worker/_lib/ia/index.js');
const srt = () => import('../core/worker/_lib/ia/srt.js');
const AGORA = () => Date.parse('2026-10-02T12:00:00Z');
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const configFala = (provedor, extra) => F.configIA({ ia: { transcricao: Object.assign({ provedor }, extra || {}) } });
const sem = () => 0;

test('Whisper no Workers AI pelo binding: base64, idioma curto, VAD ligado; os segmentos viram SRT e o custo sai por minuto', async () => {
  const { transcrever } = await ia();
  const pedidos = [];
  const binding = { run: async (modelo, entrada) => { pedidos.push({ modelo, entrada }); return F.whisper(F.SEGMENTOS_WHISPER, 60); } };
  const r = await transcrever({ origem: { audio: AUDIO, duracaoSeg: 60 }, idioma: 'pt-BR', config: configFala('workers-ai-whisper'), env: { AI: binding }, glossario: ['Vila Nova'], agora: AGORA });
  assert.equal(pedidos[0].modelo, '@cf/openai/whisper-large-v3-turbo');
  assert.equal(pedidos[0].entrada.audio, Buffer.from(AUDIO).toString('base64'));
  assert.equal(pedidos[0].entrada.language, 'pt');
  assert.equal(pedidos[0].entrada.vad_filter, true);
  assert.equal(pedidos[0].entrada.initial_prompt, 'Vila Nova');
  assert.equal(r.estado, 'ok');
  assert.equal(r.segmentos.length, 4);
  assert.match(r.srt, /^1\n00:00:00,000 --> 00:00:06,000\nBom dia, pessoal\./);
  assert.match(r.vtt, /^WEBVTT/);
  assert.equal(r.duracaoSeg, 60);
  /* 1 min x US$ 0,0005 */
  assert.equal(r.custoUSD, 0.0005);
  assert.deepEqual([r.proveniencia.origem, r.proveniencia.revisado, r.proveniencia.tarefa, r.proveniencia.provedor], ['ia', false, 'transcricao', 'workers-ai-whisper']);
  assert.equal(r.proveniencia.modelo, '@cf/openai/whisper-large-v3-turbo');
});

test('Whisper pelo REST (scripts): token e conta, e a chave nunca vai no corpo nem na URL', async () => {
  const { transcrever } = await ia();
  const fetch = F.fetchFalso([{ json: { result: F.whisper(F.SEGMENTOS_WHISPER), success: true } }]);
  const config = configFala('workers-ai-whisper', { chave: { $env: 'CF_TOKEN' }, contaId: { $env: 'CF_CONTA' } });
  const r = await transcrever({ origem: { audio: AUDIO }, config, env: { CF_TOKEN: 'tok-secreto-123456789', CF_CONTA: 'conta9' }, fetch, agora: AGORA });
  assert.equal(r.estado, 'ok');
  const c = fetch.chamadas[0];
  assert.equal(c.url, 'https://api.cloudflare.com/client/v4/accounts/conta9/ai/run/@cf/openai/whisper-large-v3-turbo');
  assert.equal(c.cabecalhos.authorization, 'Bearer tok-secreto-123456789');
  assert.ok(!c.corpoTexto.includes('tok-secreto'));
  /* sem binding e sem token+conta: sem acesso */
  const sem = await transcrever({ origem: { audio: AUDIO }, config: configFala('workers-ai-whisper'), env: {}, fetch });
  assert.equal(sem.codigo, 'ia-sem-chave');
});

test('pedaços de áudio: cada um é transcrito e os tempos ganham o deslocamento do pedaço', async () => {
  const { transcrever } = await ia();
  const binding = { run: async () => F.whisper([{ start: 0, end: 5, text: 'Primeira frase do pedaço, com palavras suficientes para contar.' }, { start: 5, end: 10, text: 'Segunda frase do pedaço, também com várias palavras.' }], 10) };
  const r = await transcrever({ origem: { pedacos: [{ audio: AUDIO, deslocamentoSeg: 0 }, { audio: AUDIO, deslocamentoSeg: 300 }, { audio: AUDIO, deslocamentoSeg: 600 }] }, config: configFala('workers-ai-whisper'), env: { AI: binding }, agora: AGORA });
  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.segmentos.map((s) => s.inicio), [0, 5, 300, 305, 600, 605]);
  assert.equal(r.duracaoSeg, 610);
  assert.match(r.srt, /00:10:05,000 --> 00:10:10,000/);
});

test('a limpeza tira o que o Whisper inventa em silêncio: assinaturas, laço de repetição e segmento sem fala; e acusa "sem fala"', async () => {
  const { transcrever } = await ia();
  const lixo = [
    { start: 0, end: 4, text: 'Legendas pela comunidade Amara.org' },
    { start: 4, end: 8, text: 'Obrigado por assistir!' },
    { start: 8, end: 10, text: 'Tchau', no_speech_prob: 0.95, avg_logprob: -1.8 },
    ...[10, 12, 14, 16].map((t) => ({ start: t, end: t + 2, text: 'e aí' }))
  ];
  const binding = { run: async () => F.whisper(lixo, 20) };
  const r = await transcrever({ origem: { audio: AUDIO }, config: configFala('workers-ai-whisper'), env: { AI: binding }, agora: AGORA });
  assert.equal(r.estado, 'sem-fala');
  assert.equal(r.srt, null);
  assert.deepEqual(r.segmentos, []);
  assert.equal(r.custoUSD, Math.round((20 / 60) * 0.0005 * 1e6) / 1e6, 'o áudio foi processado e custou, mesmo sem fala');
  /* fala de verdade no meio do lixo é mantida */
  const misto = [{ start: 0, end: 4, text: 'Obrigado por assistir' }, ...F.SEGMENTOS_WHISPER.map((s) => ({ start: s.start + 4, end: s.end + 4, text: s.text }))];
  const m = await transcrever({ origem: { audio: AUDIO }, config: configFala('workers-ai-whisper'), env: { AI: { run: async () => F.whisper(misto, 70) } }, agora: AGORA });
  assert.equal(m.estado, 'ok');
  assert.equal(m.segmentos.length, 4);
});

test('áudio vazio ou maior que o limite do provedor: erro claro, sem chamar', async () => {
  const { transcrever } = await ia();
  const binding = { run: async () => { throw new Error('não devia chamar'); } };
  const grande = { byteLength: 7 * 1024 * 1024 };
  const a = await transcrever({ origem: { audio: new Uint8Array(0) }, config: configFala('workers-ai-whisper'), env: { AI: binding } });
  assert.equal(a.codigo, 'ia-entrada-invalida');
  const b = await transcrever({ origem: { pedacos: [{ audio: grande, deslocamentoSeg: 0 }] }, config: configFala('workers-ai-whisper'), env: { AI: binding } });
  assert.equal(b.codigo, 'ia-audio-grande');
  assert.equal((await transcrever({ origem: null, config: configFala('workers-ai-whisper'), env: { AI: binding } })).codigo, 'ia-entrada-invalida');
  assert.equal((await transcrever({ origem: { audio: AUDIO }, config: F.configIA(), env: {} })).codigo, 'ia-desligada');
});

test('OpenAI whisper-1: multipart com verbose_json e segmentos; gpt-4o-transcribe devolve só texto (sem legenda com tempo)', async () => {
  const { transcrever } = await ia();
  const fetch = F.fetchFalso([{ json: { text: F.TEXTO, duration: 110, segments: F.CUES.slice(0, 3).map((c) => ({ start: c[0], end: c[1], text: c[2], avg_logprob: -0.2, no_speech_prob: 0.01 })) } }]);
  const env = { OPENAI_API_KEY: 'sk-openai-0123456789abcdef' };
  const r = await transcrever({ origem: { audio: AUDIO, mime: 'audio/mpeg', duracaoSeg: 110 }, config: configFala('openai'), env, fetch, agora: AGORA });
  assert.equal(r.estado, 'ok');
  const c = fetch.chamadas[0];
  assert.equal(c.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(c.cabecalhos.authorization, 'Bearer ' + env.OPENAI_API_KEY);
  assert.ok(c.corpo instanceof FormData);
  assert.equal(c.corpo.get('model'), 'whisper-1');
  assert.equal(c.corpo.get('response_format'), 'verbose_json');
  assert.equal(c.corpo.get('language'), 'pt');
  assert.equal(c.corpo.get('timestamp_granularities[]'), 'segment');
  assert.equal(r.segmentos.length, 3);
  /* 110 s = 1,8333 min x US$ 0,006 */
  assert.equal(r.custoUSD, 0.011);

  const f2 = F.fetchFalso([{ json: { text: F.TEXTO } }]);
  const t = await transcrever({ origem: { audio: AUDIO }, config: configFala('openai', { modelo: 'gpt-4o-mini-transcribe' }), env, fetch: f2, agora: AGORA });
  assert.equal(t.estado, 'ok');
  assert.equal(t.semTempos, true);
  assert.equal(t.srt, null);
  assert.equal(t.texto, F.TEXTO);
  assert.equal(f2.chamadas[0].corpo.get('response_format'), 'json');
  assert.equal(f2.chamadas[0].corpo.get('timestamp_granularities[]'), null);
});

test('AssemblyAI: upload, pedido com speech_models e language_code, consulta até completar, SRT lido; assíncrono sem `aguardar`', async () => {
  const { transcrever, consultarTranscricao } = await ia();
  const env = { ASSEMBLYAI_API_KEY: 'aai-chave-de-teste-123' };
  const roteiro = (url) => {
    if (url.endsWith('/upload')) return { json: { upload_url: 'https://cdn.assemblyai.com/upload/abc' } };
    if (url.endsWith('/transcript')) return { json: { id: 'tr-1', status: 'queued' } };
    if (url.endsWith('/transcript/tr-1')) return { json: { id: 'tr-1', status: roteiro.estado, text: F.TEXTO, audio_duration: 110 } };
    if (url.endsWith('/transcript/tr-1/srt')) return { texto: F.SRT };
    return null;
  };
  roteiro.estado = 'processing';
  const fetch = F.fetchFalso(roteiro);
  /* sem aguardar: devolve o trabalho */
  const p = await transcrever({ origem: { audio: AUDIO }, config: configFala('assemblyai'), env, fetch, aguardar: false, agora: AGORA });
  assert.deepEqual([p.estado, p.trabalho.provedor, p.trabalho.id], ['pendente', 'assemblyai', 'tr-1']);
  assert.equal(fetch.chamadas[0].cabecalhos.authorization, env.ASSEMBLYAI_API_KEY);
  const pedido = fetch.chamadas[1].json;
  assert.deepEqual([pedido.audio_url, pedido.language_code, pedido.speech_models, pedido.punctuate], ['https://cdn.assemblyai.com/upload/abc', 'pt', ['universal-3-5-pro']]  .concat([true]));
  /* ainda processando */
  assert.equal((await consultarTranscricao({ trabalho: p.trabalho, config: configFala('assemblyai'), env, fetch })).estado, 'pendente');
  /* concluído */
  roteiro.estado = 'completed';
  const feito = await consultarTranscricao({ trabalho: p.trabalho, config: configFala('assemblyai'), env, fetch, agora: AGORA });
  assert.equal(feito.estado, 'ok');
  assert.equal(feito.segmentos.length, 8);
  assert.equal(feito.duracaoSeg, 110);
  /* US$ 0,21/h: 110 s */
  assert.equal(feito.custoUSD, Math.round((110 / 60) * 0.0035 * 1e6) / 1e6);

  /* com aguardar, espera (injetado) e termina sozinho */
  roteiro.estado = 'processing';
  let voltas = 0;
  const f2 = F.fetchFalso((url, init, n) => { const r = roteiro(url, init); if (url.endsWith('/transcript/tr-1') && ++voltas >= 3) roteiro.estado = 'completed'; return r; });
  const esperas = [];
  const w = await transcrever({ origem: { url: 'https://exemplo.test/a.mp3' }, config: configFala('assemblyai'), env, fetch: f2, esperar: async (ms) => { esperas.push(ms); }, intervaloMs: 7, agora: AGORA });
  assert.equal(w.estado, 'ok');
  assert.ok(esperas.length >= 2 && esperas.every((ms) => ms === 7));
  assert.ok(!f2.chamadas.some((c) => c.url.endsWith('/upload')), 'com URL não há upload');
});

test('AssemblyAI: transcrição concluída e VAZIA é "sem fala" (não tenta baixar o SRT); status error vira falha', async () => {
  const { transcrever } = await ia();
  const env = { ASSEMBLYAI_API_KEY: 'aai-chave-de-teste-123' };
  const vazio = F.fetchFalso((url) => {
    if (url.endsWith('/transcript')) return { json: { id: 'tr-2' } };
    if (url.endsWith('/transcript/tr-2')) return { json: { id: 'tr-2', status: 'completed', text: '', audio_duration: 40 } };
    return null;
  });
  const r = await transcrever({ origem: { url: 'https://exemplo.test/a.mp3' }, config: configFala('assemblyai'), env, fetch: vazio, esperar: async () => {}, agora: AGORA });
  assert.equal(r.estado, 'sem-fala');
  assert.ok(!vazio.chamadas.some((c) => c.url.endsWith('/srt')));
  const erro = F.fetchFalso((url) => (url.endsWith('/transcript') ? { json: { id: 'tr-3' } } : { json: { id: 'tr-3', status: 'error', error: 'Audio file could not be decoded' } }));
  const e = await transcrever({ origem: { url: 'https://exemplo.test/a.mp3' }, config: configFala('assemblyai'), env, fetch: erro, esperar: async () => {}, agora: AGORA });
  assert.deepEqual([e.estado, e.codigo], ['falhou', 'ia-provedor-recusou']);
  assert.match(e.detalhe, /could not be decoded/);
});

test('legenda nativa do provedor de vídeo: lê a faixa que já existe; senão pede ao provedor (pendente); sem a capacidade, recusa', async () => {
  const { transcrever, consultarTranscricao } = await ia();
  const config = configFala('provedor-de-video');
  const video = { id: 'vid-1', extras: {} };
  const comFaixa = {
    id: 'cloudflare-stream', capacidades: () => ({ legendaIA: true }),
    legendas: async () => [{ idioma: 'pt', rotulo: 'pt', url: 'https://cdn.exemplo.test/pt.vtt', origem: 'ia' }],
    gerarLegendaIA: async () => { throw new Error('não devia pedir'); }
  };
  const fetch = F.fetchFalso([{ texto: F.VTT }]);
  const r = await transcrever({ origem: { provedor: comFaixa, video, referer: 'https://site.test/' }, idioma: 'pt-BR', config, env: {}, fetch, agora: AGORA });
  assert.equal(r.estado, 'ok');
  assert.equal(r.segmentos.length, 8);
  assert.equal(r.custoUSD, 0);
  assert.equal(fetch.chamadas[0].cabecalhos.Referer, 'https://site.test/');
  assert.equal(r.proveniencia.provedor, 'provedor-de-video');

  let faixas = [];
  const pedidos = [];
  const semFaixa = { id: 'cloudflare-stream', capacidades: () => ({ legendaIA: true }), legendas: async () => faixas, gerarLegendaIA: async (id, p) => { pedidos.push([id, p]); return { iniciado: true }; } };
  const p = await transcrever({ origem: { provedor: semFaixa, video }, idioma: 'pt', config, env: {}, fetch, aguardar: false });
  assert.equal(p.estado, 'pendente');
  assert.deepEqual(pedidos, [['vid-1', { idioma: 'pt' }]]);
  assert.equal((await consultarTranscricao({ trabalho: p.trabalho, origem: { provedor: semFaixa, video }, idioma: 'pt', config, env: {}, fetch })).estado, 'pendente');
  faixas = [{ idioma: 'pt', url: 'https://cdn.exemplo.test/pt.vtt', origem: 'ia' }];
  const f2 = F.fetchFalso([{ texto: F.VTT }]);
  assert.equal((await consultarTranscricao({ trabalho: p.trabalho, origem: { provedor: semFaixa, video }, idioma: 'pt', config, env: {}, fetch: f2, agora: AGORA })).estado, 'ok');

  const bunny = { id: 'bunny', capacidades: () => ({ legendaIA: false }), legendas: async () => [] };
  const x = await transcrever({ origem: { provedor: bunny, video }, config, env: {}, fetch });
  assert.deepEqual([x.estado, x.codigo], ['falhou', 'ia-provedor-recusou']);
  assert.match(x.detalhe, /legendaIA desligada/);
});

test('transcrição respeita o orçamento: com duração conhecida, não envia nada se não couber, e registra o custo real quando faz', async () => {
  const { transcrever, criarOrcamento } = await ia();
  const kv = F.kvEmMemoria({});
  const env = { CATALOGO: kv, AI: { run: async () => F.whisper(F.SEGMENTOS_WHISPER, 3600) } };
  const apertado = F.configIA({ ia: { orcamentoMensalUSD: 0.001, transcricao: { provedor: 'workers-ai-whisper' } } });
  const orc = criarOrcamento({ env, config: apertado, agora: AGORA });
  const barrado = await transcrever({ origem: { audio: AUDIO, duracaoSeg: 36000 }, config: apertado, env, orcamento: orc });
  assert.deepEqual([barrado.estado, barrado.codigo], ['falhou', 'ia-orcamento-estourado']);
  assert.deepEqual(kv.escritas, []);

  const folga = configFala('workers-ai-whisper');
  const orc2 = criarOrcamento({ env, config: folga, agora: AGORA });
  const ok = await transcrever({ origem: { audio: AUDIO, duracaoSeg: 3600 }, config: folga, env, orcamento: orc2, agora: AGORA });
  assert.equal(ok.estado, 'ok');
  assert.equal(await orc2.gastoDoMes(), 0.03);
  assert.equal((await orc2.ler()).porTarefa.transcricao, 0.03);
});

test('legendas SRT e VTT: leitura, ida e volta, e as rolantes (cada cue repete a linha de cima) não duplicam o texto', async () => {
  const S = await srt();
  const cues = S.analisarLegenda(F.SRT);
  assert.equal(cues.length, 8);
  assert.deepEqual(S.analisarLegenda(F.VTT).map((c) => [c.inicio, c.fim]), cues.map((c) => [c.inicio, c.fim]));
  assert.equal(S.analisarLegenda(S.paraSrt(cues)).length, 8);
  assert.equal(S.analisarLegenda(S.paraVtt(cues))[3].texto, cues[3].texto);
  assert.equal(S.paraCarimbo(3725.5), '01:02:05,500');
  assert.equal(S.paraSegundos('00:01:05,250'), 65.25);
  assert.equal(S.paraSegundos('01:05.5'), 65.5);
  assert.equal(S.mmss(3725), '1:02:05');
  const rolante = S.juntarSemRepetir([
    { inicio: 0, fim: 2, texto: 'a gente vai plantar' },
    { inicio: 2, fim: 4, texto: 'a gente vai plantar alface hoje' },
    { inicio: 4, fim: 6, texto: 'a gente vai plantar alface hoje' },
    { inicio: 6, fim: 8, texto: 'e depois regar' }
  ]);
  assert.equal(S.textoDasCues(rolante), 'a gente vai plantar alface hoje e depois regar');
  const blocos = S.emBlocos(cues, 30);
  assert.deepEqual(blocos.map((b) => b.inicio), [0, 30, 60, 90]);
  assert.ok(S.reduzirBlocos(F.BLOCOS_LONGOS, 500).length < F.BLOCOS_LONGOS.length);
  assert.equal(S.reduzirBlocos(F.BLOCOS, 100000).length, F.BLOCOS.length);
});

test('REGRESSÃO: sem duração conhecida (provedor-de-video), o orçamento é conferido ANTES e o provedor não é chamado', async () => {
  const { transcrever } = await ia();
  const fetch = F.fetchFalso([]);
  const orcamento = { podeGastar: async () => false, registrar: async () => {} };
  const r = await transcrever({ origem: { provedor: 'bunny', video: 'abc' }, config: configFala('provedor-de-video'), env: {}, fetch, orcamento, agora: AGORA });
  assert.equal(r.estado, 'falhou');
  assert.equal(r.codigo, 'ia-orcamento-estourado');
  assert.equal(fetch.chamadas.length, 0);
});
