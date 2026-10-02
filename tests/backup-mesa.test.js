/* M8 — a tela Backup da mesa (mesa-backup.js) rodando de verdade num DOM falso.
 *
 * Exportar: baixa o arquivo (só o superadmin leva as contas, e a tela avisa que ficou sensível). Importar, em três tempos:
 * escolher o arquivo (lido no navegador), conferir (o servidor simula e não grava) e restaurar (com confirmação e com a `rev`
 * que a tela viu, para o 409 de sempre). As contas nascem desmarcadas. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirOperacao, resposta } = require('./assistente-ambiente.js');

const BACKUP = {
  formato: 'streaming-backup', versaoDoFormato: 1, core: '0.1.0', criadoEm: '2026-10-01T10:00:00.000Z', origem: 'script',
  resumo: { titulos: 4, noAr: 3, rev: 9 }, hashes: { catalogo: 'sha256:' + 'a'.repeat(64) }, hash: 'sha256:' + 'b'.repeat(64),
  conteudo: { catalogo: { rev: 9, itens: [] }, operacao: { player: { marcaDagua: { ligada: false } } }, legal: null, contas: { equipe: [], espectadores: [] } }
};
const PLANO = { catalogo: { titulos: 4, revDe: 5, revPara: 6, mudancas: 12, hash: 'sha256:' + 'a'.repeat(64) }, operacao: { secoes: ['player'] } };

function rotas(extra) {
  return Object.assign({
    '/api/backup': (url, init) => {
      if (!init || !init.method || init.method === 'GET') return Object.assign({}, BACKUP, { criadoEm: '2026-10-02T08:30:00.000Z' });
      const corpo = JSON.parse(init.body);
      return corpo.simular ? { ok: true, simulado: true, plano: PLANO, partes: ['catalogo', 'operacao'] } : { ok: true, simulado: false, plano: PLANO, feito: { catalogo: { rev: 6, titulos: 4, historico: true, hash: PLANO.catalogo.hash }, operacao: { secoes: ['player'] } } };
    },
    '/api/saude': () => ({ geradoEm: '2026-10-02T09:00:00.000Z', versao: { core: '0.1.0', ultima: null, nova: false }, checagens: [], resumo: { ok: 0, aviso: 0, erro: 0, pulado: 0 }, segredos: [], armazenamento: {}, backup: {}, assistente: { estado: 'concluido' } }),
    '/api/catalogo': () => ({ rev: 6, itens: [] })
  }, extra || {});
}

async function escolher(t, texto = JSON.stringify(BACKUP)) {
  const campo = t.achar('#bkp-arquivo');
  campo.files = [t.arquivo(texto, 'meu-backup.json')];
  t.mudar(campo);
  await t.esperar();
}

test('baixar o backup: pede ao servidor, entrega um arquivo com o dia no nome e avisa', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  t.clicar('[data-acao="bkp-exportar"]');
  await t.esperar();
  const p = t.pedidosDe('/api/backup', 'GET');
  assert.equal(p.length, 1);
  assert.ok(!/contas=1/.test(p[0].url), 'sem contas, a menos que se marque');
  assert.equal(t.baixados.length, 1, 'um arquivo foi entregue');
  const arquivo = JSON.parse(await t.baixados[0].text());
  assert.equal(arquivo.formato, 'streaming-backup');
  assert.match(t.aviso.textContent, /Backup baixado/);
  assert.match(t.texto(), /Último backup baixado: .*com 4 títulos/);
  assert.ok(t.pedidosDe('/api/saude').length >= 1, 'a Saúde é relida: o "último backup" muda');
});

test('com contas: só o superadmin vê a caixa, o aviso de arquivo sensível aparece e o pedido leva ?contas=1', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  assert.ok(t.achar('#bkp-contas'));
  assert.ok(!/Este arquivo será sensível/.test(t.texto()));
  t.mudar('#bkp-contas', true);
  assert.match(t.texto(), /Este arquivo será sensível/);
  assert.ok(t.achar('[role="note"]'), 'o aviso é anunciado');
  t.clicar('[data-acao="bkp-exportar"]');
  await t.esperar();
  assert.match(t.pedidosDe('/api/backup', 'GET')[0].url, /\?contas=1$/);
  assert.match(t.baixados.length ? 'ok' : 'x', /ok/);

  const equipe = abrirOperacao({ super: false, permissoes: ['conteudo'], rotas: rotas() });
  equipe.tela('backup');
  assert.ok(!equipe.achar('#bkp-contas'), 'a equipe não leva contas');
  assert.ok(!equipe.achar('#bkp-arquivo'), 'nem restaura');
  assert.match(equipe.texto(), /Só o superadmin restaura/);
  equipe.clicar('[data-acao="bkp-exportar"]');
  await equipe.esperar();
  assert.ok(!/contas=1/.test(equipe.pedidosDe('/api/backup', 'GET')[0].url));
});

test('escolher o arquivo: mostra de quando é e o que traz, tudo lido no navegador (nenhum pedido ao servidor)', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  const antes = t.pedidos.length;
  await escolher(t);
  assert.equal(t.pedidos.length, antes, 'escolher o arquivo não manda nada para fora');
  assert.match(t.texto(), /meu-backup\.json/);
  assert.match(t.texto(), /versão 0\.1\.0, feito por script, com 4 títulos/);
  assert.equal(t.achar('#bkp-p-catalogo').checked, true);
  assert.equal(t.achar('#bkp-p-operacao').checked, true);
  assert.ok(!t.achar('#bkp-p-contas').checked, 'as contas nascem desmarcadas');
  assert.equal(t.achar('#bkp-p-legal').hasAttribute('disabled') || t.achar('#bkp-p-legal').disabled, true, 'o que o arquivo não traz fica desligado');
  assert.ok(t.achar('[data-acao="bkp-restaurar"]').disabled, 'não dá para restaurar sem conferir antes');
});

test('arquivo que não é um backup: erro anunciado, e nada para restaurar', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  await escolher(t, '{"qualquer":"coisa"}');
  assert.match(t.texto(), /não parece um backup deste produto/);
  assert.ok(t.achar('[role="alert"]'));
  assert.ok(!t.achar('[data-acao="bkp-conferir"]'));
  await escolher(t, 'isto nem é JSON');
  assert.match(t.texto(), /não parece um backup deste produto/);
});

test('conferir: manda simular com a rev que a tela viu e as partes marcadas, e mostra o plano em palavras', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  await escolher(t);
  t.clicar('[data-acao="bkp-conferir"]');
  await t.esperar();
  const post = t.pedidosDe('/api/backup', 'POST');
  assert.equal(post.length, 1);
  const corpo = t.corpoDe(post[0]);
  assert.equal(corpo.simular, true);
  assert.equal(corpo.rev, 5, 'a rev do catálogo que esta tela leu');
  assert.deepEqual(corpo.aplicar, { catalogo: true, operacao: true, legal: false, contas: false });
  assert.equal(corpo.backup.formato, 'streaming-backup');
  assert.match(t.texto(), /Catálogo: 4 títulos entram como a revisão 6 \(hoje é a 5\); 12 mudanças/);
  assert.match(t.texto(), /Configuração do \/admin: seções player/);
  assert.match(t.texto(), /nada foi gravado ainda/i);
  assert.ok(!t.achar('[data-acao="bkp-restaurar"]').disabled, 'agora dá para restaurar');
  assert.equal(t.pedidosDe('/api/catalogo').length, 0);
});

test('mexer nas partes depois de conferir invalida a conferência', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  await escolher(t);
  t.clicar('[data-acao="bkp-conferir"]');
  await t.esperar();
  t.mudar('#bkp-p-operacao', false);
  assert.ok(t.achar('[data-acao="bkp-restaurar"]').disabled, 'o plano era de outra escolha');
  assert.ok(!/nada foi gravado ainda/i.test(t.texto()));
});

test('restaurar pede confirmação; sem o "sim" nada vai; com o "sim" grava e relê o catálogo', async () => {
  const nao = abrirOperacao({ rotas: rotas(), confirmar: false });
  nao.tela('backup');
  await escolher(nao);
  nao.clicar('[data-acao="bkp-conferir"]'); await nao.esperar();
  nao.clicar('[data-acao="bkp-restaurar"]'); await nao.esperar();
  assert.equal(nao.confirmacoes.length, 1);
  assert.match(nao.confirmacoes[0], /dá para voltar/);
  assert.equal(nao.pedidosDe('/api/backup', 'POST').length, 1, 'só a conferência');

  const sim = abrirOperacao({ rotas: rotas(), confirmar: true });
  sim.tela('backup');
  await escolher(sim);
  sim.clicar('[data-acao="bkp-conferir"]'); await sim.esperar();
  sim.clicar('[data-acao="bkp-restaurar"]'); await sim.esperar();
  const posts = sim.pedidosDe('/api/backup', 'POST');
  assert.equal(posts.length, 2);
  assert.equal(sim.corpoDe(posts[1]).simular, false);
  assert.equal(sim.corpoDe(posts[1]).rev, 5);
  assert.match(sim.texto(), /Pronto\. Isto foi restaurado/);
  assert.match(sim.texto(), /Catálogo: 4 títulos, agora na revisão 6/);
  assert.match(sim.texto(), /sha256:aaaaaaaaaaaa…/);
  assert.ok(sim.pedidosDe('/api/catalogo').length >= 1, 'a tela relê o catálogo que o servidor tem agora');
  assert.equal(sim.M.st.servidor.rev, 6);
});

test('409: o catálogo mudou no meio — a tela explica, recarrega e pede para conferir de novo', async () => {
  const t = abrirOperacao({ rotas: rotas({
    '/api/backup': (url, init) => (init && init.method === 'POST' ? resposta({ codigo: 'catalogo-mudou', rev_servidor: 8 }, 409) : BACKUP)
  }) });
  t.tela('backup');
  await escolher(t);
  t.clicar('[data-acao="bkp-conferir"]');
  await t.esperar();
  assert.match(t.texto(), /O catálogo mudou desde que esta tela o leu/);
  assert.ok(t.achar('[role="alert"]'));
  assert.ok(t.pedidosDe('/api/catalogo').length >= 1, 'recarregou o catálogo do servidor');
});

test('arquivo corrompido: o erro do servidor aparece com o código traduzido e nada fica pela metade', async () => {
  const t = abrirOperacao({ rotas: rotas({
    '/api/backup': (url, init) => (init && init.method === 'POST' ? resposta({ codigo: 'backup-corrompido', params: { parte: 'catalogo' } }, 400) : BACKUP)
  }) });
  t.tela('backup');
  await escolher(t);
  t.clicar('[data-acao="bkp-conferir"]');
  await t.esperar();
  assert.match(t.texto(), /não passou na conferência: o arquivo foi alterado ou está incompleto \(parte: catalogo\)/);
  assert.ok(t.achar('[data-acao="bkp-restaurar"]').disabled);
});

test('rascunho aberto + catálogo marcado: a tela avisa antes de restaurar', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.M.st.rascunho = [{ alvo: 'item:a', campo: 'titulo', antes: 'A', depois: 'B' }];
  t.tela('backup');
  await escolher(t);
  assert.match(t.texto(), /Você tem alterações no rascunho/);
  t.mudar('#bkp-p-catalogo', false);
  assert.ok(!/Você tem alterações no rascunho/.test(t.texto()), 'sem o catálogo marcado, o rascunho não corre risco');
});

test('acessibilidade: todo campo tem rótulo, o arquivo tem dica ligada, e as partes ficam num grupo com legenda', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  await escolher(t);
  for (const campo of t.todos('input')) {
    const id = campo.id;
    assert.ok(id, 'campo sem id');
    assert.ok(t.todos('label').some((l) => l.getAttribute('for') === id), 'campo sem <label for>: ' + id);
  }
  assert.equal(t.achar('#bkp-arquivo').getAttribute('aria-describedby'), 'bkp-arquivo-dica');
  assert.ok(t.achar('fieldset legend'.split(' ')[0]), 'grupo de partes');
  assert.ok(t.achar('legend'));
  assert.ok(t.todos('button').every((b) => b.textContent.trim().length > 0), 'botão sem nome');
});

test('o painel da direita diz quando fazer backup e o que não entra', async () => {
  const t = abrirOperacao({ rotas: rotas() });
  t.tela('backup');
  assert.match(t.painelDir.textContent, /senhas e chaves \(ficam na Cloudflare\)/);
  assert.match(t.painelDir.textContent, /marca de conferência do catálogo tem de ser a mesma/);
});
