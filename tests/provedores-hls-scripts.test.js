/* Os scripts de carga falam com o provedor SÓ pelo adaptador (scripts/lib/provedores):
 * as funções de consulta por título, a capacidade que protege o que é de um provedor só,
 * e o cadastro em lote do HLS genérico (scripts/cadastrar-hls.mjs). Sem rede. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const espelho = () => import('../scripts/lib/provedores/index.mjs');
const BASE = 'https://videos.exemplo.test/acervo';

async function adaptadorHls(respostas = {}, chamadas = []) {
  const m = await espelho();
  const fetch = async (url, init) => {
    chamadas.push({ url: String(url), init });
    const r = respostas[String(url)];
    if (!r) throw new Error('chamada não prevista: ' + url);
    return new Response(r.texto, { status: r.status || 200, headers: r.cabecalhos || {} });
  };
  return m.criarProvedor({ video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: BASE, hostsPermitidos: ['cdn.exemplo.net'] } } }, {}, { provedor: 'hls-generico', fetch });
}

test('videoDoItem: o vídeo do item NESTE provedor, nos dois formatos de fonte; de outro provedor é null', async () => {
  const m = await espelho();
  const hls = await adaptadorHls();
  assert.deepEqual(m.videoDoItem(hls, { fonte: { provedor: 'hls-generico', id: 'a/b.m3u8', extras: { capa: BASE + '/c.jpg' } } }), { id: 'a/b.m3u8', extras: { capa: BASE + '/c.jpg' } });
  assert.equal(m.videoDoItem(hls, { fonte: { provedor: 'bunny', id: 'aaaaaaaa-1', extras: {} } }), null);
  assert.equal(m.videoDoItem(hls, { fonte: {} }), null);
  assert.equal(m.videoDoItem(hls, {}), null);
  /* Formato de antes do M4 vira bunny: não é do HLS. */
  assert.equal(m.videoDoItem(hls, { fonte: { videoId: 'aaaaaaaa-1' } }), null);
});

test('statusDoItem e dadosDoItem levam os extras do item ao adaptador (o endereço do playlist fora da base)', async () => {
  const m = await espelho();
  const url = 'https://cdn.exemplo.net/v/x.m3u8';
  const chamadas = [];
  const hls = await adaptadorHls({ [url]: { texto: '#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST' } }, chamadas);
  const item = { fonte: { provedor: 'hls-generico', id: 'hls-12345678', extras: { hls: url } } };
  assert.equal((await m.statusDoItem(hls, item)).estado, 'pronto');
  assert.equal((await m.dadosDoItem(hls, item)).duracaoSeg, 4);
  assert.equal(chamadas.length, 2);
  await assert.rejects(() => m.statusDoItem(hls, {}), /não tem vídeo/);
});

test('exigirCapacidade: recusa com mensagem clara o que o provedor não faz; ehNaoEncontrado reconhece o 404 do provedor', async () => {
  const m = await espelho();
  const hls = await adaptadorHls();
  assert.equal(m.exigirCapacidade(hls, 'fontePorUrl', 'cadastrar'), hls);
  assert.throws(() => m.exigirCapacidade(hls, 'capaPorUpload', 'enviar capas'), /"hls-generico".*enviar capas.*capaPorUpload/);
  assert.throws(() => m.exigirCapacidade(hls, 'capitulosNativos', 'x'), /capitulosNativos/);
  assert.equal(m.exigirCapacidade(m.criarProvedor(null, { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'k-1234' }), 'capaPorUpload', 'x').id, 'bunny');
  const falha = await adaptadorHls({ [BASE + '/a.m3u8']: { status: 404, texto: 'nada' } });
  await assert.rejects(() => falha.obterVideo('a.m3u8'), (e) => m.ehNaoEncontrado(e) === true);
  assert.equal(m.ehNaoEncontrado(new Error('404 qualquer')), false);
});

test('urlDaLegenda escolhe a faixa do idioma cadastrada no item (HLS) ou monta a do idioma (Bunny)', async () => {
  const m = await espelho();
  const hls = await adaptadorHls();
  const item = { fonte: { provedor: 'hls-generico', id: 'a.m3u8', extras: { legendas: [{ idioma: 'en', url: BASE + '/en.vtt' }, { idioma: 'pt-BR', url: BASE + '/pt.vtt' }] } } };
  assert.equal(await m.urlDaLegenda(hls, item, 'pt'), BASE + '/pt.vtt');
  assert.equal(await m.urlDaLegenda(hls, item, 'en'), BASE + '/en.vtt');
  assert.equal(await m.urlDaLegenda(hls, item, 'es'), BASE + '/en.vtt', 'sem o idioma, vale a primeira faixa');
  assert.equal(await m.urlDaLegenda(hls, { fonte: { provedor: 'hls-generico', id: 'a.m3u8', extras: {} } }), null);
});

test('nenhum script fala com o Bunny por fora do adaptador (lib/bunny.mjs saiu; ninguém usa criarCliente)', () => {
  assert.ok(!fs.existsSync(path.join(RAIZ, 'scripts', 'lib', 'bunny.mjs')));
  const dir = path.join(RAIZ, 'scripts');
  for (const nome of fs.readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const codigo = fs.readFileSync(path.join(dir, nome), 'utf8');
    assert.ok(!/lib\/bunny\.mjs|criarCliente\b|bunnycdn\.com|b-cdn\.net/.test(codigo), nome + ' ainda fala com o Bunny direto');
  }
});

/* ---------------------------------------------------- cadastrar-hls.mjs */

function ambienteDoCadastro(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hls-'));
  const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'site.json'), 'utf8'));
  config.video = Object.assign({ provedor: 'hls-generico', hlsGenerico: { baseUrl: BASE, hostsPermitidos: ['cdn.exemplo.net'] } }, extra);
  delete config.$schema;
  const arquivoConfig = path.join(dir, 'site.json');
  fs.writeFileSync(arquivoConfig, JSON.stringify(config));
  const catalogo = path.join(dir, 'catalogo.json');
  fs.writeFileSync(catalogo, JSON.stringify({ itens: [
    { id: 'aula-1', titulo: 'Aula 1' }, { id: 'aula-2', titulo: 'Aula 2' }, { id: 'aula-3', titulo: 'Aula 3', fonte: { provedor: 'hls-generico', id: 'ja/tem.m3u8', extras: {} } }
  ] }));
  const rodar = (mapa, ...args) => {
    const arquivoMapa = path.join(dir, 'mapa.json');
    fs.writeFileSync(arquivoMapa, JSON.stringify(mapa));
    const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'cadastrar-hls.mjs'), '--mapa', arquivoMapa, '--catalogo', catalogo, ...args],
      { encoding: 'utf8', env: Object.assign({}, process.env, { APP_CONFIG: arquivoConfig }), cwd: dir });
    return { saida: r.stdout + r.stderr, codigo: r.status, lido: () => JSON.parse(fs.readFileSync(catalogo, 'utf8')) };
  };
  return { rodar };
}

test('cadastrar-hls grava a `fonte` de cada título do mapa (id sob a base, ou hls-<hash> com o endereço em extras)', () => {
  const { rodar } = ambienteDoCadastro();
  const r = rodar([
    { item: 'aula-1', hls: BASE + '/serie/aula-1/master.m3u8', capa: BASE + '/serie/aula-1/capa.jpg', legenda: BASE + '/serie/aula-1/pt.vtt' },
    { item: 'aula-2', hls: 'https://cdn.exemplo.net/v/2.m3u8', mp4: 'https://cdn.exemplo.net/v/2.mp4' }
  ]);
  assert.equal(r.codigo, 0, r.saida);
  const itens = r.lido().itens;
  assert.equal(itens[0].fonte.provedor, 'hls-generico');
  assert.equal(itens[0].fonte.id, 'serie/aula-1/master.m3u8');
  assert.equal(itens[0].fonte.extras.capa, BASE + '/serie/aula-1/capa.jpg');
  assert.deepEqual(itens[0].fonte.extras.legendas, [{ idioma: 'pt', rotulo: 'Português', url: BASE + '/serie/aula-1/pt.vtt' }]);
  assert.match(itens[1].fonte.id, /^hls-[0-9a-f]{8}$/);
  assert.equal(itens[1].fonte.extras.hls, 'https://cdn.exemplo.net/v/2.m3u8');
  assert.deepEqual(itens[1].fonte.extras.mp4, { '720p': 'https://cdn.exemplo.net/v/2.mp4' });
});

test('cadastrar-hls --simular não grava; quem já tem fonte é pulado; host não liberado e título inexistente saem com erro', () => {
  const { rodar } = ambienteDoCadastro();
  const ensaio = rodar([{ item: 'aula-1', hls: BASE + '/a.m3u8' }], '--simular');
  assert.equal(ensaio.codigo, 0, ensaio.saida);
  assert.match(ensaio.saida, /--simular: nada foi gravado/);
  assert.equal(ensaio.lido().itens[0].fonte, undefined);

  const pula = rodar([{ item: 'aula-3', hls: BASE + '/outra.m3u8' }]);
  assert.match(pula.saida, /já tem fonte/);
  assert.equal(pula.lido().itens[2].fonte.id, 'ja/tem.m3u8');

  const ruim = rodar([{ item: 'aula-1', hls: 'https://estranho.test/a.m3u8' }, { item: 'nao-existe', hls: BASE + '/b.m3u8' }]);
  assert.equal(ruim.codigo, 1);
  assert.match(ruim.saida, /parametro-invalido \(hls:host-nao-permitido\)/);
  assert.match(ruim.saida, /título não encontrado no catálogo: nao-existe/);
  assert.equal(ruim.lido().itens[0].fonte, undefined);
});

test('cadastrar-hls recusa quando o provedor configurado não cadastra por endereço (nada de fonte de outro provedor)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hls-'));
  const catalogo = path.join(dir, 'catalogo.json');
  fs.writeFileSync(catalogo, JSON.stringify({ itens: [{ id: 'a', titulo: 'A' }] }));
  const mapa = path.join(dir, 'mapa.json');
  fs.writeFileSync(mapa, JSON.stringify([{ item: 'a', hls: BASE + '/a.m3u8' }]));
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'cadastrar-hls.mjs'), '--mapa', mapa, '--catalogo', catalogo],
    { encoding: 'utf8', env: Object.assign({}, process.env, { APP_CONFIG: path.join(RAIZ, 'config', 'site.json'), BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'chave-1234' }) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /não oferece isto/);
});
