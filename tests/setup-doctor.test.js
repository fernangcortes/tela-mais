// setup.mjs doctor: grupos, --json, --fix e, principalmente, o teste de fora (--remote): no modo privado ele FALHA se o
// catálogo ou o vídeo (HLS) abrirem sem login. Os testes negativos usam um "site" que vaza de propósito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { criarProjeto, rodar, criarMundo, criarFetch, lerArq, escreverSiteJson, lerSiteJson, CABECALHOS_SEGUROS } from './setup-falso.js';

const por = (r, id) => r.json.checagens.find((c) => c.id === id);
const GUID = '11111111-2222-4333-8444-555555555555';
const ENV_BUNNY = { BUNNY_LIBRARY_ID: '1234', BUNNY_API_KEY: 'chave-da-biblioteca-0123456789', BUNNY_TOKEN_KEY: 'token-key-0123456789abcdef', BUNNY_PULLZONE: 'vz-teste.b-cdn.net' };

async function projeto(preset, nome = 'Rede Sol') {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  await rodar(['init', '--nome', nome, '--preset', preset, '--cloudflare'], { raiz, mundo });
  mundo.segredos.set('ADMIN_PASSWORD', 'x'); mundo.segredos.set('SESSION_SECRET', 'y');
  return { raiz, mundo };
}
const videosOk = { '/videos': { status: 200, corpo: { items: [] } } };

test('doctor --json: formato estável, grupos e códigos de saída', async () => {
  const { raiz, mundo } = await projeto('criador');
  const r = await rodar(['doctor', '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(videosOk) });
  assert.equal(r.codigo, 0, JSON.stringify(r.json.checagens.filter((c) => c.status === 'erro')));
  assert.equal(r.json.ok, true);
  for (const c of r.json.checagens) {
    assert.deepEqual(Object.keys(c).sort(), ['correcao', 'grupo', 'id', 'mensagem', 'status']);
    assert.ok(['ok', 'aviso', 'erro', 'pulado'].includes(c.status));
  }
  const grupos = new Set(r.json.checagens.map((c) => c.grupo));
  for (const g of ['env', 'config', 'cloudflare', 'video', 'acesso', 'admin', 'seguranca']) assert.ok(grupos.has(g), g);
  assert.ok(!grupos.has('remoto'), 'remoto só com --remote');
  assert.equal(por(r, 'video.conexao').status, 'ok');
  assert.equal(por(r, 'cloudflare.kv').status, 'ok');
});

test('doctor --only filtra grupos; grupo inexistente sai 2', async () => {
  const { raiz, mundo } = await projeto('criador');
  const r = await rodar(['doctor', '--only', 'config,seguranca', '--json'], { raiz, mundo });
  assert.deepEqual([...new Set(r.json.checagens.map((c) => c.grupo))].sort(), ['config', 'seguranca']);
  assert.equal((await rodar(['doctor', '--only', 'nuvem'], { raiz, mundo })).codigo, 2);
});

test('doctor: avisa se CLOUDFLARE_API_TOKEN está no ambiente, sem mostrar o valor', async () => {
  const { raiz, mundo } = await projeto('criador');
  const token = 'tokenzao-global-0123456789-ABCDEFGH';
  const r = await rodar(['doctor', '--only', 'cloudflare', '--json'], { raiz, mundo, env: { CLOUDFLARE_API_TOKEN: token } });
  assert.equal(por(r, 'cloudflare.token-global').status, 'aviso');
  assert.ok(!r.tudo.includes(token));
  const sem = await rodar(['doctor', '--only', 'cloudflare', '--json'], { raiz, mundo });
  assert.equal(por(sem, 'cloudflare.token-global').status, 'ok');
});

test('doctor: sem login, KV/D1 ficam pulados e o login é erro com o comando a rodar', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['doctor', '--only', 'cloudflare', '--json'], { raiz, mundo: criarMundo({ logado: false }) });
  assert.equal(r.codigo, 1);
  assert.equal(por(r, 'cloudflare.login').status, 'erro');
  assert.match(por(r, 'cloudflare.login').correcao, /wrangler login/);
  assert.equal(por(r, 'cloudflare.kv').status, 'pulado');
});

test('doctor: ids de KV/D1 que não existem na conta são erro e apontam o conserto', async () => {
  const { raiz, mundo } = await projeto('criador');
  mundo.kv.length = 0;
  const r = await rodar(['doctor', '--only', 'cloudflare', '--json'], { raiz, mundo });
  assert.equal(por(r, 'cloudflare.kv').status, 'erro');
  assert.match(por(r, 'cloudflare.kv').correcao, /setup\.mjs cloudflare/);
});

test('doctor: config inválida é erro; arquivos gerados desatualizados são erro e --fix conserta', async () => {
  const raiz = criarProjeto();
  const c = lerSiteJson(raiz);
  c.acesso.modo = 'talvez';
  escreverSiteJson(raiz, c);
  const ruim = await rodar(['doctor', '--only', 'config', '--json'], { raiz });
  assert.equal(por(ruim, 'config.valida').status, 'erro');
  c.acesso.modo = 'publico';
  c.marca.slogan = 'Outro slogan';
  escreverSiteJson(raiz, c);
  const velho = await rodar(['doctor', '--only', 'config', '--json'], { raiz });
  assert.equal(por(velho, 'config.aplicada').status, 'erro');
  const fix = await rodar(['doctor', '--only', 'config', '--fix', '--json'], { raiz });
  assert.equal(por(fix, 'config.aplicada').status, 'ok');
  assert.equal((await rodar(['doctor', '--only', 'config', '--json'], { raiz })).codigo, 0);
});

test('doctor: modo privado sem chave de assinatura do vídeo é erro; com a chave nas variáveis ou no Worker, ok', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const semChave = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k'.repeat(20) }, fetch: criarFetch(videosOk) });
  assert.equal(por(semChave, 'video.assinatura').status, 'erro');
  assert.equal(semChave.codigo, 1);
  const comChave = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch(videosOk) });
  assert.equal(por(comChave, 'video.assinatura').status, 'ok');
  mundo.segredos.set('BUNNY_TOKEN_KEY', 'x'); mundo.segredos.set('BUNNY_PULLZONE', 'x');
  const noWorker = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k'.repeat(20) }, fetch: criarFetch(videosOk) });
  assert.equal(por(noWorker, 'video.assinatura').status, 'ok');
});

test('doctor: provedor recusa a chave -> erro; credenciais só no Worker -> aviso de que não testou daqui', async () => {
  const { raiz, mundo } = await projeto('criador');
  const recusa = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch({ '/videos': { status: 401, corpo: {} } }) });
  assert.equal(por(recusa, 'video.conexao').status, 'erro');
  mundo.segredos.set('BUNNY_LIBRARY_ID', 'x'); mundo.segredos.set('BUNNY_API_KEY', 'x');
  const remoto = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo });
  assert.equal(por(remoto, 'video.credenciais').status, 'ok');
  assert.equal(por(remoto, 'video.conexao').status, 'aviso');
  const falta = await rodar(['doctor', '--only', 'video', '--json'], { raiz: (await projeto('criador')).raiz, mundo: criarMundo({ worker: true }) });
  assert.equal(por(falta, 'video.credenciais').status, 'erro');
});

test('doctor admin: ADMIN_PASSWORD e SESSION_SECRET ausentes são erro quando o Worker existe, aviso antes do 1º deploy', async () => {
  const { raiz, mundo } = await projeto('criador');
  mundo.segredos.clear();
  const erro = await rodar(['doctor', '--only', 'admin', '--json'], { raiz, mundo });
  assert.equal(por(erro, 'admin.admin-password').status, 'erro');
  assert.equal(erro.codigo, 1);
  const antes = await rodar(['doctor', '--only', 'admin', '--json'], { raiz, mundo: criarMundo({ worker: false }) });
  assert.equal(por(antes, 'admin.admin-password').status, 'aviso');
  assert.equal(antes.codigo, 0);
});

test('doctor acesso: cadastro sem Turnstile avisa; privado com assinarMidia=false é erro', async () => {
  const { raiz, mundo } = await projeto('escola');
  const cad = await rodar(['doctor', '--only', 'acesso', '--json'], { raiz, mundo });
  assert.equal(por(cad, 'acesso.turnstile').status, 'aviso');
  await rodar(['acesso', '--modo', 'privado'], { raiz, mundo });
  const c = lerSiteJson(raiz);
  c.video.provedor = 'bunny';
  c.acesso.privado.assinarMidia = false;
  escreverSiteJson(raiz, c);
  const r = await rodar(['doctor', '--only', 'acesso', '--json'], { raiz, mundo });
  assert.equal(por(r, 'acesso.assinatura').status, 'erro');
});

test('doctor seguranca: segredo em arquivo versionado e .gitignore faltando são erros; --fix completa o .gitignore', async () => {
  const raiz = criarProjeto();
  writeFileSync(path.join(raiz, 'notas.md'), 'minha chave: AKIA' + 'ABCDEFGHIJKLMNOP\n');
  const r = await rodar(['doctor', '--only', 'seguranca', '--json'], { raiz });
  assert.equal(por(r, 'seguranca.segredos').status, 'erro');
  assert.match(por(r, 'seguranca.segredos').mensagem, /notas\.md:1/);
  assert.ok(!r.tudo.includes('ABCDEFGHIJKLMNOP'));
  writeFileSync(path.join(raiz, '.gitignore'), 'node_modules/\n');
  const g = await rodar(['doctor', '--only', 'seguranca', '--json'], { raiz });
  assert.equal(por(g, 'seguranca.gitignore').status, 'erro');
  const f = await rodar(['doctor', '--only', 'seguranca', '--fix', '--json'], { raiz });
  assert.equal(por(f, 'seguranca.gitignore').status, 'ok');
  assert.match(lerArq(raiz, '.gitignore'), /^\.env$/m);
});

/* ------------------------------------------------------------------ --remote */

const base = 'https://minha-tela.sub.workers.dev';
const rotasFechadas = () => ({
  '/': { status: 200, corpo: '<html></html>', cabecalhos: CABECALHOS_SEGUROS },
  '/api/catalogo': { status: 401, corpo: { codigo: 'nao-autorizado' } },
  '/robots.txt': { status: 200, corpo: 'User-agent: *\nDisallow: /\n' },
  [`/${GUID}/playlist.m3u8`]: { status: 403, corpo: 'forbidden' }
});

test('doctor --remote, modo privado BEM configurado: catálogo fecha (401), vídeo sem assinatura fecha (403) e tudo fica verde', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const fetch = criarFetch({ ...rotasFechadas(), ...videosOk });
  const r = await rodar(['doctor', '--remote', '--url', base, '--video-id', GUID, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch });
  assert.equal(r.codigo, 0, JSON.stringify(r.json.checagens.filter((c) => c.status === 'erro')));
  assert.equal(por(r, 'remoto.catalogo').status, 'ok');
  assert.equal(por(r, 'remoto.hls').status, 'ok');
  assert.equal(por(r, 'remoto.arquivos-internos').status, 'ok');
  assert.ok(fetch.chamadas.some((c) => c.url.endsWith('/playlist.m3u8')), 'testou o HLS de fora');
  assert.ok(fetch.chamadas.every((c) => !c.opcoes.headers.cookie && !c.opcoes.headers.authorization), 'anônimo de verdade: sem cookie nem credencial');
});

test('TESTE NEGATIVO doctor --remote, modo privado com o catálogo aberto: FALHA (saída 1)', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const fetch = criarFetch({ ...rotasFechadas(), '/api/catalogo': { status: 200, corpo: { itens: [{ id: 'a', titulo: 'Aula' }] } }, ...videosOk });
  const r = await rodar(['doctor', '--remote', '--url', base, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch });
  assert.equal(r.codigo, 1);
  assert.equal(por(r, 'remoto.catalogo').status, 'erro');
  assert.match(por(r, 'remoto.catalogo').mensagem, /ABRE para qualquer pessoa/);
});

test('TESTE NEGATIVO doctor --remote, modo privado com o HLS aberto: FALHA (saída 1), pelo --video-id e pelo --hls', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const aberto = criarFetch({ ...rotasFechadas(), [`/${GUID}/playlist.m3u8`]: { status: 200, corpo: '#EXTM3U\n' }, ...videosOk });
  const a = await rodar(['doctor', '--remote', '--url', base, '--video-id', GUID, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: aberto });
  assert.equal(a.codigo, 1);
  assert.equal(por(a, 'remoto.hls').status, 'erro');
  assert.match(por(a, 'remoto.hls').mensagem, /ABRE sem login/);
  const b = await rodar(['doctor', '--remote', '--url', base, '--hls', `https://cdn.teste/${GUID}/playlist.m3u8`, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch({ ...rotasFechadas(), [`/${GUID}/playlist.m3u8`]: { status: 200, corpo: '#EXTM3U\n' }, ...videosOk }) });
  assert.equal(b.codigo, 1);
});

test('TESTE NEGATIVO: config propositalmente errada (assinarMidia desligado) + site que vaza = erros em acesso e remoto', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const c = lerSiteJson(raiz);
  c.acesso.privado.assinarMidia = false;
  escreverSiteJson(raiz, c);
  const fetch = criarFetch({ ...rotasFechadas(), '/api/catalogo': { status: 200, corpo: { itens: [] } }, [`/${GUID}/playlist.m3u8`]: { status: 200, corpo: '#EXTM3U' }, ...videosOk });
  const r = await rodar(['doctor', '--remote', '--url', base, '--video-id', GUID, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch });
  assert.equal(r.codigo, 1);
  assert.equal(por(r, 'acesso.assinatura').status, 'erro');
  assert.equal(por(r, 'remoto.catalogo').status, 'erro');
  assert.equal(por(r, 'remoto.hls').status, 'erro');
});

test('doctor --remote, modo privado: HLS tirado do catálogo anônimo também é testado; sem vídeo para testar vira aviso (não erro)', async () => {
  const { raiz, mundo } = await projeto('empresa', 'Empresa Alfa');
  const fechado = await rodar(['doctor', '--remote', '--url', base, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: criarFetch({ ...rotasFechadas(), ...videosOk }) });
  assert.equal(por(fechado, 'remoto.hls').status, 'aviso');
  assert.match(por(fechado, 'remoto.hls').correcao, /--video-id/);
  assert.equal(fechado.codigo, 0);
  const vaza = criarFetch({ ...rotasFechadas(), '/api/catalogo': { status: 200, corpo: { itens: [{ midia: { hls: `https://cdn.teste/${GUID}/playlist.m3u8` } }] } }, [`/${GUID}/playlist.m3u8`]: { status: 200, corpo: '#EXTM3U' }, ...videosOk });
  const r = await rodar(['doctor', '--remote', '--url', base, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch: vaza });
  assert.equal(por(r, 'remoto.hls').status, 'erro');
});

test('doctor --remote, modo público: catálogo e vídeo abertos são o esperado (ok)', async () => {
  const { raiz, mundo } = await projeto('criador');
  const fetch = criarFetch({ '/': { status: 200, corpo: 'ok', cabecalhos: CABECALHOS_SEGUROS }, '/api/catalogo': { status: 200, corpo: { itens: [{ midia: { hls: `https://cdn.teste/${GUID}/playlist.m3u8` } }] } }, [`/${GUID}/playlist.m3u8`]: { status: 200, corpo: '#EXTM3U' }, ...videosOk });
  const r = await rodar(['doctor', '--remote', '--url', base, '--json'], { raiz, mundo, env: ENV_BUNNY, fetch });
  assert.equal(r.codigo, 0, JSON.stringify(r.json.checagens.filter((c) => c.status === 'erro')));
  assert.equal(por(r, 'remoto.catalogo').status, 'ok');
  assert.equal(por(r, 'remoto.hls').status, 'ok');
});

test('doctor --remote: arquivos internos servidos (.env, wrangler.jsonc) e site fora do ar são erros; sem endereço pede --url', async () => {
  const { raiz, mundo } = await projeto('criador');
  const vaza = criarFetch({ '/': { status: 200, corpo: 'ok', cabecalhos: CABECALHOS_SEGUROS }, '/api/catalogo': { status: 200, corpo: { itens: [] } }, '/.env': { status: 200, corpo: 'X=1' } });
  const r = await rodar(['doctor', '--only', 'remoto', '--url', base, '--json'], { raiz, mundo, fetch: vaza });
  assert.equal(por(r, 'remoto.arquivos-internos').status, 'erro');
  assert.match(por(r, 'remoto.arquivos-internos').mensagem, /\/\.env/);
  const fora = criarFetch({});
  const f = await rodar(['doctor', '--only', 'remoto', '--url', base, '--json'], { raiz, mundo, fetch: fora });
  assert.equal(por(f, 'remoto.home').status, 'erro');
  const semUrl = await rodar(['doctor', '--only', 'remoto', '--json'], { raiz, mundo, fetch: fora });
  assert.equal(por(semUrl, 'remoto.url').status, 'erro');
  assert.equal(semUrl.codigo, 1);
});

test('doctor --remote: erro de rede não derruba o doctor (vira erro na checagem)', async () => {
  const { raiz, mundo } = await projeto('criador');
  const quebrado = async () => { throw new Error('ECONNREFUSED'); };
  const r = await rodar(['doctor', '--only', 'remoto', '--url', base, '--json'], { raiz, mundo, fetch: quebrado });
  assert.equal(r.codigo, 1);
  assert.match(por(r, 'remoto.home').mensagem, /ECONNREFUSED/);
});
