/* O espelho Node dos adaptadores (scripts/lib/provedores): o envio TUS de um
 * arquivo do disco pelo PLANO do adaptador, e a leitura da `fonte` nos dois
 * formatos. Sem rede: o servidor TUS é um fetch de mentira. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const espelho = () => import('../scripts/lib/provedores/index.mjs');

function servidorTus({ tamanhoEsperado, offsetInicial = 0 }) {
  const chamadas = [];
  let recebido = offsetInicial;
  const fetch = async (url, init = {}) => {
    const cab = new Headers(init.headers || {});
    chamadas.push({ url: String(url), metodo: init.method, cab });
    if (init.method === 'POST') {
      assert.equal(cab.get('upload-length'), String(tamanhoEsperado));
      return new Response(null, { status: 201, headers: { location: '/tusupload/abc123' } });
    }
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'upload-offset': String(recebido) } });
    if (init.method === 'PATCH') {
      assert.equal(Number(cab.get('upload-offset')), recebido, 'offset fora de ordem');
      recebido += init.body.length;
      return new Response(null, { status: 204, headers: { 'upload-offset': String(recebido) } });
    }
    throw new Error('método inesperado ' + init.method);
  };
  return { fetch, chamadas, recebido: () => recebido };
}

function arquivoDe(tamanho) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tus-'));
  const caminho = path.join(dir, 'v.mp4');
  fs.writeFileSync(caminho, Buffer.alloc(tamanho, 7));
  return caminho;
}

test('enviarArquivo manda o arquivo em pedaços pelo plano de endpoint: cria, depois PATCH com os cabeçalhos do plano', async () => {
  const { enviarArquivo } = await espelho();
  const caminho = arquivoDe(2500000);
  const srv = servidorTus({ tamanhoEsperado: 2500000 });
  const plano = {
    protocolo: 'tus', modo: 'endpoint', url: 'https://tus.exemplo.test/tusupload', pedacoBytes: 1048576,
    cabecalhos: { AuthorizationSignature: 'assinatura', VideoId: 'v1' }, metadados: { title: 'Aula' }
  };
  const progresso = [];
  await enviarArquivo(plano, caminho, { fetch: srv.fetch, aoProgredir: (f, t) => progresso.push([f, t]) });
  assert.equal(srv.recebido(), 2500000);
  assert.deepEqual(srv.chamadas.map(c => c.metodo), ['POST', 'PATCH', 'PATCH', 'PATCH']);
  assert.equal(srv.chamadas[0].cab.get('authorizationsignature'), 'assinatura');
  assert.equal(srv.chamadas[0].cab.get('tus-resumable'), '1.0.0');
  assert.match(srv.chamadas[0].cab.get('upload-metadata'), /title QXVsYQ==/);
  assert.equal(srv.chamadas[1].url, 'https://tus.exemplo.test/tusupload/abc123', 'o Location relativo não foi resolvido');
  assert.equal(srv.chamadas[1].cab.get('videoid'), 'v1', 'os cabeçalhos do plano precisam ir também nos PATCH');
  assert.deepEqual(progresso[progresso.length - 1], [2500000, 2500000]);
});

test('enviarArquivo com plano de URL pronta retoma do offset que o servidor informa, sem criar upload', async () => {
  const { enviarArquivo } = await espelho();
  const caminho = arquivoDe(2000000);
  const srv = servidorTus({ tamanhoEsperado: 2000000, offsetInicial: 1048576 });
  await enviarArquivo({ protocolo: 'tus', modo: 'url-pronta', url: 'https://tus.exemplo.test/u/1', pedacoBytes: 1048576, cabecalhos: {}, metadados: {} }, caminho, { fetch: srv.fetch });
  assert.deepEqual(srv.chamadas.map(c => c.metodo), ['HEAD', 'PATCH']);
  assert.equal(srv.recebido(), 2000000 + 0, 'a retomada não terminou o arquivo');
});

test('enviarArquivo recusa protocolo que os scripts não falam e offset que não avança', async () => {
  const { enviarArquivo } = await espelho();
  await assert.rejects(() => enviarArquivo({ protocolo: 's3-multipart', url: 'https://x.test' }, arquivoDe(10)), /protocolo/);
  const caminho = arquivoDe(100);
  const parado = async (url, init) => init.method === 'PATCH' ? new Response(null, { status: 204, headers: { 'upload-offset': '0' } }) : new Response(null, { status: 200, headers: { 'upload-offset': '0' } });
  await assert.rejects(() => enviarArquivo({ protocolo: 'tus', modo: 'url-pronta', url: 'https://x.test/u', pedacoBytes: 50, cabecalhos: {} }, caminho, { fetch: parado }), /não avançou/);
});

test('o espelho é o MESMO código do Worker (sem segunda implementação), e lê a fonte nos dois formatos', async () => {
  const m = await espelho();
  const w = await import('../core/worker/_lib/provedores/index.js');
  assert.equal(m.criarProvedor, w.criarProvedor);
  assert.equal(m.montarMidia, w.montarMidia);
  assert.equal(m.idDoVideo({ fonte: { videoId: 'abc' } }), 'abc');
  assert.equal(m.idDoVideo({ fonte: { provedor: 'bunny', id: 'abc', extras: {} } }), 'abc');
  const { provedor } = await m.provedorDoAmbiente({ env: { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'chave-1234', BUNNY_PULLZONE: 'vz-a.b-cdn.net' } });
  assert.equal(await m.urlDaLegenda(provedor, { fonte: { videoId: 'aaaaaaaa-1' } }), 'https://vz-a.b-cdn.net/aaaaaaaa-1/captions/pt.vtt');
  assert.equal(await m.urlDaLegenda(provedor, { fonte: {} }), null);
  assert.throws(() => m.exigirConfigurado(w.criarProvedor(null, {})), /BUNNY_LIBRARY_ID, BUNNY_API_KEY/);
});

test('os scripts que liam `config.pullzone` do catálogo não dependem mais dela (a API não a entrega)', () => {
  const dir = path.join(__dirname, '..', 'scripts');
  for (const nome of fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).concat(fs.readdirSync(path.join(dir, 'lib')).filter(f => f.endsWith('.mjs')).map(f => 'lib/' + f))) {
    const codigo = fs.readFileSync(path.join(dir, nome), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/config\.pullzone|\.pullzone\b/.test(codigo.replace(/^\s*\/\/.*$/gm, '')), nome + ' ainda lê pullzone da API');
  }
});
