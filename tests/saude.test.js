/* M8 — a tela Saúde: GET /api/saude (equipe). O que se confere:
 *   - o retrato traz só NOMES de segredo e "presente ou não"; nenhum valor sai, em nenhuma resposta;
 *   - cada falha tem um código estável (o navegador traduz) e quem pode vê-lo (equipe) ou só o superadmin;
 *   - o teste de credencial só roda com ?testar=1 e devolve a mensagem curta do adaptador;
 *   - a versão nova vem do GitHub só quando pedida, fica guardada por horas e tolera falha de rede;
 *   - o estado do assistente (pendente, concluído, dispensado) é do superadmin. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper, fetchFalso, kvEmMemoria, SEGREDO } = require('./fixtures/contas-ambiente.js');

const mod = (nome) => import('../core/worker/' + nome);
const VALORES_SECRETOS = { ADMIN_PASSWORD: 'senha-do-super', BUNNY_API_KEY: 'chave-secreta-do-bunny-0123', BUNNY_LIBRARY_ID: '987654', TURNSTILE_SECRET: 'turnstile-segredo-abcdef' };

function ambienteDeSaude(extra) {
  return ambiente(Object.assign({ BUNNY_API_KEY: VALORES_SECRETOS.BUNNY_API_KEY, BUNNY_LIBRARY_ID: VALORES_SECRETOS.BUNNY_LIBRARY_ID }, extra || {}));
}

async function equipeEToken(worker, env, tokenSuper) {
  const c = cliente(worker, env);
  const criada = await c.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token: tokenSuper });
  assert.equal(criada.status, 200, criada.texto);
  const r = await c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' });
  return r.json.token;
}

const achar = (saude, id) => saude.checagens.find((x) => x.id === id);

test('o retrato de saúde: só nomes de segredo e "presente"; nenhum valor sai em nenhuma resposta', async () => {
  const env = ambienteDeSaude({ TURNSTILE_SECRET: VALORES_SECRETOS.TURNSTILE_SECRET });
  const worker = await criarWorker(configDe({ modo: 'cadastro' }, { video: { provedor: 'bunny' } }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const r = await c.get('/api/saude', { token });
  assert.equal(r.status, 200, r.texto);
  const nomes = r.json.segredos.map((s) => s.nome);
  for (const n of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'TURNSTILE_SECRET']) assert.ok(nomes.includes(n), 'falta o nome ' + n);
  assert.equal(r.json.segredos.find((s) => s.nome === 'BUNNY_API_KEY').presente, true);
  assert.equal(r.json.segredos.find((s) => s.nome === 'BUNNY_API_KEY').secreta, true);
  assert.equal(r.json.segredos.find((s) => s.nome === 'BUNNY_LIBRARY_ID').secreta, false, 'o id da biblioteca não é senha');
  for (const [nome, valor] of Object.entries(VALORES_SECRETOS)) assert.ok(!r.texto.includes(valor), nome + ' vazou na resposta');
  assert.ok(!r.texto.includes(SEGREDO), 'SESSION_SECRET vazou');
  assert.ok(!r.texto.includes('senha-do-super'));
});

test('a equipe vê a saúde; o anônimo não; o assistente e as contas dele são só do superadmin', async () => {
  const env = ambienteDeSaude();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const tSuper = await tokenDoSuper(worker, env);
  const tEquipe = await equipeEToken(worker, env, tSuper);
  const c = cliente(worker, env);
  assert.equal((await c.get('/api/saude')).status, 401);
  assert.equal((await c.get('/api/saude', { token: tEquipe })).status, 200);
  assert.equal((await c.get('/api/saude?assistente=1', { token: tEquipe })).status, 403);
  assert.equal((await c.post('/api/saude', { acao: 'marca' }, { token: tEquipe })).status, 403);
  assert.equal((await c.put('/api/saude', { assistente: 'concluido' }, { token: tEquipe })).status, 403);
  assert.equal((await c.get('/api/saude?assistente=1', { token: tSuper })).status, 200);
});

test('cada falha tem um código estável: segredos que faltam, sessão curta, senha igual à chave', async () => {
  const { montarSaude } = await mod('_lib/saude.js');
  const base = { config: { acesso: { modo: 'privado' }, video: { provedor: 'bunny' } }, data: {}, modo: 'privado' };

  const semNada = await montarSaude(Object.assign({ env: { CATALOGO: kvEmMemoria({}) } }, base));
  assert.equal(achar(semNada, 'admin-senha').codigo, 'admin-senha-falta');
  assert.equal(achar(semNada, 'sessao').codigo, 'sessao-falta');
  assert.equal(achar(semNada, 'video-credenciais').codigo, 'video-credenciais-faltam');
  assert.match(achar(semNada, 'video-credenciais').params.nomes, /BUNNY_API_KEY/);
  assert.equal(achar(semNada, 'video-conexao').estado, 'pulado');
  assert.equal(achar(semNada, 'd1').codigo, 'd1-ausente', 'modo privado guarda contas no D1');
  assert.ok(semNada.resumo.erro >= 4);

  const curta = await montarSaude(Object.assign({ env: { CATALOGO: kvEmMemoria({}), ADMIN_PASSWORD: 'uma-senha-qualquer', SESSION_SECRET: 'curta' } }, base));
  assert.equal(achar(curta, 'sessao').codigo, 'sessao-curta');

  const igual = 'a'.repeat(40);
  const iguais = await montarSaude(Object.assign({ env: { CATALOGO: kvEmMemoria({}), ADMIN_PASSWORD: igual, SESSION_SECRET: igual } }, base));
  assert.equal(achar(iguais, 'sessao').codigo, 'sessao-igual-a-senha');
});

test('modo público dispensa o D1 e a assinatura; modo restrito com HLS genérico é erro', async () => {
  const { montarSaude } = await mod('_lib/saude.js');
  const env = { CATALOGO: kvEmMemoria({}), ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) };
  const publico = await montarSaude({ env, config: { acesso: { modo: 'publico' }, video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: 'https://v.exemplo.test/a' } } }, data: {}, modo: 'publico' });
  assert.equal(achar(publico, 'd1').estado, 'ok');
  assert.equal(achar(publico, 'video-assinatura'), undefined);
  const privado = await montarSaude({ env, config: { acesso: { modo: 'privado' }, video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: 'https://v.exemplo.test/a' } } }, data: {}, modo: 'privado' });
  assert.equal(achar(privado, 'video-assinatura').codigo, 'video-assinatura-impossivel');
});

test('modo cadastro sem o segredo do Turnstile avisa; com segredo e chave pública fica ok', async () => {
  const { montarSaude } = await mod('_lib/saude.js');
  const base = { config: { acesso: { modo: 'cadastro' }, video: { provedor: 'bunny' } }, data: {}, modo: 'cadastro' };
  const env = { CATALOGO: kvEmMemoria({}), ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) };
  assert.equal(achar(await montarSaude(Object.assign({ env }, base)), 'turnstile').codigo, 'turnstile-sem-segredo');
  const meio = await montarSaude(Object.assign({ env: Object.assign({ TURNSTILE_SECRET: 'segredo-do-turnstile' }, env) }, base));
  assert.equal(achar(meio, 'turnstile').codigo, 'turnstile-sem-chave-publica');
  const ok = await montarSaude(Object.assign({ env: Object.assign({ TURNSTILE_SECRET: 'segredo-do-turnstile', TURNSTILE_SITE_KEY: '0x4AAAAAAAchavepublica' }, env) }, base));
  assert.equal(achar(ok, 'turnstile').estado, 'ok');
});

test('o teste de credencial só roda com ?testar=1, e diz a mensagem curta do provedor', async () => {
  const env = ambienteDeSaude();
  const worker = await criarWorker(configDe({ modo: 'publico' }, { video: { provedor: 'bunny' } }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);

  const sem = await fetchFalso({});
  try {
    const r = await c.get('/api/saude', { token });
    assert.equal(achar(r.json, 'video-conexao').codigo, 'video-conexao-nao-testada');
    assert.equal(sem.chamadas.length, 0, 'sem ?testar não pode haver chamada de rede');
  } finally { sem.restaurar(); }

  const recusa = await fetchFalso({ 'https://video.bunnycdn.com': () => new Response('{}', { status: 401 }) });
  try {
    const r = await c.get('/api/saude?testar=1', { token });
    const t = achar(r.json, 'video-conexao');
    assert.equal(t.codigo, 'video-conexao-recusou');
    assert.equal(t.params.codigo, 'credenciais-recusadas');
    assert.ok(!r.texto.includes(VALORES_SECRETOS.BUNNY_API_KEY), 'a chave não pode aparecer na mensagem');
  } finally { recusa.restaurar(); }

  const aceita = await fetchFalso({ 'https://video.bunnycdn.com': () => ({ items: [], totalItems: 0 }) });
  try {
    const r = await c.get('/api/saude?testar=1', { token });
    assert.equal(achar(r.json, 'video-conexao').codigo, 'video-conexao-ok');
  } finally { aceita.restaurar(); }
});

test('versão: só vai à rede com ?versao=1, guarda por horas, tolera falha e compara versões', async () => {
  const { compararVersoes, ultimaVersaoPublicada, VERSAO_DO_CORE, CHAVE_ULTIMA_VERSAO } = await mod('_lib/saude.js');
  assert.equal(compararVersoes('1.2.3', 'v1.10.0'), -1);
  assert.equal(compararVersoes('1.2.3', '1.2.3-rc.1'), 0);
  assert.equal(compararVersoes('2.0.0', '1.99.99'), 1);
  assert.equal(compararVersoes('abc', '1.0.0'), null);

  const env = ambienteDeSaude();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const [maior] = VERSAO_DO_CORE.split('.');
  const nova = `${Number(maior) + 1}.0.0`;

  const rede = await fetchFalso({ 'https://api.github.com/repos/': () => ({ tag_name: 'v' + nova, html_url: 'https://github.com/o/r/releases/tag/v' + nova }) });
  try {
    const sem = await c.get('/api/saude', { token });
    assert.equal(sem.json.versao.nova, false, 'sem ?versao e sem cache, não há o que avisar');
    assert.equal(rede.chamadas.length, 0);
    const com = await c.get('/api/saude?versao=1', { token });
    assert.equal(rede.chamadas.length, 1);
    assert.equal(com.json.versao.nova, true);
    assert.equal(com.json.versao.ultima.versao, nova);
    assert.equal(achar(com.json, 'versao').codigo, 'versao-nova');
    await c.get('/api/saude?versao=1', { token });
    assert.equal(rede.chamadas.length, 1, 'a segunda vez sai do cache de horas');
    /* e o GET comum já mostra o aviso, vindo do cache */
    assert.equal((await c.get('/api/saude', { token })).json.versao.nova, true);
  } finally { rede.restaurar(); }

  /* rede fora: não é erro, só não há aviso */
  const kv = kvEmMemoria({});
  const falha = await fetchFalso({ 'https://api.github.com/repos/': () => { throw new Error('sem rede'); } });
  try {
    const r = await ultimaVersaoPublicada({ CATALOGO: kv });
    assert.equal(r.ok, false);
    const guardado = JSON.parse(kv.dados[CHAVE_ULTIMA_VERSAO]);
    assert.equal(guardado.ok, false, 'a falha também fica guardada: não martelar a API');
  } finally { falha.restaurar(); }
  const torta = await fetchFalso({ 'https://api.github.com/repos/': () => new Response('<html>', { status: 200 }) });
  try { assert.equal((await ultimaVersaoPublicada({ CATALOGO: kvEmMemoria({}) })).ok, false); } finally { torta.restaurar(); }
  const limite = await fetchFalso({ 'https://api.github.com/repos/': () => new Response('{}', { status: 403 }) });
  try { assert.equal((await ultimaVersaoPublicada({ CATALOGO: kvEmMemoria({}) })).motivo, 'http-403'); } finally { limite.restaurar(); }
  /* tag que não é versão, ou link de fora do GitHub, não vira aviso */
  const estranha = await fetchFalso({ 'https://api.github.com/repos/': () => ({ tag_name: 'nightly', html_url: 'https://exemplo.test/x' }) });
  try { assert.equal((await ultimaVersaoPublicada({ CATALOGO: kvEmMemoria({}) })).ok, false); } finally { estranha.restaurar(); }
  const linkFalso = await fetchFalso({ 'https://api.github.com/repos/': () => ({ tag_name: 'v9.0.0', html_url: 'https://golpe.exemplo.test/baixe' }) });
  try { assert.match((await ultimaVersaoPublicada({ CATALOGO: kvEmMemoria({}) })).url, /^https:\/\/github\.com\//); } finally { linkFalso.restaurar(); }
});

test('backup: nunca feito é aviso; recente é ok; passou de 48 h é aviso com as horas', async () => {
  const { montarSaude, CHAVE_ULTIMO_BACKUP } = await mod('_lib/saude.js');
  const agora = Date.parse('2026-10-02T12:00:00Z');
  const mk = (em) => ({ env: { CATALOGO: kvEmMemoria(em ? { [CHAVE_ULTIMO_BACKUP]: JSON.stringify({ em, origem: 'admin' }) } : {}), ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) }, config: { acesso: { modo: 'publico' } }, data: {}, modo: 'publico', agora });
  assert.equal(achar(await montarSaude(mk(null)), 'backup').codigo, 'backup-nunca');
  assert.equal(achar(await montarSaude(mk('2026-10-02T06:00:00Z')), 'backup').codigo, 'backup-recente');
  const velho = achar(await montarSaude(mk('2026-09-29T12:00:00Z')), 'backup');
  assert.equal(velho.codigo, 'backup-velho');
  assert.equal(velho.params.horas, 72);
  assert.equal(achar(await montarSaude(mk('lixo')), 'backup').codigo, 'backup-nunca');
});

test('catálogo grande avisa do corte de CPU; catálogo vazio avisa para enviar o primeiro título', async () => {
  const { montarSaude, BYTES_DE_CATALOGO_QUE_PEDE_ATENCAO } = await mod('_lib/saude.js');
  const base = { config: { acesso: { modo: 'publico' } }, data: {}, modo: 'publico' };
  const envCom = (doc) => ({ CATALOGO: kvEmMemoria(doc ? { catalogo: JSON.stringify(doc) } : {}), ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) });
  assert.equal(achar(await montarSaude(Object.assign({ env: envCom(null) }, base)), 'catalogo').codigo, 'catalogo-vazio');
  assert.equal(achar(await montarSaude(Object.assign({ env: envCom({ rev: 1, itens: [] }) }, base)), 'catalogo').codigo, 'catalogo-vazio');
  const ok = await montarSaude(Object.assign({ env: envCom({ rev: 1, itens: [{ id: 'a', publicar: true }, { id: 'b' }] }) }, base));
  assert.deepEqual(achar(ok, 'catalogo').params, { n: 2, noAr: 1 });
  assert.equal(achar(ok, 'catalogo-tamanho'), undefined);
  const grande = await montarSaude(Object.assign({ env: envCom({ rev: 1, itens: [{ id: 'a', sinopse: 'x'.repeat(BYTES_DE_CATALOGO_QUE_PEDE_ATENCAO) }] }) }, base));
  assert.equal(achar(grande, 'catalogo-tamanho').codigo, 'catalogo-grande');
});

test('KV fora do ar ou sem vínculo é erro; config de emergência é erro e traz a contagem', async () => {
  const { montarSaude } = await mod('_lib/saude.js');
  const base = { config: { acesso: { modo: 'privado' }, _estado: { valido: false, erros: [{}, {}] } }, data: {}, modo: 'privado' };
  const semKv = await montarSaude(Object.assign({ env: { ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) } }, base));
  assert.equal(achar(semKv, 'kv').codigo, 'kv-ausente');
  assert.deepEqual(achar(semKv, 'config').params, { n: 2 });
  const quebrado = await montarSaude(Object.assign({ env: { CATALOGO: { get: async () => { throw new Error('KV fora'); } }, ADMIN_PASSWORD: 'x'.repeat(14), SESSION_SECRET: 'y'.repeat(40) } }, base));
  assert.equal(achar(quebrado, 'kv').codigo, 'kv-falhou');
});

test('o estado do assistente: pendente por padrão; o superadmin conclui, dispensa e reabre', async () => {
  const env = ambienteDeSaude();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  assert.equal((await c.get('/api/saude', { token })).json.assistente.estado, 'pendente');
  for (const estado of ['concluido', 'dispensado', 'pendente']) {
    const r = await c.put('/api/saude', { assistente: estado }, { token });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await c.get('/api/saude', { token })).json.assistente.estado, estado);
  }
  assert.equal((await c.put('/api/saude', { assistente: 'qualquer' }, { token })).status, 400);
  assert.equal((await c.put('/api/saude', {}, { token })).status, 400);
});

test('erros da rota: corpo que não é JSON, ação desconhecida; tudo com código traduzível', async () => {
  const env = ambienteDeSaude();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const torto = await worker.fetch(new Request('https://exemplo.test/api/saude', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', origin: 'https://exemplo.test' }, body: '{nao-json' }), env, { waitUntil() {} });
  assert.equal(torto.status, 400);
  assert.equal((await torto.json()).codigo, 'corpo-invalido');
  assert.equal((await c.post('/api/saude', { acao: 'inventada' }, { token })).json.codigo, 'acao-invalida');
});
