/* scripts/exportar-kv.mjs e scripts/importar-kv.mjs, com um wrangler simulado (um Map no lugar do KV). O formato e as regras
 * são os do /admin (core/worker/_lib/backup.js, testado em tests/backup.test.js): aqui se confere a COLA: o KV por wrangler,
 * as flags, a cópia de segurança, o "sim" explícito e a ida e volta com comparação de hash. Sem rede, sem conta Cloudflare. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exportar = () => import('../scripts/exportar-kv.mjs');
const importar = () => import('../scripts/importar-kv.mjs');
const biblioteca = () => import('../core/worker/_lib/backup.js');

const CATALOGO = {
  versao: 1, rev: 7, total: 3, atualizado_em: '2026-09-30T10:00:00.000Z',
  itens: [
    { id: 'a', titulo: 'Aula 1', serie: 'Curso', temporada: 1, episodio: 1, publicar: true, fonte: { provedor: 'bunny', id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', extras: {} } },
    { id: 'b', titulo: 'Aula 2', serie: 'Curso', temporada: 1, episodio: 2, publicar: true, fonte: { provedor: 'bunny', id: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff', extras: {} } },
    { id: 'c', titulo: 'Rascunho', publicar: false }
  ],
  site: { textos: { rodape: 'Feito com carinho' } }
};
const EQUIPE = { contas: [{ usuario: 'maria', nome: 'Maria', permissoes: [], ativa: true, versao: 1, senha: { hash: 'h4sh-d4-s3nh4', sal: 's4l', iter: 10000 }, criada_em: '2026-09-01T00:00:00.000Z' }] };
const SEMENTE = () => new Map([
  ['catalogo', { valor: JSON.stringify(CATALOGO) }],
  ['config:operacao', { valor: JSON.stringify({ player: { autoplay: { modo: 'nunca' } } }) }],
  ['admins', { valor: JSON.stringify(EQUIPE) }],
  ['busca:fala', { valor: 'linha\nlinha' }],
  ['versao:00000006', { valor: JSON.stringify({ rev: 6, itens: [] }) }]
]);

/* Um projeto mínimo + wrangler simulado sobre um Map. */
function mundo(kv = SEMENTE()) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-bkp-'));
  fs.writeFileSync(path.join(raiz, 'wrangler.jsonc'), '{ "name": "minha-tela", "kv_namespaces": [{ "binding": "CATALOGO", "id": "' + 'a'.repeat(32) + '" }] }');
  const chamadas = [];
  const exec = async (cmd, args = []) => {
    chamadas.push([cmd, ...args]);
    const w = args.slice(args.indexOf('wrangler@4') + 1);
    const ok = (saida = '') => ({ codigo: 0, saida, erro: '' });
    if (w[0] === 'kv' && w[1] === 'key' && w[2] === 'list') return ok(JSON.stringify([...kv].map(([name, v]) => ({ name, ...(v.metadata ? { metadata: v.metadata } : {}) }))));
    if (w[0] === 'kv' && w[1] === 'key' && w[2] === 'get') {
      if (!kv.has(w[3])) return { codigo: 1, saida: '', erro: 'not found' };
      return ok(kv.get(w[3]).valor + '\n');
    }
    if (w[0] === 'kv' && w[1] === 'key' && w[2] === 'put') {
      const meta = w.indexOf('--metadata');
      kv.set(w[3], { valor: fs.readFileSync(w[w.indexOf('--path') + 1], 'utf8'), ...(meta > 0 ? { metadata: JSON.parse(w[meta + 1]) } : {}) });
      return ok('Success');
    }
    if (w[0] === 'kv' && w[1] === 'key' && w[2] === 'delete') { kv.delete(w[3]); return ok('Success'); }
    return { codigo: 1, saida: '', erro: 'comando inesperado: ' + w.join(' ') };
  };
  const ctx = { raiz, env: {}, exec, agora: () => new Date('2026-10-02T12:00:00Z') };
  const escritas = () => chamadas.filter((c) => c.includes('put') || c.includes('delete'));
  return { raiz, kv, chamadas, ctx, escritas };
}
const lerJson = (m, chave) => JSON.parse(m.kv.get(chave).valor);

test('exportar-kv grava dados/backup-AAAA-MM-DD.json no formato do /admin, sem equipe, e só LÊ', async () => {
  const { principal } = await exportar();
  const lib = await biblioteca();
  const m = mundo();
  const r = await principal([], m.ctx);
  assert.equal(r.codigo, 0, r.texto);
  const arq = path.join(m.raiz, 'dados', 'backup-2026-10-02.json');
  const b = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.equal(b.formato, lib.FORMATO);
  assert.equal(b.origem, 'script');
  assert.equal(b.resumo.titulos, 3);
  assert.equal(b.resumo.noAr, 2);
  assert.equal(b.resumo.rev, 7);
  assert.equal(b.resumo.operacao, true);
  assert.equal(b.conteudo.contas, null, 'a equipe só entra com --com-contas');
  assert.doesNotMatch(fs.readFileSync(arq, 'utf8'), /h4sh-d4-s3nh4|nao-deve/);
  assert.equal((await lib.verificarBackup(b)).ok, true, 'o arquivo passa na conferência do Worker');
  assert.match(r.texto, /3 títulos \(2 no ar\)/);
  assert.equal(m.escritas().length, 0, 'exportar nunca escreve no KV');
});

test('exportar-kv --com-contas inclui a equipe (com aviso de dado sensível); --saida - escreve na tela; sem catálogo, falha clara', async () => {
  const { principal } = await exportar();
  const m = mundo();
  const r = await principal(['--com-contas', '--saida', 'sub/b.json'], m.ctx);
  assert.equal(r.codigo, 0, r.texto);
  assert.match(r.texto, /ATENÇÃO/);
  const b = JSON.parse(fs.readFileSync(path.join(m.raiz, 'sub', 'b.json'), 'utf8'));
  assert.equal(b.conteudo.contas.equipe[0].usuario, 'maria');
  const tela = await principal(['--saida', '-'], mundo().ctx);
  assert.equal(JSON.parse(tela.texto).formato, (await biblioteca()).FORMATO);
  const vazio = await principal([], mundo(new Map([['outra', { valor: 'x' }]])).ctx);
  assert.equal(vazio.codigo, 1);
  assert.match(vazio.texto, /catalogo/);
});

test('exportar-kv --registrar anota o backup para a tela Saúde (e só então escreve no KV)', async () => {
  const { principal } = await exportar();
  const m = mundo();
  const r = await principal(['--registrar', '--json'], m.ctx);
  assert.equal(JSON.parse(r.texto).registrado, true);
  const nota = lerJson(m, 'backup:ultimo');
  assert.equal(nota.origem, 'script');
  assert.equal(nota.titulos, 3);
  assert.equal(m.escritas().length, 1);
});

test('exportar-kv --json devolve o resumo sem o conteúdo; flag desconhecida e segredo na linha são uso incorreto', async () => {
  const { principal } = await exportar();
  const r = await principal(['--json'], mundo().ctx);
  const j = JSON.parse(r.texto);
  assert.equal(j.ok, true);
  assert.equal(j.resumo.titulos, 3);
  assert.equal('conteudo' in j, false);
  assert.equal((await principal(['--senha', 'x'], mundo().ctx)).codigo, 2);
  assert.equal((await principal(['--nada'], mundo().ctx)).codigo, 2);
});

test('importar-kv sem --yes confere o arquivo, mostra o plano e NÃO grava nada', async () => {
  const exp = await exportar(), imp = await importar();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json'], origem.ctx);
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify({ rev: 1, itens: [] }) }]]));
  fs.copyFileSync(path.join(origem.raiz, 'b.json'), path.join(destino.raiz, 'b.json'));
  const r = await imp.principal(['b.json'], destino.ctx);
  assert.equal(r.codigo, 0, r.texto);
  assert.match(r.texto, /Nada foi alterado/);
  assert.match(r.texto, /3 títulos; a revisão 1 passaria a 2/);
  assert.equal(destino.escritas().length, 0);
  assert.equal(lerJson(destino, 'catalogo').rev, 1);
});

test('ida e volta: exportar, restaurar com --yes em outro KV e conferir que o hash do catálogo é o mesmo', async () => {
  const exp = await exportar(), imp = await importar(), lib = await biblioteca();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json'], origem.ctx);
  const arquivo = fs.readFileSync(path.join(origem.raiz, 'b.json'), 'utf8');
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify({ rev: 3, itens: [{ id: 'velho', titulo: 'Velho' }] }) }], ['sessao:x', { valor: 'fica' }]]));
  fs.writeFileSync(path.join(destino.raiz, 'b.json'), arquivo);
  const r = await imp.principal(['b.json', '--yes', '--json'], destino.ctx);
  const j = JSON.parse(r.texto);
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(j.aplicado, true);
  assert.equal(j.conferido, true);
  assert.equal(j.hashDoCatalogo, JSON.parse(arquivo).hashes.catalogo);
  /* É uma publicação: a rev sobe e o histórico guarda o estado anterior. */
  const cat = lerJson(destino, 'catalogo');
  assert.equal(cat.rev, 4);
  assert.equal(cat.itens.length, 3);
  assert.ok([...destino.kv.keys()].some((k) => k.startsWith('versao:')), 'cópia no histórico');
  assert.ok([...destino.kv.keys()].some((k) => k.startsWith('historico:')), 'registro no histórico');
  assert.deepEqual(lerJson(destino, 'config:operacao'), { player: { autoplay: { modo: 'nunca' } } });
  assert.equal(destino.kv.has('admins'), false, 'a equipe não vai sem --com-contas');
  assert.equal(destino.kv.get('sessao:x').valor, 'fica', 'nunca toca no que não é do backup');
  /* Exportar de novo dá o MESMO hash do catálogo (a rev anda, o conteúdo não). */
  const de = JSON.parse((await exp.principal(['--saida', '-'], destino.ctx)).texto);
  assert.equal(de.hashes.catalogo, JSON.parse(arquivo).hashes.catalogo);
  assert.equal((await lib.verificarBackup(de)).ok, true);
  /* A cópia de segurança do estado anterior foi guardada, em arquivo só do dono. */
  const seguranca = fs.readdirSync(path.join(destino.raiz, 'dados')).find((n) => n.startsWith('pre-restauracao-'));
  assert.ok(seguranca);
  const copia = JSON.parse(fs.readFileSync(path.join(destino.raiz, 'dados', seguranca), 'utf8'));
  assert.equal(copia.conteudo.catalogo.itens[0].id, 'velho');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(destino.raiz, 'dados', seguranca)).mode & 0o077, 0);
});

test('importar-kv --com-contas restaura a equipe sem sobrescrever quem já existe', async () => {
  const exp = await exportar(), imp = await importar();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json', '--com-contas'], origem.ctx);
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify(CATALOGO) }]]));
  fs.copyFileSync(path.join(origem.raiz, 'b.json'), path.join(destino.raiz, 'b.json'));
  const r = await imp.principal(['b.json', '--yes', '--com-contas'], destino.ctx);
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(lerJson(destino, 'admins').contas[0].usuario, 'maria');
  /* de novo: a conta já existe e fica como está */
  lerJson(destino, 'admins').contas[0].nome = 'Mudou';
  const dois = await imp.principal(['b.json', '--yes', '--com-contas', '--json'], destino.ctx);
  assert.equal(JSON.parse(dois.texto).feito.contas.equipe.puladas, 1);
});

test('importar-kv --partes limita o que é restaurado; parte desconhecida (legal) é uso incorreto', async () => {
  const exp = await exportar(), imp = await importar();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json'], origem.ctx);
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify({ rev: 1, itens: [] }) }]]));
  fs.copyFileSync(path.join(origem.raiz, 'b.json'), path.join(destino.raiz, 'b.json'));
  const r = await imp.principal(['b.json', '--yes', '--partes', 'catalogo'], destino.ctx);
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(destino.kv.has('config:operacao'), false);
  assert.equal((await imp.principal(['b.json', '--partes', 'legal'], destino.ctx)).codigo, 2);
});

test('importar-kv recusa arquivo adulterado, que não existe ou sem argumento, sem tocar no KV', async () => {
  const exp = await exportar(), imp = await importar();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json'], origem.ctx);
  const b = JSON.parse(fs.readFileSync(path.join(origem.raiz, 'b.json'), 'utf8'));
  b.conteudo.catalogo.itens[0].titulo = 'Alterado à mão';
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify(CATALOGO) }]]));
  fs.writeFileSync(path.join(destino.raiz, 'ruim.json'), JSON.stringify(b));
  const r = await imp.principal(['ruim.json', '--yes'], destino.ctx);
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /conferência/);
  fs.writeFileSync(path.join(destino.raiz, 'torto.json'), '{ nao é json');
  assert.equal((await imp.principal(['torto.json', '--yes'], destino.ctx)).codigo, 1);
  assert.equal(destino.escritas().length, 0);
  assert.equal((await imp.principal(['nao-existe.json'], destino.ctx)).codigo, 1);
  assert.equal((await imp.principal([], destino.ctx)).codigo, 2);
});

test('--namespace-id e --local viram argumentos do wrangler; sem id no wrangler.jsonc procura "<projeto>-catalogo"', async () => {
  const exp = await exportar();
  const m = mundo();
  await exp.principal(['--namespace-id', 'b'.repeat(32), '--local', '--saida', '-'], m.ctx);
  const lista = m.chamadas.find((c) => c.includes('list'));
  assert.ok(lista.includes('--namespace-id') && lista.includes('b'.repeat(32)) && lista.includes('--local'));
  assert.equal(lista.includes('--remote'), false);
  const sem = mundo();
  fs.writeFileSync(path.join(sem.raiz, 'wrangler.jsonc'), '{ "name": "loja", "kv_namespaces": [{ "binding": "CATALOGO" }] }');
  const base = sem.ctx.exec;
  sem.ctx.exec = async (cmd, args = []) => (args.join(' ').includes('kv namespace list')
    ? { codigo: 0, saida: JSON.stringify([{ id: 'c'.repeat(32), title: 'loja-catalogo' }]), erro: '' } : base(cmd, args));
  const r = await exp.principal(['--saida', '-'], sem.ctx);
  assert.equal(r.codigo, 0, r.texto);
  assert.ok(sem.chamadas.some((c) => c.includes('c'.repeat(32))));
});

test('o valor de uma chave nunca vai na linha de comando do wrangler (vai por arquivo temporário)', async () => {
  const exp = await exportar(), imp = await importar();
  const origem = mundo();
  await exp.principal(['--saida', 'b.json', '--com-contas'], origem.ctx);
  const destino = mundo(new Map([['catalogo', { valor: JSON.stringify({ rev: 1, itens: [] }) }]]));
  fs.copyFileSync(path.join(origem.raiz, 'b.json'), path.join(destino.raiz, 'b.json'));
  await imp.principal(['b.json', '--yes', '--com-contas'], destino.ctx);
  const puts = destino.chamadas.filter((c) => c.includes('put'));
  assert.ok(puts.length >= 3);
  for (const c of puts) {
    assert.ok(c.includes('--path'));
    assert.ok(!c.some((a) => /h4sh-d4-s3nh4|Aula 1/.test(a)), 'conteúdo na linha de comando: ' + c.slice(0, 5).join(' '));
  }
});
