/* O D1 das contas (M5): migrações, criação preguiçosa, migração da equipe do KV, custo por
 * requisição (linhas lidas, com EXPLAIN QUERY PLAN) e retenção. Banco de verdade (node:sqlite),
 * sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, cliente, kvEmMemoria, tokenDoSuper, tokenDoLink, ACEITE, criarD1Falso } = require('./fixtures/contas-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const mod = (nome) => import('../core/worker/' + nome);
const migracoes = () => import('../core/migrations/indice.mjs');

const CONFIG = configDe({ modo: 'privado' });

test('as migrações .sql e o indice.mjs (o que o Worker aplica) dizem a mesma coisa', async () => {
  const { MIGRACOES } = await migracoes();
  const dir = path.join(RAIZ, 'core', 'migrations');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(MIGRACOES.map((m) => m.nome), arquivos, 'toda migração .sql precisa de uma entrada em indice.mjs, na mesma ordem');
  for (const m of MIGRACOES) {
    assert.equal(m.sql, fs.readFileSync(path.join(dir, m.nome), 'utf8'), m.nome + ' diverge do indice.mjs');
  }
});

test('criação preguiçosa: o primeiro acesso cria as tabelas e os índices, o segundo não refaz nada', async () => {
  const { garantirBanco } = await mod('_lib/contas-banco.js');
  const env = ambiente();
  assert.deepEqual(env.DB.consultar("SELECT name FROM sqlite_master WHERE type = 'table'"), [], 'o banco nasce vazio');
  await garantirBanco(env);
  const tabelas = env.DB.consultar("SELECT name FROM sqlite_master WHERE type = 'table'").map((l) => l.name);
  for (const t of ['usuarios', 'sessoes', 'convites', 'links_magicos', 'consentimentos', 'limites', 'documentos', 'meta', 'd1_migrations']) {
    assert.ok(tabelas.includes(t), 'falta a tabela ' + t);
  }
  const antes = env.DB.chamadas.length;
  await garantirBanco(env);
  await garantirBanco(env);
  assert.equal(env.DB.chamadas.length, antes, 'a segunda chamada não deve tocar o banco');
  /* Convive com o `wrangler d1 migrations apply`: mesma tabela de controle e mesmo nome. */
  assert.deepEqual(env.DB.consultar('SELECT name FROM d1_migrations').map((l) => l.name), ['0001_inicial.sql']);
});

test('sem binding DB não há banco: garantirBanco devolve null e o espectador fica 503 (falha fechada)', async () => {
  const { garantirBanco, temBanco } = await mod('_lib/contas-banco.js');
  const env = ambiente({ DB: undefined });
  assert.equal(temBanco(env), false);
  assert.equal(await garantirBanco(env), null);
  const worker = await criarWorker(CONFIG);
  const c = cliente(worker, env);
  assert.equal((await c.post('/api/auth/entrar', { email: 'a@exemplo.com' })).status, 503);
  assert.equal((await c.post('/api/auth/entrar', { email: 'a@exemplo.com' })).json.codigo, 'banco-ausente');
});

test('migração da equipe: as contas do KV entram no D1 na primeira execução, uma vez só, com a mesma versão', async () => {
  const { garantirBanco } = await mod('_lib/contas-banco.js');
  const { equipeAchar, equipeListar } = await mod('_lib/contas.js');
  const sess = await mod('_lib/sessao.js');
  const senha = await sess.hashSenha('senha-bem-comprida', 1000);
  const kv = kvEmMemoria({
    admins: JSON.stringify({ contas: [
      { usuario: 'maria', nome: 'Maria', permissoes: ['conteudo', 'no-ar'], ativa: true, versao: 3, limiteEnvio: { maxVideos: 2 }, enviosContagem: 1, senha, criada_em: '2026-01-02T03:04:05.000Z', criada_por: 'superadmin' },
      { usuario: 'joao', nome: 'João', permissoes: [], ativa: false, versao: 1, senha }
    ] })
  });
  const env = ambiente({ CATALOGO: kv });
  await garantirBanco(env);
  const lista = await equipeListar(env);
  assert.deepEqual(lista.map((c) => c.usuario).sort(), ['joao', 'maria']);
  const maria = await equipeAchar(env, 'maria');
  assert.equal(maria.versao, 3, 'a versão preserva o token já emitido');
  assert.deepEqual(maria.permissoes, ['conteudo', 'no-ar']);
  assert.deepEqual(maria.limiteEnvio, { maxVideos: 2 });
  assert.equal(maria.enviosContagem, 1);
  assert.equal(maria.ativa, true);
  assert.equal((await equipeAchar(env, 'joao')).ativa, false);
  assert.equal(maria.criada_em, '2026-01-02T03:04:05.000Z');
  assert.equal(await sess.conferirSenha('senha-bem-comprida', maria.senha), true, 'o hash da senha vem junto');

  /* Não importa de novo: uma conta nova no KV depois do marcador é ignorada. */
  await kv.put('admins', JSON.stringify({ contas: [{ usuario: 'intrusa', nome: 'X', permissoes: [], versao: 1, senha }] }));
  const env2 = Object.assign({}, env);   /* mesmo DB, outro "isolate" */
  const { garantirBanco: g2 } = await mod('_lib/contas-banco.js');
  await g2(env2);
  assert.equal(await equipeAchar(env, 'intrusa'), null);
  assert.equal(env.DB.consultar("SELECT valor FROM meta WHERE chave = 'equipe-importada-do-kv'").length, 1);
  /* A cópia do KV fica como estava (cópia de segurança). */
  assert.ok(JSON.parse(kv.dados.admins).contas.length >= 1);
});

test('o token da equipe emitido ANTES da migração continua valendo depois dela', async () => {
  const sess = await mod('_lib/sessao.js');
  const senha = await sess.hashSenha('senha-bem-comprida', 1000);
  const kv = kvEmMemoria({ admins: JSON.stringify({ contas: [{ usuario: 'maria', nome: 'Maria', permissoes: ['conteudo'], versao: 2, senha }] }) });
  /* Sem D1 (instalação antiga): a equipe vive no KV e o login funciona. */
  const antigo = ambiente({ DB: undefined, CATALOGO: kv });
  const w = await criarWorker(configDe({ modo: 'publico' }));
  const antes = await cliente(w, antigo).post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' });
  assert.equal(antes.status, 200, antes.texto);
  /* O deploy novo liga o D1 (mesmo KV, mesmo SESSION_SECRET): o mesmo token abre a conta. */
  const novo = ambiente({ CATALOGO: kv });
  const depois = await cliente(w, novo).get('/api/conta', { token: antes.json.token });
  assert.equal(depois.status, 200, depois.texto);
  assert.equal(depois.json.usuario, 'maria');
});

test('equipe no D1: criar, entrar, mudar permissão derruba o token, trocar senha, apagar', async () => {
  const worker = await criarWorker(configDe({ modo: 'publico' }));
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const App = require('../core/site/catalogo-core.js');

  const criada = await c.post('/api/contas', { usuario: 'maria', nome: 'Maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token: sup });
  assert.equal(criada.status, 200, criada.texto);
  assert.equal((await c.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: [] }, { token: sup })).status, 409);
  /* mora no D1, não no KV */
  assert.equal(env.DB.consultar("SELECT login, papel FROM usuarios WHERE login = 'maria'")[0].papel, 'equipe');
  assert.equal(env.CATALOGO.dados.admins, undefined);

  const entrou = await c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' });
  assert.equal(entrou.status, 200);
  const tk = entrou.json.token;
  assert.equal((await c.get('/api/conta', { token: tk })).status, 200);

  const mudou = await c.put('/api/contas', { usuario: 'maria', permissoes: App.PERMISSOES.slice() }, { token: sup });
  assert.equal(mudou.json.sessoesDerrubadas, true);
  assert.equal((await c.get('/api/conta', { token: tk })).status, 401, 'o token de antes caiu no pedido seguinte');

  const novo = (await c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).json.token;
  const troca = await c.put('/api/conta', { senhaAtual: 'senha-bem-comprida', senhaNova: 'outra-senha-comprida' }, { token: novo });
  assert.equal(troca.status, 200, troca.texto);
  assert.equal((await c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).status, 401);

  const lista = await c.get('/api/contas', { token: sup });
  assert.equal(lista.json.contas.length, 1);
  assert.ok(!JSON.stringify(lista.json).includes('hash'), 'o hash da senha nunca sai');

  assert.equal((await c.delete('/api/contas?usuario=maria', { token: sup })).status, 200);
  assert.equal((await c.post('/api/login', { usuario: 'maria', senha: 'outra-senha-comprida' })).status, 401);
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0);
});

test('o superadmin continua sendo a variável de ambiente: entra com o banco vazio e sem linha em usuarios', async () => {
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  assert.equal((await cliente(worker, env).get('/api/catalogo', { token: sup })).status, 200);
  assert.equal(env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0);
});

/* ----------------------------------------------------------------- custo */

/* Cria um espectador com sessão e devolve { c, env, worker }. Convite -> aceite. */
async function espectadorLogado(email = 'ana@exemplo.com') {
  const worker = await criarWorker(CONFIG);
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  const c = cliente(worker, env, { ip: '203.0.113.50' });
  const conv = await c.post('/api/convites', { email, enviar: false }, { token: sup });
  assert.equal(conv.status, 200, conv.texto);
  const token = tokenDoLink(conv.json.link);
  const aceito = await c.post('/api/auth/convite', Object.assign({ token }, ACEITE()));
  assert.equal(aceito.status, 200, aceito.texto);
  return { worker, env, c, sup };
}

test('consumo de D1 por requisição autenticada: no máximo 2 linhas lidas, todas por índice (EXPLAIN)', async () => {
  const { env, c } = await espectadorLogado();
  env.DB.chamadas.length = 0;
  const r = await c.get('/api/catalogo');
  assert.equal(r.status, 200, r.texto);

  const leituras = env.DB.chamadas.filter((x) => /^\s*SELECT/i.test(x.sql));
  assert.equal(env.DB.chamadas.length, leituras.length, 'a requisição autenticada não escreve no banco: ' + JSON.stringify(env.DB.chamadas.map((x) => x.sql)));
  assert.equal(leituras.length, 1, 'uma consulta só (sessão + usuário num JOIN)');
  const { sql, params } = leituras[0];
  const plano = env.DB.explicar(sql, params);
  assert.ok(plano.length >= 1 && plano.length <= 2, 'no máximo 2 acessos a tabela: ' + plano.join(' | '));
  for (const linha of plano) {
    assert.match(linha, /^SEARCH /, 'varredura de tabela: ' + linha);
    assert.match(linha, /PRIMARY KEY|USING INDEX|USING COVERING INDEX|INTEGER PRIMARY KEY/, 'sem índice: ' + linha);
  }
  /* Linhas lidas de verdade: o resultado do JOIN tem 1 linha, e cada SEARCH por chave única lê 1. */
  const rows = env.DB.consultar(sql, ...params);
  assert.equal(rows.length, 1);
});

test('requisição de equipe (Bearer): 1 linha do D1, pelo índice único de login', async () => {
  const worker = await criarWorker(CONFIG);
  const env = ambiente();
  const sup = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  await c.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token: sup });
  const tk = (await c.post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).json.token;
  env.DB.chamadas.length = 0;
  assert.equal((await c.get('/api/catalogo', { token: tk })).status, 200);
  assert.equal(env.DB.chamadas.length, 1);
  const { sql, params } = env.DB.chamadas[0];
  const plano = env.DB.explicar(sql, params);
  assert.equal(plano.length, 1);
  assert.match(plano[0], /^SEARCH usuarios USING (COVERING )?INDEX sqlite_autoindex_usuarios/, plano[0]);
  /* O superadmin e o visitante anônimo não custam linha nenhuma. */
  env.DB.chamadas.length = 0;
  await c.get('/api/catalogo', { token: sup });
  await cliente(worker, env).get('/api/auth/estado');
  const outras = env.DB.chamadas.filter((x) => !/documentos/.test(x.sql));
  assert.equal(outras.length, 0, JSON.stringify(outras));
});

test('toda consulta do caminho quente e das rotas de conta usa índice: nenhuma varre uma tabela', async () => {
  const { env, c, sup } = await espectadorLogado('bia@exemplo.com');
  /* Exercita as rotas e olha o plano de CADA consulta feita. */
  await c.get('/api/conta/eu');
  await c.get('/api/conta/exportar');
  await c.post('/api/auth/entrar', { email: 'bia@exemplo.com' });
  await c.get('/api/espectadores', { token: sup });
  const vistos = new Set();
  for (const { sql, params } of env.DB.chamadas) {
    if (vistos.has(sql) || /^\s*(CREATE|INSERT OR (IGNORE|REPLACE) INTO (d1_migrations|meta))/i.test(sql)) continue;
    vistos.add(sql);
    if (!/^\s*(SELECT|UPDATE|DELETE|INSERT)/i.test(sql)) continue;
    let plano;
    try { plano = env.DB.explicar(sql, params); } catch (e) { continue; }
    for (const linha of plano) {
      if (/^SCAN /.test(linha) && /^\s*(SELECT|UPDATE|DELETE)/i.test(sql)) {
        /* Permitido só: tabelas de 1-3 linhas por desenho (d1_migrations, documentos) e a lista do admin. */
        assert.ok(/d1_migrations|documentos|FROM usuarios WHERE papel = 'equipe'/.test(sql), 'varredura de tabela em: ' + sql + ' => ' + linha);
      }
    }
  }
});

/* -------------------------------------------------------------- retenção */

test('retenção (cron): apaga sessão, link e convite vencidos e contador velho, e nada mais', async () => {
  const { limparExpirados } = await mod('_lib/contas.js');
  const { ambiente: _a } = require('./fixtures/contas-ambiente.js');
  const { env, c } = await espectadorLogado('caio@exemplo.com');
  const agora = Math.floor(Date.now() / 1000);
  const db = env.DB.bruto;
  const uid = env.DB.consultar('SELECT id FROM usuarios')[0].id;
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, criado_em, renovada_em, expira_em) VALUES (?,?,?,?,?)').run('velha', uid, agora - 9e5, agora - 9e5, agora - 100);
  db.prepare('INSERT INTO links_magicos (token_hash, email, criado_em, expira_em) VALUES (?,?,?,?)').run('l-velho', 'caio@exemplo.com', agora - 9e5, agora - 2 * 86400);
  db.prepare('INSERT INTO links_magicos (token_hash, email, criado_em, expira_em) VALUES (?,?,?,?)').run('l-novo', 'caio@exemplo.com', agora, agora + 900);
  db.prepare('INSERT INTO convites (token_hash, email, criado_em, expira_em) VALUES (?,?,?,?)').run('c-velho', 'caio@exemplo.com', agora - 9e6, agora - 40 * 86400);
  db.prepare('INSERT INTO limites (chave, contagem, atualizado_em) VALUES (?,?,?)').run('antigo', 1, agora - 2 * 86400);
  db.prepare('INSERT INTO limites (chave, contagem, atualizado_em) VALUES (?,?,?)').run('recente', 1, agora);

  const r = await limparExpirados(env);
  assert.deepEqual(r, { sessoes: 1, linksMagicos: 1, convites: 1, limites: 1 });
  assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM sessoes WHERE token_hash = 'velha'")[0].n, 0);
  assert.equal(env.DB.consultar("SELECT COUNT(*) AS n FROM links_magicos WHERE token_hash = 'l-novo'")[0].n, 1);
  assert.equal((await c.get('/api/catalogo')).status, 200, 'a sessão viva continua valendo');
});

test('o Worker expõe o `scheduled` e ele roda a retenção sem lançar (com e sem D1)', async () => {
  const worker = await criarWorker(CONFIG);
  assert.equal(typeof worker.scheduled, 'function');
  const env = ambiente();
  await worker.scheduled({ cron: '17 3 * * *' }, env, { waitUntil: (p) => p });
  await worker.scheduled({ cron: '17 3 * * *' }, ambiente({ DB: undefined }), {});
});
