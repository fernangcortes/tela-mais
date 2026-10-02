import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliar } from '../.claude/hooks/bloquear-segredos.mjs';

test('bloqueia comandos que leem ou imprimem segredos', () => {
  for (const c of [
    'cat .env', 'grep KEY .dev.vars', 'type .env.local', 'printenv', 'echo $BUNNY_API_KEY',
    'echo abc | npx wrangler secret put X', 'cat chave.pem', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuv" https://x',
  ]) assert.ok(avaliar(c), c);
});

test('deixa passar comandos comuns e o .env.example', () => {
  for (const c of [
    'cat .env.example', 'npx wrangler secret put X', 'node scripts/setup.mjs doctor --json', 'npm test', 'git status', 'cat docs/provedores.md',
  ]) assert.equal(avaliar(c), null, c);
});
