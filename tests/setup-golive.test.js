// setup.mjs go-live: o checklist da seção 5 de docs/contas-e-chaves.md rodando por comando (ok, falha ou manual por item).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { criarProjeto, rodar, criarMundo, criarFetch, escreverSiteJson, lerSiteJson, CABECALHOS_SEGUROS, RAIZ_REAL } from './setup-falso.js';

const GUID = '11111111-2222-4333-8444-555555555555';
const base = 'https://minha-tela.sub.workers.dev';
const ENV_BUNNY = { BUNNY_LIBRARY_ID: '1234', BUNNY_API_KEY: 'chave-da-biblioteca-0123456789', BUNNY_TOKEN_KEY: 'token-key-0123456789abcdef', BUNNY_PULLZONE: 'vz-teste.b-cdn.net' };
const por = (r, id) => r.json.dados.itens.find((i) => i.id === id);

async function projeto() {
  const raiz = criarProjeto();
  cpSync(path.join(RAIZ_REAL, '.github'), path.join(raiz, '.github'), { recursive: true });
  const mundo = criarMundo({ worker: true });
  await rodar(['init', '--nome', 'Empresa Alfa', '--preset', 'empresa', '--cloudflare'], { raiz, mundo });
  mundo.segredos.set('ADMIN_PASSWORD', 'x'); mundo.segredos.set('SESSION_SECRET', 'y');
  const c = lerSiteJson(raiz); c.marca.dominio = 'https://tv.empresa-alfa.test'; escreverSiteJson(raiz, c);
  await rodar(['doctor', '--only', 'config', '--fix'], { raiz, mundo });
  /* o `gh` simulado: repositório privado e execuções recentes e verdes */
  const exec = mundo.exec;
  mundo.exec = async (cmd, args = [], o) => {
    if (cmd !== 'gh') return exec(cmd, args, o);
    mundo.chamadas.push({ cmd, args: [...args] });
    if (args[0] === 'repo') return { codigo: 0, saida: JSON.stringify({ isPrivate: true }), erro: '' };
    return { codigo: 0, saida: JSON.stringify([{ conclusion: 'success', status: 'completed', createdAt: '2026-10-02T05:23:00Z' }]), erro: '' };
  };
  return { raiz, mundo };
}

function rotas({ catalogoAberto = false, limite = true, legalPreenchido = true } = {}) {
  let logins = 0;
  const legal = (tipo) => ({ tipo, versao: 2, campos: legalPreenchido ? { controlador: 'Empresa Alfa Ltda', contato: 'lgpd@empresa-alfa.test' } : {}, textos: {} });
  return {
    '/': { status: 200, corpo: '<html></html>', cabecalhos: CABECALHOS_SEGUROS },
    '/api/catalogo': { status: catalogoAberto ? 200 : 401, corpo: catalogoAberto ? { itens: [] } : { codigo: 'nao-autorizado' } },
    '/robots.txt': { status: 200, corpo: 'User-agent: *\nDisallow: /\n' },
    [`/${GUID}/playlist.m3u8`]: { status: 403, corpo: 'forbidden' },
    '/videos': { status: 200, corpo: { items: [] } },
    '/api/saude': { status: 401, corpo: {} },
    '/api/legal': { status: 200, corpo: { documentos: { privacidade: legal('privacidade'), termos: legal('termos') } } },
    '/api/login': () => { logins++; return { status: limite && logins > 10 ? 429 : 401, corpo: {} }; },
    'https://tv.empresa-alfa.test/': { status: 200, corpo: '<html></html>' },
    'https://www.tv.empresa-alfa.test/': { status: 301, corpo: '' }
  };
}
const ARGS = ['go-live', '--url', base, '--video-id', GUID, '--json'];

test('go-live: tudo certo deixa só os itens manuais pendentes (saída 3, quem: agente) e --confirmado fecha o checklist (saída 0)', async () => {
  const { raiz, mundo } = await projeto();
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas()) });
  const falhas = r.json.dados.itens.filter((i) => i.estado === 'falha');
  assert.deepEqual(falhas, [], JSON.stringify(falhas));
  assert.equal(r.codigo, 3);
  assert.equal(r.json.pendencias[0].quem, 'agente');
  for (const id of ['modo-testado-de-fora', 'limite-de-login', 'segredos-presentes', 'sem-segredo-no-git', 'dominio-https', 'deploy-automatico', 'backup-recente', 'politica-e-termos', 'repo-privado']) assert.equal(por(r, id).estado, 'ok', id);
  for (const id of ['2fa-cloudflare', 'direito-de-exibir', 'custo-aceito']) assert.equal(por(r, id).estado, 'manual', id);
  for (const i of r.json.dados.itens) if (i.estado === 'manual') assert.ok(i.comando, 'item manual sem comando: ' + i.id);
  const manuais = r.json.dados.itens.filter((i) => i.estado === 'manual').map((i) => i.id);
  const fim = await rodar([...ARGS, '--confirmado', manuais.join(',')], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas()) });
  assert.equal(fim.codigo, 0, JSON.stringify(fim.json.dados.itens.filter((i) => i.estado !== 'ok')));
  assert.equal(fim.json.dados.contagem.falha, 0);
});

test('TESTE NEGATIVO go-live: catálogo aberto no modo privado reprova o item "testado de fora" (saída 1)', async () => {
  const { raiz, mundo } = await projeto();
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas({ catalogoAberto: true })) });
  assert.equal(r.codigo, 1);
  assert.equal(por(r, 'modo-testado-de-fora').estado, 'falha');
  assert.match(por(r, 'modo-testado-de-fora').detalhe, /ABRE/);
});

test('TESTE NEGATIVO go-live: login sem limite de tentativas reprova (nenhuma das 12 foi recusada)', async () => {
  const { raiz, mundo } = await projeto();
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas({ limite: false })) });
  assert.equal(r.codigo, 1);
  assert.equal(por(r, 'limite-de-login').estado, 'falha');
});

test('go-live: sem domínio próprio, sem backup rodado e sem texto legal, três falhas com o que fazer', async () => {
  const { raiz, mundo } = await projeto();
  const c = lerSiteJson(raiz); c.marca.dominio = ''; escreverSiteJson(raiz, c);
  const exec = mundo.exec;
  mundo.exec = async (cmd, args = [], o) => (cmd === 'gh' && args[0] === 'run' && args.includes('backup.yml')) ? { codigo: 0, saida: '[]', erro: '' } : exec(cmd, args, o);
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas({ legalPreenchido: false })) });
  assert.equal(r.codigo, 1);
  for (const id of ['dominio-https', 'backup-recente', 'politica-e-termos']) { assert.equal(por(r, id).estado, 'falha', id); assert.ok(por(r, id).comando, id); }
});

test('go-live: sem o "gh" os itens do GitHub viram manuais (não falha de mentira)', async () => {
  const { raiz, mundo } = await projeto();
  const exec = mundo.exec;
  mundo.exec = async (cmd, args = [], o) => cmd === 'gh' ? { codigo: 127, saida: '', erro: 'gh: não encontrado' } : exec(cmd, args, o);
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas()) });
  for (const id of ['deploy-automatico', 'backup-recente', 'repo-privado']) assert.equal(por(r, id).estado, 'manual', id);
});

test('go-live: --confirmado com item inexistente sai 2; texto normal mostra ok/falha/manual por item', async () => {
  const { raiz, mundo } = await projeto();
  const f = criarFetch(rotas());
  assert.equal((await rodar(['go-live', '--url', base, '--confirmado', 'nao-existe'], { raiz, mundo, env: ENV_BUNNY, fetch: f })).codigo, 2);
  const t = await rodar(['go-live', '--url', base, '--video-id', GUID], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas()) });
  assert.match(t.out, /OK {4}\s+Limite de tentativas/);
  assert.match(t.out, /MANUAL\s+2FA ligado na Cloudflare/);
  assert.match(t.out, /Comando: abrir https:\/\/dash\.cloudflare\.com/);
});

test('docs/contas-e-chaves.md traz o comando e o id de cada item do go-live (nada de caixa sem comando)', async () => {
  const { raiz, mundo } = await projeto();
  const r = await rodar(ARGS, { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(rotas()) });
  const doc = readFileSync(path.join(RAIZ_REAL, 'docs/contas-e-chaves.md'), 'utf8');
  assert.match(doc, /setup\.mjs go-live/);
  for (const i of r.json.dados.itens) assert.ok(doc.includes('`' + i.id + '`'), 'o doc não cita o item ' + i.id);
  const caixas = doc.split('\n').filter((l) => l.startsWith('- ['));
  assert.ok(caixas.length >= r.json.dados.itens.length);
  for (const l of caixas) assert.match(l, /`[a-z0-9-]+`/, 'caixa sem id: ' + l);
});
