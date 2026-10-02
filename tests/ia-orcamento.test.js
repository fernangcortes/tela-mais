/* O orçamento da IA (M9): estimativa ANTES do lote, recusa do que não cabe, conta do mês no KV, tabela de preços editável
 * e o preço conservador de modelo desconhecido. Sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ia/ambiente.js');

const ia = () => import('../core/worker/_lib/ia/index.js');
const AGORA = Date.parse('2026-10-15T12:00:00Z');
const json = (o) => JSON.stringify(o);
const ITENS = [{ id: 'a', duracaoSeg: 3600 }, { id: 'b', duracaoSeg: 1800 }];

test('estimativa de lote: por item e tarefa, com margem, total, restante e a data dos preços', async () => {
  const { estimarLote, DATA_DOS_PRECOS } = await ia();
  const e = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: ITENS, tarefas: ['sinopse-curta', 'capitulos'] });
  assert.equal(e.estimativa, true);
  assert.equal(e.dataDosPrecos, DATA_DOS_PRECOS);
  assert.match(e.dataDosPrecos, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(e.itens.length, 4);
  assert.equal(e.provedorDeTexto, 'anthropic');
  assert.equal(e.modeloDeTexto, 'claude-sonnet-5-5');
  assert.equal(e.precosConfirmados, true, 'Sonnet 5.5 foi conferido na página da Anthropic');
  /* 1 h de fala ≈ 54 mil caracteres ≈ 17 mil tokens + 450 do prompt: Sonnet 5.5 (US$ 2/10) com margem de 20% */
  const sinopse1h = e.itens.find((i) => i.id === 'a' && i.tarefa === 'sinopse-curta');
  assert.ok(sinopse1h.usd > 0.03 && sinopse1h.usd < 0.06, 'sinopse de 1 h: ' + sinopse1h.usd);
  const cap = e.itens.find((i) => i.id === 'a' && i.tarefa === 'capitulos');
  assert.ok(cap.usd > sinopse1h.usd, 'capítulos devolvem mais texto que a sinopse');
  assert.equal(e.totalUSD, Math.round(e.itens.reduce((s, i) => s + i.usd, 0) * 1e6) / 1e6);
  assert.equal(e.porTarefa['sinopse-curta'] + e.porTarefa.capitulos, e.totalUSD);
  assert.equal(e.limiteUSD, 5);
  assert.equal(e.restanteUSD, 5);
  assert.equal(e.cabe, true);
  /* a mesma estimativa com a metade da duração custa menos */
  const metade = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: [{ id: 'b', duracaoSeg: 1800 }], tarefas: ['sinopse-curta'] });
  assert.ok(metade.totalUSD < sinopse1h.usd);
});

test('a estimativa escolhe o preço do modelo configurado, e modelo desconhecido custa o preço conservador, com aviso', async () => {
  const { estimarLote } = await ia();
  const haiku = estimarLote({ config: F.configIA({ ia: { textos: { modelo: 'claude-haiku-4-5-20251001' } } }), env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  const sonnet = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  assert.ok(haiku.totalUSD < sonnet.totalUSD);
  const desconhecido = estimarLote({ config: F.configIA({ ia: { textos: { modelo: 'modelo-novo-de-2027' } } }), env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  assert.ok(desconhecido.totalUSD > 0, 'preço desconhecido NUNCA vira zero');
  assert.ok(desconhecido.totalUSD >= sonnet.totalUSD, 'o desconhecido é conservador');
  assert.ok(desconhecido.avisos.includes('preco-desconhecido:anthropic:modelo-novo-de-2027'));
  assert.equal(desconhecido.precosConfirmados, false);
  /* OpenAI e Gemini: preços de fonte secundária, marcados como NÃO confirmados */
  const oa = estimarLote({ config: F.configIA({ ia: { textos: { provedor: 'openai' } } }), env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  assert.equal(oa.precosConfirmados, false);
});

test('o cliente corrige a tabela em ia.precos, e a correção vale na estimativa e no custo real', async () => {
  const { estimarLote, tabelaDePrecos } = await ia();
  const config = F.configIA({ ia: { precos: { texto: { 'anthropic:claude-sonnet-5-5': { entradaPorMTok: 20, saidaPorMTok: 100 } }, transcricao: { assemblyai: { porMinuto: 0.01 } } } } });
  const t = tabelaDePrecos(config);
  assert.equal(t.texto['anthropic:claude-sonnet-5-5'].entradaPorMTok, 20);
  assert.equal(t.texto['anthropic:claude-sonnet-5-5'].confirmado, false, 'o valor do cliente não é "conferido na fonte"');
  assert.equal(t.transcricao.assemblyai.porMinuto, 0.01);
  const caro = estimarLote({ config, env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  const normal = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: [ITENS[0]], tarefas: ['sinopse-curta'] });
  assert.ok(caro.totalUSD > normal.totalUSD * 9);
  /* linha torta no config é ignorada */
  const torta = tabelaDePrecos(F.configIA({ ia: { precos: { texto: { 'anthropic:x': { entradaPorMTok: -1, saidaPorMTok: 'a' } } } } }));
  assert.equal(torta.texto['anthropic:x'], undefined);
});

test('estimativa com IA desligada, tarefa inexistente e transcrição por provedor', async () => {
  const { estimarLote } = await ia();
  const off = estimarLote({ config: F.configIA({ ia: { textos: { provedor: 'nenhum' } } }), env: F.ENV_TEXTO, itens: ITENS, tarefas: ['sinopse-curta'] });
  assert.equal(off.totalUSD, 0);
  assert.ok(off.avisos.includes('ia-desligada'));
  const x = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: ITENS, tarefas: ['voar'] });
  assert.ok(x.avisos.includes('ia-tarefa-invalida:voar'));
  /* Whisper no Workers AI: US$ 0,0005/min => 60 min = US$ 0,03, com margem de 20% = US$ 0,036 */
  const w = estimarLote({ config: F.configIA({ ia: { transcricao: { provedor: 'workers-ai-whisper' } } }), env: {}, itens: [ITENS[0]], tarefas: ['transcricao'] });
  assert.equal(w.totalUSD, 0.036);
  assert.equal(w.itens[0].minutos, 60);
  const a = estimarLote({ config: F.configIA({ ia: { transcricao: { provedor: 'assemblyai' } } }), env: {}, itens: [ITENS[0]], tarefas: ['transcricao'] });
  assert.equal(a.totalUSD, 0.252);   /* US$ 0,21/h x 1,2 */
  const pv = estimarLote({ config: F.configIA({ ia: { transcricao: { provedor: 'provedor-de-video' } } }), env: {}, itens: [ITENS[0]], tarefas: ['transcricao'] });
  assert.equal(pv.totalUSD, 0);
  /* a tradução multiplica pelos idiomas de destino */
  const um = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: [ITENS[1]], tarefas: ['traducao-legenda'], idiomasDestino: 1 });
  const tres = estimarLote({ config: F.configIA(), env: F.ENV_TEXTO, itens: [ITENS[1]], tarefas: ['traducao-legenda'], idiomasDestino: 3 });
  assert.ok(Math.abs(tres.totalUSD - um.totalUSD * 3) < 0.000003);
});

test('lote acima do orçamento é RECUSADO; o que cabe passa; o gasto real reduz o que sobra', async () => {
  const { estimarLote, criarOrcamento } = await ia();
  const kv = F.kvEmMemoria({});
  const env = Object.assign({ CATALOGO: kv }, F.ENV_TEXTO);
  const config = F.configIA({ ia: { orcamentoMensalUSD: 0.2 } });
  const orc = criarOrcamento({ env, config, agora: () => AGORA });
  const pequeno = estimarLote({ config, env, itens: [ITENS[1]], tarefas: ['sinopse-curta'], gastoDoMesUSD: await orc.gastoDoMes() });
  const ok = await orc.verificarLote(pequeno);
  assert.equal(ok.ok, true);
  const grande = estimarLote({ config, env, itens: Array.from({ length: 10 }, (_, i) => ({ id: 'v' + i, duracaoSeg: 3600 })), tarefas: ['sinopse-curta', 'capitulos', 'tags'] });
  assert.ok(grande.totalUSD > 0.2);
  assert.equal(grande.cabe, false);
  const recusa = await orc.verificarLote(grande);
  assert.deepEqual([recusa.ok, recusa.codigo, recusa.motivo], [false, 'ia-orcamento-estourado', 'acima-do-restante']);
  assert.equal(recusa.limiteUSD, 0.2);
  assert.deepEqual(kv.escritas, [], 'a verificação não grava nada');

  await orc.registrar({ usd: 0.15, provedor: 'anthropic', modelo: 'claude-sonnet-5-5', tarefa: 'sinopse-curta', entradaTokens: 1, saidaTokens: 1 });
  assert.equal(await orc.gastoDoMes(), 0.15);
  assert.equal(await orc.restanteUSD(), 0.05);
  assert.equal((await orc.verificarLote(pequeno)).ok, pequeno.totalUSD <= 0.05);
  assert.equal(await orc.podeGastar(0.06), false);
  assert.equal(await orc.podeGastar(0.05), true);
});

test('a conta do mês: soma por provedor e tarefa, guarda as últimas chamadas, e vira o mês sozinha', async () => {
  const { criarOrcamento } = await ia();
  const kv = F.kvEmMemoria({});
  const env = { CATALOGO: kv };
  let agora = AGORA;
  const orc = criarOrcamento({ env, config: F.configIA(), agora: () => agora });
  await orc.registrar({ usd: 0.01, provedor: 'anthropic', modelo: 'm', tarefa: 'sinopse-curta' });
  await orc.registrar({ usd: 0.02, provedor: 'anthropic', modelo: 'm', tarefa: 'capitulos' });
  await orc.registrar({ usd: 0.03, provedor: 'assemblyai', tarefa: 'transcricao', minutos: 60 });
  const mes = await orc.ler();
  assert.equal(mes.mes, '2026-10');
  assert.equal(mes.totalUSD, 0.06);
  assert.equal(mes.chamadas, 3);
  assert.deepEqual(mes.porProvedor, { anthropic: 0.03, assemblyai: 0.03 });
  assert.equal(mes.porTarefa.capitulos, 0.02);
  assert.equal(mes.ultimos.length, 3);
  assert.ok(kv.dados['ia:gasto:2026-10']);
  agora = Date.parse('2026-11-01T00:00:01Z');
  assert.equal(await orc.gastoDoMes(), 0, 'mês novo, conta nova');
  await orc.registrar({ usd: 0.5, provedor: 'x' });
  assert.ok(kv.dados['ia:gasto:2026-11']);
  assert.equal(JSON.parse(kv.dados['ia:gasto:2026-10']).totalUSD, 0.06, 'o mês anterior fica como estava');
  /* valor ruim não entra */
  assert.equal(await orc.registrar({ usd: -5 }), null);
  assert.equal(await orc.registrar({ usd: NaN }), null);
});

test('orçamento 0 recusa tudo que custa; sem KV não há como contar, então nada é liberado', async () => {
  const { estimarLote, criarOrcamento } = await ia();
  const zero = F.configIA({ ia: { orcamentoMensalUSD: 0 } });
  const orc0 = criarOrcamento({ env: { CATALOGO: F.kvEmMemoria({}) }, config: zero, agora: () => AGORA });
  const e = estimarLote({ config: zero, env: F.ENV_TEXTO, itens: [ITENS[1]], tarefas: ['sinopse-curta'] });
  assert.equal((await orc0.verificarLote(e)).ok, false);
  /* o que não custa passa mesmo com orçamento 0 */
  assert.equal((await orc0.verificarLote({ totalUSD: 0 })).ok, true);
  const semKv = criarOrcamento({ env: {}, config: F.configIA(), agora: () => AGORA });
  assert.equal(semKv.temArmazenamento, false);
  assert.equal((await semKv.verificarLote(e)).ok, false);
  assert.equal(await semKv.podeGastar(0.0001), false);
  assert.equal(await semKv.registrar({ usd: 1 }), null);
});

test('gerarTexto com orçamento: registra o gasto REAL de cada chamada (também da que foi recusada) e para quando não cabe', async () => {
  const { gerarTexto, criarOrcamento } = await ia();
  const kv = F.kvEmMemoria({});
  const env = Object.assign({ CATALOGO: kv }, F.ENV_TEXTO);
  const config = F.configIA();
  const orcamento = criarOrcamento({ env, config, agora: () => AGORA });
  const fetch = F.fetchFalso([{ json: F.anthropic('lixo', { input_tokens: 1000, output_tokens: 50 }) }, { json: F.anthropic(json({ sinopse: F.SINOPSE_BOA }), { input_tokens: 1000, output_tokens: 100 }) }]);
  const r = await gerarTexto({ tarefa: 'sinopse-curta', entrada: F.ENTRADA, config, env, fetch, orcamento, agora: () => AGORA });
  assert.equal(r.estado, 'ok');
  assert.equal(r.custoUSD, 0.0055, 'duas chamadas: (1000x2 + 50x10 + 1000x2 + 100x10) / 1e6');
  assert.equal(await orcamento.gastoDoMes(), r.custoUSD);
  assert.equal((await orcamento.ler()).chamadas, 2);

  /* orçamento esgotado: nenhuma chamada sai */
  const apertado = criarOrcamento({ env: { CATALOGO: F.kvEmMemoria({}) }, config: F.configIA({ ia: { orcamentoMensalUSD: 0.0001 } }), agora: () => AGORA });
  const fetch2 = F.fetchFalso([{ json: F.anthropic(json({ sinopse: F.SINOPSE_BOA })) }]);
  const barrado = await gerarTexto({ tarefa: 'sinopse-curta', entrada: F.ENTRADA, config: F.configIA({ ia: { orcamentoMensalUSD: 0.0001 } }), env, fetch: fetch2, orcamento: apertado });
  assert.deepEqual([barrado.estado, barrado.codigo], ['falhou', 'ia-orcamento-estourado']);
  assert.equal(fetch2.chamadas.length, 0);
});

test('sem o uso no corpo da resposta, o custo sai da estimativa pelo tamanho do texto (nunca zero)', async () => {
  const { gerarTexto } = await ia();
  const binding = { run: async () => ({ response: json({ sinopse: F.SINOPSE_BOA }) }) };
  const config = F.configIA({ ia: { textos: { provedor: 'workers-ai' } } });
  delete config.ia.textos.chave;
  const r = await gerarTexto({ tarefa: 'sinopse-curta', entrada: F.ENTRADA, config, env: { AI: binding } });
  assert.equal(r.estado, 'ok');
  assert.ok(r.custoUSD > 0);
  assert.ok(r.uso.entradaTokens > 300);
});
