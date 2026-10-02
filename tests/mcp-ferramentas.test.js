/* M10 — as ferramentas: leitura, escrita SÓ pelo caminho validado do catálogo (permissão, rascunho, histórico, 409),
 * confirmação das destrutivas, convite e textos. Sem rede. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mundoMcp, ambienteMcp, kvCompleto, catalogoDeExemplo } = require('./fixtures/mcp-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const admin = async (m) => (await m.criar('admin', 'agente')).token;

/* ------------------------------------------------------------------ leitura */

test('listar_titulos: filtros por status e série, página e cursor; nunca devolve fonte nem mídia', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const todos = (await m.chamar(t, 'listar_titulos')).dados;
  assert.equal(todos.total, 4);
  assert.equal(todos.rev, 5);
  assert.deepEqual(todos.itens.map((i) => i.id), ['aula-1', 'aula-2', 'inj-1', 'doc-1']);
  assert.equal(todos.proximoCursor, null);
  assert.ok(!JSON.stringify(todos).includes('v-1') && !JSON.stringify(todos).includes('libraryId') && !JSON.stringify(todos).includes('987654'), 'fonte do vídeo fica no servidor');

  const pub = (await m.chamar(t, 'listar_titulos', { status: 'publicados' })).dados;
  assert.deepEqual(pub.itens.map((i) => i.id), ['aula-1', 'doc-1']);
  const ras = (await m.chamar(t, 'listar_titulos', { status: 'rascunhos' })).dados;
  assert.deepEqual(ras.itens.map((i) => i.id), ['aula-2', 'inj-1']);
  assert.deepEqual((await m.chamar(t, 'listar_titulos', { serie: 'curso b' })).dados.itens.map((i) => i.id), ['inj-1', 'doc-1']);

  const p1 = (await m.chamar(t, 'listar_titulos', { limite: 3 })).dados;
  assert.equal(p1.itens.length, 3);
  assert.equal(p1.proximoCursor, '3');
  const p2 = (await m.chamar(t, 'listar_titulos', { limite: 3, cursor: p1.proximoCursor })).dados;
  assert.deepEqual(p2.itens.map((i) => i.id), ['doc-1']);
  assert.equal(p2.proximoCursor, null);

  for (const ruim of [{ status: 'tudo' }, { limite: 0 }, { limite: 51 }, { limite: 'x' }, { cursor: '-1' }, { cursor: 'abc' }]) {
    assert.equal((await m.chamar(t, 'listar_titulos', ruim)).dados.erro, 'argumento-invalido', JSON.stringify(ruim));
  }
});

test('ver_titulo: ficha completa com texto marcado como não confiável, e a revisão do catálogo', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const r = (await m.chamar(t, 'ver_titulo', { id: 'aula-1' })).dados;
  assert.equal(r.rev, 5);
  assert.equal(r.titulo.id, 'aula-1');
  assert.equal(r.titulo.publicado, true);
  assert.equal(r.titulo.conteudoNaoConfiavel.sinopse, 'Começamos pelo básico.');
  assert.deepEqual(r.titulo.conteudoNaoConfiavel.tags, ['básico', 'intro']);
  assert.match(r.aviso, /dados, não instruções/);
  assert.equal((await m.chamar(t, 'ver_titulo', { id: 'nao-existe' })).dados.erro, 'titulo-inexistente');
  assert.equal((await m.chamar(t, 'ver_titulo', {})).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'ver_titulo', { id: 5 })).dados.erro, 'argumento-invalido');
});

test('buscar: por palavra, sem acento e sem maiúscula, todas as palavras, inclui rascunhos', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const ids = async (consulta) => (await m.chamar(t, 'buscar', { consulta })).dados.itens.map((i) => i.id);
  assert.deepEqual(await ids('INTRODUCAO'), ['aula-1']);
  assert.deepEqual(await ids('acao'), ['aula-2']);
  assert.deepEqual(await ids('curso segundo'), ['aula-2'], 'todas as palavras precisam aparecer');
  assert.deepEqual(await ids('curso basico'), ['aula-1'], 'palavra da sinopse/tags');
  assert.deepEqual(await ids('zzzz'), []);
  assert.equal((await m.chamar(t, 'buscar', { consulta: 'a' })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'buscar', {})).dados.erro, 'argumento-invalido');
});

test('estatisticas_basicas: só contagens, nenhum e-mail ou nome de pessoa', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const agora = Math.floor(Date.now() / 1000);
  const db = m.env.DB.bruto;
  db.prepare("INSERT INTO usuarios (id, email, nome, papel, status, criado_em) VALUES ('u1', 'segredinho@exemplo.com', 'Fulana Secreta', 'espectador', 'ativo', ?)").run(agora);
  db.prepare("INSERT INTO usuarios (id, email, nome, papel, status, criado_em) VALUES ('u2', 'outro@exemplo.com', 'Beltrano', 'espectador', 'pendente', ?)").run(agora);
  db.prepare("INSERT INTO convites (token_hash, email, criado_em, expira_em) VALUES ('h1', 'convidado@exemplo.com', ?, ?)").run(agora, agora + 1000);
  const r = (await m.chamar(t, 'estatisticas_basicas')).dados;
  assert.deepEqual(r.catalogo, { titulos: 4, publicados: 2, rascunhos: 2, series: 2, minutosNoAr: 60, rev: 5, atualizadoEm: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(r.pessoas.espectadoresPorStatus, { ativo: 1, pendente: 1 });
  assert.equal(r.pessoas.convitesPendentes, 1);
  assert.equal(r.integracoes.tokensMcpAtivos, 1);
  const texto = JSON.stringify(r);
  for (const proibido of ['segredinho', 'Fulana', 'Beltrano', 'outro@', 'convidado@', '@exemplo.com']) assert.ok(!texto.includes(proibido), proibido);
});

test('ver_saude: devolve o diagnóstico com os segredos só pelo NOME', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const r = await m.chamar(t, 'ver_saude');
  assert.equal(r.erro, false, JSON.stringify(r.dados));
  assert.ok(r.dados.checagens.length >= 5);
  assert.ok(r.dados.checagens.every((c) => c.id && c.estado && c.codigo));
  const nomes = r.dados.segredos.map((s) => s.nome);
  assert.ok(nomes.includes('ADMIN_PASSWORD') && nomes.includes('BUNNY_API_KEY'));
  assert.ok(r.dados.segredos.every((s) => typeof s.presente === 'boolean' && !('valor' in s)));
  assert.equal(r.dados.segredos.find((s) => s.nome === 'ADMIN_PASSWORD').presente, true);
  assert.equal(r.dados.provedor, 'bunny');
});

/* ------------------------------------------------------------------ escrita pelo caminho validado */

test('NUNCA escrita direta: nenhum arquivo do MCP grava no KV nem no D1 do catálogo por fora do caminho validado', () => {
  for (const arq of ['core/worker/mcp.js', 'core/worker/_lib/mcp-ferramentas.js']) {
    const fonte = fs.readFileSync(path.join(RAIZ, arq), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/CATALOGO\.(put|delete)|\.put\(\s*['"]catalogo|registrarPublicacao/.test(fonte), arq + ' escreve direto no catálogo');
  }
  const ferr = fs.readFileSync(path.join(RAIZ, 'core/worker/_lib/mcp-ferramentas.js'), 'utf8');
  assert.match(ferr, /gravarCatalogo\(\{ env: ctx\.env, corpo, conta: ctx\.conta \}\)/, 'a única escrita é o caminho do PUT');
  const catalogo = fs.readFileSync(path.join(RAIZ, 'core/worker/api/catalogo.js'), 'utf8');
  assert.match(catalogo, /return gravarCatalogo\(\{ env, corpo, conta: data\.conta \}\)/, 'o PUT da mesa usa o mesmo caminho');
});

test('editar_titulo em rascunho: grava pelo caminho do PUT (rev sobe, histórico com o nome do token), sem mexer em publicar', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('curate', 'Claude da Ana')).token;
  const r = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { titulo: 'Aula Dois (revisada)', sinopse: 'Nova sinopse.', tags: ['a', 'b'], temporada: 2, episodio: null } });
  assert.equal(r.erro, false, JSON.stringify(r.dados));
  assert.equal(r.dados.rev, 6);
  assert.deepEqual(r.dados.camposAlterados.sort(), ['episodio', 'sinopse', 'tags', 'temporada', 'titulo']);
  assert.equal(r.dados.historico, true);
  const item = m.catalogo().itens.find((i) => i.id === 'aula-2');
  assert.equal(item.titulo, 'Aula Dois (revisada)');
  assert.equal(item.publicar, false, 'continua rascunho');
  assert.deepEqual(item.tags, ['a', 'b']);
  assert.equal(m.catalogo().rev, 6);
  /* o rastro é o mesmo do PUT: registro, cópia e quem */
  const chaves = Object.keys(m.env.CATALOGO.dados);
  assert.ok(chaves.some((k) => k.startsWith('historico:')), 'registro no histórico');
  assert.ok(chaves.some((k) => k.startsWith('versao:')), 'cópia da versão');
  const meta = Object.values(m.env.CATALOGO.metas).find((x) => x && x.rev === 6);
  assert.equal(meta.quem, 'mcp:Claude da Ana');
  /* e a mesa enxerga a linha do tempo */
  const hist = await m.c.get('/api/historico', { token: m.tokenSuper });
  assert.equal(hist.json.linha[0].quem, 'mcp:Claude da Ana');
});

test('editar_titulo: só campos de texto permitidos; id, fonte, publicar e o resto são recusados; tipos e tamanhos conferidos', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const antes = JSON.stringify(m.catalogo());
  for (const campo of ['id', 'fonte', 'publicar', 'destaque', 'capa_arquivo', 'duracao_seg', 'midia', 'rev', 'titularidade']) {
    const r = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { [campo]: 'x' } });
    assert.equal(r.dados.erro, 'campo-nao-permitido', campo);
  }
  const ruins = [{ titulo: '' }, { titulo: 5 }, { titulo: 'x'.repeat(201) }, { sinopse: 'x'.repeat(2001) }, { temporada: 'um' }, { temporada: -1 }, { temporada: 1.5 }, { tags: 'a' }, { tags: ['a', ''] }, { tags: Array(21).fill('t') }, { tags: [5] }];
  for (const campos of ruins) assert.equal((await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos })).dados.erro, 'argumento-invalido', JSON.stringify(campos).slice(0, 40));
  for (const args of [{ id: 'aula-2', campos: {} }, { id: 'aula-2', campos: [1] }, { id: 'aula-2' }, { campos: { titulo: 'x' } }]) {
    assert.equal((await m.chamar(t, 'editar_titulo', args)).dados.erro, 'argumento-invalido');
  }
  assert.equal((await m.chamar(t, 'editar_titulo', { id: 'fantasma', campos: { titulo: 'x' } })).dados.erro, 'titulo-inexistente');
  assert.equal(JSON.stringify(m.catalogo()), antes, 'nada foi gravado');
});

test('editar_titulo sem mudança real não grava nem sobe a rev', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const r = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { titulo: 'Aula Dois: Ação' } });
  assert.equal(r.dados.nadaMudou, true);
  assert.equal(m.catalogo().rev, 5);
  assert.ok(!m.env.CATALOGO.puts.includes('catalogo'));
});

test('editar_titulo em título NO AR pede confirmação: devolve o resumo, não altera; com confirmar:true grava', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const antes = JSON.stringify(m.catalogo());
  const pedido = await m.chamar(t, 'editar_titulo', { id: 'aula-1', campos: { titulo: 'Aula Um (nova)' } });
  assert.equal(pedido.erro, false);
  assert.equal(pedido.dados.confirmacaoNecessaria, true);
  assert.equal(pedido.dados.nadaFoiAlterado, true);
  assert.deepEqual(pedido.dados.resumo.conteudoNaoConfiavel, [{ campo: 'titulo', antes: 'Aula Um: Introdução', depois: 'Aula Um (nova)' }]);
  assert.equal(pedido.dados.resumo.publicado, true);
  assert.match(pedido.dados.comoConfirmar, /confirmar/);
  assert.equal(JSON.stringify(m.catalogo()), antes);
  for (const nao of [false, 'true', 1, null]) {
    assert.equal((await m.chamar(t, 'editar_titulo', { id: 'aula-1', campos: { titulo: 'Aula Um (nova)' }, confirmar: nao })).dados.confirmacaoNecessaria, true, 'confirmar:' + JSON.stringify(nao));
  }
  assert.equal(JSON.stringify(m.catalogo()), antes, 'só confirmar:true (booleano) vale');
  const ok = await m.chamar(t, 'editar_titulo', { id: 'aula-1', campos: { titulo: 'Aula Um (nova)' }, confirmar: true });
  assert.equal(ok.dados.ok, true);
  assert.equal(m.catalogo().itens[0].titulo, 'Aula Um (nova)');
  assert.deepEqual(m.auditoria().map((l) => l.resultado), ['confirmacao', 'confirmacao', 'confirmacao', 'confirmacao', 'confirmacao', 'ok']);
});

test('409: se o catálogo mudou desde a revisão que o agente leu, nada é gravado e o conflito é explicado', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const lido = (await m.chamar(t, 'ver_titulo', { id: 'aula-2' })).dados.rev;
  /* outra pessoa grava pela mesa no meio do caminho */
  const doc = JSON.parse(JSON.stringify(m.catalogo()));
  doc.itens[1].sinopse = 'Escrita por uma pessoa na mesa.';
  const put = await m.c.put('/api/catalogo', doc, { token: m.tokenSuper });
  assert.equal(put.status, 200, put.texto);
  const depois = JSON.stringify(m.catalogo());

  const r = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { sinopse: 'Do agente.' }, rev: lido });
  assert.equal(r.erro, true);
  assert.equal(r.dados.erro, 'conflito');
  assert.equal(r.dados.rev_servidor, lido + 1);
  assert.match(r.dados.mensagem, new RegExp('agora é a ' + (lido + 1)));
  assert.equal(JSON.stringify(m.catalogo()), depois, 'a escrita da pessoa foi preservada');
  assert.equal(m.auditoria().pop().resultado, 'conflito');
  /* lendo de novo e repetindo com a rev certa, passa */
  const ok = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { sinopse: 'Do agente.' }, rev: lido + 1 });
  assert.equal(ok.erro, false);
  assert.equal(m.catalogo().itens[1].sinopse, 'Do agente.');
  assert.equal((await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { sinopse: 'z' }, rev: 'x' })).dados.erro, 'argumento-invalido');
});

test('a conta do token passa pela conferência de permissão do PUT: o agente nunca é superadmin', async () => {
  /* A conta que o token representa só tem conteudo, no-ar e estrutura. O PUT recusaria `fonte`, `player` etc.; aqui provamos que
   * a conferência existe de fato mexendo na conta: curate pode, read não tem ferramenta de escrita, e `conta.super` é falso. */
  const { gravarCatalogo } = await import('../core/worker/api/catalogo.js');
  const m = await mundoMcp();
  const doc = JSON.parse(JSON.stringify(m.catalogo()));
  doc.itens[0].fonte = { provedor: 'bunny', id: 'trocado' };   /* campo de superadmin */
  const conta = { usuario: 'mcp:teste', super: false, permissoes: ['conteudo', 'no-ar', 'estrutura'] };
  const r = await gravarCatalogo({ env: m.env, corpo: doc, conta });
  assert.equal(r.status, 403);
  assert.equal(m.catalogo().rev, 5);
  doc.itens[0].fonte = { provedor: 'bunny', id: 'v-1', extras: { libraryId: '987654' } };
  doc.ajustes = { arrastoTeto: 0.9 };   /* permissão `player`, que o token não tem */
  assert.equal((await gravarCatalogo({ env: m.env, corpo: doc, conta })).status, 403);
  assert.equal((await gravarCatalogo({ env: m.env, corpo: doc, conta: null })).status, 401);
});

test('publicar_rascunho: sem confirmar só mostra o efeito; com confirmar:true põe no ar; título já no ar é recusado', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const pedido = await m.chamar(t, 'publicar_rascunho', { id: 'aula-2' });
  assert.equal(pedido.dados.confirmacaoNecessaria, true);
  assert.equal(pedido.dados.resumo.efeito, 'publicar');
  assert.equal(pedido.dados.resumo.visivelPara, 'privado');
  assert.equal(pedido.dados.resumo.conteudoNaoConfiavel.titulo, 'Aula Dois: Ação');
  assert.equal(m.catalogo().itens[1].publicar, false);
  const ok = await m.chamar(t, 'publicar_rascunho', { id: 'aula-2', confirmar: true });
  assert.equal(ok.dados.publicado, true);
  assert.equal(m.catalogo().itens[1].publicar, true);
  assert.equal(m.catalogo().rev, 6);
  assert.equal((await m.chamar(t, 'publicar_rascunho', { id: 'aula-2', confirmar: true })).dados.erro, 'ja-publicado');
  assert.equal((await m.chamar(t, 'publicar_rascunho', { id: 'fantasma', confirmar: true })).dados.erro, 'titulo-inexistente');
  /* o público vê pelo catálogo da mesma API */
  const pub = await m.c.get('/api/catalogo', { token: m.tokenSuper });
  assert.ok(pub.json.itens.some((i) => i.id === 'aula-2'));
});

test('organizar_home: mostra antes e depois sem alterar; com confirmar:true grava os blocos pelo PUT', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const pedido = await m.chamar(t, 'organizar_home', { ordem: ['series', 'destaque'], esconder: ['curtas'] });
  assert.equal(pedido.dados.confirmacaoNecessaria, true);
  const { antes, depois } = pedido.dados.resumo;
  assert.equal(antes[0].id, 'destaque');
  assert.deepEqual(depois.slice(0, 2).map((b) => b.id), ['series', 'destaque']);
  assert.equal(depois.find((b) => b.id === 'curtas').escondido, true);
  assert.equal(depois.length, antes.length, 'quem não foi citado vai para o fim, ninguém some');
  assert.equal(m.catalogo().site, undefined, 'nada gravado ainda');

  const ok = await m.chamar(t, 'organizar_home', { ordem: ['series', 'destaque'], esconder: ['curtas'], confirmar: true });
  assert.equal(ok.erro, false, JSON.stringify(ok.dados));
  assert.equal(ok.dados.rev, 6);
  const blocos = m.catalogo().site.blocos;
  assert.deepEqual(blocos.slice(0, 2).map((b) => b.id), ['series', 'destaque']);
  assert.equal(blocos.find((b) => b.id === 'curtas').escondido, true);
  /* a mesa lê a mesma coisa; e `mostrar` desfaz */
  assert.deepEqual((await m.c.get('/api/catalogo?completo=1', { token: m.tokenSuper })).json.site.blocos.map((b) => b.id), blocos.map((b) => b.id));
  const volta = await m.chamar(t, 'organizar_home', { mostrar: ['curtas'], confirmar: true });
  assert.equal(volta.erro, false);
  assert.equal(m.catalogo().site.blocos.find((b) => b.id === 'curtas').escondido, undefined);
  assert.equal((await m.chamar(t, 'organizar_home', { ordem: ['series', 'destaque'] })).dados.nadaMudou, true, 'já está assim');
});

test('organizar_home: id que não existe, tipo inválido e argumento torto são recusados antes de gravar', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const antes = JSON.stringify(m.catalogo());
  assert.equal((await m.chamar(t, 'organizar_home', { ordem: ['fantasma'], confirmar: true })).dados.erro, 'bloco-desconhecido');
  assert.equal((await m.chamar(t, 'organizar_home', { esconder: ['fantasma'], confirmar: true })).dados.erro, 'bloco-desconhecido');
  assert.equal((await m.chamar(t, 'organizar_home', { blocos: [{ tipo: 'inventado' }], confirmar: true })).dados.erro, 'blocos-invalidos');
  assert.equal((await m.chamar(t, 'organizar_home', { blocos: 'x', confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'organizar_home', { ordem: 'series', confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'organizar_home', { ordem: ['MAIÚSCULA'], confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'organizar_home', { confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal(JSON.stringify(m.catalogo()), antes);
  /* lista completa nova: validada e saneada */
  const nova = await m.chamar(t, 'organizar_home', { blocos: [{ tipo: 'destaque' }, { tipo: 'texto', texto: 'Bem-vindo' }], confirmar: true });
  assert.equal(nova.erro, false, JSON.stringify(nova.dados));
  assert.deepEqual(m.catalogo().site.blocos.map((b) => b.tipo), ['destaque', 'texto']);
});

test('criar_colecao: acrescenta sem apagar as que existem; id repetido, título inexistente e argumento ruim são recusados', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const r = await m.chamar(t, 'criar_colecao', { id: 'para-iniciantes', nome: 'Para iniciantes', titulos: ['aula-1', 'aula-2', 'aula-1'] });
  assert.equal(r.erro, false, JSON.stringify(r.dados));
  assert.equal(r.dados.rev, 6);
  const cols = m.catalogo().site.colecoes;
  assert.ok(cols.length >= 3, 'as duas de fábrica continuam: ' + JSON.stringify(cols.map((c) => c.id)));
  const nova = cols.find((c) => c.id === 'para-iniciantes');
  assert.deepEqual(nova.titulos, ['aula-1', 'aula-2']);
  assert.equal((await m.chamar(t, 'criar_colecao', { id: 'para-iniciantes', nome: 'Outra' })).dados.erro, 'colecao-existe');
  assert.equal((await m.chamar(t, 'criar_colecao', { id: 'x', nome: 'X', titulos: ['fantasma'] })).dados.erro, 'titulo-inexistente');
  for (const ruim of [{ id: 'Maiúscula', nome: 'x' }, { id: 'ok', nome: '' }, { id: 'ok', nome: 'x'.repeat(301) }, { id: 'ok', nome: 'x', titulos: 'a' }, { nome: 'sem id' }]) {
    assert.equal((await m.chamar(t, 'criar_colecao', ruim)).dados.erro, 'argumento-invalido', JSON.stringify(ruim).slice(0, 40));
  }
  assert.equal(m.catalogo().rev, 6, 'as recusas não gravaram');
});

/* ------------------------------------------------------------------ admin */

test('gerar_convite: sem confirmar só resume (e-mail mascarado, nada criado); com confirmar:true devolve o link de uso único', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const pedido = await m.chamar(t, 'gerar_convite', { email: 'Pessoa.Convidada@Exemplo.com' });
  assert.equal(pedido.dados.confirmacaoNecessaria, true);
  assert.equal(pedido.dados.resumo.para, 'pe***@exemplo.com');
  assert.equal(pedido.dados.resumo.validadeDias, 7);
  assert.ok(!JSON.stringify(pedido.dados).includes('pessoa.convidada'));
  assert.equal(m.env.DB.consultar('SELECT COUNT(*) AS n FROM convites')[0].n, 0);
  assert.equal(m.env.DB.consultar('SELECT COUNT(*) AS n FROM usuarios')[0].n, 0);

  const ok = await m.chamar(t, 'gerar_convite', { email: 'pessoa.convidada@exemplo.com', confirmar: true });
  assert.equal(ok.erro, false, JSON.stringify(ok.dados));
  assert.match(ok.dados.link, /^https:\/\/exemplo\.test\/entrar\.html#t=/);
  assert.equal(ok.dados.para, 'pe***@exemplo.com');
  assert.ok(ok.dados.expiraEm > Math.floor(Date.now() / 1000));
  assert.match(ok.dados.aviso, /uso único/);
  assert.equal(m.env.DB.consultar('SELECT COUNT(*) AS n FROM convites')[0].n, 1);
  assert.equal(m.env.DB.consultar('SELECT criado_por FROM convites')[0].criado_por, 'mcp:agente', 'o convite sabe quem o pediu');
  /* o e-mail e o link não vão para a auditoria */
  const linhas = JSON.stringify(m.auditoria());
  assert.ok(!linhas.includes('pessoa.convidada') && !linhas.includes('#t='), 'auditoria sem e-mail e sem link');
  assert.deepEqual(m.auditoria().map((l) => l.argumentos).filter((a) => a.includes('[oculto]')).length, 2);

  assert.equal((await m.chamar(t, 'gerar_convite', { email: 'não é e-mail', confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'gerar_convite', {})).dados.erro, 'argumento-invalido');
});

test('gerar_convite no modo público: contas não existem, então convite não se aplica', async () => {
  const m = await mundoMcp({ modo: 'publico' });
  const t = await admin(m);
  assert.equal((await m.chamar(t, 'gerar_convite', { email: 'a@exemplo.com', confirmar: true })).dados.erro, 'sem-contas');
});

test('trocar_textos: confirmação, só chaves conhecidas, vazio volta ao padrão, tudo pelo caminho do PUT', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const antes = JSON.stringify(m.catalogo());
  const pedido = await m.chamar(t, 'trocar_textos', { textos: { rodape: 'Feito com carinho.' } });
  assert.equal(pedido.dados.confirmacaoNecessaria, true);
  assert.deepEqual(pedido.dados.resumo.conteudoNaoConfiavel, [{ chave: 'rodape', antes: null, depois: 'Feito com carinho.' }]);
  assert.equal(JSON.stringify(m.catalogo()), antes);

  const ok = await m.chamar(t, 'trocar_textos', { textos: { rodape: 'Feito com carinho.' }, confirmar: true });
  assert.equal(ok.erro, false, JSON.stringify(ok.dados));
  assert.equal(m.catalogo().site.textos.rodape, 'Feito com carinho.');
  assert.equal(m.catalogo().rev, 6);
  assert.equal((await m.c.get('/api/catalogo', { token: m.tokenSuper })).json.site.textos.rodape, 'Feito com carinho.');
  assert.equal((await m.chamar(t, 'trocar_textos', { textos: { rodape: 'Feito com carinho.' } })).dados.nadaMudou, true);

  assert.equal((await m.chamar(t, 'trocar_textos', { textos: { inventada: 'x' }, confirmar: true })).dados.erro, 'texto-desconhecido');
  assert.equal((await m.chamar(t, 'trocar_textos', { textos: { rodape: 'x'.repeat(301) }, confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'trocar_textos', { textos: {}, confirmar: true })).dados.erro, 'argumento-invalido');
  assert.equal((await m.chamar(t, 'trocar_textos', { textos: { rodape: 5 }, confirmar: true })).dados.erro, 'argumento-invalido');

  const volta = await m.chamar(t, 'trocar_textos', { textos: { rodape: '' }, confirmar: true });
  assert.equal(volta.erro, false);
  assert.equal(m.catalogo().site, undefined, 'vazio volta ao padrão: a chave some e o `site` vazio também');
});

test('catálogo ainda não importado: as ferramentas dizem isso, sem estourar', async () => {
  const env = ambienteMcp({ CATALOGO: kvCompleto({}) });
  const m = await mundoMcp({ env });
  const t = await admin(m);
  assert.equal((await m.chamar(t, 'listar_titulos')).dados.erro, 'catalogo-vazio');
  assert.equal((await m.chamar(t, 'editar_titulo', { id: 'a', campos: { titulo: 'x' } })).dados.erro, 'catalogo-vazio');
  const e = (await m.chamar(t, 'estatisticas_basicas')).dados;
  assert.equal(e.catalogo.titulos, 0);
});

test('sem permissão de escrita no KV (falha do armazenamento): a ferramenta devolve erro sem vazar detalhe interno', async () => {
  const m = await mundoMcp();
  const t = await admin(m);
  const original = m.env.CATALOGO.put;
  m.env.CATALOGO.put = async () => { throw new Error('KV PUT failed: segredo-interno-123'); };
  const r = await m.chamar(t, 'editar_titulo', { id: 'aula-2', campos: { titulo: 'Novo' } });
  m.env.CATALOGO.put = original;
  assert.equal(r.erro, true);
  assert.equal(r.dados.erro, 'interno');
  assert.ok(!JSON.stringify(r).includes('segredo-interno-123'));
  assert.equal(m.auditoria().pop().resultado, 'erro');
});

test('trocar_textos: nomes herdados de Object.prototype não são chaves de texto (nada vai ao KV)', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('admin', 'admin')).token;
  const antes = JSON.stringify(m.catalogo());
  for (const nome of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    const r = await m.chamar(t, 'trocar_textos', { textos: JSON.parse('{"' + nome + '":"pwn"}'), confirmar: true });
    assert.equal(r.erro, true, nome);
    assert.equal(r.dados.erro, 'texto-desconhecido', nome);
  }
  assert.equal(JSON.stringify(m.catalogo()), antes, 'nada foi gravado');
});

test('catalogo-core: textoDoSite, comTexto e siteSaneado ignoram chaves herdadas', () => {
  const App = require('../core/site/catalogo-core.js');
  for (const nome of ['constructor', 'toString', '__proto__']) {
    assert.equal(App.textoDoSite({}, nome), '', nome);
    assert.deepEqual(App.comTexto({}, nome, 'pwn').textos || {}, {}, nome);
  }
  const s = App.siteSaneado(JSON.parse('{"textos":{"constructor":"x","toString":"y","__proto__":"z"}}'));
  assert.deepEqual(Object.keys(s.textos), []);
});

test('chamada com ferramenta desconhecida ou argumentos inválidos entra na auditoria', async () => {
  const m = await mundoMcp();
  const t = (await m.criar('read', 'leitor')).token;
  const a = await m.rpc('tools/call', { name: 'nao_existe', arguments: {} }, { token: t });
  assert.ok(a.erro || a.error || a.json, 'erro de protocolo');
  await m.rpc('tools/call', { name: 'listar_titulos', arguments: [1] }, { token: t });
  const aud = m.auditoria().map((l) => [l.ferramenta, l.resultado, l.detalhe]);
  assert.deepEqual(aud, [['nao_existe', 'erro', 'ferramenta-desconhecida'], ['listar_titulos', 'erro', 'argumentos-invalidos']]);
});
