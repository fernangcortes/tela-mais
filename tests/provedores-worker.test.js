/* O provedor de vídeo vista de fora (M4): o que o Worker entrega ao navegador, o
 * que ele aceita gravar, o plano de upload, a migração do formato antigo de
 * `fonte` e a regra "o navegador não conhece provedor". Sem rede: o Bunny é um
 * `fetch` de mentira injetado no global (o Worker usa o fetch global; os testes
 * do adaptador em si, com fixtures, estão em provedores-contrato.test.js). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const App = require('../core/site/catalogo-core.js');
const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'core', 'site');

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PZ = 'vz-exemplo-abc.b-cdn.net';
const SEGREDO_DE_API = 'chave-de-api-que-nao-pode-sair';

/* ------------------------------------------------------------ infraestrutura */

const kv = (inicial) => {
  const dados = Object.assign({}, inicial);
  return {
    dados,
    get: async (k, tipo) => (k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null),
    getWithMetadata: async (k, tipo) => ({ value: k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null, metadata: null }),
    put: async (k, v) => { dados[k] = String(v); },
    delete: async (k) => { delete dados[k]; },
    list: async ({ prefix = '' } = {}) => ({ keys: Object.keys(dados).filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true })
  };
};

const ambiente = (catalogo, extra) => Object.assign({
  ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres',
  CATALOGO: kv(catalogo === undefined ? {} : { catalogo: JSON.stringify(catalogo) }),
  ASSETS: { fetch: async () => new Response('<html></html>', { status: 200 }) },
  BUNNY_LIBRARY_ID: '123456', BUNNY_API_KEY: SEGREDO_DE_API, BUNNY_PULLZONE: PZ
}, extra || {});

async function pedir(env, { metodo = 'GET', caminho, corpo, bruto, token, config, modo = 'publico' }) {
  const { criarWorker } = await import('../core/worker/index.js');
  const worker = criarWorker({ obterConfig: async () => Object.assign({ acesso: { modo } }, config || {}) });
  const resposta = await worker.fetch(new Request('https://exemplo.test' + caminho, {
    method: metodo,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
    body: bruto !== undefined ? bruto : (corpo === undefined ? undefined : JSON.stringify(corpo))
  }), env, { waitUntil: () => {} });
  const texto = await resposta.clone().text();
  let json = null;
  try { json = JSON.parse(texto); } catch (e) { /* sem JSON */ }
  return { status: resposta.status, corpo: json, texto, cabecalhos: resposta.headers };
}

const entrar = async (env) => (await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { senha: 'senha-do-super' } })).corpo.token;

/* Um Bunny de mentira no fetch GLOBAL. `roteiro(metodo, url, init)` devolve { status, corpo } ou null
 * (que cai para um erro: nada vai à rede). Guarda as chamadas. */
function bunnyDeMentira(roteiro) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    const metodo = String(init.method || 'GET').toUpperCase();
    chamadas.push({ metodo, url: String(url), init });
    const r = roteiro(metodo, String(url), init);
    if (!r) throw new Error('chamada ao provedor não prevista: ' + metodo + ' ' + url);
    return new Response(r.texto !== undefined ? r.texto : JSON.stringify(r.corpo === undefined ? {} : r.corpo), { status: r.status || 200 });
  };
  return { chamadas, desfazer: () => { globalThis.fetch = original; } };
}

const catalogoAntigo = () => ({
  rev: 1, versao: 1,
  itens: [
    { id: 'a', titulo: 'A', publicar: true, capa_arquivo: 'thumbnail_ab12.jpg', capa_versao: '1700000000000', fonte: { tipo: 'bunny', libraryId: '123456', videoId: ID } },
    { id: 'b', titulo: 'B', publicar: false, fonte: { tipo: 'bunny', libraryId: null, videoId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' } },
    { id: 'c', titulo: 'Sem vídeo', publicar: true, fonte: { tipo: 'bunny', libraryId: null, videoId: null } }
  ]
});

/* --------------------------------------------------------------- migrarFonte */

test('migrarFonte: o formato antigo vira { provedor, id, extras }, e migrar de novo não muda nada', () => {
  assert.deepEqual(App.migrarFonte({ tipo: 'bunny', libraryId: '123456', videoId: ID }), { provedor: 'bunny', id: ID, extras: { libraryId: '123456' } });
  /* Sem library, sem extras; o id numérico vira texto. */
  assert.deepEqual(App.migrarFonte({ tipo: 'bunny', libraryId: null, videoId: 123456789 }), { provedor: 'bunny', id: '123456789', extras: {} });
  /* O formato antigo só existia para o Bunny: sem `tipo`, é bunny. */
  assert.equal(App.migrarFonte({ videoId: 'x' }).provedor, 'bunny');
  /* Outro `tipo` é respeitado (o item continua apontando para o provedor dele). */
  assert.equal(App.migrarFonte({ tipo: 'hls', videoId: 'x' }).provedor, 'hls');
  /* Campo extra que um script gravou não se perde na migração. */
  assert.deepEqual(App.migrarFonte({ tipo: 'bunny', videoId: 'x', libraryId: '1', colecao: 'c1' }).extras, { colecao: 'c1', libraryId: '1' });
  /* Ausente, vazio e lixo viram uma fonte sem vídeo, sem lançar. */
  for (const ruim of [undefined, null, 'texto', 42, [], {}]) {
    assert.deepEqual(App.migrarFonte(ruim), { provedor: 'bunny', id: null, extras: {} }, JSON.stringify(ruim));
  }
  /* O formato novo passa como está (provedor, id, extras), com extras em ordem estável. */
  const nova = { provedor: 'cloudflare-stream', id: 'f'.repeat(32), extras: { z: 1, a: 2 } };
  assert.equal(JSON.stringify(App.migrarFonte(nova)), JSON.stringify({ provedor: 'cloudflare-stream', id: 'f'.repeat(32), extras: { a: 2, z: 1 } }));
  /* IDEMPOTENTE, para qualquer um dos formatos. */
  for (const f of [{ tipo: 'bunny', libraryId: '1', videoId: ID }, nova, {}, null, { videoId: 'x' }]) {
    const uma = App.migrarFonte(f);
    assert.deepEqual(App.migrarFonte(uma), uma, JSON.stringify(f));
    assert.equal(JSON.stringify(App.migrarFonte(uma)), JSON.stringify(uma), 'a ordem das chaves mudou ao migrar de novo');
  }
  /* Não muda o que recebeu. */
  const entrada = { tipo: 'bunny', libraryId: '1', videoId: ID };
  App.migrarFonte(entrada);
  assert.deepEqual(entrada, { tipo: 'bunny', libraryId: '1', videoId: ID });
});

test('idDoVideo lê os dois formatos; itemMigrado e catalogoMigrado só copiam quando há o que mudar, e nunca deixam `midia`', () => {
  assert.equal(App.idDoVideo({ fonte: { videoId: ID } }), ID);
  assert.equal(App.idDoVideo({ fonte: { provedor: 'bunny', id: ID, extras: {} } }), ID);
  assert.equal(App.idDoVideo({ fonte: { videoId: null } }), null);
  assert.equal(App.idDoVideo({}), null);
  assert.equal(App.idDoVideo(null), null);

  const migrado = { id: 'a', fonte: { provedor: 'bunny', id: ID, extras: {} } };
  assert.equal(App.itemMigrado(migrado), migrado, 'copiou um item que já estava no formato novo');
  const velho = { id: 'a', fonte: { tipo: 'bunny', libraryId: '1', videoId: ID }, midia: { hls: 'x' } };
  const novo = App.itemMigrado(velho);
  assert.deepEqual(novo.fonte, { provedor: 'bunny', id: ID, extras: { libraryId: '1' } });
  assert.ok(!('midia' in novo), '`midia` é do servidor e nunca é gravada');
  assert.ok('midia' in velho && velho.fonte.videoId === ID, 'itemMigrado mexeu no item que recebeu');

  const cat = { rev: 3, itens: [velho, migrado] };
  const m = App.catalogoMigrado(cat);
  assert.equal(m.itens[1], migrado);
  assert.equal(m.rev, 3);
  assert.equal(App.catalogoMigrado(m), m, 'migrar um catálogo já migrado devia devolver o mesmo');
  assert.equal(App.catalogoMigrado(null), null);
});

test('o histórico não vê mudança de `fonte` quando só o formato mudou, e não vê `midia` como mudança de ninguém', () => {
  const antes = { itens: [{ id: 'a', fonte: { tipo: 'bunny', libraryId: '1', videoId: ID } }] };
  const depois = { itens: [{ id: 'a', fonte: { provedor: 'bunny', id: ID, extras: { libraryId: '1' } }, midia: { hls: 'https://x/y.m3u8' } }] };
  assert.deepEqual(App.diferencasDoCatalogo(antes, depois), []);
  /* Trocar o vídeo de verdade continua sendo mudança — e só do superadmin. */
  const outro = { itens: [{ id: 'a', fonte: { provedor: 'bunny', id: 'outro-video-0001', extras: { libraryId: '1' } } }] };
  const difs = App.diferencasDoCatalogo(antes, outro);
  assert.deepEqual(difs.map(d => [d.campo, d.permissao]), [['fonte', null]]);
});

/* ------------------------------------------------------ o catálogo entrega `midia` */

test('o catálogo público entrega item.midia pronto — e nenhum dado de provedor além do necessário', async () => {
  const env = ambiente(catalogoAntigo());
  const r = await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(r.status, 200, r.texto);
  /* Só o publicado, e com `midia` calculada pelo servidor (o formato antigo, no KV, foi lido). */
  assert.deepEqual(r.corpo.itens.map(i => i.id), ['a', 'c']);
  const a = r.corpo.itens[0];
  assert.equal(a.midia.hls, 'https://' + PZ + '/' + ID + '/playlist.m3u8');
  assert.equal(a.midia.capa, 'https://' + PZ + '/' + ID + '/thumbnail_ab12.jpg?v=1700000000000', 'a capa trocada (hash + versão) não chegou pronta');
  assert.equal(a.midia.previa, 'https://' + PZ + '/' + ID + '/preview.webp');
  assert.deepEqual(Object.keys(a.midia.mp4), ['240p', '360p', '720p']);
  assert.equal(a.midia.legendas[0].url, 'https://' + PZ + '/' + ID + '/captions/pt.vtt');
  assert.match(a.midia.embed.url, /autoplay=false/);
  assert.equal(a.midia.expiraEm, null);
  /* Título sem vídeo: sem `midia`, e o site mostra "indisponível". */
  assert.equal(r.corpo.itens[1].midia, null);
  assert.equal(App.midiaDe(r.corpo.itens[1]), null);
  assert.ok(App.midiaDe(a));

  /* O que NÃO sai: nome de arquivo de capa, libraryId, a config de ambiente, a chave. */
  assert.ok(!('capa_arquivo' in a) && !('capa_versao' in a));
  assert.deepEqual(a.fonte, { provedor: 'bunny', id: ID });
  assert.ok(!('config' in r.corpo), 'a resposta ainda leva `config` (pullzone/libraryId do ambiente)');
  assert.ok(!r.texto.includes(SEGREDO_DE_API));
  assert.ok(!/"libraryId"|"videoId"|"pullzone"/.test(r.texto), 'dado do formato antigo vazou para o navegador');
});

test('o GET completo (a mesa) também traz `midia` em cada item, inclusive os fora do ar', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const r = await pedir(env, { caminho: '/api/catalogo?completo=1', token });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.corpo.itens.map(i => i.id), ['a', 'b', 'c']);
  assert.ok(r.corpo.itens[1].midia.hls.includes('bbbbbbbb-cccc-dddd-eeee-ffffffffffff'));
  /* A fonte já vem no formato novo, com extras (a mesa e os scripts precisam). */
  assert.deepEqual(r.corpo.itens[0].fonte, { provedor: 'bunny', id: ID, extras: { libraryId: '123456' } });
  assert.ok(!('config' in r.corpo));
  assert.ok(!r.texto.includes(SEGREDO_DE_API));
});

test('o PUT migra a `fonte` e descarta `midia`: o KV nunca guarda URL calculada', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const lido = (await pedir(env, { caminho: '/api/catalogo?completo=1', token })).corpo;
  assert.ok(lido.itens[0].midia, 'precondição: o GET completo traz midia');
  lido.itens[0].titulo = 'A, editado';
  const put = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token, corpo: lido });
  assert.equal(put.status, 200, put.texto);
  const gravado = JSON.parse(env.CATALOGO.dados.catalogo);
  assert.ok(gravado.itens.every(i => !('midia' in i)), '`midia` foi gravada no KV');
  assert.deepEqual(gravado.itens[0].fonte, { provedor: 'bunny', id: ID, extras: { libraryId: '123456' } });
  assert.deepEqual(gravado.itens[2].fonte, { provedor: 'bunny', id: null, extras: {} });
  /* O histórico registra a edição do título, e NADA sobre `fonte` ou `midia`. */
  const registro = JSON.parse(env.CATALOGO.dados[App.chaveHistorico(2)]);
  assert.deepEqual([...new Set(registro.mudancas.map(m => m.campo))], ['titulo']);
});

test('conta de equipe grava o catálogo que leu sem esbarrar na `fonte`/`midia` (que não são dela)', async () => {
  const env = ambiente(catalogoAntigo());
  const sup = await entrar(env);
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup, corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const maria = (await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { usuario: 'maria', senha: 'senha-bem-comprida' } })).corpo.token;
  const lido = (await pedir(env, { caminho: '/api/catalogo?completo=1', token: maria })).corpo;
  lido.itens[0].sinopse = 'Uma sinopse nova.';
  const put = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: maria, corpo: lido });
  assert.equal(put.status, 200, put.texto);
  /* Trocar o vídeo de um título continua proibido para ela, no formato novo e no antigo. */
  for (const fonte of [{ provedor: 'bunny', id: 'outro-video-0001', extras: {} }, { tipo: 'bunny', videoId: 'outro-video-0001' }]) {
    const atual = (await pedir(env, { caminho: '/api/catalogo?completo=1', token: maria })).corpo;
    atual.itens[0].fonte = fonte;
    const r = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: maria, corpo: atual });
    assert.equal(r.status, 403, JSON.stringify(fonte));
    assert.equal(r.corpo.barradas[0].campo, 'fonte');
  }
});

test('a capa do destaque que vai ao HTML sai de midia.capa, e só vale se for de um host de mídia do adaptador', async () => {
  const cat = catalogoAntigo();
  cat.site = { destaque: 'a' };
  const env = ambiente(cat);
  await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(env.CATALOGO.dados['capa-destaque'], 'https://' + PZ + '/' + ID + '/thumbnail_ab12.jpg?v=1700000000000');
  const home = await import('../core/worker/home.js');
  const hosts = ['https://*.b-cdn.net', 'https://videos.exemplo.com.br'];
  assert.equal(home.capaValida('https://videos.exemplo.com.br/x/thumbnail.jpg', hosts), true, 'host próprio (domínio do cliente) recusado');
  assert.equal(home.capaValida('https://vz-a.b-cdn.net/x/thumbnail.jpg?v=1', hosts), true);
  assert.equal(home.capaValida('https://b-cdn.net/x.jpg', hosts), false, 'o curinga não vale para o domínio puro');
  assert.equal(home.capaValida('https://evil.com/x.jpg', hosts), false);
  assert.equal(home.capaValida('https://evil.com.b-cdn.net.evil.com/x.jpg', hosts), false);
  assert.equal(home.capaValida('https://vz-a.b-cdn.net/x.jpg', []), false, 'sem hosts do adaptador nenhuma capa vale');
  /* A pré-conexão vai ao host PRÓPRIO desta instalação, lido do adaptador. */
  const pagina = '<html><head><link rel="stylesheet" href="style.css"></head><meta property="og:image" content="og-image.png"></html>';
  const r = await home.onRequestGet({
    request: new Request('https://exemplo.test/'), modo: 'publico', config: null,
    env: { ASSETS: { fetch: async () => new Response(pagina, { status: 200 }) }, CATALOGO: { get: async () => null }, BUNNY_PULLZONE: PZ }
  });
  assert.ok((await r.text()).includes('<link rel="preconnect" href="https://' + PZ + '">'));
});

/* ------------------------------------------------------- upload pelo adaptador */

test('upload-token devolve o PLANO do adaptador: endpoint, cabeçalhos de uso único, pedaço — e a fonte para o catálogo', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const bunny = bunnyDeMentira((metodo, url) => {
    if (metodo === 'POST' && /\/library\/123456\/videos$/.test(url)) return { corpo: { guid: ID, title: 'Aula' } };
    return null;
  });
  try {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token, corpo: { titulo: 'Aula', tamanhoBytes: 5000 } });
    assert.equal(r.status, 200, r.texto);
    const c = r.corpo;
    assert.equal(c.id, ID);
    assert.equal(c.videoId, ID, 'o alias `videoId` (retomada, /api/midia) saiu');
    assert.equal(c.protocolo, 'tus');
    assert.equal(c.modo, 'endpoint');
    assert.equal(c.url, 'https://video.bunnycdn.com/tusupload');
    assert.equal(c.pedacoBytes, 50 * 1024 * 1024);
    assert.deepEqual(c.fonte, { provedor: 'bunny', id: ID, extras: { libraryId: '123456' } });
    assert.equal(c.cabecalhos.VideoId, ID);
    assert.equal(c.cabecalhos.LibraryId, '123456');
    /* A ASSINATURA de uso único: SHA256(libraryId + chave + expire + videoId), expire em SEGUNDOS. */
    const esperado = crypto.createHash('sha256').update('123456' + SEGREDO_DE_API + c.cabecalhos.AuthorizationExpire + ID).digest('hex');
    assert.equal(c.cabecalhos.AuthorizationSignature, esperado);
    assert.ok(Number(c.cabecalhos.AuthorizationExpire) > Date.now() / 1000 && Number(c.cabecalhos.AuthorizationExpire) < Date.now() / 1000 + 3700);
    assert.equal(c.expiraEm, Number(c.cabecalhos.AuthorizationExpire));
    assert.ok(!r.texto.includes(SEGREDO_DE_API), 'a chave de API saiu na resposta do upload-token');
    /* O Bunny recebeu a chave só no cabeçalho da chamada de criação. */
    assert.equal(bunny.chamadas.length, 1);
    assert.equal(new Headers(bunny.chamadas[0].init.headers).get('accesskey'), SEGREDO_DE_API);
    assert.ok(!bunny.chamadas[0].url.includes(SEGREDO_DE_API));

    /* Retomar: reassina o mesmo vídeo, e NÃO cria outro nem chama o provedor. */
    const retomada = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token, corpo: { videoId: ID } });
    assert.equal(retomada.status, 200, retomada.texto);
    assert.equal(retomada.corpo.id, ID);
    assert.equal(bunny.chamadas.length, 1, 'retomar criou vídeo');
    /* Id que não é do provedor: recusado pelo `padraoId` do adaptador. */
    const ruim = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token, corpo: { videoId: '../../x' } });
    assert.equal(ruim.status, 400);
    assert.equal(ruim.corpo.codigo, 'id-invalido');
  } finally { bunny.desfazer(); }
});

test('upload-token: provedor sem credencial diz QUAIS variáveis faltam; provedor que recusa vira 502 com o código dele', async () => {
  const token0 = await entrar(ambiente(catalogoAntigo()));
  const semChave = ambiente(catalogoAntigo(), { BUNNY_API_KEY: undefined, BUNNY_LIBRARY_ID: undefined });
  const token = await entrar(semChave);
  const r = await pedir(semChave, { metodo: 'POST', caminho: '/api/upload-token', token, corpo: { titulo: 'X' } });
  assert.equal(r.status, 500);
  assert.equal(r.corpo.codigo, 'provedor-nao-configurado');
  assert.match(r.corpo.mensagem, /BUNNY_LIBRARY_ID/);
  assert.match(r.corpo.mensagem, /BUNNY_API_KEY/);
  assert.ok(token0);

  const env = ambiente(catalogoAntigo());
  const t = await entrar(env);
  const bunny = bunnyDeMentira(() => ({ status: 401, texto: 'AccessKey invalid: ' + SEGREDO_DE_API }));
  try {
    const recusa = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: t, corpo: { titulo: 'X' } });
    assert.equal(recusa.status, 502);
    assert.equal(recusa.corpo.codigo, 'provedor-recusou-criacao');
    assert.equal(recusa.corpo.status, 401);
    assert.ok(!recusa.texto.includes(SEGREDO_DE_API), 'o provedor repetiu a chave e o erro a devolveu');
  } finally { bunny.desfazer(); }
});

test('trocar `video.provedor` na config troca o adaptador, sem editar código', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const config = { video: { provedor: 'cloudflare-stream' } };
  /* O item do Bunny não toca em outro provedor: sem `midia`, em vez de URL errada. */
  const r = await pedir(env, { caminho: '/api/catalogo', config });
  assert.equal(r.status, 200);
  assert.ok(r.corpo.itens.every(i => i.midia === null));
  /* E a CSP deixa de liberar os hosts do Bunny. */
  assert.ok(!/b-cdn|bunnycdn|mediadelivery/.test(r.cabecalhos.get('content-security-policy')));
  const bunny = await pedir(env, { caminho: '/api/catalogo' });
  assert.match(bunny.cabecalhos.get('content-security-policy'), /b-cdn\.net/);
  /* O upload fala com o provedor escolhido: o Stream sem credenciais no ambiente recusa como "não configurado" (500)... */
  const up = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token, config, corpo: { titulo: 'X' } });
  assert.equal(up.status, 500, up.texto);
  /* ...e o HLS genérico, que não recebe arquivo, recusa como recurso indisponível (501) ou não configurado (500). */
  const hls = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token, config: { video: { provedor: 'hls-generico' } }, corpo: { titulo: 'X' } });
  assert.ok([500, 501].includes(hls.status), String(hls.status));
  /* Nenhum dos dois cai no Bunny. */
  assert.ok(!/bunny/i.test(up.texto + hls.texto));
});

/* ----------------------------------------------------------------- /api/midia */

test('GET /api/midia devolve o estado NORMALIZADO e a `midia` do vídeo; id de outro formato é recusado pelo adaptador', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const casos = [[0, 'enviando'], [3, 'processando'], [4, 'pronto'], [5, 'erro']];
  for (const [status, estado] of casos) {
    const bunny = bunnyDeMentira((metodo, url) => (metodo === 'GET' && url.endsWith('/videos/' + ID)) ? { corpo: { guid: ID, status, encodeProgress: 40, length: 90, title: 'Aula' } } : null);
    try {
      const r = await pedir(env, { caminho: '/api/midia?videoId=' + ID, token });
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.corpo.estado, estado);
      assert.equal(r.corpo.pronto, estado === 'pronto');
      assert.equal(r.corpo.falhou, estado === 'erro');
      assert.equal(r.corpo.status, status, 'o status bruto some do diagnóstico');
      assert.equal(r.corpo.progresso, 40);
      assert.equal(r.corpo.duracao_seg, 90);
      assert.ok(r.corpo.midia.hls.includes(ID), 'a mesa não recebe a mídia do vídeo novo');
    } finally { bunny.desfazer(); }
  }
  for (const ruim of ['../x', 'curto', ID + '/../y']) {
    const r = await pedir(env, { caminho: '/api/midia?videoId=' + encodeURIComponent(ruim), token });
    assert.equal(r.status, 400, ruim);
    assert.equal(r.corpo.codigo, 'informe-video-id');
  }
  const caiu = bunnyDeMentira(() => ({ status: 404, texto: '{"Message":"not found"}' }));
  try {
    const r = await pedir(env, { caminho: '/api/midia?videoId=' + ID, token });
    assert.equal(r.status, 502);
    assert.equal(r.corpo.codigo, 'provedor-recusou-consulta');
    assert.equal(r.corpo.status, 404);
  } finally { caiu.desfazer(); }
});

test('POST /api/midia?tipo=capa devolve a URL nova pronta (`capa`), o nome e a versão; a legenda vai pelo adaptador', async () => {
  const env = ambiente(catalogoAntigo());
  const token = await entrar(env);
  const bunny = bunnyDeMentira((metodo, url) => {
    if (metodo === 'POST' && url.endsWith('/thumbnail')) return { corpo: { success: true } };
    if (metodo === 'GET' && url.endsWith('/videos/' + ID)) return { corpo: { guid: ID, thumbnailFileName: 'thumbnail_novo.jpg' } };
    if (metodo === 'POST' && url.includes('/captions/pt')) return { corpo: { success: true } };
    return null;
  });
  try {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=capa&videoId=' + ID, token, bruto: new Uint8Array([0xff, 0xd8, 0xff]) });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.corpo.capa_arquivo, 'thumbnail_novo.jpg');
    assert.match(r.corpo.capa, new RegExp('^https://' + PZ + '/' + ID + '/thumbnail_novo\\.jpg\\?v=\\d+$'));
    assert.equal(r.corpo.capa_versao, r.corpo.capa.split('?v=')[1]);
    assert.equal(r.corpo.rev, 2, 'o título do catálogo não recebeu a capa');
    const gravado = JSON.parse(env.CATALOGO.dados.catalogo);
    assert.equal(gravado.itens[0].capa_arquivo, 'thumbnail_novo.jpg');
    assert.equal(gravado.itens[0].capa_versao, r.corpo.capa_versao, 'a versão gravada não é a da URL que o servidor devolveu');

    const leg = await pedir(env, { metodo: 'POST', caminho: '/api/midia?tipo=legenda&videoId=' + ID, token, corpo: { srt: '1\n00:00:01,000 --> 00:00:02,000\nOi\n', srclang: 'pt' } });
    assert.equal(leg.status, 200, leg.texto);
    assert.equal(leg.corpo.srclang, 'pt');
    const enviada = bunny.chamadas.find(c => c.url.includes('/captions/pt'));
    assert.equal(JSON.parse(enviada.init.body).captionsFile, Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nOi\n', 'utf8').toString('base64'));
  } finally { bunny.desfazer(); }
});

/* --------------------------------------------- o navegador não conhece provedor */

function arquivosDe(dir) {
  const saida = [];
  for (const nome of fs.readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    if (fs.statSync(cheio).isDirectory()) saida.push(...arquivosDe(cheio));
    else saida.push(cheio);
  }
  return saida;
}

test('ACEITE: nenhum host de provedor em core/site (b-cdn, bunnycdn, cloudflarestream, mediadelivery)', () => {
  const achados = [];
  for (const arquivo of arquivosDe(SITE)) {
    if (/\.(png|jpg|jpeg|woff2?|ico|webp)$/i.test(arquivo)) continue;
    const texto = fs.readFileSync(arquivo, 'utf8');
    if (/b-cdn|bunnycdn|cloudflarestream|mediadelivery/i.test(texto)) achados.push(path.relative(RAIZ, arquivo));
  }
  assert.deepEqual(achados, [], 'host de provedor no navegador: ' + achados.join(', '));
});

test('o navegador não monta URL de provedor: lê `midia` e não conhece pullzone, libraryId nem videoId do provedor', () => {
  const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const arquivo of ['app.js', 'player.js', 'player-core.js', 'mesa.js', 'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'busca-core.js', 'indice-core.js', 'catalogo-core.js']) {
    const codigo = semComentarios(fs.readFileSync(path.join(SITE, arquivo), 'utf8'));
    assert.ok(!/pullzone|hostPullzone/i.test(codigo), arquivo + ' fala de pull zone');
    /* Só a migração (catalogo-core.js) conhece o formato antigo da fonte. */
    if (arquivo !== 'catalogo-core.js') {
      assert.ok(!/libraryId/.test(codigo), arquivo + ' lê libraryId');
      assert.ok(!/fonte\.videoId|fonte && [a-z.]*\.videoId/.test(codigo), arquivo + ' lê fonte.videoId direto: use App.idDoVideo(item)');
    }
    assert.ok(!/['"`]https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(codigo.replace(/https?:\/\/(www\.)?w3\.org[^'"`]*/g, '')), arquivo + ' escreve um endereço http(s) no código');
  }
  /* O envio TUS: endpoint e cabeçalhos vêm do plano do servidor. */
  const telas = semComentarios(fs.readFileSync(path.join(SITE, 'mesa-telas.js'), 'utf8'));
  assert.match(telas, /headers: t\.cabecalhos/);
  assert.match(telas, /uploadUrl: t\.url/);
  assert.match(telas, /endpoint: t\.url/);
  assert.match(telas, /chunkSize: t\.pedacoBytes/);
});

test('o player e a grade usam `midia`: sem URL de capa, de HLS, de MP4 ou de legenda montada no navegador', () => {
  const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const player = semComentarios(fs.readFileSync(path.join(SITE, 'player.js'), 'utf8'));
  assert.match(player, /App\.midiaDe\(item\)/);
  assert.match(player, /AppPlayerCore\.urlHls\(midia\)/);
  assert.match(player, /AppPlayerCore\.urlLegenda\(midia\)/);
  const app = semComentarios(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'));
  assert.ok(!/App\.resolverFonte|estado\.config\)/.test(app.replace(/AppPlayer\.criar\(item, estado\.config/g, '')), 'app.js ainda passa config de provedor');
  assert.match(app, /iframe\.src = App\.urlEmbed\(midia\)/);
  assert.match(app, /midia\.embed\.scriptUrl/, 'o script do controle do embed tem de vir do servidor');
});

/* ------------------------------------------------------------ catálogo do repositório */

test('o catálogo de exemplo e o `.env.example` não carregam segredo nem host de provedor real', () => {
  const exemplo = fs.readFileSync(path.join(RAIZ, 'exemplo', 'catalogo.json'), 'utf8');
  assert.ok(!/b-cdn|bunnycdn/.test(exemplo));
  const env = fs.readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
  assert.ok(!/BUNNY_API_KEY=\S/.test(env), 'o .env.example traz uma chave preenchida');
});
