/* A integração do M9: texto + mídia + executor + fundo do destaque.
 *   - o trailer.mjs escolhe os trechos pelo `gerarTexto` (tarefa trechos-trailer), com custo ANTES, orçamento e INSUFICIENTE;
 *   - a mídia gerada entra na FILA do /admin (midia_clipe, midia_trailer) e só depois de uma pessoa aceitar vira `item.midia.clipe`,
 *     que o fundo do destaque (M6) passa a tocar;
 *   - o botão "gerar no GitHub": desligado por padrão, token do Worker nunca sai, escopo mínimo, só o superadmin.
 * Sem rede: o fetch global é trocado por um falso. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./fixtures/ia/ambiente.js');
const { carregar, No } = require('./player-dom-falso.js');

const mod = (n) => import('../core/worker/' + n);
const lib = (n) => import('../scripts/lib/' + n);
const ID_VIDEO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const json = (o) => JSON.stringify(o);
const AGORA = () => Date.parse('2026-10-02T12:00:00Z');
const calado = () => { const linhas = []; const f = (...a) => linhas.push(a.join(' ')); f.linhas = linhas; return f; };

const itemBase = (extra) => Object.assign({ id: 'horta', titulo: 'Horta em casa', serie: 'Mão na terra', publicar: true, duracao_seg: 110, fonte: { provedor: 'bunny', id: ID_VIDEO, extras: {} } }, extra || {});
const TRECHOS_BONS = [{ inicio: 6, fim: 20, motivo: 'a Joana apresenta a horta' }, { inicio: 40, fim: 58, motivo: 'o que plantar' }, { inicio: 75, fim: 92, motivo: 'colher sem prejudicar' }];

function ambiente(extra) {
  return Object.assign({
    ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
    CATALOGO: F.kvEmMemoria({ catalogo: json({ rev: 1, versao: 1, itens: [itemBase()] }) }), ASSETS: { fetch: async () => new Response('ok') },
    BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k-12345678', BUNNY_PULLZONE: 'vz-a.b-cdn.net'
  }, F.ENV_TEXTO, extra || {});
}

async function mundo({ config, env } = {}) {
  const { criarWorker } = await mod('index.js');
  const cfg = config || Object.assign({ acesso: { modo: 'publico' } }, F.configIA());
  const worker = criarWorker({ obterConfig: async () => cfg });
  const e = env || ambiente();
  const fetchDoSite = async (url, init) => worker.fetch(new Request(url, init), e, { waitUntil: () => {} });
  const chamar = async (metodo, caminho, token, corpo) => {
    const r = await fetchDoSite('https://exemplo.test' + caminho, {
      method: metodo, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: corpo === undefined ? undefined : json(corpo)
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (x) { /* */ }
    return { status: r.status, json: j, texto: t };
  };
  const sup = (await chamar('POST', '/api/login', null, { senha: 'senha-do-super' })).json.token;
  const conta = async (usuario, permissoes) => {
    assert.equal((await chamar('POST', '/api/contas', sup, { usuario, senha: 'senha-bem-comprida', permissoes })).status, 200);
    return (await chamar('POST', '/api/login', null, { usuario, senha: 'senha-bem-comprida' })).json.token;
  };
  const { entrar } = await lib('ia-cliente.mjs');
  const cliente = await entrar({ site: 'https://exemplo.test', senha: 'senha-do-super', fetch: fetchDoSite });
  return { worker, env: e, cfg, chamar, sup, conta, cliente, kv: e.CATALOGO };
}

const ligarTudo = (m, recursos) => m.chamar('PUT', '/api/ia', m.sup, { recursos });

/* ------------------------------------------------------------------ trechos do trailer pelo gerarTexto */

test('criarEscolhedorDeTrechos: o modelo devolve trechos validados (tarefa trechos-trailer), com modelo e custo', async () => {
  const { criarEscolhedorDeTrechos } = await lib('ia-trechos.mjs');
  const fetch = F.fetchFalso([{ json: F.anthropic(json({ trechos: TRECHOS_BONS })) }]);
  const escolher = criarEscolhedorDeTrechos({ config: F.configIA(), env: F.ENV_TEXTO, fetch, titulo: 'Horta em casa', agora: AGORA });
  const r = await escolher(F.VTT, { duracao: 110, alvoSeg: 45 });
  assert.deepEqual(r.resultado.map((t) => [t.inicio, t.fim]), [[6, 20], [40, 58], [75, 92]]);
  assert.equal(r.modelo, 'claude-sonnet-5-5');
  assert.ok(r.custoUSD > 0);
  /* a legenda viaja COM os tempos e como dado (entre marcas), e o alvo vai no pedido */
  const pedido = fetch.chamadas[0].corpoTexto;
  assert.match(pedido, /Joana Batista/);
  assert.match(pedido, /45/);
});

test('criarEscolhedorDeTrechos: legenda insuficiente ou sem tempos devolve null SEM chamar o modelo; trecho inválido duas vezes lança', async () => {
  const { criarEscolhedorDeTrechos } = await lib('ia-trechos.mjs');
  const fetch = F.fetchFalso([{ json: F.anthropic(json({ trechos: TRECHOS_BONS })) }]);
  const escolher = criarEscolhedorDeTrechos({ config: F.configIA(), env: F.ENV_TEXTO, fetch, agora: AGORA });
  assert.equal(await escolher('só texto corrido, sem carimbo de tempo nenhum', { duracao: 110 }), null);
  assert.equal(await escolher('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nOi.\n', { duracao: 110 }), null, 'curta demais para sustentar um trailer');
  assert.equal(fetch.chamadas.length, 0);

  const ruim = F.fetchFalso([{ json: F.anthropic(json({ trechos: [{ inicio: 0, fim: 500, motivo: 'passa do fim' }] })) }]);
  const e2 = criarEscolhedorDeTrechos({ config: F.configIA(), env: F.ENV_TEXTO, fetch: ruim, agora: AGORA });
  await assert.rejects(() => e2(F.VTT, { duracao: 110, alvoSeg: 45 }), /ia-resposta-invalida|passa do fim/);
  assert.equal(ruim.chamadas.length, 2, '1 retentativa e depois falha');
});

test('criarEscolhedorDeTrechos: INSUFICIENTE do modelo vira null (o trailer usa a amostra automática)', async () => {
  const { criarEscolhedorDeTrechos } = await lib('ia-trechos.mjs');
  const fetch = F.fetchFalso([{ json: F.anthropic(json({ insuficiente: true })) }]);
  const escolher = criarEscolhedorDeTrechos({ config: F.configIA(), env: F.ENV_TEXTO, fetch, agora: AGORA });
  assert.equal(await escolher(F.VTT, { duracao: 110, alvoSeg: 45 }), null);
});

test('escolherTrechosPadrao do trailer.mjs entrega o resultado no formato que o pipeline lê; sem config não há IA', async () => {
  const t = await import('../scripts/trailer.mjs');
  assert.equal(await t.escolherTrechosPadrao({}), null);
  const fetch = F.fetchFalso([{ json: F.anthropic(json({ trechos: TRECHOS_BONS })) }]);
  const escolher = await t.escolherTrechosPadrao({ config: F.configIA(), env: F.ENV_TEXTO, fetch, agora: AGORA });
  const resp = await escolher(F.VTT, { duracao: 110, alvoSeg: 45 });
  const lista = t.lerRespostaDeTrechos(resp);
  assert.equal(lista.length, 3);
});

/* ------------------------------------------------------------------ o portão de custo do trailer */

test('prepararEscolhedor: recurso desligado recusa; ligado mostra a estimativa e pede --yes; --simular não chama ninguém', async () => {
  const { prepararEscolhedor } = await lib('ia-trechos.mjs');
  const m = await mundo();
  const base = { cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, ids: ['horta'], fetch: F.fetchFalso([{ json: F.anthropic(json({ trechos: TRECHOS_BONS })) }]), log: calado() };

  const off = await prepararEscolhedor({ ...base, opcoes: { yes: true } });
  assert.equal(off.codigo, 1);
  assert.match(off.resumo, /desligado/);

  await ligarTudo(m, { trailer: true });
  const log = calado();
  const sem = await prepararEscolhedor({ ...base, log, opcoes: {} });
  assert.equal(sem.codigo, 3);
  assert.match(log.linhas.join('\n'), /Estimativa da escolha dos trechos/);
  assert.match(sem.resumo, /--yes/);

  const sim = await prepararEscolhedor({ ...base, opcoes: { simular: true } });
  assert.equal(sim.codigo, 0);
  assert.equal(base.fetch.chamadas.length, 0, 'nada foi chamado');

  const ok = await prepararEscolhedor({ ...base, opcoes: { yes: true } });
  assert.equal(typeof ok.escolherPara, 'function');
});

test('prepararEscolhedor: sem provedor, sem chave, sem site ou acima do orçamento: recusa com o motivo, sem gastar', async () => {
  const { prepararEscolhedor } = await lib('ia-trechos.mjs');
  const m = await mundo();
  await ligarTudo(m, { trailer: true });
  const base = { cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, ids: ['horta'], opcoes: { yes: true }, log: calado() };
  assert.match((await prepararEscolhedor({ ...base, config: F.configIA({ ia: { textos: { provedor: 'nenhum' } } }) })).resumo, /desligada/);
  assert.match((await prepararEscolhedor({ ...base, env: {} })).resumo, /falta a chave/);
  assert.match((await prepararEscolhedor({ ...base, cliente: null })).resumo, /APP_SITE_URL/);

  const apertado = await mundo({ config: Object.assign({ acesso: { modo: 'publico' } }, F.configIA({ ia: { orcamentoMensalUSD: 0 } })) });
  await ligarTudo(apertado, { trailer: true });
  const r = await prepararEscolhedor({ ...base, cliente: apertado.cliente, config: apertado.cfg });
  assert.equal(r.codigo, 1);
  assert.match(r.resumo, /RECUSADO/);
});

test('o gasto do escolhedor vai ao site (orçamento do mês vale para os scripts)', async () => {
  const { prepararEscolhedor } = await lib('ia-trechos.mjs');
  const m = await mundo();
  await ligarTudo(m, { trailer: true });
  const fetch = F.fetchFalso([{ json: F.anthropic(json({ trechos: TRECHOS_BONS })) }]);
  const p = await prepararEscolhedor({ cliente: m.cliente, config: m.cfg, env: F.ENV_TEXTO, ids: ['horta'], opcoes: { yes: true }, fetch, log: calado() });
  const antes = (await m.cliente.estado()).orcamento.gastoUSD;
  const r = await p.escolherPara({ titulo: 'Horta em casa' })(F.VTT, { duracao: 110, alvoSeg: 45 });
  assert.equal(r.resultado.length, 3);
  const depois = (await m.cliente.estado()).orcamento.gastoUSD;
  assert.ok(depois > antes, 'gasto registrado no site: ' + antes + ' -> ' + depois);
});

/* ------------------------------------------------------------------ mídia gerada: fila -> aceitar -> fundo do destaque */

const RESULTADO = {
  origemTrechos: 'ia', modelo: 'claude-sonnet-5-5',
  clipe: { duracao: 8, bytes: 900000 },
  trailer: { duracao: 44.5, bytes: 9000000, trechos: TRECHOS_BONS }
};
const URLS = { clipe: 'https://midia.exemplo.test/midia/horta/clipe.mp4', clipePoster: 'https://midia.exemplo.test/midia/horta/clipe-poster.jpg', trailer: 'https://midia.exemplo.test/midia/horta/trailer.mp4', trailerPoster: 'https://midia.exemplo.test/midia/horta/trailer-poster.jpg' };

test('sugerirNaFila: clipe e trailer entram na fila como SUGESTÃO; o catálogo e o site continuam sem eles', async () => {
  const { sugerirNaFila } = await lib('ia-midia-fila.mjs');
  const m = await mundo();
  const r = await sugerirNaFila({ cliente: m.cliente, itemId: 'horta', resultado: RESULTADO, urls: URLS, agora: () => '2026-10-02T12:00:00.000Z' });
  assert.deepEqual(r.map((x) => [x.campo, x.ok]), [['midia_clipe', true], ['midia_trailer', true]]);

  const fila = (await m.chamar('GET', '/api/ia-sugestoes', m.sup)).json;
  assert.equal(fila.total, 2);
  const clipe = fila.sugestoes.find((s) => s.campo === 'midia_clipe');
  assert.equal(clipe.valor.url, URLS.clipe);
  assert.deepEqual([clipe.proveniencia.origem, clipe.proveniencia.revisado, clipe.proveniencia.modelo], ['ia', false, 'claude-sonnet-5-5']);

  const publico = (await m.chamar('GET', '/api/catalogo', null)).json;
  const item = publico.itens.find((i) => i.id === 'horta');
  assert.ok(!item.midia || !item.midia.clipe, 'nada gerado vai ao ar sem ação humana');
  assert.ok(!item.midia || !item.midia.trailer);
  assert.equal(JSON.stringify(publico).includes(URLS.clipe), false);
});

test('mídia só do ffmpeg (sem modelo) nasce "automatica" e continua não revisada', async () => {
  const { sugerirNaFila } = await lib('ia-midia-fila.mjs');
  const m = await mundo();
  await sugerirNaFila({ cliente: m.cliente, itemId: 'horta', resultado: { ...RESULTADO, origemTrechos: 'automatica', modelo: null }, urls: URLS });
  const s = (await m.chamar('GET', '/api/ia-sugestoes?itemId=horta&campo=midia_clipe', m.sup)).json.sugestoes[0];
  assert.deepEqual([s.proveniencia.origem, s.proveniencia.revisado], ['automatica', false]);
});

test('aceitar o clipe na fila: o clipe vira item.midia.clipe e o fundo do destaque o toca', async () => {
  const { sugerirNaFila } = await lib('ia-midia-fila.mjs');
  const m = await mundo();
  await sugerirNaFila({ cliente: m.cliente, itemId: 'horta', resultado: RESULTADO, urls: URLS });

  const aceita = await m.chamar('PUT', '/api/ia-sugestoes', m.sup, { itemId: 'horta', campo: 'midia_clipe' });
  assert.equal(aceita.status, 200, aceita.texto);

  const publico = (await m.chamar('GET', '/api/catalogo', null)).json;
  const item = publico.itens.find((i) => i.id === 'horta');
  assert.equal(item.midia.clipe, URLS.clipe, 'depois de aceitar, o Worker põe o clipe em item.midia');
  assert.equal(item.midia.trailer, undefined, 'o trailer ainda espera a decisão');
  assert.equal(item.midia.clipePoster, URLS.clipePoster);
  assert.ok(item.midia.hls || item.midia.mp4, 'a mídia principal do provedor continua intacta');
  assert.equal(item.midia_sugerida, undefined);
  assert.equal(item.ia, undefined, 'o carimbo e a fila não saem no catálogo público');

  /* o fundo do destaque (M6) passa a usar o clipe: <video src> = clipe, mudo, nunca a mídia principal */
  const amb = carregar(['guardiao.js', 'destaque-fundo.js'], { matchMedia: () => false });
  class Obs { constructor(cb) { this.cb = cb; Obs.ultimo = this; } observe() {} disconnect() {} ver(s) { this.cb([{ isIntersecting: s, intersectionRatio: s ? 1 : 0 }]); } }
  amb.janela.IntersectionObserver = Obs;
  const el = new No('section', amb.doc); amb.doc.body.appendChild(el);
  const config = { home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 500 } } } };
  assert.ok(amb.janela.montarFundoDoDestaque(el, item, config));
  while (amb.janela.__correr()) { /* o atraso */ }
  const v = el.todos().find((n) => n.tagName === 'VIDEO');
  assert.ok(v, 'montou o <video>');
  assert.equal(v.src, URLS.clipe);
  assert.equal(v.muted, true);
  assert.notEqual(v.src, item.midia.hls);
});

test('descartar a sugestão de mídia: nada muda no site', async () => {
  const { sugerirNaFila } = await lib('ia-midia-fila.mjs');
  const m = await mundo();
  await sugerirNaFila({ cliente: m.cliente, itemId: 'horta', resultado: RESULTADO, urls: URLS });
  assert.equal((await m.chamar('DELETE', '/api/ia-sugestoes', m.sup, { itemId: 'horta', campo: 'midia_clipe' })).status, 200);
  const item = (await m.chamar('GET', '/api/catalogo', null)).json.itens.find((i) => i.id === 'horta');
  assert.ok(!item.midia || !item.midia.clipe);
  assert.equal((await m.chamar('GET', '/api/ia-sugestoes', m.sup)).json.total, 1, 'só o trailer segue na fila');
});

test('a fila recusa URL que não é https e clipe acima de 4 MB (o script não consegue empurrar o que o site não aceita)', async () => {
  const { sugerirNaFila } = await lib('ia-midia-fila.mjs');
  const m = await mundo();
  const r = await sugerirNaFila({ cliente: m.cliente, itemId: 'horta', resultado: { ...RESULTADO, clipe: { duracao: 8, bytes: 5000000 } }, urls: { ...URLS, clipe: 'http://midia.exemplo.test/c.mp4' } });
  assert.equal(r[0].ok, false);
  assert.equal(r[0].campo, 'midia_clipe');
});

test('o host do R2 (ia.midia.urlBase) entra na CSP de imagem e vídeo, e só a origem', async () => {
  const { hostsDeMidia } = await mod('_lib/provedores/index.js');
  const cfg = { ...F.configIA(), video: { provedor: 'bunny' } };
  const sem = hostsDeMidia(cfg, ambiente());
  assert.ok(!sem.media.some((h) => /midia\.exemplo\.test/.test(h)));
  const com = hostsDeMidia({ ...cfg, ia: { ...cfg.ia, midia: { destino: 'r2', bucket: 'meu-bucket', urlBase: 'https://midia.exemplo.test/pasta' } } }, ambiente());
  assert.ok(com.media.includes('https://midia.exemplo.test'));
  assert.ok(com.img.includes('https://midia.exemplo.test'));
  assert.ok(!com.media.some((h) => h.includes('/pasta')));
});

/* ------------------------------------------------------------------ alvos do executor (vídeo vem do provedor) */

test('alvosDaFila: o vídeo vem da URL do provedor, a legenda vem junto e título sem vídeo é pulado com motivo', async () => {
  const { alvosDaFila, urlDeOrigem } = await lib('ia-midia-fila.mjs');
  assert.equal(urlDeOrigem({ mp4: 'https://x/a.mp4', hls: 'https://x/a.m3u8' }), 'https://x/a.mp4');
  assert.equal(urlDeOrigem({ hls: 'https://x/a.m3u8' }), 'https://x/a.m3u8');
  assert.equal(urlDeOrigem({}), null);
  assert.equal(urlDeOrigem({ mp4: { '240p': 'https://x/240.mp4', '720p': 'https://x/720.mp4', '2160p': 'https://x/4k.mp4' } }), 'https://x/720.mp4', 'a maior até 1080p, como objeto de rendições');
  assert.equal(urlDeOrigem({ mp4: { '2160p': 'https://x/4k.mp4' }, hls: 'https://x/a.m3u8' }), 'https://x/4k.mp4');

  const m = await mundo({ env: ambiente({ CATALOGO: F.kvEmMemoria({ catalogo: json({ rev: 1, versao: 1, itens: [itemBase(), itemBase({ id: 'sem-video', fonte: undefined, titulo: 'Sem vídeo' })] }) }) }) });
  const { criarProvedor } = await mod('_lib/provedores/index.js');
  const provedor = criarProvedor(m.cfg, m.env, { fetch: F.fetchFalso(() => ({ texto: F.VTT })) });
  const r = await alvosDaFila({ cliente: m.cliente, provedor, config: m.cfg, ids: ['horta', 'sem-video'], comTranscricao: true, fetch: F.fetchFalso(() => ({ texto: F.VTT })) });
  assert.equal(r.alvos.length, 1);
  assert.match(r.alvos[0].video, /^https:\/\//);
  assert.equal(r.alvos[0].titulo, 'Horta em casa');
  assert.ok(r.alvos[0].blocos && r.alvos[0].blocos.length > 3, 'legenda com tempos');
  assert.deepEqual(r.pulados.map((p) => p.id), ['sem-video']);
  await assert.rejects(() => alvosDaFila({ cliente: m.cliente, provedor, config: m.cfg, ids: ['nao-existe'] }), /id não encontrado/);
});

/* ------------------------------------------------------------------ o executor do GitHub */

function trocarFetchGlobal(responder) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => { chamadas.push({ url: String(url), init, corpo: typeof init.body === 'string' ? JSON.parse(init.body) : null }); return responder(String(url), init); };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

const EXECUTOR = (g) => ({ ia: { executor: { github: g } } });
const GH = { ligado: true, repositorio: 'cliente/streaming', token: { $env: 'GITHUB_DISPATCH_TOKEN' } };

test('executor: nasce DESLIGADO; ligado exige repositório e token; o retrato nunca devolve o token', async () => {
  const { configDoExecutor, retratoDoExecutor } = await mod('_lib/ia/executor.js');
  assert.equal(configDoExecutor({}, {}).ligado, false);
  assert.equal(configDoExecutor({}, {}).pronto, false);
  assert.equal(configDoExecutor(EXECUTOR({ ligado: true }), { GITHUB_DISPATCH_TOKEN: 'ghp_x' }).pronto, false, 'sem repositório');
  assert.equal(configDoExecutor(EXECUTOR({ ligado: true, repositorio: 'a/b' }), {}).pronto, false, 'sem token');
  assert.equal(configDoExecutor(EXECUTOR({ ligado: true, repositorio: 'a/b' }), { GITHUB_DISPATCH_TOKEN: 'ghp_x' }).pronto, true);
  assert.equal(configDoExecutor(EXECUTOR({ ligado: false, repositorio: 'a/b' }), { GITHUB_DISPATCH_TOKEN: 'ghp_x' }).pronto, false, 'token guardado não liga sozinho');
  assert.equal(configDoExecutor(EXECUTOR({ ligado: true, repositorio: 'não é repo' }), {}).repositorio, null);
  const retrato = retratoDoExecutor(EXECUTOR(GH), { GITHUB_DISPATCH_TOKEN: 'ghp_segredo_nao_vazar' });
  assert.equal(retrato.temToken, true);
  assert.equal(JSON.stringify(retrato).includes('ghp_segredo_nao_vazar'), false);
});

test('executor: o pedido é conferido (tarefa, ids, subtarefas) antes de ir ao GitHub', async () => {
  const { entradasDoFluxo } = await mod('_lib/ia/executor.js');
  assert.equal(entradasDoFluxo({ tarefa: 'apagar-tudo', ids: ['a'] }).motivo, 'tarefa');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: [] }).motivo, 'ids');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: Array.from({ length: 21 }, (_, i) => 'id' + i) }).motivo, 'ids');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: ['a b'] }).motivo, 'ids', 'espaço não passa (vai como lista separada por vírgula)');
  assert.equal(entradasDoFluxo({ tarefa: 'textos', ids: ['a'], subtarefas: ['rm -rf'] }).motivo, 'subtarefas');
  assert.deepEqual(entradasDoFluxo({ tarefa: 'textos', ids: ['a', 'b'], subtarefas: ['tags', 'tags', 'capitulos'], idiomas: ['en', 'x;y'] }).entradas, { tarefa: 'textos', ids: 'a,b', subtarefas: 'tags,capitulos', idiomas: 'en', usar_ia: 'nao' });
  assert.deepEqual(entradasDoFluxo({ tarefa: 'trailer', ids: ['horta'] }).entradas, { tarefa: 'trailer', ids: 'horta', usar_ia: 'nao' });
});

test('executor: dispara o fluxo com o token do Worker (só Authorization), repositório e ramo da config; 204 é sucesso', async () => {
  const { dispararFluxo } = await mod('_lib/ia/executor.js');
  const chamadas = [];
  const fetch = async (url, init) => { chamadas.push({ url, metodo: init.method, cabecalhos: init.headers, json: JSON.parse(init.body) }); return new Response(null, { status: 204 }); };
  fetch.chamadas = chamadas;
  const r = await dispararFluxo({ config: EXECUTOR({ ...GH, ref: 'principal' }), env: { GITHUB_DISPATCH_TOKEN: 'ghp_segredo' }, fetch, entradas: { tarefa: 'trailer', ids: 'horta' } });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(r).includes('ghp_segredo'), false);
  const c = fetch.chamadas[0];
  assert.equal(c.url, 'https://api.github.com/repos/cliente/streaming/actions/workflows/gerar-midia.yml/dispatches');
  assert.equal(c.metodo, 'POST');
  assert.equal(c.cabecalhos.authorization, 'Bearer ghp_segredo');
  assert.deepEqual(c.json, { ref: 'principal', inputs: { tarefa: 'trailer', ids: 'horta' } });
});

test('executor: desligado, sem repositório, sem token, recusa do GitHub e rede fora do ar viram códigos claros', async () => {
  const { dispararFluxo } = await mod('_lib/ia/executor.js');
  const env = { GITHUB_DISPATCH_TOKEN: 'ghp_x' };
  const e = { tarefa: 'trailer', ids: 'a' };
  assert.deepEqual([(await dispararFluxo({ config: {}, env, entradas: e, fetch: F.fetchFalso([{}]) })).codigo], ['ia-executor-desligado']);
  assert.equal((await dispararFluxo({ config: EXECUTOR({ ligado: true }), env, entradas: e, fetch: F.fetchFalso([{}]) })).codigo, 'ia-executor-sem-repositorio');
  assert.equal((await dispararFluxo({ config: EXECUTOR(GH), env: {}, entradas: e, fetch: F.fetchFalso([{}]) })).codigo, 'ia-executor-sem-token');
  const recusa = await dispararFluxo({ config: EXECUTOR(GH), env, entradas: e, fetch: F.fetchFalso([{ status: 404, json: { message: 'Not Found' } }]) });
  assert.deepEqual([recusa.codigo, recusa.httpStatus], ['ia-executor-recusou', 404]);
  const fora = await dispararFluxo({ config: EXECUTOR(GH), env, entradas: e, fetch: async () => { throw new Error('rede'); } });
  assert.equal(fora.codigo, 'ia-executor-inacessivel');
});

test('POST /api/ia disparar: só o superadmin; confere o pedido; 202 com o que foi enviado e nunca o token', async () => {
  const env = ambiente({ GITHUB_DISPATCH_TOKEN: 'ghp_segredo_do_worker' });
  const m = await mundo({ config: Object.assign({ acesso: { modo: 'publico' } }, F.configIA(EXECUTOR(GH))), env });
  const equipe = await m.conta('maria', ['conteudo']);
  const gh = trocarFetchGlobal(() => new Response(null, { status: 204 }));
  try {
    assert.equal((await m.chamar('POST', '/api/ia', equipe, { acao: 'disparar', tarefa: 'trailer', ids: ['horta'] })).status, 403);
    assert.equal(gh.chamadas.length, 0);
    assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'disparar', tarefa: 'formatar-disco', ids: ['horta'] })).status, 400);
    assert.equal((await m.chamar('POST', '/api/ia', m.sup, { acao: 'disparar', tarefa: 'trailer', ids: [] })).status, 400);
    assert.equal(gh.chamadas.length, 0, 'pedido inválido não chega ao GitHub');

    const ok = await m.chamar('POST', '/api/ia', m.sup, { acao: 'disparar', tarefa: 'trailer', ids: ['horta'] });
    assert.equal(ok.status, 202, ok.texto);
    assert.equal(ok.texto.includes('ghp_segredo_do_worker'), false);
    assert.equal(gh.chamadas.length, 1);
    assert.deepEqual(gh.chamadas[0].corpo.inputs, { tarefa: 'trailer', ids: 'horta', usar_ia: 'nao' });
    const retrato = await m.chamar('GET', '/api/ia', m.sup);
    assert.equal(retrato.json.executor.github.pronto, true);
    assert.equal(retrato.texto.includes('ghp_segredo_do_worker'), false);
  } finally { gh.restaurar(); }
});

test('POST /api/ia disparar: com o executor desligado (o padrão) responde 409 e não chama o GitHub', async () => {
  const m = await mundo({ env: ambiente({ GITHUB_DISPATCH_TOKEN: 'ghp_x' }) });
  const gh = trocarFetchGlobal(() => new Response(null, { status: 204 }));
  try {
    const r = await m.chamar('POST', '/api/ia', m.sup, { acao: 'disparar', tarefa: 'trailer', ids: ['horta'] });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, 'ia-executor-desligado');
    assert.equal(gh.chamadas.length, 0);
  } finally { gh.restaurar(); }
});

/* ------------------------------------------------------------------ o fluxo do GitHub Actions */

const FLUXO = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'gerar-midia.yml'), 'utf8');

test('gerar-midia.yml: só dispara à mão, só roda ligado, permissões mínimas, entradas via env (sem injeção) e ffmpeg do executor', () => {
  assert.match(FLUXO, /workflow_dispatch:/);
  assert.doesNotMatch(FLUXO, /\n\s*(push|pull_request|pull_request_target|schedule|issue_comment):/);
  assert.match(FLUXO, /vars\.IA_EXECUTOR_LIGADO == 'true'/);
  assert.match(FLUXO, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(FLUXO, /run:[^\n]*\$\{\{\s*(github\.event\.)?inputs\./, 'nenhuma entrada interpolada direto em comando');
  assert.match(FLUXO, /INPUT_TAREFA: \$\{\{ inputs\.tarefa \}\}/);
  assert.match(FLUXO, /apt-get install[^\n]*ffmpeg/);
  assert.match(FLUXO, /ia-textos\.mjs/);
  assert.match(FLUXO, /ia-transcrever\.mjs/);
  assert.match(FLUXO, /trailer\.mjs/);
  assert.match(FLUXO, /capas\.mjs/);
  assert.match(FLUXO, /--yes/);
});

test('gerar-midia.yml: nenhum segredo escrito no arquivo, só referências a secrets.*', () => {
  assert.doesNotMatch(FLUXO, /(sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,})/);
  for (const nome of ['APP_SENHA', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ASSEMBLYAI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    assert.match(FLUXO, new RegExp(nome + ': \\$\\{\\{ secrets\\.' + nome + ' \\}\\}'), nome);
  }
});

test('REGRESSÃO: o disparo pelo /admin manda usar_ia explícito ("nao" por padrão; "sim" só com usarIa: true)', async () => {
  const { entradasDoFluxo } = await import('../core/worker/_lib/ia/index.js');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: ['a'] }).entradas.usar_ia, 'nao');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: ['a'], usarIa: 'sim' }).entradas.usar_ia, 'nao');
  assert.equal(entradasDoFluxo({ tarefa: 'trailer', ids: ['a'], usarIa: true }).entradas.usar_ia, 'sim');
});

test('REGRESSÃO: scripts/sinopses.mjs não depende do SDK nem grava no catálogo; o fluxo tem usar_ia padrão "nao"', () => {
  const fs = require('node:fs');
  const s = fs.readFileSync(require('node:path').join(__dirname, '../scripts/sinopses.mjs'), 'utf8');
  assert.doesNotMatch(s, /import .*anthropic|claude-opus|gravarCatalogo/);
  assert.match(s, /ia:textos/);
  const y = fs.readFileSync(require('node:path').join(__dirname, '../.github/workflows/gerar-midia.yml'), 'utf8');
  assert.match(y, /usar_ia:[\s\S]*?default: 'nao'/);
});
