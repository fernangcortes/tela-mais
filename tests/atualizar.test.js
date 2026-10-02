/* Atualização do core sem tocar em config/: scripts/atualizar-core.mjs, o CHANGELOG, a comparação de versões (SemVer) e a
 * coerência dos números de versão do repositório. Sem rede: o GitHub é um falso e o tar é de verdade (local). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');
const versao = () => import('../scripts/lib/semver.mjs');
const lib = () => import('../scripts/lib/atualizar-core.mjs');
const cmd = () => import('../scripts/atualizar-core.mjs');
const VERSAO_ATUAL = fs.readFileSync(path.join(RAIZ, '.core-version'), 'utf8').trim();
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

function escrever(raiz, arquivos) {
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const alvo = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, conteudo);
  }
}
const tudo = (raiz, base = '') => {
  const saida = {};
  for (const it of fs.readdirSync(path.join(raiz, base), { withFileTypes: true })) {
    const rel = base ? base + '/' + it.name : it.name;
    if (it.isDirectory()) Object.assign(saida, tudo(raiz, rel)); else saida[rel] = fs.readFileSync(path.join(raiz, rel), 'utf8');
  }
  return saida;
};

const CHANGELOG_NOVO = `# Histórico

## [1.1.0] - 2026-11-01
### Novidades
- Tela nova.
### Segurança
- Corrige um cabeçalho.
### Precisa de ação sua
- Rode a migração: node scripts/migrar-config.mjs
- Ligue o alerta de gasto.

## [1.0.1] - 2026-10-20
### Correções
- Ajuste.
### Segurança
- Nenhuma.
### Precisa de ação sua
- Nenhuma.

## [1.0.0] - 2026-10-10
### Precisa de ação sua
- Coisa antiga que não interessa a quem já está na 1.0.0.
`;

/* Um cliente na 1.0.0 (com a marca e a config dele) e uma release 1.1.0 em outra pasta. */
function cenario() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-atu-'));
  const cliente = path.join(base, 'cliente'), nova = path.join(base, 'nova');
  escrever(cliente, {
    '.core-version': '1.0.0\n', 'package.json': '{"version":"1.0.0"}',
    'core/site/app.js': 'velho', 'core/site/removido.js': 'sai', 'core/site/marca/logo.svg': '<svg>DO CLIENTE</svg>',
    'core/site/fontes/Minha.woff2': 'fonte', 'core/worker/index.js': 'igual',
    'scripts/a.mjs': 'velho', 'tests/t.js': 'velho', 'docs/x.md': 'velho', 'AGENTS.md': 'velho',
    'config/site.json': '{"marca":{"nome":"Cliente SA"}}', 'config/site.schema.json': '{"v":1}', 'config/fontes/X.woff2': 'w',
    'wrangler.jsonc': '{"name":"cliente","kv_namespaces":[{"binding":"CATALOGO","id":"abc"}]}',
    'dados/backup.json': 'meu backup', '.env': 'SEGREDO=1', 'README.md': 'readme do cliente', '.github/workflows/deploy.yml': 'do cliente',
    '.claude/settings.local.json': '{"local":true}'
  });
  escrever(nova, {
    '.core-version': '1.1.0\n', 'package.json': '{"version":"1.1.0"}', 'CHANGELOG.md': CHANGELOG_NOVO,
    'core/site/app.js': 'novo', 'core/site/novo.js': 'novo', 'core/site/marca/logo.svg': '<svg>NEUTRA DO PRODUTO</svg>', 'core/worker/index.js': 'igual',
    'scripts/a.mjs': 'novo', 'scripts/b.mjs': 'novo', 'tests/t.js': 'novo', 'docs/x.md': 'novo', 'AGENTS.md': 'novo',
    'config/site.json': '{"marca":{"nome":"NAO PODE ENTRAR"}}', 'config/site.schema.json': '{"v":2}', 'wrangler.jsonc': 'NAO PODE ENTRAR',
    'README.md': 'NAO', '.github/workflows/deploy.yml': 'NAO', '.env': 'NAO', 'dados/x.json': 'NAO'
  });
  return { base, cliente, nova };
}
const falso = (cliente, extra = {}) => ({ raiz: cliente, agora: () => new Date('2026-11-02T00:00:00Z'), ...extra });

test('versões do repositório coerentes: .core-version, package.json (versão do core no Worker), LICENSE e repositório oficial', async () => {
  const core = ler('.core-version').trim();
  assert.match(core, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(ler('package.json')).version, core);
  const saude = await import('../core/worker/_lib/saude.js');
  assert.equal(saude.VERSAO_DO_CORE, core, 'a tela Saúde mostra a versão do .core-version');
  assert.equal((await versao()).REPOSITORIO_OFICIAL, saude.REPOSITORIO_OFICIAL, 'o repositório oficial é o mesmo no Worker e nos scripts');
  assert.match(ler('LICENSE'), new RegExp('Licensed Work:\\s+tela mAIs, version ' + core.replace(/\./g, '\\.')));
  assert.match(ler('CHANGELOG.md'), new RegExp('^## \\[' + core.replace(/\./g, '\\.') + '\\]', 'm'), 'o CHANGELOG tem a seção da versão atual');
});

test('CHANGELOG: cada versão tem as quatro partes, e a parte "Precisa de ação sua" é lida', async () => {
  const { blocosDoChangelog } = await lib();
  const blocos = blocosDoChangelog(ler('CHANGELOG.md'));
  assert.ok(blocos.length >= 1);
  for (const b of blocos) {
    for (const parte of ['Novidades', 'Correções', 'Segurança', 'Precisa de ação sua']) assert.match(b.texto, new RegExp('^### ' + parte, 'm'), `${b.versao}: falta "${parte}"`);
  }
  const b = blocosDoChangelog(CHANGELOG_NOVO);
  assert.deepEqual(b.map((x) => x.versao), ['1.1.0', '1.0.1', '1.0.0']);
  assert.deepEqual(b[0].acoes, ['Rode a migração: node scripts/migrar-config.mjs', 'Ligue o alerta de gasto.']);
  assert.equal(b[0].seguranca, true);
  assert.equal(b[1].precisaDeAcao, false, '"Nenhuma." não é ação');
  assert.equal(b[1].seguranca, false, '"Segurança: Nenhuma" não é aviso de segurança');
});

test('mudançasEntre pega só o que o cliente ainda não tem', async () => {
  const { mudancasEntre } = await lib();
  assert.deepEqual(mudancasEntre(CHANGELOG_NOVO, '1.0.0', '1.1.0').map((b) => b.versao), ['1.1.0', '1.0.1']);
  assert.deepEqual(mudancasEntre(CHANGELOG_NOVO, '1.0.1', '1.1.0').map((b) => b.versao), ['1.1.0']);
  assert.deepEqual(mudancasEntre(CHANGELOG_NOVO, '1.1.0', '1.1.0'), []);
});

test('atualizar substitui o produto e NÃO toca em config/, marca, wrangler, dados, .env, README e workflows', async () => {
  const { principal } = await cmd();
  const { cliente, nova } = cenario();
  const antes = tudo(cliente);
  const r = await principal(['--de', nova, '--corpo-do-pr', 'pr.md'], falso(cliente));
  assert.equal(r.codigo, 0, r.texto);
  const depois = tudo(cliente);
  /* do produto: atualizado, acrescentado, removido */
  assert.equal(depois['core/site/app.js'], 'novo');
  assert.equal(depois['core/site/novo.js'], 'novo');
  assert.equal(depois['scripts/b.mjs'], 'novo');
  assert.equal(depois['AGENTS.md'], 'novo');
  assert.equal(depois['.core-version'].trim(), '1.1.0');
  assert.equal('core/site/removido.js' in depois, false, 'o que o produto apagou sai');
  assert.equal(depois['config/site.schema.json'], '{"v":2}', 'o esquema é do produto');
  /* do cliente: idêntico ao que era */
  for (const rel of ['config/site.json', 'config/fontes/X.woff2', 'wrangler.jsonc', 'dados/backup.json', '.env', 'README.md', '.github/workflows/deploy.yml', 'core/site/marca/logo.svg', 'core/site/fontes/Minha.woff2', '.claude/settings.local.json']) {
    assert.equal(depois[rel], antes[rel], rel + ' tinha de ficar como estava');
  }
  assert.equal('dados/x.json' in depois, false);
  assert.match(r.texto, /1\.0\.0 para 1\.1\.0/);
  assert.equal(r.precisaDeAcao, true);
  assert.equal(r.seguranca, true);
  const pr = fs.readFileSync(path.join(cliente, 'pr.md'), 'utf8');
  assert.match(pr, /SEGURANÇA/);
  assert.match(pr, /Ligue o alerta de gasto/);
  assert.doesNotMatch(pr, /Coisa antiga/);
});

test('--simular não grava nada (nem .core-version), mas conta o que mudaria', async () => {
  const { principal } = await cmd();
  const { cliente, nova } = cenario();
  const antes = tudo(cliente);
  const r = await principal(['--de', nova, '--simular', '--json'], falso(cliente));
  const j = JSON.parse(r.texto);
  assert.equal(j.simulado, true);
  assert.ok(j.alterados >= 4 && j.adicionados >= 2 && j.removidos === 1);
  assert.deepEqual(tudo(cliente), antes);
});

test('já na mesma versão: nada a fazer; versão mais antiga: recusa', async () => {
  const { principal } = await cmd();
  const { cliente, nova } = cenario();
  fs.writeFileSync(path.join(cliente, '.core-version'), '1.1.0\n');
  assert.match((await principal(['--de', nova], falso(cliente))).texto, /Nada a fazer/);
  fs.writeFileSync(path.join(cliente, '.core-version'), '1.2.0\n');
  const r = await principal(['--de', nova], falso(cliente));
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /MAIS ANTIGA/);
});

test('pasta que não é uma release, link simbólico e uso incorreto são recusados sem gravar', async () => {
  const { principal } = await cmd();
  const { base, cliente } = cenario();
  const vazia = path.join(base, 'vazia'); fs.mkdirSync(vazia);
  assert.equal((await principal(['--de', vazia], falso(cliente))).codigo, 1);
  const { nova } = cenario();
  fs.symlinkSync('/etc/passwd', path.join(nova, 'core/site/link'));
  const antes = tudo(cliente);
  const r = await principal(['--de', nova], falso(cliente));
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /link simbólico/);
  assert.deepEqual(tudo(cliente), antes);
  assert.equal((await principal([], falso(cliente))).codigo, 2);
  assert.equal((await principal(['--baixar', '--de', 'x'], falso(cliente))).codigo, 2);
  assert.equal((await principal(['--baixar', '--repo', 'sem-barra'], falso(cliente))).codigo, 2);
});

/* A release de verdade: tarball + sha256, baixados por um fetch falso. */
function release(nova, base, { somaErrada = false } = {}) {
  const tar = path.join(base, 'core-v1.1.0.tar.gz');
  execFileSync('tar', ['-czf', tar, '-C', path.dirname(nova), path.basename(nova)]);
  const soma = crypto.createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
  fs.writeFileSync(path.join(base, 'core-v1.1.0.sha256'), (somaErrada ? 'a'.repeat(64) : soma) + '  core-v1.1.0.tar.gz\n');
  const arquivos = { 'https://x/tar': tar, 'https://x/sha': path.join(base, 'core-v1.1.0.sha256') };
  return {
    async fetchJson(url) {
      assert.match(url, /api\.github\.com\/repos\/fernangcortes\/tela-mais\/releases\/(latest|tags\/v1\.1\.0)/);
      return { tag_name: 'v1.1.0', body: '', assets: [
        { name: 'core-v1.1.0.tar.gz', browser_download_url: 'https://x/tar' }, { name: 'core-v1.1.0.sha256', browser_download_url: 'https://x/sha' }] };
    },
    async baixar(url, destino) { fs.copyFileSync(arquivos[url], destino); },
    async extrair(arquivo, pasta) { execFileSync('tar', ['-xzf', arquivo, '-C', pasta]); }
  };
}

test('--baixar: confere o sha256, extrai o tarball (com pasta de topo) e aplica', async () => {
  const { principal } = await cmd();
  const { base, cliente, nova } = cenario();
  const r = await principal(['--baixar'], falso(cliente, release(nova, base)));
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(tudo(cliente)['core/site/app.js'], 'novo');
  assert.equal(tudo(cliente)['config/site.json'], '{"marca":{"nome":"Cliente SA"}}');
});

test('--baixar com sha256 errado: recusa e não altera nada', async () => {
  const { principal } = await cmd();
  const { base, cliente, nova } = cenario();
  const antes = tudo(cliente);
  const r = await principal(['--baixar'], falso(cliente, release(nova, base, { somaErrada: true })));
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /sha256/);
  assert.deepEqual(tudo(cliente), antes);
});

test('--baixar: release sem os dois assets é recusada', async () => {
  const { principal } = await cmd();
  const { cliente } = cenario();
  const r = await principal(['--baixar'], falso(cliente, { fetchJson: async () => ({ tag_name: 'v1.1.0', assets: [] }) }));
  assert.equal(r.codigo, 1);
  assert.match(r.texto, /\.sha256/);
});

test('o que a atualização substitui não inclui nada do cliente', async () => {
  const { PRODUTO, PRESERVAR, preservado } = await lib();
  const todos = [...PRODUTO.pastas, ...PRODUTO.arquivos];
  for (const proibido of ['config', 'config/site.json', 'wrangler.jsonc', 'dados', '.env', 'README.md', '.github/workflows', '.github', 'node_modules', '.git']) {
    assert.equal(todos.includes(proibido), false, proibido + ' não pode ser do produto');
  }
  assert.ok(todos.includes('config/site.schema.json'));
  assert.equal(PRODUTO.arquivos.filter((a) => a.startsWith('config/')).length, 1, 'só o esquema vive em config/');
  assert.ok(preservado('core/site/marca/logo.svg') && preservado('core/site/marca') && !preservado('core/site/marcador.js'));
  assert.ok(PRESERVAR.includes('core/site/fontes'));
});

/* ------------------------------------------------------------ semver */

test('compararVersoes segue o SemVer, inclusive pré-lançamento', async () => {
  const { compararVersoes: c, lerVersao } = await versao();
  assert.equal(c('1.2.3', '1.2.3'), 0);
  assert.equal(c('1.2.3', 'v1.10.0'), -1);
  assert.equal(c('2.0.0', '1.99.99'), 1);
  assert.equal(c('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(c('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(c('1.0.0-alfa', '1.0.0-beta'), -1);
  assert.equal(c('1.0', '1.0.0'), null);
  assert.equal(c(null, '1.0.0'), null);
  assert.equal(lerVersao(' v1.2.3 ').correcao, 3);
});

/* ------------------------------------------------------------ preparar-release */

const rel = () => import('../scripts/preparar-release.mjs');

test('release: o repositório atual está coerente (versão, LICENSE, CHANGELOG)', async () => {
  const { verificar } = await rel();
  assert.deepEqual(await verificar(RAIZ, {}), []);
});

test('release: Change Date = 4 anos depois da publicação, com 29/02 tratado', async () => {
  const { somarAnos } = await rel();
  assert.equal(somarAnos('2027-03-01', 4), '2031-03-01');
  assert.equal(somarAnos('2026-10-01', 4), '2030-10-01');
  assert.equal(somarAnos('2024-02-29', 4), '2028-02-29');
  assert.equal(somarAnos('2024-02-29', 1), '2025-02-28');
});

function copiaDoRepositorio() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-rel-'));
  for (const f of ['.core-version', 'package.json', 'LICENSE', 'LICENCA-PT.md', 'CHANGELOG.md', 'NOTICE', 'COMMERCIAL.md']) fs.copyFileSync(path.join(RAIZ, f), path.join(raiz, f));
  fs.mkdirSync(path.join(raiz, 'core/site'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'core/site/a.js'), 'a');
  fs.mkdirSync(path.join(raiz, 'dados'));
  fs.writeFileSync(path.join(raiz, 'dados/segredo.json'), 'NAO ENTRA');
  return raiz;
}

test('release --versao muda só os parâmetros do LICENSE (o texto-base da BSL fica intacto) e os números de versão', async () => {
  const { principal, verificar } = await rel();
  const raiz = copiaDoRepositorio();
  const antes = fs.readFileSync(path.join(raiz, 'LICENSE'), 'utf8');
  fs.appendFileSync(path.join(raiz, 'CHANGELOG.md'), '\n## [1.0.0] - 2027-03-01\n### Novidades\n- x\n### Correções\n- y\n### Segurança\n- Nenhuma.\n### Precisa de ação sua\n- Nenhuma.\n');
  const r = await principal(['--versao', '1.0.0', '--data', '2027-03-01'], { raiz });
  assert.equal(r.codigo, 0, r.texto);
  const depois = fs.readFileSync(path.join(raiz, 'LICENSE'), 'utf8');
  const linhasA = antes.split('\n'), linhasD = depois.split('\n');
  assert.equal(linhasA.length, linhasD.length);
  const diferentes = linhasA.map((l, i) => [l, linhasD[i]]).filter(([a, b]) => a !== b);
  assert.equal(diferentes.length, 2, 'só Licensed Work e Change Date mudam');
  assert.match(diferentes[0][1], /version 1\.0\.0/);
  assert.match(diferentes[1][1], /2031-03-01/);
  assert.equal(fs.readFileSync(path.join(raiz, '.core-version'), 'utf8'), '1.0.0\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version, '1.0.0');
  assert.match(fs.readFileSync(path.join(raiz, 'LICENCA-PT.md'), 'utf8'), /2031-03-01 para a versão 1\.0\.0/);
  assert.deepEqual(await verificar(raiz, { tag: 'v1.0.0', hoje: '2027-03-01' }), []);
  assert.ok((await verificar(raiz, { tag: 'v1.0.1' })).length, 'tag diferente é incoerente');
  assert.ok((await verificar(raiz, { hoje: '2032-01-01' })).some((e) => /já passou/.test(e)));
  assert.ok((await verificar(raiz, { hoje: '2026-01-01' })).some((e) => /passa de 4 anos/.test(e)));
});

test('release --versao exige a seção no CHANGELOG e valida a entrada; --simular não grava', async () => {
  const { principal } = await rel();
  const raiz = copiaDoRepositorio();
  assert.equal((await principal(['--versao', '9.9.9'], { raiz })).codigo, 1);
  assert.equal((await principal(['--versao', 'abc'], { raiz })).codigo, 2);
  assert.equal((await principal(['--versao', VERSAO_ATUAL, '--data', '2026-13-01'], { raiz })).codigo, 2);
  const antes = fs.readFileSync(path.join(raiz, 'LICENSE'), 'utf8');
  const r = await principal(['--versao', VERSAO_ATUAL, '--data', '2027-01-01', '--simular'], { raiz });
  assert.equal(r.codigo, 0);
  assert.equal(fs.readFileSync(path.join(raiz, 'LICENSE'), 'utf8'), antes);
  assert.equal((await principal(['--nada'], { raiz })).codigo, 2);
});

test('release --notas imprime a seção da versão; --empacotar gera tarball + sha256 só com o produto', async () => {
  const { principal } = await rel();
  const raiz = copiaDoRepositorio();
  const n = await principal(['--notas', VERSAO_ATUAL], { raiz });
  assert.equal(n.codigo, 0);
  assert.match(n.texto, /### Precisa de ação sua/);
  assert.equal((await principal(['--notas', '7.7.7'], { raiz })).codigo, 1);
  const saida = path.join(raiz, 'saida');
  const e = await principal(['--empacotar', saida], { raiz });
  assert.equal(e.codigo, 0, e.texto);
  const tar = path.join(saida, 'core-v' + VERSAO_ATUAL + '.tar.gz');
  const soma = fs.readFileSync(path.join(saida, 'core-v' + VERSAO_ATUAL + '.sha256'), 'utf8');
  assert.equal(soma.split(/\s+/)[0], crypto.createHash('sha256').update(fs.readFileSync(tar)).digest('hex'));
  const lista = execFileSync('tar', ['-tzf', tar]).toString();
  assert.match(lista, new RegExp('tela-mais-' + VERSAO_ATUAL.replace(/\./g, '\\.') + '/core/site/a\\.js'));
  assert.match(lista, new RegExp('tela-mais-' + VERSAO_ATUAL.replace(/\./g, '\\.') + '/LICENSE'));
  assert.doesNotMatch(lista, /dados|segredo/);
});

test('o tarball de release é aceito pelo atualizar-core (fecha o ciclo release -> atualização)', async () => {
  const { principal: preparar } = await rel();
  const { principal: atualizar } = await cmd();
  const origem = copiaDoRepositorio();
  fs.appendFileSync(path.join(origem, 'CHANGELOG.md'), '\n## [0.2.0] - 2026-12-01\n### Novidades\n- n\n### Correções\n- c\n### Segurança\n- Nenhuma.\n### Precisa de ação sua\n- Nenhuma.\n');
  await preparar(['--versao', '0.2.0', '--data', '2026-12-01'], { raiz: origem });
  const saida = path.join(origem, 'saida');
  assert.equal((await preparar(['--empacotar', saida], { raiz: origem })).codigo, 0);
  const cliente = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-cli-'));
  escrever(cliente, { '.core-version': '0.1.0\n', 'config/site.json': '{"meu":"dado"}', 'core/site/marca/logo.svg': 'meu logo' });
  const r = await atualizar(['--de', path.join(saida, 'core-v0.2.0.tar.gz')], { raiz: cliente, extrair: async (a, p) => execFileSync('tar', ['-xzf', a, '-C', p]) });
  assert.equal(r.codigo, 0, r.texto);
  assert.equal(fs.readFileSync(path.join(cliente, '.core-version'), 'utf8').trim(), '0.2.0');
  assert.equal(fs.readFileSync(path.join(cliente, 'config/site.json'), 'utf8'), '{"meu":"dado"}');
  assert.equal(fs.readFileSync(path.join(cliente, 'core/site/marca/logo.svg'), 'utf8'), 'meu logo');
});
