/* Os fluxos do GitHub (.github/workflows), a retenção de backup e as promessas de segurança dos arquivos de CI.
 * Sem parser de YAML (o projeto não tem dependências): conferências de texto, mais a sintaxe validada à parte. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const fluxo = (nome) => fs.readFileSync(path.join(RAIZ, '.github', 'workflows', nome + '.yml'), 'utf8');
/* só o que executa: sem as linhas de comentário (que explicam e citam nomes de segredo à vontade). */
const semComentarios = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const retencao = () => import('../scripts/lib/retencao-backup.mjs');
const podar = () => import('../scripts/podar-backups.mjs');

test('os fluxos esperados existem', () => {
  for (const n of ['testes', 'deploy', 'backup', 'atualizar-core', 'release']) assert.ok(fs.existsSync(path.join(RAIZ, '.github', 'workflows', n + '.yml')), n);
});

test('nenhum fluxo tem segredo escrito: tudo vem de secrets./vars. e há `permissions` declaradas', () => {
  for (const n of ['testes', 'deploy', 'backup', 'atualizar-core', 'release']) {
    const t = fluxo(n);
    assert.match(t, /^permissions:/m, n + ' declara permissions');
    assert.doesNotMatch(t, /(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|[0-9a-f]{32}\b)/, n + ': parece ter segredo ou ID escrito');
    for (const m of t.matchAll(/CLOUDFLARE_API_TOKEN:\s*(.+)/g)) assert.match(m[1], /secrets\.CLOUDFLARE_API_TOKEN/, n);
    assert.doesNotMatch(t, /pull_request_target/, n + ': pull_request_target roda código de fork com segredos');
  }
});

test('deploy: só depois de `testes`, desligado sem o token, sem action de terceiros e sem ler segredo do Worker', () => {
  const t = fluxo('deploy');
  assert.match(t, /uses:\s*\.\/\.github\/workflows\/testes\.yml/);
  assert.match(t, /needs:\s*testes/);
  assert.match(t, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(t, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(t, /ligado=false/);
  assert.match(t, /wrangler@4 deploy/);
  assert.match(t, /contents:\s*read/);
  assert.doesNotMatch(semComentarios(t), /secret (put|bulk)|SESSION_SECRET|ADMIN_PASSWORD/);
  assert.match(fluxo('testes'), /workflow_call:/);
  /* só Actions oficiais do GitHub */
  for (const n of ['testes', 'deploy', 'backup', 'atualizar-core', 'release']) for (const m of fluxo(n).matchAll(/uses:\s*([^\s#]+)/g)) {
    assert.match(m[1], /^(actions\/(checkout|setup-node)@v\d+|\.\/\.github\/workflows\/[\w.-]+)$/, `${n}: action não prevista ${m[1]}`);
  }
});

test('testes.yml: os testes do produto só rodam na cópia com a marca neutra; as demais conferências sempre', () => {
  const t = fluxo('testes');
  assert.match(t, /Plataforma Exemplo/);
  assert.match(t, /if: steps\.produto\.outputs\.produto == 'true'\n\s+run: npm test/);
  for (const c of ['scan-secrets', 'sync-agents --check', 'aplicar-config.mjs --verificar', 'gerar-headers.mjs --verificar', 'migrar-config.mjs --verificar', 'anti-marca.mjs']) assert.ok(t.includes(c), c);
});

test('backup: DESLIGADO por padrão, repositório separado e privado, contas só se pedido', () => {
  const t = fluxo('backup');
  assert.match(t, /if: \$\{\{ vars\.BACKUP_LIGADO == 'true' \}\}/);
  assert.match(t, /schedule:/);
  assert.match(t, /exportar-kv\.mjs/);
  assert.match(t, /BACKUP_COM_CONTAS/);
  assert.match(t, /\.private/);
  assert.match(t, /repository: \$\{\{ vars\.BACKUP_REPOSITORIO \}\}/);
  assert.match(t, /podar-backups\.mjs/);
  assert.match(t, /\[ "\$BACKUP_COM_CONTAS" = "true" \] && extra="--com-contas"/, '--com-contas só pela variável');
  assert.match(t, /\[ "\$BACKUP_REGISTRAR" = "true" \] && extra="\$extra --registrar"/, '--registrar só pela variável (exige escrita no KV)');
  assert.match(t, /verificarBackup/, 'o arquivo é conferido com a mesma função do /admin');
  assert.equal((semComentarios(t).match(/--com-contas/g) || []).length, 1, '--com-contas aparece uma vez só, dentro da condição');
  assert.match(t, /SÓ DE LEITURA/);
});

test('atualizar-core: semanal, não roda no repositório oficial, só o produto, abre PR e não faz merge sozinho', () => {
  const t = fluxo('atualizar-core');
  assert.match(t, /cron:/);
  assert.match(t, /github\.repository != 'fernangcortes\/tela-mais'/);
  assert.match(t, /atualizar-core\.mjs/);
  assert.match(t, /migrar-config\.mjs/);
  assert.match(t, /gh pr (create|edit)/);
  assert.doesNotMatch(t, /gh pr merge|--auto|enable_pr_auto_merge/);
  assert.match(t, /ATUALIZAR_TOKEN/);
  assert.match(t, /pull-requests:\s*write/);
  assert.doesNotMatch(t, /git add[^\n]*config\//, 'o fluxo não adiciona config/ à mão');
});

test('retenção: 30 diários e o primeiro de cada um dos 12 últimos meses', async () => {
  const { escolherRetencao, dataDoArquivo } = await retencao();
  const nomes = [];
  const fim = Date.UTC(2026, 9, 2);
  for (let i = 0; i < 400; i++) { const d = new Date(fim - i * 86400000); nomes.push(`backup-${d.toISOString().slice(0, 10)}.json`); }
  nomes.push('LEIA-ME.md', 'backup-2026-13-45.json', 'backup-2026-10-02.json.bak');
  const r = escolherRetencao(nomes);
  const diarios = r.guardar.filter((n) => dataDoArquivo(n).ms > fim - 30 * 86400000);
  assert.equal(diarios.length, 30);
  assert.ok(r.guardar.includes('backup-2026-10-02.json') && r.guardar.includes('backup-2026-09-03.json'));
  /* o primeiro de cada mês guardado */
  assert.ok(r.guardar.includes('backup-2026-09-01.json'));
  assert.ok(r.guardar.includes('backup-2025-11-01.json') || r.guardar.includes('backup-2025-11-02.json') || r.guardar.some((n) => n.startsWith('backup-2025-11')));
  assert.equal(r.guardar.some((n) => n.startsWith('backup-2025-09')), false, 'mais de 12 meses atrás sai');
  assert.ok(r.guardar.length <= 30 + 12);
  assert.deepEqual([...r.guardar, ...r.apagar].sort(), nomes.filter((n) => dataDoArquivo(n)).sort());
  assert.equal(r.apagar.includes('LEIA-ME.md'), false, 'nome estranho nunca é tocado');
  assert.deepEqual(escolherRetencao([]), { guardar: [], apagar: [] });
});

test('podar-backups apaga só o que a regra manda e só com esse nome; --simular não apaga', async () => {
  const { principal } = await podar();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-poda-'));
  const fim = Date.UTC(2026, 9, 2);
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(pasta, `backup-${new Date(fim - i * 86400000).toISOString().slice(0, 10)}.json`), '{}');
  fs.writeFileSync(path.join(pasta, 'minhas-notas.txt'), 'x');
  const sim = await principal([pasta, '--simular']);
  assert.equal(fs.readdirSync(pasta).length, 61);
  assert.ok(sim.apagar.length > 0);
  const r = await principal([pasta, '--diarios', '10', '--mensais', '1']);
  assert.equal(r.codigo, 0);
  assert.ok(fs.existsSync(path.join(pasta, 'minhas-notas.txt')));
  assert.equal(fs.readdirSync(pasta).filter((n) => n.startsWith('backup-')).length, 10, '10 diários; o primeiro do mês mais recente (02/10 -> 01/10) já está entre eles');
  assert.ok(fs.existsSync(path.join(pasta, 'backup-2026-10-01.json')));
  assert.equal((await principal([])).codigo, 2);
  assert.equal((await principal([pasta, '--diarios', 'x'])).codigo, 2);
  assert.equal((await principal([path.join(pasta, 'nao-existe')])).codigo, 1);
});

test('release: só no repositório oficial, só por tag, confere a coerência antes de empacotar e não usa action de terceiros', () => {
  const t = fluxo('release');
  assert.match(t, /tags:/);
  assert.match(t, /github\.repository == 'fernangcortes\/tela-mais'/);
  assert.match(t, /needs:\s*testes/);
  assert.match(t, /preparar-release\.mjs --verificar --tag/);
  assert.match(t, /preparar-release\.mjs --empacotar/);
  assert.match(t, /core-\*\.sha256/);
  assert.match(t, /--prerelease/);
  assert.doesNotMatch(t, /branches:/, 'release não dispara por push de branch');
});
