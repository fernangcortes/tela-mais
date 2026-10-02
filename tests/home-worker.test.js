/* M6 — a home por blocos atravessando o Worker de verdade (D1 em memória, KV de mentira, sem rede):
 *
 *   - toda mudança de bloco pelo /admin passa pelo PUT validado: permissão `estrutura`, histórico, 409;
 *   - tipo de bloco que não existe é recusado com 400 (e nada é gravado);
 *   - o config/site.json entra POR BAIXO do que a mesa escolheu, e `padroes` nunca vai parar no KV;
 *   - o catálogo diz quem está olhando (`quem`) para os blocos "só com conta" e para a Minha lista. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper, tokenDoLink, ACEITE } = require('./fixtures/contas-ambiente.js');
const App = require('../core/site/catalogo-core.js');

const ITENS = ['a', 'b', 'c', 'd'].map((id) => ({ id, titulo: 'Título ' + id, serie: 'Série X', duracao_seg: 600, publicar: true, fonte: { videoId: 'v-' + id } }));

const PUBLICO = (resto) => configDe({ modo: 'publico' }, resto);

async function montar(config, extraEnv) {
  const worker = await criarWorker(config || PUBLICO());
  const env = ambiente(extraEnv);
  env.CATALOGO.dados.catalogo = JSON.stringify({ rev: 1, itens: ITENS });
  const sup = await tokenDoSuper(worker, env);
  return { worker, env, sup, c: cliente(worker, env) };
}

const guardado = (env) => JSON.parse(env.CATALOGO.dados.catalogo);

async function lerCompleto(c, sup) {
  const r = await c.get('/api/catalogo?completo=1', { token: sup });
  assert.equal(r.status, 200, r.texto);
  return r.json;
}

const BLOCOS = [
  { id: 'destaque', tipo: 'destaque' },
  { id: 'busca', tipo: 'busca', titulo: { 'pt-BR': 'Procure' } },
  { id: 'escolhas', tipo: 'carrossel', titulos: ['b', 'a'], titulo: 'Escolhas' },
  { id: 'resto', tipo: 'prateleira-restante', garantirQueTodoTituloApareca: true }
];

test('PUT grava blocos, coleções e modelo; o GET público entrega saneado, e o completo entrega o cru + os padrões', async () => {
  const { env, sup, c } = await montar();
  const atual = await lerCompleto(c, sup);
  const r = await c.put('/api/catalogo', {
    rev: atual.rev, itens: atual.itens,
    site: { blocos: BLOCOS.concat([{ tipo: 'texto', lixo: true, texto: 'oi' }]), colecoes: [{ id: 'oficiais', nome: 'Oficiais', series: ['Série X'] }], modeloDeConteudo: 'avulso' }
  }, { token: sup });
  assert.equal(r.status, 200, r.texto);

  const publico = (await c.get('/api/catalogo')).json;
  assert.equal(publico.site.blocos.length, 5);
  assert.ok(!('lixo' in publico.site.blocos[4]), 'o PUT não saneou o bloco');
  assert.equal(publico.site.modeloDeConteudo, 'avulso');
  assert.deepEqual(publico.site.colecoes, [{ id: 'oficiais', nome: 'Oficiais', series: ['Série X'] }]);
  /* O que o site desenha com o que recebeu. */
  const h = App.home(publico.itens, publico.site, {});
  assert.deepEqual(h.sequencia.map((e) => e.tipo), ['destaque', 'busca', 'prateleira', 'prateleira', 'texto']);
  assert.deepEqual(h.prateleiras[0].itens.map((i) => i.id), ['b', 'a'], 'o carrossel não seguiu a ordem escolhida');

  /* O que está no KV: a estrutura saneada, e NADA do que é só do GET da mesa. */
  const noKv = guardado(env);
  assert.equal(noKv.site.blocos.length, 5);
  assert.ok(!('padroes' in noKv) && !('quem' in noKv), 'o que o GET acrescenta foi parar no catálogo');

  const completo = await lerCompleto(c, sup);
  assert.deepEqual(completo.site, noKv.site);
  assert.ok(completo.padroes && typeof completo.padroes === 'object', 'a mesa não recebeu os padrões do config');
});

test('o corpo do GET da mesa volta no PUT sem inventar campo nem mudança: padroes não vira diferença', async () => {
  const { env, sup, c } = await montar();
  const atual = await lerCompleto(c, sup);
  /* A mesa devolve o documento inteiro que leu (inclusive `padroes`). */
  const r = await c.put('/api/catalogo', atual, { token: sup });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.mudancas, 0, 'devolver o documento intacto contou como mudança');
  assert.ok(!('padroes' in guardado(env)));
  assert.ok(!('site' in guardado(env)), 'publicar sem escolher nada inventou o campo site');
});

test('bloco de tipo que não existe é recusado (400) e nada é gravado; coleções e modelo também têm forma', async () => {
  const { env, sup, c } = await montar();
  const atual = await lerCompleto(c, sup);
  const antes = env.CATALOGO.dados.catalogo;
  const pedido = (site) => c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site }, { token: sup });

  const r1 = await pedido({ blocos: [{ tipo: 'busca' }, { tipo: 'nao-existe' }, 'lixo'] });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.codigo, 'blocos-invalidos');
  assert.deepEqual(r1.json.blocos.map((b) => b.indice), [1, 2]);
  assert.match(r1.json.mensagem, /2/);

  assert.equal((await pedido({ blocos: 'lixo' })).json.codigo, 'blocos-invalidos');
  assert.equal((await pedido({ colecoes: { id: 'x' } })).json.codigo, 'colecoes-invalidas');
  assert.equal((await pedido({ modeloDeConteudo: 'filme' })).json.codigo, 'modelo-invalido');
  assert.equal(env.CATALOGO.dados.catalogo, antes, 'um pedido recusado gravou algo');

  /* null é "voltar ao padrão", e vale. */
  assert.equal((await pedido({ blocos: null, colecoes: null, modeloDeConteudo: null })).status, 200);
});

test('permissão: quem só tem "conteúdo" não mexe nos blocos; com "estrutura" mexe, e o histórico registra', async () => {
  const { sup, c } = await montar();
  await c.post('/api/contas', { usuario: 'ana', senha: 'senha-bem-comprida', permissoes: ['conteudo'] }, { token: sup });
  await c.post('/api/contas', { usuario: 'bia', senha: 'senha-bem-comprida', permissoes: ['estrutura'] }, { token: sup });
  const ana = (await c.post('/api/login', { usuario: 'ana', senha: 'senha-bem-comprida' })).json.token;
  const bia = (await c.post('/api/login', { usuario: 'bia', senha: 'senha-bem-comprida' })).json.token;

  const atual = await lerCompleto(c, sup);
  for (const campo of [{ blocos: BLOCOS }, { colecoes: [{ id: 'x' }] }, { modeloDeConteudo: 'avulso' }]) {
    const recusa = await c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site: campo }, { token: ana });
    assert.equal(recusa.status, 403, JSON.stringify(campo));
    assert.equal(recusa.json.barradas[0].permissao, 'estrutura');
  }
  const ok = await c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site: { blocos: BLOCOS } }, { token: bia });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.json.historico, true);

  const registro = (await c.get('/api/historico?rev=' + ok.json.rev, { token: sup })).json.registro;
  const d = registro.mudancas.find((m) => m.alvo === 'site' && m.campo === 'blocos');
  assert.ok(d, 'o histórico não guardou a mudança dos blocos');
  assert.equal(d.permissao, 'estrutura');
  assert.equal(registro.quem, 'bia');
  assert.deepEqual(d.depois, App.siteSaneado({ blocos: BLOCOS }).blocos);
});

test('409: duas telas mexendo na home ao mesmo tempo não se sobrescrevem', async () => {
  const { sup, c } = await montar();
  const atual = await lerCompleto(c, sup);
  const primeira = await c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site: { blocos: BLOCOS } }, { token: sup });
  assert.equal(primeira.status, 200);
  const segunda = await c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site: { blocos: BLOCOS.slice(0, 2) } }, { token: sup });
  assert.equal(segunda.status, 409);
  assert.equal(segunda.json.codigo, 'catalogo-mudou');
  assert.equal(segunda.json.rev_servidor, primeira.json.rev);
});

test('restaurar uma versão antiga devolve também os blocos que ela tinha (e a permissão é conferida)', async () => {
  const { sup, c } = await montar();
  const v0 = await lerCompleto(c, sup);
  const um = await c.put('/api/catalogo', { rev: v0.rev, itens: v0.itens, site: { blocos: BLOCOS } }, { token: sup });
  const dois = await c.put('/api/catalogo', { rev: um.json.rev, itens: v0.itens, site: { blocos: BLOCOS.slice(0, 1) } }, { token: sup });
  assert.equal(dois.status, 200);
  const volta = await c.post('/api/historico', { restaurar: um.json.rev }, { token: sup });
  assert.equal(volta.status, 200, volta.texto);
  assert.equal((await lerCompleto(c, sup)).site.blocos.length, BLOCOS.length);
});

test('o config/site.json entra por baixo: sem escolha da mesa vale o config; a escolha da mesa vence', async () => {
  const config = PUBLICO({
    home: { blocos: [{ id: 'busca', tipo: 'busca' }, { id: 'nao', tipo: 'nao-existe' }] },
    catalogo: { modeloDeConteudo: 'avulso', colecoes: [{ id: 'palestras', series: ['Série X'] }] },
    idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR', 'en'] }
  });
  const { env, sup, c } = await montar(config);
  const antes = (await c.get('/api/catalogo')).json;
  assert.deepEqual(antes.site.blocos, [{ id: 'busca', tipo: 'busca' }], 'o config não chegou ao site (ou o tipo inválido passou)');
  assert.equal(antes.site.modeloDeConteudo, 'avulso');
  assert.deepEqual(antes.site.colecoes, [{ id: 'palestras', series: ['Série X'] }]);

  const completo = await lerCompleto(c, sup);
  assert.ok(!('blocos' in (completo.site || {})), 'o config vazou para o documento cru, que é contra o que o Publicar confere');
  assert.deepEqual(completo.padroes.blocos, [{ id: 'busca', tipo: 'busca' }]);
  assert.deepEqual(completo.padroes.idiomas, ['pt-BR', 'en']);

  await c.put('/api/catalogo', { rev: completo.rev, itens: completo.itens, site: { blocos: BLOCOS } }, { token: sup });
  assert.equal((await c.get('/api/catalogo')).json.site.blocos.length, BLOCOS.length, 'a escolha da mesa não venceu o config');
  assert.equal((await c.get('/api/catalogo')).json.site.modeloDeConteudo, 'avulso', 'o que a mesa não escolheu continua vindo do config');
  assert.ok(env);
});

test('a resposta diz quem está olhando: anônimo, espectador com conta, e a Minha lista desligada', async () => {
  /* Modo público, sem sessão: nada de conta. */
  const pub = await montar();
  assert.deepEqual((await pub.c.get('/api/catalogo')).json.quem, { logado: false, espectador: false, minhaLista: false });

  /* Modo privado: o espectador entra por convite. */
  const configPrivada = configDe({ modo: 'privado' });
  const priv = await montar(configPrivada);
  const conv = await priv.c.post('/api/convites', { email: 'ana@exemplo.com', enviar: false }, { token: priv.sup });
  const ana = cliente(priv.worker, priv.env, { ip: '203.0.113.50' });
  assert.equal((await ana.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv.json.link) }, ACEITE()))).status, 200);
  assert.deepEqual((await ana.get('/api/catalogo')).json.quem, { logado: true, espectador: true, minhaLista: true });
  assert.deepEqual((await priv.c.get('/api/catalogo', { token: priv.sup })).json.quem, { logado: true, espectador: false, minhaLista: true }, 'a equipe é logada, mas não é espectador');

  const semLista = await montar(configDe({ modo: 'privado' }, { recursos: { minhaLista: false } }));
  const conv2 = await semLista.c.post('/api/convites', { email: 'bia@exemplo.com', enviar: false }, { token: semLista.sup });
  const bia = cliente(semLista.worker, semLista.env, { ip: '203.0.113.51' });
  await bia.post('/api/auth/convite', Object.assign({ token: tokenDoLink(conv2.json.link) }, ACEITE()));
  assert.equal((await bia.get('/api/catalogo')).json.quem.minhaLista, false, 'recursos.minhaLista: false não desligou');
});

test('catálogo sem nada importado também entrega a home do config e quem está olhando', async () => {
  const worker = await criarWorker(PUBLICO({ catalogo: { modeloDeConteudo: 'avulso' } }));
  const env = ambiente();
  delete env.CATALOGO.dados.catalogo;
  const r = (await cliente(worker, env).get('/api/catalogo')).json;
  assert.equal(r.vazio, true);
  assert.equal(r.site.modeloDeConteudo, 'avulso');
  assert.equal(r.quem.logado, false);
});

test('sem o bloco de destaque na home, a capa do LCP não é pré-carregada (a chave do KV some)', async () => {
  const { env, sup, c } = await montar();
  const atual = await lerCompleto(c, sup);
  await c.get('/api/catalogo');
  const guardada = env.CATALOGO.dados['capa-destaque'];
  /* O catálogo de teste não tem capa de provedor; o que importa é que a chave segue a home. */
  const r = await c.put('/api/catalogo', { rev: atual.rev, itens: atual.itens, site: { blocos: [{ id: 'busca', tipo: 'busca' }] } }, { token: sup });
  assert.equal(r.status, 200);
  await c.get('/api/catalogo');
  assert.ok(!('capa-destaque' in env.CATALOGO.dados), 'sobrou o preload de uma capa que a home não desenha (era ' + guardada + ')');
});
