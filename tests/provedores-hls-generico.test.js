/* O que é só do HLS genérico (a suíte de contrato cobre o que é comum a todo
 * adaptador): endereços colados por título, a lista de hosts liberados, o
 * cadastro por `prepararFonte` e a leitura do playlist. Sem rede: o fetch é um falso. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const registro = () => import('../core/worker/_lib/provedores/index.js');
const BASE = 'https://videos.exemplo.test/acervo';
const ENV = { HLS_BASE_URL: BASE };

async function criar({ config, env = ENV, respostas = {}, chamadas = [] } = {}) {
  const { criarProvedor } = await registro();
  const fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), metodo: (init && init.method) || 'GET', init });
    const r = respostas[String(url)];
    if (!r) throw new Error('chamada não prevista: ' + url);
    return new Response(r.texto === undefined ? '' : r.texto, { status: r.status || 200, headers: r.cabecalhos || {} });
  };
  return criarProvedor(config || { video: { provedor: 'hls-generico' } }, env, { provedor: 'hls-generico', fetch });
}

const comHosts = (hostsPermitidos) => ({ video: { provedor: 'hls-generico', hlsGenerico: { hostsPermitidos } } });

test('hostsMidia: a base e os hosts permitidos, em img, media e connect; nunca frame nem script', async () => {
  const p = await criar({ config: comHosts(['cdn.exemplo.net', '*.exemplo.org', 'x; script-src *', 'http://ruim.test', 'sem-ponto']) });
  const h = p.hostsMidia();
  const esperado = ['https://videos.exemplo.test', 'https://cdn.exemplo.net', 'https://*.exemplo.org'];
  assert.deepEqual(h.media, esperado);
  assert.deepEqual(h.connect, esperado);
  assert.deepEqual(h.img, esperado);
  assert.deepEqual(h.frame, []);
  assert.deepEqual(h.script, []);
});

test('baseUrl com porta, credencial, query ou http não configura: nada entra na CSP', async () => {
  for (const ruim of ['http://videos.exemplo.test', 'https://videos.exemplo.test:8443/x', 'https://u:s@videos.exemplo.test', 'https://videos.exemplo.test/?a=1', 'videos.exemplo.test', 'https://localhost']) {
    const p = await criar({ env: { HLS_BASE_URL: ruim } });
    assert.equal(p.configurado, false, ruim);
    assert.deepEqual(p.hostsMidia().media, [], ruim);
  }
});

test('o id é o caminho do playlist sob a base: urlReproducao junta, sem rede, e só devolve https', async () => {
  const chamadas = [];
  const p = await criar({ chamadas });
  const r = await p.urlReproducao('aula-1/master.m3u8', {});
  assert.equal(r.hls, BASE + '/aula-1/master.m3u8');
  assert.equal(r.mp4, null);
  assert.equal(r.embed, null);
  assert.equal(r.expiraEm, null);
  /* Um id que não aponta para .m3u8 e sem endereço em extras: nada para tocar (e nunca adivinha). */
  assert.equal((await p.urlReproducao('aula-1', {})).hls, null);
  assert.equal(chamadas.length, 0);
});

test('extras: endereço absoluto em host liberado vale; host fora da lista, http, extensão errada e credencial são ignorados', async () => {
  const p = await criar({ config: comHosts(['cdn.exemplo.net', '*.exemplo.org']) });
  const ok = (u) => p.urlReproducao('hls-12345678', { extras: { hls: u } }).then(r => r.hls);
  assert.equal(await ok('https://cdn.exemplo.net/a/b.m3u8?token=abc'), 'https://cdn.exemplo.net/a/b.m3u8?token=abc');
  assert.equal(await ok('https://x.y.exemplo.org/a.M3U8'), 'https://x.y.exemplo.org/a.M3U8');
  assert.equal(await ok(BASE + '/qualquer/outra.m3u8'), BASE + '/qualquer/outra.m3u8');
  for (const ruim of ['https://outro.test/a.m3u8', 'http://cdn.exemplo.net/a.m3u8', 'https://cdn.exemplo.net/a.mp4', 'https://u:s@cdn.exemplo.net/a.m3u8',
    'https://cdn.exemplo.net:8443/a.m3u8', 'https://cdn.exemplo.net/a b.m3u8', 'https://exemplo.org/a.m3u8', 'https://cdn.exemplo.net.evil.test/a.m3u8',
    'javascript:alert(1)', '//cdn.exemplo.net/a.m3u8', 'https://cdn.exemplo.net/a.m3u8"><script>']) {
    assert.equal(await ok(ruim), null, ruim);
  }
  /* Endereço de extras inválido NÃO cai no caminho do id (não toca o que ninguém escolheu). */
  const cai = await p.urlReproducao('aula-1/master.m3u8', { extras: { hls: 'https://outro.test/a.m3u8' } });
  assert.equal(cai.hls, null);
});

test('mp4: texto vira { 720p }, mapa por resolução é filtrado; capa por extras ou por arquivo sob a base, com versão', async () => {
  const p = await criar();
  const r = await p.urlReproducao('hls-12345678', { extras: { hls: BASE + '/a.m3u8', mp4: BASE + '/a.mp4' } });
  assert.deepEqual(r.mp4, { '720p': BASE + '/a.mp4' });
  const mapa = await p.urlReproducao('hls-12345678', { extras: { hls: BASE + '/a.m3u8', mp4: { '240p': BASE + '/a-240.mp4', 'grande': BASE + '/x.mp4', '360p': 'https://outro.test/x.mp4' } } });
  assert.deepEqual(mapa.mp4, { '240p': BASE + '/a-240.mp4' });

  assert.equal(await p.urlCapa('x/y.m3u8', { extras: { capa: BASE + '/capas/a.jpg' }, versao: 7 }), BASE + '/capas/a.jpg?v=7');
  assert.equal(await p.urlCapa('x/y.m3u8', { extras: { capa: BASE + '/capas/a.jpg?w=300' }, versao: 7 }), BASE + '/capas/a.jpg?w=300&v=7');
  assert.equal(await p.urlCapa('x/y.m3u8', { arquivo: 'capas/b.webp', versao: 'a"b' }), BASE + '/capas/b.webp?v=a%22b');
  assert.equal(await p.urlCapa('x/y.m3u8', { arquivo: '../../etc/passwd' }), null);
  assert.equal(await p.urlCapa('x/y.m3u8', { arquivo: 'capas/b.exe' }), null);
  assert.equal(await p.urlCapa('x/y.m3u8', {}), null);
});

test('legendas: só as cadastradas (https, host liberado, .vtt, idioma válido), sem repetir idioma; rótulo padrão pelo idioma', async () => {
  const p = await criar();
  const extras = { legendas: [
    { idioma: 'pt', url: BASE + '/l/pt.vtt' },
    { idioma: 'en', rotulo: 'English  ', url: BASE + '/l/en.vtt' },
    { idioma: 'en', url: BASE + '/l/en2.vtt' },
    { idioma: 'x"><', url: BASE + '/l/x.vtt' },
    { idioma: 'es', url: BASE + '/l/es.srt' },
    { idioma: 'fr', url: 'https://outro.test/fr.vtt' }
  ] };
  const l = await p.legendas('a/b.m3u8', { idiomas: ['pt'], extras });
  assert.deepEqual(l.map(x => [x.idioma, x.rotulo, x.url, x.origem]), [
    ['pt', 'Português', BASE + '/l/pt.vtt', 'manual'],
    ['en', 'English', BASE + '/l/en.vtt', 'manual']
  ]);
  assert.deepEqual(await p.legendas('a/b.m3u8', { idiomas: ['pt', 'en'] }), [], 'sem cadastro não se adivinha nome de arquivo');
});

test('montarMidia com extras: o atalho midia() e a composição dão o mesmo, com a capa e a legenda do item', async () => {
  const { montarMidia } = await registro();
  const p = await criar();
  const item = {
    fonte: { provedor: 'hls-generico', id: 'a/b.m3u8', extras: { capa: BASE + '/c.jpg', legendas: [{ idioma: 'pt', url: BASE + '/p.vtt' }] } },
    capa_versao: 3
  };
  const rapida = await montarMidia(p, item);
  assert.deepEqual(rapida, await montarMidia(p, item, { semAtalho: true }));
  assert.equal(rapida.hls, BASE + '/a/b.m3u8');
  assert.equal(rapida.capa, BASE + '/c.jpg?v=3');
  assert.deepEqual(rapida.legendas, [{ idioma: 'pt', rotulo: 'Português', url: BASE + '/p.vtt' }]);
  assert.equal(rapida.embed, null);
});

test('statusEncoding lê o playlist: master e VOD prontos, media aberta processando, HTML e lixo com erro, 3xx pronto', async () => {
  const url = BASE + '/a/m.m3u8';
  const status = async (resposta) => (await criar({ respostas: { [url]: resposta } })).statusEncoding('a/m.m3u8');
  assert.equal((await status({ texto: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8\n' })).estado, 'pronto');
  assert.equal((await status({ texto: '﻿#EXTM3U\n#EXTINF:5,\na.ts\n#EXT-X-ENDLIST' })).estado, 'pronto');
  assert.equal((await status({ texto: '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:5,\na.ts' })).estado, 'pronto');
  const aberta = await status({ texto: '#EXTM3U\n#EXTINF:5,\na.ts' });
  assert.deepEqual([aberta.estado, aberta.progresso], ['processando', null]);
  assert.equal((await status({ texto: 'qualquer coisa' })).estadoBruto, 'sem-extm3u');
  assert.equal((await status({ texto: '#EXTM3U', cabecalhos: { 'content-type': 'text/html' } })).estado, 'erro');
  const redirecionado = await status({ status: 302, cabecalhos: { location: 'https://outro.test/x.m3u8' } });
  assert.deepEqual([redirecionado.estado, redirecionado.estadoBruto], ['pronto', 'redirecionado']);
});

test('statusEncoding: a requisição não segue redirecionamento e pede só o playlist; obterVideo soma a duração e acha o fps', async () => {
  const chamadas = [];
  const url = BASE + '/a/m.m3u8';
  const texto = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\na.ts\n#EXTINF:5.5,\nb.ts\n#EXT-X-ENDLIST\n';
  const p = await criar({ respostas: { [url]: { texto } }, chamadas });
  const v = await p.obterVideo('a/m.m3u8');
  assert.equal(v.duracaoSeg, 12);   /* 11,5 arredonda */
  assert.equal(v.estado, 'pronto');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].init.redirect, 'manual');
  const mestre = await (await criar({ respostas: { [url]: { texto: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,FRAME-RATE=29.970\nx.m3u8' } } })).obterVideo('a/m.m3u8');
  assert.equal(mestre.framerate, 29.97);
});

test('statusEncoding com extras usa o endereço do item; endereço de host não liberado vira estado erro sem tocar a rede', async () => {
  const chamadas = [];
  const outro = 'https://cdn.exemplo.net/z.m3u8';
  const p = await criar({ config: comHosts(['cdn.exemplo.net']), respostas: { [outro]: { texto: '#EXTM3U\n#EXT-X-ENDLIST' } }, chamadas });
  assert.equal((await p.statusEncoding('hls-12345678', { extras: { hls: outro } })).estado, 'pronto');
  chamadas.length = 0;
  const fora = await p.statusEncoding('hls-12345678', { extras: { hls: 'https://outro.test/z.m3u8' } });
  assert.deepEqual([fora.estado, fora.estadoBruto], ['erro', 'url-invalida']);
  assert.equal(chamadas.length, 0);
});

test('prepararFonte: sob a base o id é o caminho; fora dela, hls-<hash> e o endereço vai em extras; extras saem normalizados', async () => {
  const p = await criar({ config: comHosts(['cdn.exemplo.net']) });
  const sob = await p.prepararFonte({ hls: BASE + '/serie/ep1/master.m3u8', capa: BASE + '/serie/ep1/capa.jpg', legendas: [{ idioma: 'pt', url: BASE + '/serie/ep1/pt.vtt' }], mp4: BASE + '/serie/ep1/ep1.mp4' });
  assert.deepEqual(sob.fonte, {
    provedor: 'hls-generico', id: 'serie/ep1/master.m3u8',
    extras: {
      mp4: { '720p': BASE + '/serie/ep1/ep1.mp4' }, capa: BASE + '/serie/ep1/capa.jpg',
      legendas: [{ idioma: 'pt', rotulo: 'Português', url: BASE + '/serie/ep1/pt.vtt' }]
    }
  });
  assert.ok(p.padraoId.test(sob.fonte.id));
  const fora = await p.prepararFonte({ hls: 'https://cdn.exemplo.net/v/a.m3u8' });
  assert.match(fora.fonte.id, /^hls-[0-9a-f]{8}$/);
  assert.ok(p.padraoId.test(fora.fonte.id));
  assert.deepEqual(fora.fonte.extras, { hls: 'https://cdn.exemplo.net/v/a.m3u8' });
  assert.equal((await p.prepararFonte({ hls: 'https://cdn.exemplo.net/v/a.m3u8' })).fonte.id, fora.fonte.id, 'o id é estável');
  /* Com query (token) sob a base: o id não pode carregar `?`, então vai por extras. */
  const comQuery = await p.prepararFonte({ hls: BASE + '/a.m3u8?t=1' });
  assert.match(comQuery.fonte.id, /^hls-/);
  assert.equal(comQuery.fonte.extras.hls, BASE + '/a.m3u8?t=1');
});

test('prepararFonte recusa com o campo e o motivo; quem edita o catálogo não amplia os hosts liberados', async () => {
  const { ErroProvedor } = await registro();
  const p = await criar();
  const recusa = (entrada, detalhe) => assert.rejects(() => p.prepararFonte(entrada),
    (e) => e instanceof ErroProvedor && e.codigo === 'parametro-invalido' && e.detalhe === detalhe, detalhe);
  await recusa({}, 'hls:invalida');
  await recusa({ hls: 'https://outro.test/a.m3u8' }, 'hls:host-nao-permitido');
  await recusa({ hls: 'http://videos.exemplo.test/acervo/a.m3u8' }, 'hls:sem-https');
  await recusa({ hls: BASE + '/a.mp4' }, 'hls:extensao');
  await recusa({ hls: BASE + '/a.m3u8', capa: 'https://outro.test/c.jpg' }, 'capa:host-nao-permitido');
  await recusa({ hls: BASE + '/a.m3u8', capa: BASE + '/c.txt' }, 'capa:extensao');
  await recusa({ hls: BASE + '/a.m3u8', mp4: BASE + '/a.m3u8' }, 'mp4:extensao');
  await recusa({ hls: BASE + '/a.m3u8', mp4: { grande: BASE + '/a.mp4' } }, 'mp4:invalida');
  await recusa({ hls: BASE + '/a.m3u8', legendas: [{ idioma: 'pt', url: BASE + '/a.srt' }] }, 'legenda:extensao');
  await recusa({ hls: BASE + '/a.m3u8', legendas: [{ idioma: '../x', url: BASE + '/a.vtt' }] }, 'legenda:invalida');
  /* O servidor não configurado não cadastra nada. */
  const sem = await criar({ env: {} });
  await assert.rejects(() => sem.prepararFonte({ hls: BASE + '/a.m3u8' }), (e) => e.codigo === 'provedor-nao-configurado');
});

test('prepararFonte com verificar lê o playlist: devolve o estado, e falha do servidor vira ErroProvedor', async () => {
  const { ErroProvedor } = await registro();
  const url = BASE + '/a.m3u8';
  const bom = await criar({ respostas: { [url]: { texto: '#EXTM3U\n#EXTINF:3,\na.ts\n#EXT-X-ENDLIST' } } });
  const r = await bom.prepararFonte({ hls: url }, { verificar: true });
  assert.deepEqual([r.estado, r.duracaoSeg, r.fonte.id], ['pronto', 3, 'a.m3u8']);
  const html = await criar({ respostas: { [url]: { texto: '<html>', cabecalhos: { 'content-type': 'text/html' } } } });
  assert.equal((await html.prepararFonte({ hls: url }, { verificar: true })).estado, 'erro');
  const falta = await criar({ respostas: { [url]: { status: 404, texto: 'nada' } } });
  await assert.rejects(() => falta.prepararFonte({ hls: url }, { verificar: true }), (e) => e instanceof ErroProvedor && e.status === 404);
});

test('sem envio: criarUpload, retomarUpload, definirCapa e enviarLegenda recusam; assinar é recusado; excluir não vai à rede', async () => {
  const { ErroProvedor } = await registro();
  const chamadas = [];
  const p = await criar({ chamadas });
  for (const [fn, args] of [['criarUpload', [{ titulo: 'x' }]], ['retomarUpload', ['a.m3u8']], ['definirCapa', ['a.m3u8', new Uint8Array(1), 'image/jpeg']], ['enviarLegenda', ['a.m3u8', { idioma: 'pt', srt: '1' }]]]) {
    await assert.rejects(() => p[fn](...args), (e) => e instanceof ErroProvedor && e.codigo === 'recurso-indisponivel', fn);
  }
  await assert.rejects(() => p.urlReproducao('a.m3u8', { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel');
  assert.deepEqual(await p.excluir('a.m3u8'), { ok: true, removido: false });
  assert.deepEqual(await p.listar(), { itens: [], proximo: null });
  assert.equal(chamadas.length, 0);
  const c = p.capacidades();
  assert.deepEqual([c.envio, c.uploadProtocolo, c.fontePorUrl, c.assinatura], [false, 'nenhum', true, false]);
});

test('o schema aceita video.hlsGenerico.hostsPermitidos e recusa host malformado', async () => {
  const { validarConfig } = await import('../core/worker/_lib/config-validar.mjs');
  const fs = require('node:fs');
  const path = require('node:path');
  const esquema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.schema.json'), 'utf8'));
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.json'), 'utf8'));
  const com = (hosts) => Object.assign({}, base, { video: { provedor: 'hls-generico', hlsGenerico: { baseUrl: BASE, hostsPermitidos: hosts } } });
  const r1 = validarConfig(esquema, com(['cdn.exemplo.net', '*.exemplo.org']));
  assert.equal(r1.ok, true, JSON.stringify(r1.erros || r1));
  const r2 = validarConfig(esquema, com(['https://cdn.exemplo.net']));
  assert.equal(r2.ok, false);
});
