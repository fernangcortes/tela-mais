/* Os scripts de lote da IA (M9) de ponta a ponta: o cliente HTTP fala com o Worker de verdade (em memória), o modelo e o
 * Whisper são falsos. Confere: custo mostrado ANTES e --yes, recusa acima do orçamento, recurso desligado, nada vai ao ar,
 * gasto real registrado no site, e o que já existe não é refeito. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ia/ambiente.js');

const mod = (n) => import('../core/worker/' + n);
const lote = () => import('../scripts/lib/ia-lote.mjs');
const clienteLib = () => import('../scripts/lib/ia-cliente.mjs');
const ID_VIDEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const json = (o) => JSON.stringify(o);
const AGORA = () => Date.parse('2026-10-02T12:00:00Z');
const AUDIO = new Uint8Array([1, 2, 3, 4]);

const item = (id, extra) => Object.assign({ id, titulo: 'Título ' + id, serie: 'Mão na terra', publicar: true, duracao_seg: 110, fonte: { provedor: 'bunny', id: ID_VIDEO.replace(/e$/, String(id.length)), extras: {} } }, extra || {});

async function mundo({ config, itens } = {}) {
  const { criarWorker } = await mod('index.js');
  const cfg = config || Object.assign({ acesso: { modo: 'publico' } }, F.configIA({ ia: { transcricao: { provedor: 'workers-ai-whisper' } } }));
  const worker = criarWorker({ obterConfig: async () => cfg });
  const env = Object.assign({
    ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
    CATALOGO: F.kvEmMemoria({ catalogo: json({ rev: 1, itens: itens || [item('a'), item('b')] }) }), ASSETS: { fetch: async () => new Response('ok') },
    BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k-12345678', BUNNY_PULLZONE: 'vz-a.b-cdn.net'
  }, F.ENV_TEXTO);
  /* o fetch "do site": entrega os pedidos do cliente ao Worker em memória */
  const fetchDoSite = async (url, init) => worker.fetch(new Request(url, init), env, { waitUntil: () => {} });
  const { entrar } = await clienteLib();
  const cliente = await entrar({ site: 'https://exemplo.test', senha: 'senha-do-super', fetch: fetchDoSite });
  return { cliente, env, cfg, worker, fetchDoSite };
}

async function ligar(m, recursos) {
  const r = await m.fetchDoSite('https://exemplo.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ senha: 'senha-do-super' }) });
  const { token } = await r.json();
  const p = await m.fetchDoSite('https://exemplo.test/api/ia', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: json({ recursos }) });
  assert.equal(p.status, 200);
}

/* o provedor de vídeo que os scripts usam para ler a legenda (a do Worker é outra instância) */
const provedorFalso = (faixas = [{ idioma: 'pt', url: 'https://cdn.exemplo.test/pt.vtt' }]) => ({ id: 'bunny', capacidades: () => ({}), legendas: async () => faixas });
const fetchDoModelo = (respostas) => {
  let i = 0;
  const f = F.fetchFalso((url) => {
    if (url.endsWith('.vtt')) return { texto: F.VTT };
    return { json: respostas[Math.min(i++, respostas.length - 1)] };
  });
  return f;
};
const opcoes = (extra) => Object.assign({ tarefa: 'sinopse-curta', item: 'a,b' }, extra);
const calado = () => { const linhas = []; const f = (...a) => linhas.push(a.join(' ')); f.linhas = linhas; return f; };

test('o cliente entra com a senha do superadmin e lê o retrato; senha errada ou sem endereço é erro claro', async () => {
  const { entrar } = await clienteLib();
  const m = await mundo();
  const estado = await m.cliente.estado();
  assert.equal(estado.textos.provedor, 'anthropic');
  await assert.rejects(() => entrar({ site: 'https://exemplo.test', senha: 'errada', fetch: m.fetchDoSite }), /login recusado/);
  await assert.rejects(() => entrar({ site: '', senha: 'x' }), /APP_SITE_URL/);
  await assert.rejects(() => entrar({ site: 'https://x.test', senha: '' }), /APP_SENHA/);
});

test('rodarTextos: valida a tarefa, exige os idiomas da tradução e a chave do provedor', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  const base = { cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch: fetchDoModelo([]), log: calado() };
  assert.equal((await rodarTextos({ ...base, opcoes: {} })).codigo, 1);
  assert.match((await rodarTextos({ ...base, opcoes: { tarefa: 'voar' } })).resumo, /inválida: voar/);
  assert.match((await rodarTextos({ ...base, opcoes: { tarefa: 'trechos-trailer' } })).resumo, /inválida/);
  assert.match((await rodarTextos({ ...base, opcoes: { tarefa: 'traducao-legenda', item: 'a' } })).resumo, /--idiomas/);
  assert.match((await rodarTextos({ ...base, env: {}, opcoes: opcoes() })).resumo, /falta a chave do provedor "anthropic"/);
  const off = await rodarTextos({ ...base, config: F.configIA({ ia: { textos: { provedor: 'nenhum' } } }), opcoes: opcoes() });
  assert.match(off.resumo, /desligada/);
  await assert.rejects(() => rodarTextos({ ...base, opcoes: opcoes({ item: 'nao-existe' }) }), /id não encontrado/);
  await assert.rejects(() => rodarTextos({ ...base, opcoes: { tarefa: 'sinopse-curta' } }), /diga quais títulos/);
});

test('recurso desligado no /admin: o script se recusa (e não gasta nada)', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  const fetch = fetchDoModelo([F.anthropic(json({ sinopse: F.SINOPSE_BOA }))]);
  const r = await rodarTextos({ opcoes: opcoes({ yes: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log: calado() });
  assert.equal(r.codigo, 1);
  assert.match(r.resumo, /desligado no \/admin.*sinopse-curta/);
  assert.equal(fetch.chamadas.length, 0);
});

test('custo ANTES: mostra a estimativa; sem --yes sai com 3 e não chama o modelo; --simular sai com 0', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  await ligar(m, { 'sinopse-curta': true });
  const fetch = fetchDoModelo([F.anthropic(json({ sinopse: F.SINOPSE_BOA }))]);
  const log = calado();
  const sem = await rodarTextos({ opcoes: opcoes(), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log });
  assert.equal(sem.codigo, 3);
  assert.match(sem.resumo, /--yes/);
  assert.match(log.linhas.join('\n'), /Estimativa \(US\$, valores de 2026-10-02/);
  assert.match(log.linhas.join('\n'), /sinopse-curta\s+US\$ 0\.0\d+/);
  assert.match(log.linhas.join('\n'), /TOTAL/);
  assert.equal(fetch.chamadas.length, 0);
  const sim = await rodarTextos({ opcoes: opcoes({ simular: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log: calado() });
  assert.equal(sim.codigo, 0);
  assert.equal(fetch.chamadas.length, 0);
  assert.deepEqual((await m.cliente.fila()), []);
});

test('lote acima do orçamento do mês: RECUSADO antes de chamar o modelo', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo({ config: Object.assign({ acesso: { modo: 'publico' } }, F.configIA({ ia: { orcamentoMensalUSD: 0.0001 } })) });
  await ligar(m, { 'sinopse-curta': true });
  const fetch = fetchDoModelo([F.anthropic(json({ sinopse: F.SINOPSE_BOA }))]);
  const r = await rodarTextos({ opcoes: opcoes({ yes: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log: calado() });
  assert.equal(r.codigo, 1);
  assert.match(r.resumo, /lote RECUSADO/);
  assert.equal(fetch.chamadas.length, 0);
});

test('com --yes: gera, entrega na FILA (nada no catálogo), e o gasto real vai ao site', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  await ligar(m, { 'sinopse-curta': true });
  const antes = m.env.CATALOGO.dados.catalogo;
  const fetch = fetchDoModelo([F.anthropic(json({ sinopse: F.SINOPSE_BOA }), { input_tokens: 1500, output_tokens: 90 })]);
  const log = calado();
  const r = await rodarTextos({ opcoes: opcoes({ yes: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log, agora: AGORA });
  assert.equal(r.codigo, 0, r.resumo);
  assert.equal(r.contagem.sugeridas, 2);
  assert.equal(m.env.CATALOGO.dados.catalogo, antes, 'o catálogo não mudou: nada vai ao ar');
  const fila = await m.cliente.fila();
  assert.deepEqual(fila.map((s) => [s.itemId, s.campo, s.proveniencia.revisado]).sort(), [['a', 'sinopse', false], ['b', 'sinopse', false]]);
  const estado = await m.cliente.estado();
  assert.equal(estado.orcamento.chamadas, 2);
  /* 1500 x US$ 2/MTok + 90 x US$ 10/MTok = US$ 0,0039 por título */
  assert.equal(estado.orcamento.gastoUSD, 0.0078);
  assert.match(log.linhas.join('\n'), /Nada foi publicado/);
  assert.ok(!JSON.stringify(log.linhas).includes(F.CHAVE));
  assert.ok(!JSON.stringify(m.env.CATALOGO.dados).includes(F.CHAVE), 'a chave não foi gravada em lugar nenhum');
});

test('não refaz o que já existe nem o que já espera na fila (a menos que --refazer)', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo({ itens: [item('a', { sinopse: 'Já tem sinopse escrita por gente.' }), item('b'), item('c')] });
  await ligar(m, { 'sinopse-curta': true });
  const fetch = fetchDoModelo([F.anthropic(json({ sinopse: F.SINOPSE_BOA }))]);
  const rodar = (extra) => rodarTextos({ opcoes: opcoes(Object.assign({ item: 'a,b,c', yes: true }, extra)), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log: calado(), agora: AGORA });
  const r1 = await rodar();
  assert.equal(r1.contagem.sugeridas, 2, 'a já tinha sinopse');
  assert.deepEqual((await m.cliente.fila()).map((s) => s.itemId).sort(), ['b', 'c']);
  const r2 = await rodar();
  assert.match(r2.resumo, /nada a fazer/);
  const r3 = await rodar({ refazer: true });
  assert.equal(r3.contagem.sugeridas, 3);
});

test('transcrição insuficiente e título sem legenda: nada é inventado nem entregue; o resumo conta', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  await ligar(m, { 'sinopse-curta': true });
  const insuf = await rodarTextos({ opcoes: opcoes({ yes: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch: fetchDoModelo([F.anthropic('{"insuficiente": true}')]), log: calado(), agora: AGORA });
  assert.equal(insuf.contagem.insuficientes, 2);
  assert.deepEqual(await m.cliente.fila(), []);
  const semLegenda = await rodarTextos({ opcoes: opcoes({ yes: true }), cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso([]), fetch: fetchDoModelo([]), log: calado(), agora: AGORA });
  assert.equal(semLegenda.contagem.semLegenda, 2);
  assert.deepEqual(await m.cliente.fila(), []);
});

test('tradução de legenda pelo script: uma sugestão legenda-<idioma> por título e idioma', async () => {
  const { rodarTextos } = await lote();
  const m = await mundo();
  await ligar(m, { 'traducao-legenda': true });
  const fetch = F.fetchFalso((url, init) => {
    if (url.endsWith('.vtt')) return { texto: F.VTT };
    const enviados = JSON.parse(JSON.parse(init.body).messages[0].content.match(/<transcricao>\n([\s\S]*)\n<\/transcricao>/)[1]);
    return { json: F.anthropic(json({ cues: enviados.map((c) => ({ n: c.n, texto: 'XX ' + c.texto })) })) };
  });
  const r = await rodarTextos({ opcoes: { tarefa: 'traducao-legenda', idiomas: 'en,es', item: 'a', yes: true }, cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, provedor: provedorFalso(), fetch, log: calado(), agora: AGORA });
  assert.equal(r.codigo, 0, r.resumo);
  assert.deepEqual((await m.cliente.fila()).map((s) => s.campo).sort(), ['legenda-en', 'legenda-es']);
});

test('rodarTranscricao: Whisper por pedaços, estimativa antes, --yes, legenda na fila, custo registrado; sem fala não entrega', async () => {
  const { rodarTranscricao } = await lote();
  const m = await mundo();
  await ligar(m, { transcricao: true });
  const binding = { run: async () => F.whisper(F.SEGMENTOS_WHISPER, 110) };
  const audio = { origemDe: async () => ({ pedacos: [{ audio: AUDIO, deslocamentoSeg: 0 }], duracaoSeg: 110 }) };
  /* os títulos já têm legenda? aqui não: a faixa do provedor responde vazio */
  const prov = provedorFalso([]);
  const fetch = F.fetchFalso(() => null);
  const dados = { cliente: m.cliente, config: m.cfg, env: { AI: binding }, provedor: prov, fetch, audio, agora: AGORA };
  const log = calado();
  const sem = await rodarTranscricao({ ...dados, opcoes: { item: 'a,b' }, log });
  assert.equal(sem.codigo, 3);
  assert.match(log.linhas.join('\n'), /transcricao\s+US\$/);
  const r = await rodarTranscricao({ ...dados, opcoes: { item: 'a,b', yes: true }, log: calado() });
  assert.equal(r.codigo, 0, r.resumo);
  assert.equal(r.contagem.sugeridas, 2);
  const fila = await m.cliente.fila();
  assert.deepEqual(fila.map((s) => s.campo), ['legenda-pt', 'legenda-pt']);
  assert.match(fila[0].valor, /^1\n00:00:00,000 --> /);
  assert.equal(fila[0].proveniencia.tarefa, 'transcricao');
  const estado = await m.cliente.estado();
  assert.equal(estado.orcamento.porTarefa.transcricao > 0, true);
  /* de novo: já espera na fila */
  assert.match((await rodarTranscricao({ ...dados, opcoes: { item: 'a,b', yes: true }, log: calado() })).resumo, /nada a fazer/);
});

test('rodarTranscricao: título que já tem legenda no provedor é pulado; áudio sem fala não vira sugestão; sem a chave, para', async () => {
  const { rodarTranscricao } = await lote();
  const m = await mundo();
  await ligar(m, { transcricao: true });
  const audio = { origemDe: async () => ({ pedacos: [{ audio: AUDIO, deslocamentoSeg: 0 }], duracaoSeg: 60 }) };
  const comLegenda = await rodarTranscricao({ cliente: m.cliente, config: m.cfg, env: { AI: { run: async () => { throw new Error('não devia chamar'); } } }, provedor: provedorFalso(), fetch: fetchDoModelo([]), audio, opcoes: { item: 'a', yes: true }, log: calado() });
  assert.match(comLegenda.resumo, /nada a fazer/);
  const mudo = { run: async () => F.whisper([{ start: 0, end: 5, text: 'Obrigado por assistir' }], 60) };
  const r = await rodarTranscricao({ cliente: m.cliente, config: m.cfg, env: { AI: mudo }, provedor: provedorFalso([]), fetch: F.fetchFalso(() => null), audio, opcoes: { item: 'a', yes: true }, log: calado(), agora: AGORA });
  assert.equal(r.contagem.semFala, 1);
  assert.deepEqual(await m.cliente.fila(), []);
  const semChave = await rodarTranscricao({ cliente: m.cliente, config: m.cfg, env: {}, provedor: provedorFalso([]), fetch: F.fetchFalso(() => null), audio, opcoes: { item: 'a' }, log: calado() });
  assert.match(semChave.resumo, /falta a chave/);
  const nenhum = await rodarTranscricao({ cliente: m.cliente, config: F.configIA(), env: {}, provedor: provedorFalso([]), fetch: F.fetchFalso(() => null), audio, opcoes: { item: 'a' }, log: calado() });
  assert.match(nenhum.resumo, /desligada/);
});

test('o orçamento remoto segue o site: podeGastar usa o gasto atual e registrar atualiza pelo que o site responde', async () => {
  const { orcamentoRemoto } = await clienteLib();
  const gastos = [];
  const cliente = { gasto: async (g) => { gastos.push(g); return { gastoUSD: 1.2 }; } };
  const o = orcamentoRemoto(cliente, { limiteUSD: 2, gastoUSD: 0.5 });
  assert.equal(await o.podeGastar(1.5), true);
  assert.equal(await o.podeGastar(1.6), false);
  await o.registrar({ usd: 0.7, provedor: 'x', tarefa: 't' });
  assert.equal(await o.gastoDoMes(), 1.2);
  assert.equal(await o.restanteUSD(), 0.8);
  assert.equal(gastos[0].usd, 0.7);
});
