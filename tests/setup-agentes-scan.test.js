// setup.mjs sync-agents (espelhos de AGENTS.md e das skills) e scan-secrets (arquivos e transcritos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { criarProjeto, rodar, criarMundo, lerArq, nadaVazou } from './setup-falso.js';
import { varrerTexto } from '../scripts/lib/setup/scan.mjs';
import { mascarar } from '../scripts/lib/setup/segredos.mjs';

/* Segredos de mentira montados em tempo de execução, para o próprio teste não ser achado pela varredura do repositório. */
const falso = {
  aws: 'AKIA' + 'IOSFODNN7EXAMPLE',
  anthropic: 'sk-ant-' + 'api03-' + 'a1B2c3D4e5F6g7H8i9J0kLmNoP',
  github: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ',
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  bunny: '77777777-5b6e-4789-9abc-def012345678'
};

/* ------------------------------------------------------------------ sync-agents */

test('sync-agents gera CLAUDE.md, GEMINI.md, .cursor/rules e .claude/skills a partir do AGENTS.md e das skills', async () => {
  const raiz = criarProjeto({ skills: true });
  const r = await rodar(['sync-agents', '--json'], { raiz });
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(lerArq(raiz, 'CLAUDE.md'), /^<!-- GERADO .*-->\n@AGENTS\.md\n$/);
  const gemini = lerArq(raiz, 'GEMINI.md');
  assert.match(gemini, /Leia e siga o `AGENTS\.md`/);
  assert.match(gemini, /montar-streaming.*Monta o streaming do zero/);
  const mdc = lerArq(raiz, '.cursor/rules/00-leia-agents.mdc');
  assert.match(mdc, /^---\ndescription: .*\nalwaysApply: true\n---\n/);
  assert.match(mdc, /Leia e siga o `AGENTS\.md`/);
  assert.match(mdc, /Fonte: AGENTS\.md [0-9a-f]{12} -->/, 'o aviso leva o hash do AGENTS.md');
  assert.match(lerArq(raiz, '.cursor/rules/montar-streaming.mdc'), /alwaysApply: false/);
  const sk = lerArq(raiz, '.claude/skills/montar-streaming/SKILL.md');
  assert.match(sk, /^---\nname: montar-streaming\n/);
  assert.match(sk, /GERADO por scripts\/setup\.mjs sync-agents/);
  assert.match(sk, /# Montar/);
});

test('sync-agents: notas por ferramenta (.agents/ferramentas/*.md) entram nos espelhos certos', async () => {
  const raiz = criarProjeto({ skills: true });
  mkdirSync(path.join(raiz, '.agents/ferramentas'), { recursive: true });
  writeFileSync(path.join(raiz, '.agents/ferramentas/claude.md'), '# Notas para o Claude Code\n\n- use o hook\n');
  writeFileSync(path.join(raiz, '.agents/ferramentas/cursor.md'), 'Regra do Cursor: uma pergunta por vez.\n');
  await rodar(['sync-agents'], { raiz });
  assert.match(lerArq(raiz, 'CLAUDE.md'), /@AGENTS\.md\n\n# Notas para o Claude Code\n\n- use o hook\n$/);
  assert.match(lerArq(raiz, '.cursor/rules/00-leia-agents.mdc'), /Regra do Cursor/);
  assert.ok(!lerArq(raiz, 'GEMINI.md').includes('use o hook'));
  writeFileSync(path.join(raiz, '.agents/ferramentas/claude.md'), 'mudou\n');
  assert.equal((await rodar(['sync-agents', '--check'], { raiz })).codigo, 1, 'nota mudou: espelho desatualizado');
});

test('sync-agents --check: falha se divergir, passa depois de sincronizar, e acusa espelho de skill apagada', async () => {
  const raiz = criarProjeto({ skills: true });
  const antes = await rodar(['sync-agents', '--check', '--json'], { raiz });
  assert.equal(antes.codigo, 1, 'nada gerado ainda');
  assert.ok(antes.json.checagens.some((c) => /ausente/.test(c.mensagem)));
  await rodar(['sync-agents'], { raiz });
  assert.equal((await rodar(['sync-agents', '--check', '--json'], { raiz })).codigo, 0);

  writeFileSync(path.join(raiz, 'AGENTS.md'), lerArq(raiz, 'AGENTS.md') + '\n## Regra nova\n');
  const div = await rodar(['sync-agents', '--check', '--json'], { raiz });
  assert.equal(div.codigo, 1);
  assert.ok(div.json.checagens.some((c) => c.id === 'agentes:.cursor/rules/00-leia-agents.mdc' && /diverge/.test(c.mensagem)));
  await rodar(['sync-agents'], { raiz });
  assert.equal((await rodar(['sync-agents', '--check'], { raiz })).codigo, 0);

  writeFileSync(path.join(raiz, 'GEMINI.md'), 'editado à mão\n');
  assert.equal((await rodar(['sync-agents', '--check'], { raiz })).codigo, 1);

  rmSync(path.join(raiz, '.agents/skills/montar-streaming'), { recursive: true });
  const velho = await rodar(['sync-agents', '--check', '--json'], { raiz });
  assert.equal(velho.codigo, 1);
  assert.ok(velho.json.checagens.some((c) => /obsoleto/.test(c.mensagem)));
  await rodar(['sync-agents'], { raiz });
  assert.ok(!existsSync(path.join(raiz, '.cursor/rules/montar-streaming.mdc')));
  assert.ok(!existsSync(path.join(raiz, '.claude/skills/montar-streaming/SKILL.md')));
  assert.equal((await rodar(['sync-agents', '--check'], { raiz })).codigo, 0);
});

test('sync-agents é idempotente e respeita --dry-run; não apaga arquivo seu em .cursor/rules', async () => {
  const raiz = criarProjeto({ skills: true });
  const d = await rodar(['sync-agents', '--dry-run', '--json'], { raiz });
  assert.equal(d.codigo, 0);
  assert.ok(!existsSync(path.join(raiz, '.cursor')));
  await rodar(['sync-agents'], { raiz });
  mkdirSync(path.join(raiz, '.cursor/rules'), { recursive: true });
  writeFileSync(path.join(raiz, '.cursor/rules/minha-regra.mdc'), '---\nalwaysApply: true\n---\nmeu texto\n');
  const b = await rodar(['sync-agents', '--json'], { raiz });
  assert.ok(b.json.acoes.every((a) => a.estado === 'ja-estava'));
  assert.ok(existsSync(path.join(raiz, '.cursor/rules/minha-regra.mdc')));
  assert.equal((await rodar(['sync-agents', '--check'], { raiz })).codigo, 0);
});

test('sync-agents no repositório de verdade: depois da primeira sincronização, os espelhos versionados continuam conferindo (CI)', async (t) => {
  const { RAIZ_REAL } = await import('./setup-falso.js');
  if (!existsSync(path.join(RAIZ_REAL, '.cursor/rules/00-leia-agents.mdc')) || !readFileSync(path.join(RAIZ_REAL, 'CLAUDE.md'), 'utf8').includes('GERADO por')) return t.skip('rode uma vez: node scripts/setup.mjs sync-agents');
  const r = await rodar(['sync-agents', '--check', '--json'], { raiz: RAIZ_REAL });
  assert.equal(r.codigo, 0, 'rode: node scripts/setup.mjs sync-agents\n' + JSON.stringify(r.json && r.json.checagens.filter((c) => c.status !== 'ok'), null, 1));
});

/* ------------------------------------------------------------------ scan-secrets */

test('scan: reconhece os formatos de segredo e nunca devolve o valor inteiro', () => {
  for (const [tipo, valor] of [['aws-access-key', falso.aws], ['anthropic', falso.anthropic], ['github', falso.github], ['chave-privada', falso.pem]]) {
    const a = varrerTexto(`linha 1\nconfig = ${valor}\n`);
    assert.ok(a.some((x) => x.tipo === tipo), tipo);
    assert.equal(a[0].linha, 2);
    assert.ok(!JSON.stringify(a).includes(valor.slice(4)), `${tipo}: o achado não carrega o valor`);
  }
});

test('scan: atribuição a nome de segredo conta; exemplo, referência a variável e código comum não', () => {
  assert.ok(varrerTexto(`BUNNY_API_KEY=${falso.bunny}`).length);
  assert.ok(varrerTexto(`"chaveApi": "${falso.bunny}"`).length);
  assert.ok(varrerTexto(`SESSION_SECRET: '${'z9Y8x7W6v5U4t3S2r1Q0p9O8'}'`).length);
  for (const ok of [
    'BUNNY_API_KEY=', 'BUNNY_API_KEY=troque-esta-chave-por-uma-sua', 'ADMIN_PASSWORD=${ADMIN_PASSWORD}', 'const token = lerTokenDoFragmento();',
    '"chaveApi": { "$env": "BUNNY_API_KEY" }', 'const apiKey = String(credenciais.chaveApi || \'\');', 'SENHA = "exemplo-de-senha-aqui"', 'token = process.env.TOKEN_SECRETO_DO_SERVIDOR',
    `linha com segredo falso AKIA${'0'.repeat(16)} # scan-secrets-ignorar`.replace('AKIA' + '0'.repeat(16), falso.aws)
  ]) assert.equal(varrerTexto(ok).length, 0, ok);
});

test('scan-secrets: varre o projeto, aponta arquivo:linha sem mostrar o valor e sai 1; limpo sai 0', async () => {
  const raiz = criarProjeto();
  const limpo = await rodar(['scan-secrets', '--json'], { raiz });
  assert.equal(limpo.codigo, 0, JSON.stringify(limpo.json.dados.achados));
  assert.ok(limpo.json.dados.varridos > 10);
  writeFileSync(path.join(raiz, 'docs-do-cliente.md'), `# notas\nsenha do bunny:\nBUNNY_API_KEY=${falso.bunny}\n`);
  const r = await rodar(['scan-secrets', '--json'], { raiz });
  assert.equal(r.codigo, 1);
  assert.deepEqual(r.json.dados.achados.map((a) => [a.arquivo, a.linha, a.tipo]), [['docs-do-cliente.md', 3, 'atribuicao-suspeita']]);
  assert.ok(!r.tudo.includes(falso.bunny));
  assert.ok(r.json.proximoPasso.includes('VAZADA'));
});

test('scan-secrets: .env e .dev.vars (ignorados pelo git) e tests/ (fixtures falsas) ficam fora; --incluir-testes inclui tests/', async () => {
  const raiz = criarProjeto();
  writeFileSync(path.join(raiz, '.env'), `BUNNY_API_KEY=${falso.bunny}\n`);
  mkdirSync(path.join(raiz, 'tests'), { recursive: true });
  writeFileSync(path.join(raiz, 'tests/x.test.js'), `const c = '${falso.aws}';\n`);
  assert.equal((await rodar(['scan-secrets'], { raiz })).codigo, 0);
  assert.equal((await rodar(['scan-secrets', '--incluir-testes'], { raiz })).codigo, 1);
});

test('scan-secrets: transcrito com o VALOR de um segredo do .env é vazamento, mesmo sem formato conhecido', async () => {
  const raiz = criarProjeto();
  const valor = 'zeta-valor-sem-formato-conhecido-2026';
  writeFileSync(path.join(raiz, '.env'), `ADMIN_PASSWORD=${valor}\n`);
  writeFileSync(path.join(raiz, 'conversa.txt'), `Usuário: a senha é ${valor}\nAgente: anotado\n`);
  const r = await rodar(['scan-secrets', '--transcript', 'conversa.txt', '--json'], { raiz });
  assert.equal(r.codigo, 1);
  assert.equal(r.json.dados.achados[0].tipo, 'valor-de-segredo-local');
  assert.match(r.json.dados.achados[0].trecho, /ADMIN_PASSWORD/);
  assert.ok(!r.tudo.includes(valor));
  writeFileSync(path.join(raiz, 'conversa-ok.txt'), 'Usuário: rode o setup\nAgente: pronto, a senha foi pedida num prompt oculto\n');
  assert.equal((await rodar(['scan-secrets', '--transcript', 'conversa-ok.txt', '--json'], { raiz })).codigo, 0);
  const sem = await rodar(['scan-secrets', '--transcript', 'conversa.txt', '--sem-valores-locais'], { raiz });
  assert.equal(sem.codigo, 0, 'sem o .env como referência, só valem os formatos conhecidos');
  assert.equal((await rodar(['scan-secrets', '--transcript', 'nao-existe.txt'], { raiz })).codigo, 2);
});

test('scan-secrets --stdin e arquivos indicados', async () => {
  const raiz = criarProjeto();
  const a = await rodar(['scan-secrets', '--stdin', '--json'], { raiz, stdin: `export ANTHROPIC_API_KEY=${falso.anthropic}` });
  assert.equal(a.codigo, 1);
  assert.ok(!a.tudo.includes(falso.anthropic));
  assert.equal((await rodar(['scan-secrets', '--stdin'], { raiz, stdin: 'tudo certo' })).codigo, 0);
  writeFileSync(path.join(raiz, 'um.txt'), falso.github);
  assert.equal((await rodar(['scan-secrets', 'um.txt', '--json'], { raiz })).json.dados.achados.length, 1);
});

test('scan-secrets --instalar-hook cria o pre-commit que chama o scan com --staged', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo();
  mundo.exec = ((orig) => async (cmd, args, o) => (cmd === 'git' && args[0] === 'config' ? { codigo: 0, saida: '', erro: '' } : orig(cmd, args, o)))(mundo.exec);
  const r = await rodar(['scan-secrets', '--instalar-hook', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 0, r.tudo);
  const hook = lerArq(raiz, '.githooks/pre-commit');
  assert.match(hook, /^#!\/bin\/sh/);
  assert.match(hook, /scan-secrets --staged/);
  if (process.platform !== 'win32') assert.ok(statSync(path.join(raiz, '.githooks/pre-commit')).mode & 0o111);
});

test('segurança de ponta a ponta: um valor secreto no ambiente não vaza por nenhum comando', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  const segredo = 'valor-secreto-do-teste-0123456789-ABCDEF';
  const env = { BUNNY_LIBRARY_ID: '99', BUNNY_API_KEY: segredo, ADMIN_PASSWORD: segredo + '-admin', CLOUDFLARE_API_TOKEN: segredo + '-cf' };
  for (const argv of [['status'], ['doctor'], ['doctor', '--remote', '--url', 'https://x.test'], ['init', '--nome', 'A B C', '--preset', 'criador'], ['video', '--testar'], ['cloudflare'], ['scan-secrets'], ['deploy', '--dry-run']]) {
    const r = await rodar([...argv, '--json'], { raiz, mundo, env, fetch: async () => new Response('', { status: 404 }) });
    assert.ok(nadaVazou(r, segredo), argv.join(' '));
  }
  assert.ok(!lerArq(raiz, 'config/site.json').includes(segredo));
  assert.ok(!lerArq(raiz, 'wrangler.jsonc').includes(segredo));
});

test('mascarar: mostra só o fim de segredos longos e só o tamanho dos curtos', () => {
  assert.equal(mascarar('abcdefghijklmnopqrstuvwxyz'), '****wxyz');
  assert.equal(mascarar('curta123'), '**** (8 caracteres)');
  assert.equal(mascarar(''), '(vazio)');
});
