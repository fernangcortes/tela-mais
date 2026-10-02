/* scripts/migrar-config.mjs: versão do esquema, cadeia de migrações, idempotência, cópia, config mais nova que o core. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mod = () => import('../scripts/migrar-config.mjs');
const RAIZ_REAL = path.join(__dirname, '..');

function projeto({ versaoConfig = 1, enumEsquema = [1], extra = {} } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-mig-'));
  fs.mkdirSync(path.join(raiz, 'config'));
  const cfg = { versaoDoEsquema: versaoConfig, marca: { nome: 'Minha Tela' }, ...extra };
  fs.writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(raiz, 'config/site.schema.json'), JSON.stringify({ properties: { versaoDoEsquema: { type: 'integer', enum: enumEsquema } } }));
  return raiz;
}
const lerCfg = (raiz) => JSON.parse(fs.readFileSync(path.join(raiz, 'config/site.json'), 'utf8'));
const M12 = { 1: { para: 2, descricao: 'move marca.nome para marca.titulo', migrar(c) { const { nome, ...resto } = c.marca; return { ...c, versaoDoEsquema: 2, marca: { ...resto, titulo: nome } }; } } };
const M123 = { ...M12, 2: { para: 3, descricao: 'liga recurso novo', migrar: (c) => ({ ...c, versaoDoEsquema: 3, recursos: { ...(c.recursos || {}), novo: true } }) } };

test('a config e o esquema do repositório estão na mesma versão (nada a migrar hoje)', async () => {
  const { principal, versaoSuportada } = await mod();
  const esquema = JSON.parse(fs.readFileSync(path.join(RAIZ_REAL, 'config/site.schema.json'), 'utf8'));
  assert.equal(versaoSuportada(esquema), 1);
  const r = await principal(['--verificar'], { raiz: RAIZ_REAL });
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(r.migrado, false);
});

test('versaoSuportada: maior do enum; sem enum usa o default; sem nada, 1', async () => {
  const { versaoSuportada } = await mod();
  assert.equal(versaoSuportada({ properties: { versaoDoEsquema: { enum: [1, 3, 2] } } }), 3);
  assert.equal(versaoSuportada({ properties: { versaoDoEsquema: { default: 2 } } }), 2);
  assert.equal(versaoSuportada({}), 1);
  assert.equal(versaoSuportada(null), 1);
});

test('migra em cadeia (1 -> 2 -> 3), guarda cópia e não perde nada da pessoa', async () => {
  const { principal } = await mod();
  const raiz = projeto({ enumEsquema: [3], extra: { idiomas: { padrao: 'pt-BR' } } });
  const r = await principal(['--json'], { raiz, migracoes: M123 });
  const j = JSON.parse(r.texto);
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(j.migrado, true);
  assert.equal(j.passos.length, 2);
  const nova = lerCfg(raiz);
  assert.equal(nova.versaoDoEsquema, 3);
  assert.equal(nova.marca.titulo, 'Minha Tela');
  assert.equal(nova.recursos.novo, true);
  assert.deepEqual(nova.idiomas, { padrao: 'pt-BR' });
  const antes = JSON.parse(fs.readFileSync(path.join(raiz, 'config/site.json.antes-da-migracao'), 'utf8'));
  assert.equal(antes.versaoDoEsquema, 1);
  assert.equal(antes.marca.nome, 'Minha Tela');
});

test('é idempotente: rodar de novo não muda nada nem cria outra cópia', async () => {
  const { principal } = await mod();
  const raiz = projeto({ enumEsquema: [2] });
  await principal([], { raiz, migracoes: M12 });
  const depois = fs.readFileSync(path.join(raiz, 'config/site.json'), 'utf8');
  fs.rmSync(path.join(raiz, 'config/site.json.antes-da-migracao'));
  const r = await principal([], { raiz, migracoes: M12 });
  assert.equal(r.codigo, 0);
  assert.equal(r.migrado, false);
  assert.equal(fs.readFileSync(path.join(raiz, 'config/site.json'), 'utf8'), depois);
  assert.equal(fs.existsSync(path.join(raiz, 'config/site.json.antes-da-migracao')), false);
});

test('--verificar não grava e sai 1 enquanto precisa migrar', async () => {
  const { principal } = await mod();
  const raiz = projeto({ enumEsquema: [2] });
  const antes = fs.readFileSync(path.join(raiz, 'config/site.json'), 'utf8');
  const r = await principal(['--verificar'], { raiz, migracoes: M12 });
  assert.equal(r.codigo, 1);
  assert.equal(r.precisaMigrar, true);
  assert.equal(fs.readFileSync(path.join(raiz, 'config/site.json'), 'utf8'), antes);
});

test('config mais nova que o core: não mexe e manda atualizar o core', async () => {
  const { principal } = await mod();
  const raiz = projeto({ versaoConfig: 3, enumEsquema: [1] });
  const r = await principal([], { raiz });
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /Atualize o core/);
  assert.equal(lerCfg(raiz).versaoDoEsquema, 3);
});

test('migração faltando ou mal escrita para com mensagem, sem gravar', async () => {
  const { principal } = await mod();
  const raiz = projeto({ enumEsquema: [2] });
  const sem = await principal([], { raiz, migracoes: {} });
  assert.equal(sem.codigo, 1);
  assert.match(sem.texto, /não existe migração/);
  const torta = await principal([], { raiz, migracoes: { 1: { para: 2, migrar: (c) => c } } });
  assert.equal(torta.codigo, 1);
  assert.equal(lerCfg(raiz).versaoDoEsquema, 1);
  assert.equal(fs.existsSync(path.join(raiz, 'config/site.json.antes-da-migracao')), false);
});

test('config ausente, JSON quebrado e opção desconhecida têm saída clara', async () => {
  const { principal } = await mod();
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-mig-'));
  assert.equal((await principal([], { raiz: vazio })).codigo, 1);
  const raiz = projeto();
  fs.writeFileSync(path.join(raiz, 'config/site.json'), '{ quebrado');
  assert.match((await principal([], { raiz })).texto, /não é um JSON válido/);
  assert.equal((await principal(['--xyz'], { raiz })).codigo, 2);
});

test('sem versaoDoEsquema na config, vale a versão 1', async () => {
  const { migrar } = await mod();
  assert.equal(migrar({ marca: {} }, 1).de, 1);
  assert.equal(migrar({ marca: {} }, 1).passos.length, 0);
  assert.ok(migrar(null, 1).erro);
});
