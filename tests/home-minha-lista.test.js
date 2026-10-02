/* M6 — "Minha lista" por espectador (D1): só com conta, sempre a DE QUEM PEDE, com teto, índice e LGPD.
 * Worker de verdade, D1 em memória (node:sqlite), sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper, tokenDoLink, ACEITE } = require('./fixtures/contas-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const mod = (nome) => import('../core/worker/' + nome);

async function montar(config) {
  const worker = await criarWorker(config || configDe({ modo: 'privado' }));
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  return { worker, env, sup };
}

async function espectador(worker, env, sup, email, ip) {
  const c = cliente(worker, env, { ip: ip || '203.0.113.' + (20 + Math.floor(Math.random() * 200)) });
  const conv = await c.post('/api/convites', { email, enviar: false }, { token: sup });
  assert.equal(conv.status, 200, conv.texto);
  const r = await c.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()));
  assert.equal(r.status, 200, r.texto);
  return c;
}

const usuarioId = (env, email) => env.DB.consultar('SELECT id FROM usuarios WHERE email = ?', email)[0].id;

test('a migração 0002 existe, cria a tabela e o índice, e a criação preguiçosa a aplica', async () => {
  const { garantirBanco } = await mod('_lib/contas-banco.js');
  const env = ambiente();
  await garantirBanco(env);
  const tabelas = env.DB.consultar("SELECT name FROM sqlite_master WHERE type = 'table'").map((l) => l.name);
  assert.ok(tabelas.includes('minha_lista'));
  const indices = env.DB.consultar("SELECT name FROM sqlite_master WHERE type = 'index'").map((l) => l.name);
  assert.ok(indices.includes('minha_lista_recentes'));
  assert.ok(fs.existsSync(path.join(RAIZ, 'core', 'migrations', '0002_minha_lista.sql')));
});

test('anônimo não entra (401) e a equipe não tem lista (403): ela é de quem tem conta de espectador', async () => {
  const { worker, env, sup } = await montar();
  const anonimo = cliente(worker, env);
  for (const [metodo, corpo] of [['get'], ['post', { id: 'a' }], ['delete']]) {
    const r = await anonimo[metodo]('/api/minha-lista', ...(corpo ? [corpo] : []));
    assert.equal(r.status, 401, metodo);
  }
  const c = cliente(worker, env);
  const equipe = await c.get('/api/minha-lista', { token: sup });
  assert.equal(equipe.status, 403);
  assert.equal(equipe.json.codigo, 'conta-de-equipe');
  assert.equal((await c.post('/api/minha-lista', { id: 'a' }, { token: sup })).status, 403);
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM minha_lista')[0].n, 0, 'a equipe gravou na lista');
});

test('guardar, listar do mais novo ao mais velho, guardar de novo põe na frente, tirar por query ou por corpo', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  assert.deepEqual((await ana.get('/api/minha-lista')).json, { ids: [] });

  /* O relógio do banco é em segundos: força tempos distintos para a ordem ser determinística. */
  for (const [id, quando] of [['um', 100], ['dois', 200], ['tres', 300]]) {
    assert.equal((await ana.post('/api/minha-lista', { id })).status, 200);
    env.DB.bruto.prepare('UPDATE minha_lista SET adicionado_em = ? WHERE titulo_id = ?').run(quando, id);
  }
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids, ['tres', 'dois', 'um']);

  /* De novo: não duplica, e vai para a frente. */
  assert.equal((await ana.post('/api/minha-lista', { id: 'um' })).status, 200);
  const linhas = env.DB.consultar('SELECT titulo_id FROM minha_lista');
  assert.equal(linhas.length, 3, 'guardar o mesmo título duplicou a linha');
  assert.equal((await ana.get('/api/minha-lista')).json.ids[0], 'um');

  assert.equal((await ana.delete('/api/minha-lista?id=dois')).status, 200);
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids.sort(), ['tres', 'um']);
  assert.equal((await ana.delete('/api/minha-lista', { corpo: { id: 'um' } })).status, 200);
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids, ['tres']);
  /* Tirar o que não está na lista é inofensivo. */
  assert.equal((await ana.delete('/api/minha-lista?id=nao-esta')).status, 200);
});

test('cada pessoa vê e mexe só na própria lista — não existe parâmetro de pessoa', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  const bia = await espectador(worker, env, sup, 'bia@exemplo.com');
  await ana.post('/api/minha-lista', { id: 'da-ana' });
  await bia.post('/api/minha-lista', { id: 'da-bia' });
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids, ['da-ana']);
  assert.deepEqual((await bia.get('/api/minha-lista')).json.ids, ['da-bia']);

  /* Tentar apontar para a lista da outra: o parâmetro é ignorado. */
  const idDaAna = usuarioId(env, 'ana@exemplo.com');
  assert.deepEqual((await bia.get('/api/minha-lista?usuario=' + idDaAna + '&usuario_id=' + idDaAna)).json.ids, ['da-bia']);
  await bia.post('/api/minha-lista', { id: 'x', usuario_id: idDaAna });
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids, ['da-ana'], 'a bia escreveu na lista da ana');
  /* Tirar o título de mesmo nome não mexe na lista de ninguém além da própria. */
  await bia.delete('/api/minha-lista?id=da-ana');
  assert.deepEqual((await ana.get('/api/minha-lista')).json.ids, ['da-ana']);
});

test('id inválido é 400; lista cheia é 409 `minha-lista-cheia` (e reguardar um que já está não conta)', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  const uid = usuarioId(env, 'ana@exemplo.com');
  for (const id of ['', ' '.repeat(0), 'x'.repeat(201), 'com\nquebra', 'com\u0000nulo', 7, null, { a: 1 }]) {
    const r = await ana.post('/api/minha-lista', { id });
    assert.equal(r.status, 400, JSON.stringify(id));
    assert.equal(r.json.codigo, 'id-invalido');
  }
  assert.equal((await ana.post('/api/minha-lista', {})).status, 400);

  const { LIMITE_MINHA_LISTA } = await mod('_lib/contas.js');
  const inserir = env.DB.bruto.prepare('INSERT INTO minha_lista (usuario_id, titulo_id, adicionado_em) VALUES (?, ?, ?)');
  for (let i = 0; i < LIMITE_MINHA_LISTA; i++) inserir.run(uid, 't' + i, i);
  const cheia = await ana.post('/api/minha-lista', { id: 'um-a-mais' });
  assert.equal(cheia.status, 409);
  assert.equal(cheia.json.codigo, 'minha-lista-cheia');
  assert.equal((await ana.post('/api/minha-lista', { id: 't5' })).status, 200, 'reguardar um título que já está na lista foi recusado');
  assert.equal((await ana.get('/api/minha-lista')).json.ids.length, LIMITE_MINHA_LISTA);
  assert.equal((await ana.delete('/api/minha-lista?id=t7')).status, 200);
  assert.equal((await ana.post('/api/minha-lista', { id: 'um-a-mais' })).status, 200, 'tirar um título não abriu espaço');
});

test('recursos.minhaLista: false desliga a rota (404) e o modo público sem conta também não a abre', async () => {
  const { worker, env, sup } = await montar(configDe({ modo: 'privado' }, { recursos: { minhaLista: false } }));
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  assert.equal((await ana.get('/api/minha-lista')).status, 404);
  assert.equal((await ana.post('/api/minha-lista', { id: 'a' })).status, 404);

  const pub = await montar(configDe({ modo: 'publico' }));
  assert.equal((await cliente(pub.worker, pub.env).get('/api/minha-lista')).status, 401, 'no modo público, sem sessão não há lista');
});

test('CSRF: um POST vindo de outro site, com o cookie, vale como anônimo e não escreve', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  const r = await ana.post('/api/minha-lista', { id: 'forjado' }, { cabecalhos: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 401);
  const r2 = await ana.post('/api/minha-lista', { id: 'forjado' }, { cabecalhos: { origin: 'https://atacante.example' } });
  assert.ok(r2.status === 401 || r2.status === 403, String(r2.status));
  const r3 = await ana.delete('/api/minha-lista?id=x', { cabecalhos: { origin: 'https://atacante.example' } });
  assert.ok(r3.status === 401 || r3.status === 403, String(r3.status));
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM minha_lista')[0].n, 0);
});

test('custo no D1: a leitura da lista usa o índice e tem LIMIT; guardar são poucas consultas por chave', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  await ana.post('/api/minha-lista', { id: 'a' });
  env.DB.chamadas.length = 0;
  assert.equal((await ana.get('/api/minha-lista')).status, 200);
  const selects = env.DB.chamadas.filter((x) => /minha_lista/i.test(x.sql));
  assert.equal(selects.length, 1, 'a leitura da lista deve ser UMA consulta');
  assert.match(selects[0].sql, /LIMIT/i, 'a leitura da lista não tem teto de linhas');
  const plano = env.DB.explicar(selects[0].sql, selects[0].params);
  for (const linha of plano) {
    assert.match(linha, /^SEARCH /, 'varredura de tabela: ' + linha);
    assert.match(linha, /PRIMARY KEY|USING INDEX|USING COVERING INDEX/, 'sem índice: ' + linha);
  }
  assert.ok(!plano.some((l) => /TEMP B-TREE/.test(l)), 'a ordenação não usa o índice: ' + plano.join(' | '));

  env.DB.chamadas.length = 0;
  await ana.post('/api/minha-lista', { id: 'b' });
  const guardar = env.DB.chamadas.filter((x) => /minha_lista/i.test(x.sql));
  assert.ok(guardar.length <= 3, 'guardar um título fez ' + guardar.length + ' consultas');
  for (const q of guardar) {
    for (const linha of env.DB.explicar(q.sql, q.params).filter((l) => /minha_lista/.test(l))) {
      assert.ok(!/^SCAN /.test(linha), 'varredura em ' + q.sql + ': ' + linha);
    }
  }
});

test('LGPD: exportar inclui a lista, e excluir a conta apaga as linhas dela (e só as dela)', async () => {
  const { worker, env, sup } = await montar();
  const ana = await espectador(worker, env, sup, 'ana@exemplo.com');
  const bia = await espectador(worker, env, sup, 'bia@exemplo.com');
  await ana.post('/api/minha-lista', { id: 'a1' });
  await ana.post('/api/minha-lista', { id: 'a2' });
  await bia.post('/api/minha-lista', { id: 'b1' });

  const exp = (await ana.get('/api/conta/exportar')).json;
  assert.deepEqual(exp.minhaLista.map((l) => l.titulo).sort(), ['a1', 'a2']);
  assert.ok(exp.minhaLista.every((l) => typeof l.adicionadoEm === 'number'));
  assert.ok(!JSON.stringify(exp).includes('b1'), 'a exportação trouxe título da lista de outra pessoa');

  const del = await ana.post('/api/conta/excluir', { email: 'ana@exemplo.com' });
  assert.equal(del.status, 200, del.texto);
  assert.deepEqual(env.DB.consultar('SELECT titulo_id FROM minha_lista').map((l) => l.titulo_id), ['b1']);
});

test('o front: o botão é um clique (nada toca vídeo), otimista com volta atrás, e só existe com conta', () => {
  const app = fs.readFileSync(path.join(RAIZ, 'core', 'site', 'app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const corpo = app.match(/function botaoMinhaLista\(id\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei botaoMinhaLista');
  assert.match(corpo[1], /minhaListaDisponivel\(\)/, 'o botão aparece sem conta');
  assert.match(corpo[1], /estado\.minhaLista = antes/, 'sem volta atrás quando o servidor recusa');
  assert.match(corpo[1], /method: 'POST'/);
  assert.match(corpo[1], /method: 'DELETE'/);
  assert.ok(!/\.play\(/.test(corpo[1]), 'o botão da lista toca vídeo');
  assert.match(app, /function minhaListaDisponivel\(\)[^\n]*estado\.quem\.espectador === true/, 'a lista não exige conta de espectador');
});
