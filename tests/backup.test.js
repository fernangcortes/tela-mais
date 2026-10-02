/* M8 — backup e restauração (GET/POST /api/backup e _lib/backup.js). O que se confere:
 *   - exportar traz catálogo, configuração operacional e textos legais; as contas só com ?contas=1 e só o superadmin;
 *   - o arquivo se prova sozinho (hash por parte e do conjunto): editado ou cortado, é recusado ANTES de tocar em qualquer coisa;
 *   - exportar -> restaurar num projeto de teste -> exportar de novo dá o MESMO hash do catálogo (a rev anda, o conteúdo não);
 *   - importar é publicação: rev + 1, histórico, 409 se alguém mexeu no meio, e "simular" não grava nada;
 *   - contas nunca sobrescrevem quem já existe; segredo nenhum entra no arquivo;
 *   - a exportação anota "backup feito agora" para a tela Saúde. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper, kvEmMemoria } = require('./fixtures/contas-ambiente.js');

const mod = (nome) => import('../core/worker/' + nome);

const CATALOGO = {
  versao: 1, rev: 7, total: 3, atualizado_em: '2026-09-30T10:00:00.000Z',
  itens: [
    { id: 'a', titulo: 'Aula 1', serie: 'Curso', temporada: 1, episodio: 1, publicar: true, fonte: { provedor: 'bunny', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', extras: {} } },
    { id: 'b', titulo: 'Aula 2', serie: 'Curso', temporada: 1, episodio: 2, publicar: true, fonte: { provedor: 'bunny', id: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff', extras: {} } },
    { id: 'c', titulo: 'Rascunho', publicar: false }
  ],
  site: { textos: { rodape: 'Feito com carinho' } },
  ajustes: { arrastoTeto: 0.6 }
};

function ambienteDeBackup(extra) {
  return ambiente(Object.assign({ CATALOGO: kvEmMemoria({ catalogo: JSON.stringify(CATALOGO) }), BUNNY_API_KEY: 'chave-secreta-do-bunny-0123' }, extra || {}));
}
async function preparar(modo = 'privado', extra) {
  const env = ambienteDeBackup(extra);
  const worker = await criarWorker(configDe({ modo }));
  const token = await tokenDoSuper(worker, env);
  return { env, worker, token, c: cliente(worker, env) };
}
async function exportar(c, token, contas) {
  const r = await c.get('/api/backup' + (contas ? '?contas=1' : ''), { token });
  assert.equal(r.status, 200, r.texto);
  return r;
}
const TODAS = { catalogo: true, operacao: true, legal: true, contas: true };

test('exportar: catálogo, textos legais e configuração operacional; sem contas por padrão; sem nenhum segredo', async () => {
  const { c, token, env } = await preparar('privado', { }) ;
  await env.CATALOGO.put('config:operacao', JSON.stringify({ player: { marcaDagua: { ligada: false } } }));
  const r = await exportar(c, token);
  const b = r.json;
  assert.equal(b.formato, 'streaming-backup');
  assert.equal(b.versaoDoFormato, 1);
  assert.equal(b.resumo.titulos, 3);
  assert.equal(b.resumo.noAr, 2);
  assert.equal(b.resumo.rev, 7);
  assert.equal(b.conteudo.contas, null, 'contas só com ?contas=1');
  assert.deepEqual(b.conteudo.operacao, { player: { marcaDagua: { ligada: false } } });
  assert.deepEqual(Object.keys(b.conteudo.legal).sort(), ['privacidade', 'termos']);
  assert.equal(b.conteudo.catalogo.site.textos.rodape, 'Feito com carinho');
  assert.match(b.hashes.catalogo, /^sha256:[0-9a-f]{64}$/);
  assert.match(r.cabecalhos.get('content-disposition'), /attachment; filename="backup-\d{4}-\d{2}-\d{2}\.json"/);
  for (const segredo of ['senha-do-super', 'chave-secreta-do-bunny-0123']) assert.ok(!r.texto.includes(segredo), 'segredo no backup: ' + segredo);
});

test('a equipe baixa o backup; as contas dentro dele e a importação são só do superadmin', async () => {
  const { c, token, worker, env } = await preparar();
  await c.post('/api/contas', { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token });
  const tEquipe = (await cliente(worker, env).post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' })).json.token;
  assert.equal((await c.get('/api/backup', { token: tEquipe })).status, 200);
  assert.equal((await c.get('/api/backup?contas=1', { token: tEquipe })).status, 403);
  assert.equal((await c.post('/api/backup', { backup: {}, aplicar: TODAS }, { token: tEquipe })).status, 403);
  assert.equal((await c.get('/api/backup')).status, 401);
});

test('exportar anota "backup feito agora" para a tela Saúde', async () => {
  const { c, token, env } = await preparar();
  assert.equal((await c.get('/api/saude', { token })).json.checagens.find((x) => x.id === 'backup').codigo, 'backup-nunca');
  const b = (await exportar(c, token)).json;
  const guardado = JSON.parse(env.CATALOGO.dados['backup:ultimo']);
  assert.equal(guardado.em, b.criadoEm);
  assert.equal(guardado.origem, 'admin');
  assert.equal(guardado.titulos, 3);
  assert.equal((await c.get('/api/saude', { token })).json.checagens.find((x) => x.id === 'backup').codigo, 'backup-recente');
});

test('exportar, restaurar em outro projeto e exportar de novo: o mesmo hash do catálogo (a rev anda, o conteúdo não)', async () => {
  const origem = await preparar();
  const b = (await exportar(origem.c, origem.token)).json;

  const destino = await preparar('privado', { CATALOGO: kvEmMemoria({}) });
  const r = await destino.c.post('/api/backup', { backup: b, aplicar: { catalogo: true }, rev: undefined }, { token: destino.token });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.feito.catalogo.titulos, 3);
  assert.equal(r.json.feito.catalogo.rev, 1);
  assert.equal(r.json.feito.catalogo.hash, b.hashes.catalogo);

  const b2 = (await exportar(destino.c, destino.token)).json;
  assert.equal(b2.hashes.catalogo, b.hashes.catalogo, 'o conteúdo restaurado tem de ser idêntico');
  assert.notEqual(b2.conteudo.catalogo.rev, b.conteudo.catalogo.rev);
  assert.deepEqual(b2.conteudo.catalogo.itens, b.conteudo.catalogo.itens);
  assert.deepEqual(b2.conteudo.catalogo.site, b.conteudo.catalogo.site);
});

test('importar é publicação: rev + 1, entra no histórico e dá para voltar; "simular" não grava nada', async () => {
  /* modo público: o catálogo completo sai sem URL assinada, e o teste não precisa das chaves de assinatura do provedor */
  const { c, token, env } = await preparar('publico');
  const b = (await exportar(c, token)).json;
  const antes = JSON.stringify(env.CATALOGO.dados);

  const simulado = await c.post('/api/backup', { backup: b, aplicar: { catalogo: true }, rev: 7, simular: true }, { token });
  assert.equal(simulado.status, 200, simulado.texto);
  assert.equal(simulado.json.simulado, true);
  assert.equal(simulado.json.plano.catalogo.revDe, 7);
  assert.equal(simulado.json.plano.catalogo.revPara, 8);
  assert.equal(JSON.stringify(env.CATALOGO.dados), antes, 'simular não pode gravar nada');

  /* a simulação não exige rev: descreve o plano; já importar de verdade sem rev continua dando 409 */
  const semRev = await c.post('/api/backup', { backup: b, aplicar: { catalogo: true }, simular: true }, { token });
  assert.equal(semRev.status, 200, semRev.texto);
  assert.equal(semRev.json.plano.catalogo.revPara, 8);
  assert.equal((await c.post('/api/backup', { backup: b, aplicar: { catalogo: true } }, { token })).status, 409);
  assert.equal(JSON.stringify(env.CATALOGO.dados), antes, 'simular não pode gravar nada');

  /* muda o catálogo no destino e importa por cima */
  const atual = (await c.get('/api/catalogo?completo=1', { token })).json;
  atual.itens = atual.itens.slice(0, 1);
  delete atual.config;
  assert.equal((await c.put('/api/catalogo', atual, { token })).status, 200);
  const rev = JSON.parse(env.CATALOGO.dados.catalogo).rev;

  const r = await c.post('/api/backup', { backup: b, aplicar: { catalogo: true }, rev }, { token });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.feito.catalogo.rev, rev + 1);
  assert.equal(r.json.feito.catalogo.historico, true);
  assert.equal(JSON.parse(env.CATALOGO.dados.catalogo).itens.length, 3);
  const linha = (await c.get('/api/historico', { token })).json.linha;
  assert.ok(linha.some((x) => x.rev === rev + 1), 'a importação aparece no histórico');
  /* a cópia anterior existe: restaurar a revisão de antes desfaz a importação */
  assert.ok(env.CATALOGO.dados[require('../core/site/catalogo-core.js').chaveVersao(rev)], 'a versão anterior ficou guardada');
});

test('409: se o catálogo mudou desde que a tela leu, a importação é recusada e nada é gravado', async () => {
  const { c, token, env } = await preparar();
  const b = (await exportar(c, token)).json;
  const antes = env.CATALOGO.dados.catalogo;
  const r = await c.post('/api/backup', { backup: b, aplicar: { catalogo: true }, rev: 3 }, { token });
  assert.equal(r.status, 409);
  assert.equal(r.json.codigo, 'catalogo-mudou');
  assert.equal(r.json.rev_servidor, 7);
  assert.equal(env.CATALOGO.dados.catalogo, antes);
  const semRev = await c.post('/api/backup', { backup: b, aplicar: { catalogo: true } }, { token });
  assert.equal(semRev.status, 409, 'com catálogo no destino, a rev é obrigatória');
});

test('arquivo adulterado, cortado ou de outro formato é recusado ANTES de tocar em qualquer coisa', async () => {
  const { c, token, env } = await preparar();
  const b = (await exportar(c, token)).json;
  const antes = JSON.stringify(env.CATALOGO.dados);
  const tentar = async (corpo, codigo, status = 400) => {
    const r = await c.post('/api/backup', { backup: corpo, aplicar: TODAS, rev: 7 }, { token });
    assert.equal(r.status, status, codigo + ': ' + r.texto);
    assert.equal(r.json.codigo, codigo);
    assert.equal(JSON.stringify(env.CATALOGO.dados), antes, 'nada pode ter sido gravado (' + codigo + ')');
  };

  const editado = JSON.parse(JSON.stringify(b));
  editado.conteudo.catalogo.itens[0].titulo = 'Título trocado à mão';
  await tentar(editado, 'backup-corrompido');

  const semHashes = JSON.parse(JSON.stringify(b));
  delete semHashes.hashes;
  await tentar(semHashes, 'backup-corrompido');

  const cortado = JSON.parse(JSON.stringify(b));
  cortado.conteudo.catalogo.itens.pop();
  await tentar(cortado, 'backup-corrompido');

  const outro = JSON.parse(JSON.stringify(b));
  outro.formato = 'outra-coisa';
  await tentar(outro, 'backup-invalido');
  await tentar({}, 'backup-invalido');

  const futuro = JSON.parse(JSON.stringify(b));
  futuro.versaoDoFormato = 99;
  await tentar(futuro, 'backup-versao-nao-suportada');

  const r = await c.post('/api/backup', { backup: b, aplicar: {}, rev: 7 }, { token });
  assert.equal(r.json.codigo, 'backup-sem-nada');
});

test('catálogo do arquivo com ids repetidos ou bloco de home inventado é recusado, mesmo com o hash certo', async () => {
  const { sha256, canonico, montarBackup } = await mod('_lib/backup.js');
  const { c, token, env } = await preparar();
  const refazer = async (alterar) => {
    const b = JSON.parse(JSON.stringify((await exportar(c, token)).json));
    alterar(b.conteudo.catalogo);
    const { hashDoCatalogo } = await mod('_lib/backup.js');
    b.hashes.catalogo = await hashDoCatalogo(b.conteudo.catalogo);
    b.hash = await sha256(canonico(b.conteudo));
    return b;
  };
  const duplicado = await refazer((cat) => { cat.itens[1].id = cat.itens[0].id; });
  const r1 = await c.post('/api/backup', { backup: duplicado, aplicar: { catalogo: true }, rev: 7 }, { token });
  assert.equal(r1.json.codigo, 'backup-catalogo-invalido');
  const bloco = await refazer((cat) => { cat.site = { blocos: [{ tipo: 'tipo-que-nao-existe' }] }; });
  const r2 = await c.post('/api/backup', { backup: bloco, aplicar: { catalogo: true }, rev: 7 }, { token });
  assert.equal(r2.json.codigo, 'backup-catalogo-invalido');
  assert.equal(JSON.parse(env.CATALOGO.dados.catalogo).rev, 7);
  assert.ok(typeof montarBackup === 'function');
});

test('configuração operacional: volta pelo mesmo validador do deploy; seção fora da operação é recusada', async () => {
  const { c, token, env } = await preparar();
  await env.CATALOGO.put('config:operacao', JSON.stringify({ player: { marcaDagua: { ligada: false } } }));
  const b = (await exportar(c, token)).json;
  await env.CATALOGO.delete('config:operacao');
  const r = await c.post('/api/backup', { backup: b, aplicar: { operacao: true } }, { token });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(JSON.parse(env.CATALOGO.dados['config:operacao']), { player: { marcaDagua: { ligada: false } } });

  /* quem edita o arquivo (e refaz os hashes) para abrir o acesso pela operação é barrado: `acesso` não é seção operacional */
  const { sha256, canonico } = await mod('_lib/backup.js');
  const mau = JSON.parse(JSON.stringify(b));
  mau.conteudo.operacao = { acesso: { modo: 'publico' } };
  mau.hashes.operacao = await sha256(canonico(mau.conteudo.operacao));
  mau.hash = await sha256(canonico(mau.conteudo));
  const r2 = await c.post('/api/backup', { backup: mau, aplicar: { operacao: true } }, { token });
  assert.equal(r2.status, 400);
  assert.equal(r2.json.codigo, 'backup-operacao-invalida');
  const invalida = JSON.parse(JSON.stringify(b));
  invalida.conteudo.operacao = { player: { marcaDagua: { ligada: 'talvez' } } };
  invalida.hashes.operacao = await sha256(canonico(invalida.conteudo.operacao));
  invalida.hash = await sha256(canonico(invalida.conteudo));
  assert.equal((await c.post('/api/backup', { backup: invalida, aplicar: { operacao: true } }, { token })).json.codigo, 'backup-operacao-invalida');
});

test('contas: equipe com o hash da senha e espectadores sem senha; nunca sobrescrevem quem já existe', async () => {
  const { c, token, env, worker } = await preparar('privado');
  await c.post('/api/contas', { usuario: 'maria', nome: 'Maria', senha: 'senha-bem-comprida', permissoes: ['conteudo', 'no-ar'] }, { token });
  await c.post('/api/convites', { email: 'aluna@exemplo.test' }, { token });
  const { garantirEspectador } = await mod('_lib/contas.js');
  await garantirEspectador(env.DB, { email: 'aluna@exemplo.test', nome: 'Aluna', status: 'ativo' });
  await garantirEspectador(env.DB, { email: 'bloqueado@exemplo.test', nome: '', status: 'bloqueado' });

  const r = await exportar(c, token, true);
  const b = r.json;
  assert.equal(b.conteudo.contas.equipe.length, 1);
  assert.equal(b.conteudo.contas.equipe[0].usuario, 'maria');
  assert.ok(b.conteudo.contas.equipe[0].senha.hash, 'o hash vai, para a equipe voltar a entrar');
  assert.ok(!r.texto.includes('senha-bem-comprida'), 'a senha em claro nunca');
  assert.deepEqual(b.conteudo.contas.espectadores.map((e) => e.email).sort(), ['aluna@exemplo.test', 'bloqueado@exemplo.test']);
  assert.ok(b.conteudo.contas.espectadores.every((e) => !('senha' in e) && !('id' in e)));
  assert.ok(!('convites' in b.conteudo.contas), 'convite e sessão não entram');
  assert.equal(b.resumo.equipe, 1);
  assert.equal(b.resumo.espectadores, 2);

  /* num projeto novo: tudo volta; de novo: nada é sobrescrito */
  const novo = await preparar('privado', { CATALOGO: kvEmMemoria({}), DB: require('./fixtures/contas-ambiente.js').criarD1Falso() });
  const plano = await novo.c.post('/api/backup', { backup: b, aplicar: { contas: true }, simular: true }, { token: novo.token });
  assert.equal(plano.status, 200, plano.texto);
  assert.deepEqual(plano.json.plano.contas.equipe, { novas: 1, existentes: 0, invalidas: 0 });
  assert.equal(plano.json.plano.contas.espectadores.novos, 2);
  const feito = await novo.c.post('/api/backup', { backup: b, aplicar: { contas: true } }, { token: novo.token });
  assert.deepEqual(feito.json.feito.contas, { equipe: { criadas: 1, puladas: 0 }, espectadores: { criados: 2, pulados: 0 } });
  const login = await cliente(novo.worker, novo.env).post('/api/login', { usuario: 'maria', senha: 'senha-bem-comprida' });
  assert.equal(login.status, 200, 'a equipe restaurada entra com a mesma senha');
  assert.deepEqual(login.json.permissoes.slice().sort(), ['conteudo', 'no-ar']);
  const outraVez = await novo.c.post('/api/backup', { backup: b, aplicar: { contas: true } }, { token: novo.token });
  assert.deepEqual(outraVez.json.feito.contas, { equipe: { criadas: 0, puladas: 1 }, espectadores: { criados: 0, pulados: 2 } });
});

test('contas com forma inválida (usuário torto, hash ausente, e-mail ruim) são puladas e contadas, nunca gravadas', async () => {
  const { sha256, canonico, hashDoCatalogo } = await mod('_lib/backup.js');
  const { c, token, env } = await preparar();
  const b = JSON.parse(JSON.stringify((await exportar(c, token, true)).json));
  b.conteudo.contas = {
    equipe: [{ usuario: 'Maiúscula Torta', senha: { hash: 'h', sal: 's', iter: 1 } }, { usuario: 'sem-hash', senha: null }, { usuario: 'boa-conta', nome: 'Boa', permissoes: ['conteudo'], senha: { alg: 'pbkdf2', iter: 10000, sal: 'cw==', hash: 'aGFzaA==' } }],
    espectadores: [{ email: 'nao-e-email', status: 'ativo' }, { email: 'ok@exemplo.test', status: 'status-inventado' }, { email: 'ok@exemplo.test', status: 'ativo' }]
  };
  b.hashes.contas = await sha256(canonico(b.conteudo.contas));
  b.hash = await sha256(canonico(b.conteudo));
  const r = await c.post('/api/backup', { backup: b, aplicar: { contas: true } }, { token });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.json.feito.contas, { equipe: { criadas: 1, puladas: 2 }, espectadores: { criados: 1, pulados: 2 } });
  const { equipeListar } = await mod('_lib/contas.js');
  assert.deepEqual((await equipeListar(env)).map((x) => x.usuario), ['boa-conta']);
  assert.ok(typeof hashDoCatalogo === 'function');
});

test('textos legais voltam com a versão certa (só sobe se mudou)', async () => {
  const { c, token, env } = await preparar();
  await c.put('/api/legal', { tipo: 'privacidade', campos: { controlador: 'Associação Exemplo', contato: 'oi@exemplo.test' }, textos: {} }, { token });
  const b = (await exportar(c, token)).json;
  assert.equal(b.conteudo.legal.privacidade.campos.controlador, 'Associação Exemplo');
  const { criarD1Falso } = require('./fixtures/contas-ambiente.js');
  const destino = await preparar('privado', { CATALOGO: kvEmMemoria({}), DB: criarD1Falso() });
  const r = await destino.c.post('/api/backup', { backup: b, aplicar: { legal: true } }, { token: destino.token });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.json.feito.legal.documentos, ['privacidade', 'termos']);
  const lido = (await destino.c.get('/api/legal', { token: destino.token })).json.documentos;
  assert.equal(lido.privacidade.campos.controlador, 'Associação Exemplo');
  assert.ok(env);
});

test('sem D1 (modo público de instalação enxuta): exportar e importar o catálogo funcionam, contas e textos legais são dispensados', async () => {
  const { c, token } = await preparar('publico', { DB: undefined });
  const b = (await exportar(c, token, true)).json;
  assert.equal(b.conteudo.legal, null);
  assert.deepEqual(b.conteudo.contas.espectadores, []);
  const r = await c.post('/api/backup', { backup: b, aplicar: TODAS, rev: 7, simular: true }, { token });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.json.partes.sort(), ['catalogo', 'contas']);
});

test('corpo que não é JSON e arquivo grande demais viram erro com código, sem derrubar o Worker', async () => {
  const { token, env, worker } = await preparar();
  const cru = (corpo) => worker.fetch(new Request('https://exemplo.test/api/backup', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', origin: 'https://exemplo.test' }, body: corpo }), env, { waitUntil() {} });
  const torto = await cru('{isto nao e json');
  assert.equal(torto.status, 400);
  assert.equal((await torto.json()).codigo, 'corpo-invalido');
  const lista = await cru('[1,2]');
  assert.equal((await lista.json()).codigo, 'corpo-invalido');
  const { BYTES_MAXIMOS_DO_ARQUIVO } = await mod('_lib/backup.js');
  const grande = await cru('"' + 'x'.repeat(BYTES_MAXIMOS_DO_ARQUIVO) + '"');
  assert.equal(grande.status, 413);
  assert.equal((await grande.json()).codigo, 'backup-grande');
});

test('o hash do catálogo ignora rev, data e total, e a ordem das chaves', async () => {
  const { hashDoCatalogo, canonico } = await mod('_lib/backup.js');
  const a = { itens: [{ id: 'x', titulo: 'T' }], rev: 1, total: 1, atualizado_em: 'a', site: { a: 1, b: 2 } };
  const b = { site: { b: 2, a: 1 }, atualizado_em: 'outra', total: 9, rev: 50, itens: [{ titulo: 'T', id: 'x' }] };
  assert.equal(await hashDoCatalogo(a), await hashDoCatalogo(b));
  assert.notEqual(await hashDoCatalogo(a), await hashDoCatalogo(Object.assign({}, a, { itens: [{ id: 'x', titulo: 'Outro' }] })));
  assert.equal(canonico({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(await hashDoCatalogo(null), null);
});
