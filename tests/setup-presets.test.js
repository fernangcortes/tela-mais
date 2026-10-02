// Testes dos 7 presets de caso de uso (core/presets/*.json): cada um é um config parcial que, mesclado ao exemplo,
// precisa passar no MESMO validador do Worker, e que nunca liga autoplay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { RAIZ_REAL } from './setup-falso.js';
import { validarConfig } from '../core/worker/_lib/config-validar.mjs';
import { mesclar, listarPresets } from '../scripts/lib/setup/config-io.mjs';
import { NOMES_DOS_PRESETS } from '../core/presets/temas/index.mjs';

const schema = JSON.parse(readFileSync(path.join(RAIZ_REAL, 'config/site.schema.json'), 'utf8'));
const exemplo = JSON.parse(readFileSync(path.join(RAIZ_REAL, 'config/site.json'), 'utf8'));
const ESPERADOS = ['criador', 'empresa', 'escola', 'festival', 'igreja', 'infoprodutor', 'prefeitura'];

test('presets: existem exatamente os sete casos de uso', async () => {
  const todos = await listarPresets(RAIZ_REAL);
  assert.deepEqual(todos.map((p) => p.id).sort(), ESPERADOS);
  assert.deepEqual(readdirSync(path.join(RAIZ_REAL, 'core/presets')).filter((n) => n.endsWith('.json')).sort(), ESPERADOS.map((i) => i + '.json'));
});

test('presets: cada um tem nome e UMA linha de documentação, e o id bate com o arquivo', async () => {
  for (const p of await listarPresets(RAIZ_REAL)) {
    assert.ok(p.nome && p.nome.length > 3, p.id);
    assert.ok(p.resumo.length >= 30 && p.resumo.length <= 200, `${p.id}: resumo de uma linha`);
    assert.ok(!/\n/.test(p.resumo), p.id);
    assert.equal(p.config.preset, p.id);
    const bruto = JSON.parse(readFileSync(path.join(RAIZ_REAL, 'core/presets', p.id + '.json'), 'utf8'));
    assert.equal(bruto.id, p.id);
  }
});

test('presets: mesclado ao exemplo, todo preset é uma config válida', async () => {
  for (const p of await listarPresets(RAIZ_REAL)) {
    const r = validarConfig(schema, mesclar(exemplo, p.config));
    assert.equal(r.ok, true, `${p.id}: ${JSON.stringify(r.erros)}`);
  }
});

test('presets: usam só temas que existem e nunca ligam autoplay (regra 3 do AGENTS.md)', async () => {
  for (const p of await listarPresets(RAIZ_REAL)) {
    assert.ok(NOMES_DOS_PRESETS.includes(p.config.tema.preset), `${p.id}: tema ${p.config.tema.preset}`);
    const ap = p.config.player?.autoplay?.modo ?? 'nunca';
    assert.equal(ap, 'nunca', `${p.id}: autoplay`);
    assert.notEqual(p.config.player?.proximoEpisodio?.modo, 'automatico', `${p.id}: próximo episódio automático exige autoplay`);
    assert.notEqual(p.config.home?.destaque?.fundo?.tipo, 'video-mudo', `${p.id}: fundo de vídeo sai só por escolha do cliente`);
  }
});

test('presets: os modos de acesso fazem sentido para o caso de uso', async () => {
  const modo = Object.fromEntries((await listarPresets(RAIZ_REAL)).map((p) => [p.id, p.config.acesso.modo]));
  assert.deepEqual(modo, { criador: 'publico', empresa: 'privado', escola: 'cadastro', festival: 'publico', igreja: 'publico', infoprodutor: 'privado', prefeitura: 'publico' });
});

test('presets: acesso restrito assina o vídeo; cadastro funciona sem serviço de e-mail; marca d’água tem texto', async () => {
  for (const p of await listarPresets(RAIZ_REAL)) {
    const c = p.config;
    if (c.acesso.modo === 'privado') assert.equal(c.acesso.privado.assinarMidia, true, p.id);
    if (c.acesso.modo === 'cadastro') {
      assert.equal(c.acesso.cadastro.metodo, 'email-e-senha', p.id);
      assert.equal(c.acesso.cadastro.verificarEmail, false, p.id);
    }
    if (c.player.marcaDagua.ligada) assert.ok(c.player.marcaDagua.texto, p.id);
  }
});

test('presets: não carregam marca de cliente nem segredo (só configuração neutra)', async () => {
  for (const p of await listarPresets(RAIZ_REAL)) {
    const texto = readFileSync(path.join(RAIZ_REAL, 'core/presets', p.id + '.json'), 'utf8');
    assert.ok(!/(https?:\/\/|api[_-]?key|\bsecret\b)/i.test(texto), p.id);
    assert.equal(p.config.marca, undefined, `${p.id}: o preset não define a marca do cliente`);
  }
});
