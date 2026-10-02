/* A fila de sugestões e a API do Worker (M9): NADA gerado por IA vai ao ar sem uma pessoa aceitar, e aceitar passa pelo mesmo
 * caminho validado do PUT do catálogo (permissão por campo, 409, histórico). Sem rede: o fetch global é trocado por um falso. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixtures/ia/ambiente.js');

const mod = (n) => import('../core/worker/' + n);
const App = require('../core/site/catalogo-core.js');
const ID_VIDEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AGORA = () => Date.parse('2026-10-02T12:00:00Z');
const json = (o) => JSON.stringify(o);

const itemBase = (extra) => Object.assign({ id: 'horta', titulo: 'Horta em casa', serie: 'Mão na terra', publicar: true, duracao_seg: 110, sinopse: 'Sinopse antiga escrita por uma pessoa.', tags: ['jardim'], fonte: { provedor: 'bunny', id: ID_VIDEO, extras: {} } }, extra || {});
const catalogoInicial = (itens) => json({ rev: 7, versao: 1, itens: itens || [itemBase()] });

function ambiente(extra) {
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  return Object.assign({
    ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
    CATALOGO: kv, ASSETS: { fetch: async () => new Response('ok') },
    BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k-12345678', BUNNY_PULLZONE: 'vz-a.b-cdn.net'
  }, F.ENV_TEXTO, extra || {});
}

const configDoSite = (extra) => Object.assign({ acesso: { modo: 'publico' } }, F.configIA(extra));

async function mundo({ config, env } = {}) {
  const { criarWorker } = await mod('index.js');
  const cfg = config || configDoSite();
  const worker = criarWorker({ obterConfig: async () => cfg });
  const e = env || ambiente();
  const chamar = async (metodo, caminho, token, corpo) => {
    const r = await worker.fetch(new Request('https://exemplo.test' + caminho, {
      method: metodo, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: corpo === undefined ? undefined : json(corpo)
    }), e, { waitUntil: () => {} });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (x) { /* */ }
    return { status: r.status, json: j, texto: t };
  };
  const sup = (await chamar('POST', '/api/login', null, { senha: 'senha-do-super' })).json.token;
  const conta = async (usuario, permissoes) => {
    const c = await chamar('POST', '/api/contas', sup, { usuario, senha: 'senha-bem-comprida', permissoes });
    assert.equal(c.status, 200, c.texto);
    return (await chamar('POST', '/api/login', null, { usuario, senha: 'senha-bem-comprida' })).json.token;
  };
  return { worker, env: e, chamar, sup, conta, kv: e.CATALOGO };
}

/* O fetch global (usado pelas rotas, que não aceitam injeção) é trocado por um que responde a legenda e o modelo. */
function trocarFetch(respostasDoModelo) {
  const original = globalThis.fetch;
  const chamadas = [];
  let i = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    chamadas.push({ url: u, corpo: typeof init.body === 'string' ? JSON.parse(init.body) : null, init });
    if (u.includes('/captions/')) return new Response(F.VTT, { status: 200 });
    if (u.startsWith('https://api.anthropic.com/')) {
      const r = respostasDoModelo[Math.min(i++, respostasDoModelo.length - 1)];
      return new Response(json(r), { status: 200 });
    }
    throw new Error('fetch inesperado: ' + u);
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

const sugestao = (campo, valor, extra) => Object.assign({ itemId: 'horta', campo, valor, proveniencia: { origem: 'ia', modelo: 'claude-sonnet-5-5', provedor: 'anthropic', tarefa: 'x', data: '2026-10-02T12:00:00.000Z', revisado: false }, custoUSD: 0.01, atual: null }, extra || {});

/* ------------------------------------------------------------------ a fila nunca toca no catálogo */

test('registrar uma sugestão só escreve na fila: o catálogo fica byte a byte igual, e o carimbo nasce revisado:false', async () => {
  const { registrarSugestao, listarSugestoes } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const antes = kv.dados.catalogo;
  const r = await registrarSugestao({ CATALOGO: kv }, Object.assign(sugestao('sinopse', F.SINOPSE_BOA), { proveniencia: { origem: 'ia', modelo: 'm', revisado: true }, agora: AGORA }));
  assert.equal(r.ok, true);
  assert.equal(r.sugestao.proveniencia.revisado, false, 'quem gera não decide se foi revisado');
  assert.equal(r.sugestao.estado, 'pendente');
  assert.equal(kv.dados.catalogo, antes);
  assert.deepEqual(kv.escritas, ['ia:sug:horta:sinopse']);
  assert.equal((await listarSugestoes({ CATALOGO: kv })).length, 1);
});

test('registrar recusa campo desconhecido, valor que não serve ao campo e proveniência que não é de IA', async () => {
  const { registrarSugestao } = await import('../core/worker/_lib/ia/index.js');
  const env = { CATALOGO: F.kvEmMemoria({}) };
  const casos = [
    sugestao('publicar', true), sugestao('fonte', 'x'), sugestao('sinopse', 42), sugestao('sinopse', ''),
    sugestao('capitulos', [{ inicio: 10, titulo: 'a' }, { inicio: 5, titulo: 'b' }]), sugestao('capitulos', 'texto'),
    sugestao('tags', { tags: 'a' }), sugestao('legenda-pt', 'sem tempos'), sugestao('legenda-zzz', '1\n00:00:00,000 --> 00:00:01,000\nx'),
    sugestao('sinopse', F.SINOPSE_BOA, { proveniencia: { origem: 'humano' } }), sugestao('sinopse', F.SINOPSE_BOA, { proveniencia: null }),
    sugestao('sinopse', F.SINOPSE_BOA, { itemId: '' })
  ];
  for (const c of casos) {
    const r = await registrarSugestao(env, c);
    assert.equal(r.ok, false, json(c).slice(0, 80));
    assert.equal(r.codigo, 'ia-sugestao-invalida');
  }
  assert.deepEqual(env.CATALOGO.escritas, []);
});

test('gerar de novo substitui a sugestão pendente do mesmo campo; campos diferentes convivem', async () => {
  const { registrarSugestao, listarSugestoes } = await import('../core/worker/_lib/ia/index.js');
  const env = { CATALOGO: F.kvEmMemoria({}) };
  await registrarSugestao(env, sugestao('sinopse', 'Primeira sinopse sugerida pela máquina.'));
  await registrarSugestao(env, sugestao('sinopse', 'Segunda sinopse sugerida pela máquina.'));
  await registrarSugestao(env, sugestao('titulo_alternativo', 'Um título alternativo qualquer'));
  await registrarSugestao(env, sugestao('sinopse', 'Sinopse de outro título que também espera.', { itemId: 'outro/título:1' }));
  const fila = await listarSugestoes(env);
  assert.equal(fila.length, 3);
  assert.equal(fila.find((s) => s.itemId === 'horta' && s.campo === 'sinopse').valor, 'Segunda sinopse sugerida pela máquina.');
  assert.equal((await listarSugestoes(env, { itemId: 'outro/título:1' })).length, 1, 'id com / e : também é chave segura');
  assert.equal((await listarSugestoes(env, { itemId: 'horta', campo: 'titulo_alternativo' })).length, 1);
});

test('o pipeline só registra o que saiu "ok": insuficiente, falhou e sem legenda não gravam NADA na fila', async () => {
  const { gerarSugestoes } = await import('../core/worker/_lib/ia/index.js');
  const { analisarLegenda, emBlocos } = await import('../core/worker/_lib/ia/srt.js');
  const cues = analisarLegenda(F.SRT);
  const transcricao = { cues, texto: F.TEXTO, blocos: emBlocos(cues, 30), duracaoSeg: 110, idioma: 'pt' };
  const kv = F.kvEmMemoria({});
  const env = Object.assign({ CATALOGO: kv }, F.ENV_TEXTO);
  const fetch = F.fetchFalso([{ json: F.anthropic('{"insuficiente": true}') }, { json: F.anthropic('lixo') }, { json: F.anthropic(json({ tema: 'Horta', tags: ['horta'], tagsNovas: [] })) }]);
  const r = await gerarSugestoes({ env, config: F.configIA(), item: itemBase(), tarefas: ['sinopse-curta', 'titulo-alternativo', 'tags'], transcricao, fetch, agora: AGORA });
  assert.deepEqual(r.map((x) => x.estado), ['insuficiente', 'falhou', 'sugerida']);
  assert.deepEqual(kv.escritas, ['ia:sug:horta:tags']);
  const semLegenda = await gerarSugestoes({ env, config: F.configIA(), item: itemBase(), tarefas: ['sinopse-curta'], transcricao: null, fetch, agora: AGORA });
  assert.equal(semLegenda[0].estado, 'sem-transcricao');
  const desl = await gerarSugestoes({ env, config: F.configIA(), item: itemBase(), tarefas: ['sinopse-curta'], transcricao, fetch, ligados: { 'sinopse-curta': false }, agora: AGORA });
  assert.equal(desl[0].estado, 'desligada');
  assert.equal(kv.escritas.length, 1);
});

/* ------------------------------------------------------------------ aceitar e descartar */

test('aceitar passa a sugestão ao catálogo pelo caminho validado: rev sobe, histórico registra, carimbo vai ao item, a fila esvazia', async () => {
  const { registrarSugestao, aceitar, listarSugestoes } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  await registrarSugestao(env, sugestao('sinopse', F.SINOPSE_BOA, { agora: AGORA }));
  const r = await aceitar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'superadmin', super: true }, agora: AGORA });
  assert.equal(r.ok, true, json(r));
  assert.equal(r.decisao, 'aceita');
  assert.equal(r.rev, 8);
  const cat = JSON.parse(kv.dados.catalogo);
  assert.equal(cat.rev, 8);
  const item = cat.itens[0];
  assert.equal(item.sinopse, F.SINOPSE_BOA);
  assert.equal(item.sinopse_origem, 'auto', 'aceitar sem editar não vira "revisada"');
  assert.deepEqual([item.ia.sinopse.origem, item.ia.sinopse.revisado, item.ia.sinopse.aceitoPor, item.ia.sinopse.modelo], ['ia', false, 'superadmin', 'claude-sonnet-5-5']);
  assert.ok(item.ia.sinopse.aceitoEm);
  assert.deepEqual(item.tags, ['jardim'], 'o resto do item não mexe');
  assert.deepEqual(await listarSugestoes(env), []);
  assert.ok(Object.keys(kv.dados).some((k) => k.startsWith('historico')), 'a publicação entrou no histórico (desfazer): ' + Object.keys(kv.dados));
  const decisoes = JSON.parse(kv.dados['ia:decisoes']);
  assert.deepEqual([decisoes[0].decisao, decisoes[0].campo, decisoes[0].por], ['aceita', 'sinopse', 'superadmin']);
  /* aceitar de novo: não há mais */
  assert.equal((await aceitar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'superadmin', super: true } })).codigo, 'ia-sugestao-nao-encontrada');
});

test('aceitar COM edição: vale o texto da pessoa, vira "revisada" e o carimbo diz revisado e editado', async () => {
  const { registrarSugestao, aceitar } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  await registrarSugestao(env, sugestao('sinopse', F.SINOPSE_BOA));
  const r = await aceitar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'maria', super: true }, edicao: 'Texto corrigido por Maria, que sabe mais.' });
  assert.equal(r.decisao, 'aceita-editada');
  const item = JSON.parse(kv.dados.catalogo).itens[0];
  assert.equal(item.sinopse, 'Texto corrigido por Maria, que sabe mais.');
  assert.equal(item.sinopse_origem, 'revisada');
  assert.deepEqual([item.ia.sinopse.revisado, item.ia.sinopse.editado], [true, true]);
  /* edição igual à sugerida não conta como edição */
  await registrarSugestao(env, sugestao('titulo_alternativo', 'Um título alternativo'));
  const igual = await aceitar(env, { itemId: 'horta', campo: 'titulo_alternativo', conta: { usuario: 'maria', super: true }, edicao: 'Um título alternativo' });
  assert.equal(igual.decisao, 'aceita');
  /* edição que não serve ao campo é recusada e a sugestão continua na fila */
  await registrarSugestao(env, sugestao('capitulos', [{ inicio: 0, titulo: 'Abertura' }, { inicio: 40, titulo: 'Meio' }]));
  const ruim = await aceitar(env, { itemId: 'horta', campo: 'capitulos', conta: { usuario: 'maria', super: true }, edicao: [{ inicio: 9, titulo: 'a' }, { inicio: 3, titulo: 'b' }] });
  assert.deepEqual([ruim.ok, ruim.codigo], [false, 'ia-sugestao-invalida']);
  assert.ok(kv.dados['ia:sug:horta:capitulos']);
});

test('aceitar: capítulos entram como lista; tags entram por UNIÃO (as da pessoa ficam) e as "novas" só se marcadas', async () => {
  const { registrarSugestao, aceitar } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  const conta = { usuario: 'superadmin', super: true };
  await registrarSugestao(env, sugestao('capitulos', [{ inicio: 0, titulo: 'Abertura' }, { inicio: 40, titulo: 'O truque do dedo' }]));
  assert.equal((await aceitar(env, { itemId: 'horta', campo: 'capitulos', conta })).ok, true);
  assert.deepEqual(JSON.parse(kv.dados.catalogo).itens[0].capitulos, [{ inicio: 0, titulo: 'Abertura' }, { inicio: 40, titulo: 'O truque do dedo' }]);

  await registrarSugestao(env, sugestao('tags', { tema: 'Horta doméstica', tags: ['Jardim', 'horta'], tagsNovas: ['vasos'] }));
  await aceitar(env, { itemId: 'horta', campo: 'tags', conta });
  let item = JSON.parse(kv.dados.catalogo).itens[0];
  assert.deepEqual(item.tags, ['jardim', 'horta'], 'Jardim já existia como "jardim": sem duplicar');
  assert.equal(item.tema, 'Horta doméstica');
  await registrarSugestao(env, sugestao('tags', { tags: ['feijão'], tagsNovas: ['vasos'] }));
  await aceitar(env, { itemId: 'horta', campo: 'tags', conta, incluirTagsNovas: true });
  item = JSON.parse(kv.dados.catalogo).itens[0];
  assert.deepEqual(item.tags, ['jardim', 'horta', 'feijão', 'vasos']);
});

test('aceitar quando o catálogo mudou no meio: 409 do próprio PUT, e a sugestão continua na fila', async () => {
  const { registrarSugestao, aceitar, lerSugestao } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  await registrarSugestao(env, sugestao('sinopse', F.SINOPSE_BOA));
  const lerVelho = async (e) => Object.assign({}, App.catalogoMigrado(JSON.parse(kv.dados.catalogo)), { rev: 3 });
  const r = await aceitar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'superadmin', super: true }, lerCatalogo: lerVelho });
  assert.deepEqual([r.ok, r.status, r.codigo], [false, 409, 'catalogo-mudou']);
  assert.equal(JSON.parse(kv.dados.catalogo).itens[0].sinopse, 'Sinopse antiga escrita por uma pessoa.');
  assert.ok(await lerSugestao(env, 'horta', 'sinopse'));
});

test('descartar apaga da fila, anota a decisão e não mexe no catálogo', async () => {
  const { registrarSugestao, descartar, listarSugestoes } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  const antes = kv.dados.catalogo;
  await registrarSugestao(env, sugestao('sinopse', F.SINOPSE_BOA));
  const r = await descartar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'maria' }, agora: AGORA });
  assert.equal(r.ok, true);
  assert.deepEqual(await listarSugestoes(env), []);
  assert.equal(kv.dados.catalogo, antes);
  assert.equal(JSON.parse(kv.dados['ia:decisoes'])[0].decisao, 'descartada');
  assert.equal((await descartar(env, { itemId: 'horta', campo: 'sinopse', conta: { usuario: 'maria' } })).codigo, 'ia-sugestao-nao-encontrada');
});

test('legenda traduzida: aceitar envia a faixa ao PROVEDOR e só então anota o carimbo; se o provedor recusa, nada muda', async () => {
  const { registrarSugestao, aceitar, lerSugestao } = await import('../core/worker/_lib/ia/index.js');
  const kv = F.kvEmMemoria({ catalogo: catalogoInicial() });
  const env = { CATALOGO: kv };
  const srt = '1\n00:00:00,000 --> 00:00:03,000\nGood morning, everyone.\n';
  await registrarSugestao(env, sugestao('legenda-en', srt));
  const conta = { usuario: 'superadmin', super: true };
  const enviadas = [];
  const bom = { enviarLegenda: async (id, p) => { enviadas.push([id, p]); return { idioma: p.idioma }; } };
  const antes = kv.dados.catalogo;
  const falha = await aceitar(env, { itemId: 'horta', campo: 'legenda-en', conta, provedor: { enviarLegenda: async () => { throw new (await mod('_lib/provedores/contrato.js')).ErroProvedor('provedor-recusou-legenda', { status: 400 }); } } });
  assert.equal(falha.ok, false);
  assert.ok(falha.provedorErro);
  assert.equal(kv.dados.catalogo, antes);
  assert.ok(await lerSugestao(env, 'horta', 'legenda-en'));
  assert.equal((await aceitar(env, { itemId: 'horta', campo: 'legenda-en', conta })).ok, false, 'sem provedor não há como enviar');

  const ok = await aceitar(env, { itemId: 'horta', campo: 'legenda-en', conta, provedor: bom });
  assert.equal(ok.ok, true);
  assert.deepEqual(enviadas, [[ID_VIDEO, { idioma: 'en', rotulo: 'en', srt }]]);
  const item = JSON.parse(kv.dados.catalogo).itens[0];
  assert.equal(item.ia['legenda-en'].origem, 'ia');
  assert.equal(item.sinopse, 'Sinopse antiga escrita por uma pessoa.');
});

test('a fila vem com o valor de HOJE ao lado e avisa quando a pessoa mexeu no campo depois da sugestão', async () => {
  const { registrarSugestao, listarSugestoes, comLadoALado } = await import('../core/worker/_lib/ia/index.js');
  const env = { CATALOGO: F.kvEmMemoria({}) };
  await registrarSugestao(env, sugestao('sinopse', F.SINOPSE_BOA, { atual: 'Sinopse antiga escrita por uma pessoa.' }));
  await registrarSugestao(env, sugestao('tags', { tags: ['horta'], tagsNovas: [] }, { atual: { tema: '', tags: ['jardim'] } }));
  const catalogo = { itens: [itemBase({ sinopse: 'Outra sinopse que a pessoa escreveu depois.' })] };
  const lado = comLadoALado(await listarSugestoes(env), catalogo);
  const s = lado.find((x) => x.campo === 'sinopse');
  assert.equal(s.titulo, 'Horta em casa');
  assert.equal(s.atual, 'Outra sinopse que a pessoa escreveu depois.');
  assert.equal(s.mudouDesde, true);
  const t = lado.find((x) => x.campo === 'tags');
  assert.deepEqual(t.atual, { tema: '', tags: ['jardim'] });
  assert.equal(t.mudouDesde, false);
});

/* ------------------------------------------------------------------ a API do Worker */

test('GET /api/ia: o retrato nunca devolve a chave; tudo nasce desligado; o orçamento e a tabela de preços vêm com data', async () => {
  const m = await mundo();
  const sup = await m.chamar('GET', '/api/ia', m.sup);
  assert.equal(sup.status, 200);
  assert.ok(!sup.texto.includes(F.CHAVE), 'a chave vazou');
  for (const v of Object.values(F.ENV_TEXTO)) assert.ok(!sup.texto.includes(v), 'um segredo vazou');
  const j = sup.json;
  assert.deepEqual([j.textos.provedor, j.textos.modelo, j.textos.temChave, j.textos.pronto], ['anthropic', 'claude-sonnet-5-5', true, true]);
  assert.equal(j.transcricao.provedor, 'nenhum');
  assert.ok(Object.values(j.recursos).every((r) => r.ligado === false), 'recurso pago nasce desligado');
  assert.equal(j.orcamento.limiteUSD, 5);
  assert.equal(j.orcamento.gastoUSD, 0);
  assert.match(j.precos.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(j.pendentes, 0);
  assert.equal(j.privacidade.conteudoSaiDaConta, true);
  assert.equal(j.quemPode.gerar, true);
  const equipe = await m.conta('maria', ['conteudo']);
  assert.equal((await m.chamar('GET', '/api/ia', equipe)).json.quemPode.gerar, false);
  assert.equal((await m.chamar('GET', '/api/ia', null)).status, 401);
});

test('PUT /api/ia liga e desliga por recurso (só o superadmin); recurso desconhecido é recusado', async () => {
  const m = await mundo();
  const equipe = await m.conta('maria', ['conteudo']);
  assert.equal((await m.chamar('PUT', '/api/ia', equipe, { recursos: { capitulos: true } })).status, 403);
  const r = await m.chamar('PUT', '/api/ia', m.sup, { recursos: { capitulos: true, 'sinopse-curta': true } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.recursos.capitulos, r.json.recursos['sinopse-curta']], [true, true]);
  const g = (await m.chamar('GET', '/api/ia', m.sup)).json;
  assert.deepEqual([g.recursos.capitulos.ligado, g.recursos.capitulos.origem, g.recursos.tags.ligado], [true, 'admin', false]);
  assert.equal((await m.chamar('PUT', '/api/ia', m.sup, { recursos: { voar: true } })).status, 400);
  assert.equal((await m.chamar('PUT', '/api/ia', m.sup, { recursos: { capitulos: 'sim' } })).json.mudou, 0, 'só booleano vale');
  await m.chamar('PUT', '/api/ia', m.sup, { recursos: { capitulos: false } });
  assert.equal((await m.chamar('GET', '/api/ia', m.sup)).json.recursos.capitulos.ligado, false);
});

test('POST /api/ia estimar: a equipe com "conteudo" vê o custo e se cabe; não chama ninguém nem grava', async () => {
  const m = await mundo();
  const f = trocarFetch([]);
  try {
    const equipe = await m.conta('maria', ['conteudo']);
    const sem = await m.conta('joao', ['player']);
    assert.equal((await m.chamar('POST', '/api/ia', sem, { acao: 'estimar', tarefas: ['sinopse-curta'] })).status, 403);
    const r = await m.chamar('POST', '/api/ia', equipe, { acao: 'estimar', tarefas: ['sinopse-curta', 'capitulos', 'transcricao'], ids: ['horta'] });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.estimativa.estimativa, true);
    assert.ok(r.json.estimativa.totalUSD > 0);
    assert.equal(r.json.decisao.ok, true);
    assert.equal(r.json.estimativa.itens.filter((i) => i.id === 'horta').length, 2, 'transcrição desligada: só as duas de texto');
    assert.ok(r.json.estimativa.avisos.includes('ia-transcricao-desligada'));
    assert.equal(f.chamadas.length, 0);
    assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'estimar', tarefas: ['voar'] })).status, 400);
    assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'estimar', tarefas: [] })).status, 400);
    assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'trailer', tarefas: ['capitulos'] })).status, 400);
  } finally { f.restaurar(); }
});

test('POST /api/ia gerar: só o superadmin; lê a legenda do provedor, gera, e põe na FILA; o catálogo continua igual', async () => {
  const m = await mundo();
  const f = trocarFetch([F.anthropic(json({ sinopse: F.SINOPSE_BOA })), F.anthropic(json({ titulo: 'Como começar uma horta pequena em casa' }))]);
  try {
    await m.chamar('PUT', '/api/ia', m.sup, { recursos: { 'sinopse-curta': true, 'titulo-alternativo': true } });
    const equipe = await m.conta('maria', ['conteudo']);
    assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: ['horta'] })).status, 403);
    const antes = m.kv.dados.catalogo;
    const r = await m.chamar('POST', '/api/ia', m.sup, { acao: 'gerar', tarefas: ['sinopse-curta', 'titulo-alternativo', 'capitulos'], ids: ['horta'] });
    assert.equal(r.status, 200, r.texto);
    const res = r.json.resultados[0].resultados;
    assert.deepEqual(res.map((x) => x.estado), ['sugerida', 'sugerida', 'desligada'], 'capítulos está desligado');
    assert.equal(m.kv.dados.catalogo, antes, 'NADA vai ao catálogo sem uma pessoa aceitar');
    assert.ok(f.chamadas[0].url.includes('/captions/pt.vtt'));
    assert.equal(f.chamadas.filter((c) => c.url.startsWith('https://api.anthropic.com/')).length, 2);
    assert.ok(r.json.orcamento.gastoUSD > 0);

    const fila = (await m.chamar('GET', '/api/ia-sugestoes', equipe)).json;
    assert.equal(fila.total, 2);
    const s = fila.sugestoes.find((x) => x.campo === 'sinopse');
    assert.equal(s.valor, F.SINOPSE_BOA);
    assert.equal(s.atual, 'Sinopse antiga escrita por uma pessoa.');
    assert.equal(s.titulo, 'Horta em casa');
    assert.equal(s.proveniencia.origem, 'ia');
    assert.equal(s.proveniencia.revisado, false);
    assert.equal((await m.chamar('GET', '/api/ia', m.sup)).json.pendentes, 2);
    assert.ok((await m.chamar('GET', '/api/ia', m.sup)).json.orcamento.gastoUSD > 0);
  } finally { f.restaurar(); }
});

test('POST /api/ia gerar: lote acima do orçamento é recusado (402) ANTES de chamar o modelo; recurso desligado e IA desligada também', async () => {
  const caro = await mundo({ config: configDoSite({ ia: { orcamentoMensalUSD: 0.0001 } }) });
  const f = trocarFetch([F.anthropic(json({ sinopse: F.SINOPSE_BOA }))]);
  try {
    await caro.chamar('PUT', '/api/ia', caro.sup, { recursos: { 'sinopse-curta': true } });
    const r = await caro.chamar('POST', '/api/ia', caro.sup, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: ['horta'] });
    assert.equal(r.status, 402);
    assert.equal(r.json.codigo, 'ia-orcamento-estourado');
    assert.ok(r.json.decisao.restanteUSD <= 0.0001);
    assert.match(r.json.mensagem, /US\$/);
    assert.equal(f.chamadas.length, 0, 'nada foi chamado');
    assert.equal(caro.kv.dados['ia:sug:horta:sinopse'], undefined);

    const m = await mundo();
    const off = await m.chamar('POST', '/api/ia', m.sup, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: ['horta'] });
    assert.equal(off.json.resultados[0].resultados[0].estado, 'desligada', 'ninguém ligou o recurso');
    const semIA = await mundo({ config: configDoSite({ ia: { textos: { provedor: 'nenhum' } } }) });
    assert.equal((await semIA.chamar('POST', '/api/ia', semIA.sup, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: ['horta'] })).json.codigo, 'ia-desligada');
    assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: ['nao-existe'] })).status, 404);
    assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'gerar', tarefas: ['sinopse-curta'], ids: [] })).status, 400);
    assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'gerar', tarefas: ['trechos-trailer'], ids: ['horta'] })).status, 400, 'o trailer não sai por esta rota');
    assert.equal(f.chamadas.length, 0);
  } finally { f.restaurar(); }
});

test('POST /api/ia gasto: o superadmin registra o que um script gastou fora do Worker', async () => {
  const m = await mundo();
  const equipe = await m.conta('maria', ['conteudo']);
  assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'gasto', usd: 0.5 })).status, 403);
  const r = await m.chamar('POST', '/api/ia', m.sup, { acao: 'gasto', usd: 1.25, provedor: 'assemblyai', tarefa: 'transcricao', minutos: 360 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.gastoUSD, r.json.restanteUSD], [1.25, 3.75]);
  assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'gasto', usd: -1 })).status, 400);
  assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'gasto', usd: 'muito' })).status, 400);
  assert.equal((await m.chamar('GET', '/api/ia', m.sup)).json.orcamento.porProvedor.assemblyai, 1.25);
});

test('a fila pela API: o superadmin entrega (POST), a equipe com "conteudo" aceita (PUT) ou descarta (DELETE); sem a permissão, 403', async () => {
  const m = await mundo();
  const equipe = await m.conta('maria', ['conteudo']);
  const sem = await m.conta('joao', ['player']);
  const corpo = sugestao('sinopse', F.SINOPSE_BOA);
  assert.equal((await m.chamar('POST', '/api/ia-sugestoes', equipe, corpo)).status, 403, 'colocar na fila é do superadmin');
  assert.equal((await m.chamar('POST', '/api/ia-sugestoes', m.sup, Object.assign({}, corpo, { itemId: 'nao-existe' }))).status, 404);
  assert.equal((await m.chamar('POST', '/api/ia-sugestoes', m.sup, Object.assign({}, corpo, { campo: 'publicar', valor: true }))).status, 400);
  assert.equal((await m.chamar('POST', '/api/ia-sugestoes', m.sup, corpo)).status, 200);
  assert.equal((await m.chamar('POST', '/api/ia-sugestoes', m.sup, sugestao('titulo_alternativo', 'Um título alternativo bom'))).status, 200);

  assert.equal((await m.chamar('PUT', '/api/ia-sugestoes', sem, { itemId: 'horta', campo: 'sinopse' })).status, 403);
  assert.equal((await m.chamar('DELETE', '/api/ia-sugestoes', sem, { itemId: 'horta', campo: 'sinopse' })).status, 403);

  const aceita = await m.chamar('PUT', '/api/ia-sugestoes', equipe, { itemId: 'horta', campo: 'sinopse', edicao: 'Texto da Maria depois de ler.' });
  assert.equal(aceita.status, 200, aceita.texto);
  assert.equal(aceita.json.decisao, 'aceita-editada');
  const item = JSON.parse(m.kv.dados.catalogo).itens[0];
  assert.equal(item.sinopse, 'Texto da Maria depois de ler.');
  assert.equal(item.ia.sinopse.aceitoPor, 'maria');
  assert.equal(item.ia.sinopse.revisado, true);

  const desc = await m.chamar('DELETE', '/api/ia-sugestoes', equipe, { itemId: 'horta', campo: 'titulo_alternativo' });
  assert.equal(desc.status, 200);
  assert.equal(JSON.parse(m.kv.dados.catalogo).itens[0].titulo_alternativo, undefined);
  assert.equal((await m.chamar('DELETE', '/api/ia-sugestoes', equipe, { itemId: 'horta', campo: 'titulo_alternativo' })).status, 404);
  assert.equal((await m.chamar('PUT', '/api/ia-sugestoes', equipe, { itemId: 'horta', campo: 'sinopse' })).status, 404);
  assert.equal((await m.chamar('GET', '/api/ia-sugestoes', equipe)).json.total, 0);
});

test('a equipe só aceita o que a sua permissão por campo deixa: capítulos são do superadmin (como sempre foram)', async () => {
  const m = await mundo();
  const equipe = await m.conta('maria', ['conteudo']);
  await m.chamar('POST', '/api/ia-sugestoes', m.sup, sugestao('capitulos', [{ inicio: 0, titulo: 'Abertura' }, { inicio: 40, titulo: 'Meio' }]));
  const r = await m.chamar('PUT', '/api/ia-sugestoes', equipe, { itemId: 'horta', campo: 'capitulos' });
  assert.equal(r.status, 403);
  assert.equal(r.json.codigo, 'conta-nao-pode-campos');
  assert.equal(JSON.parse(m.kv.dados.catalogo).itens[0].capitulos, undefined);
  assert.equal((await m.chamar('GET', '/api/ia-sugestoes?itemId=horta&campo=capitulos', equipe)).json.total, 1, 'segue na fila');
  assert.equal((await m.chamar('PUT', '/api/ia-sugestoes', m.sup, { itemId: 'horta', campo: 'capitulos' })).status, 200);
});

test('legenda longa vem cortada na lista e inteira quando se pede o título e o campo', async () => {
  const m = await mundo();
  const longa = Array.from({ length: 200 }, (_, i) => (i + 1) + '\n00:00:' + String(i % 60).padStart(2, '0') + ',000 --> 00:00:' + String(i % 60).padStart(2, '0') + ',900\nLinha número ' + i + ' da legenda traduzida.\n').join('\n');
  await m.chamar('POST', '/api/ia-sugestoes', m.sup, sugestao('legenda-en', longa));
  const lista = (await m.chamar('GET', '/api/ia-sugestoes', m.sup)).json.sugestoes[0];
  assert.equal(lista.truncado, true);
  assert.equal(lista.valorTamanho, longa.length);
  assert.ok(lista.valor.length < longa.length);
  const inteira = (await m.chamar('GET', '/api/ia-sugestoes?itemId=horta&campo=legenda-en', m.sup)).json.sugestoes[0];
  assert.equal(inteira.valor, longa);
});
