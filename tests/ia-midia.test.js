/* Funções puras de capas, trailer e clipe (sem ffmpeg), e o registro/aceite da mídia gerada. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const f = () => import('../scripts/lib/ffmpeg.mjs');
const g = () => import('../scripts/lib/midia-gerada.mjs');
const t = () => import('../scripts/trailer.mjs');
const c = () => import('../scripts/capas.mjs');

test('parsearCenas e parsearSilencios leem a saída real do ffmpeg', async () => {
  const L = await f();
  const cenas = L.parsearCenas('frame:0 pts:720 pts_time:30.03\nlavfi.scene_score=0.5\nframe:1 pts_time:60.06\nframe:2 pts_time:30.03');
  assert.deepEqual(cenas, [30.03, 60.06]);
  const s = L.parsearSilencios('[silencedetect @ 0x1] silence_start: 28.001\n[silencedetect @ 0x1] silence_end: 30.002 | silence_duration: 2.001\n[silencedetect @ 0x1] silence_start: 148', 150);
  assert.deepEqual(s, [{ inicio: 28.001, fim: 30.002 }, { inicio: 148, fim: 150 }]);
  assert.equal(L.parsearMedida('lavfi.signalstats.YAVG=100\nlavfi.signalstats.YAVG=120', 'lavfi.signalstats.YAVG'), 110);
  assert.equal(L.parsearMedida('nada', 'lavfi.signalstats.YAVG'), null);
});

test('pontuarQuadro: preto, estourado e borrado perdem para um quadro nítido', async () => {
  const L = await f();
  const bom = L.pontuarQuadro({ brilho: 110, nitidez: 30, contraste: 120 });
  assert.ok(bom > 0.7);
  assert.ok(L.pontuarQuadro({ brilho: 3, nitidez: 30, contraste: 120 }) < 0.1, 'preto');
  assert.ok(L.pontuarQuadro({ brilho: 250, nitidez: 30, contraste: 120 }) < 0.1, 'estourado');
  assert.ok(L.pontuarQuadro({ brilho: 110, nitidez: 2, contraste: 20 }) < bom / 2, 'borrado');
  assert.equal(L.pontuarQuadro({ brilho: NaN, nitidez: 1 }), 0);
});

test('candidatosDeQuadro fica dentro da margem e respeita o máximo; escolherDistintos afasta as candidatas', async () => {
  const L = await f();
  const cand = L.candidatosDeQuadro({ duracao: 600, cenas: [5, 100, 300, 590], max: 10 });
  assert.ok(cand.length <= 10);
  assert.ok(cand.every((x) => x >= 48 && x <= 552), String(cand));
  assert.deepEqual(L.candidatosDeQuadro({ duracao: 0 }), []);
  const medidos = [{ t: 100, nota: 0.9 }, { t: 101, nota: 0.89 }, { t: 300, nota: 0.8 }, { t: 450, nota: 0.7 }, { t: 10, nota: 0 }];
  const e = L.escolherDistintos(medidos, 3, 20);
  assert.deepEqual(e.map((x) => x.t), [100, 300, 450]);
  /* poucos bons e distantes: completa com os restantes com nota > 0 */
  assert.equal(L.escolherDistintos([{ t: 1, nota: 0.9 }, { t: 2, nota: 0.8 }], 2, 50).length, 2);
});

test('quebrarTitulo: linhas curtas, no máximo 3, reticências quando não cabe', async () => {
  const L = await f();
  assert.deepEqual(L.quebrarTitulo('Primeiros passos', 22, 3), ['Primeiros passos']);
  const l = L.quebrarTitulo('Um título muito mais comprido do que cabe em três linhas de vinte e dois caracteres cada uma', 22, 3);
  assert.equal(l.length, 3);
  assert.ok(l.every((x) => x.length <= 22), JSON.stringify(l));
  assert.ok(l[2].endsWith('…'));
  assert.deepEqual(L.quebrarTitulo('', 22, 3), []);
  assert.ok(L.quebrarTitulo('Supercalifragilisticexpialidocious', 10, 2)[0].length <= 10);
});

test('validarTrechos: descarta o que o modelo errou e nunca inventa', async () => {
  const L = await f();
  const r = L.validarTrechos({ trechos: [
    { inicio: 10, fim: 20, motivo: 'ok' },
    { inicio: 30, fim: 20 }, { inicio: -5, fim: 10 }, { inicio: 'a', fim: 9 }, { inicio: 500, fim: 510 },
    { inicio: 40, fim: 40.5 }, { inicio: 140, fim: 900, motivo: 'passa do fim' }
  ] }, 150);
  assert.deepEqual(r.trechos.map((x) => [x.inicio, x.fim]), [[10, 20], [140, 150]]);
  assert.equal(r.descartados.length, 5);
  assert.deepEqual(L.validarTrechos('lixo', 100).trechos, []);
  assert.deepEqual(L.validarTrechos([{ inicio: 1, fim: 9 }], 100).trechos.length, 1);
});

test('ajustarTrechos: início no corte de cena, fim na pausa, sem sobreposição, total limitado', async () => {
  const L = await f();
  const cenas = [30, 60, 90]; const silencios = [{ inicio: 58, fim: 60 }, { inicio: 88, fim: 90 }];
  const r = L.ajustarTrechos([{ inicio: 29.2, fim: 57.3, motivo: 'a' }, { inicio: 61, fim: 88.5, motivo: 'b' }], { cenas, silencios, duracao: 150, maxTotal: 60 });
  assert.deepEqual(r.map((x) => [x.inicio, x.fim]), [[30, 58], [60, 88]]);
  /* sobrepostos se fundem */
  const m = L.ajustarTrechos([{ inicio: 10, fim: 20 }, { inicio: 19.9, fim: 30 }], { duracao: 100, maxTotal: 60 });
  assert.deepEqual(m.map((x) => [x.inicio, x.fim]), [[10, 30]]);
  /* excedente: encurta até caber, sem trecho menor que o mínimo */
  const e = L.ajustarTrechos([{ inicio: 0, fim: 50 }, { inicio: 60, fim: 100 }], { duracao: 200, maxTotal: 45 });
  const total = e.reduce((s, x) => s + x.fim - x.inicio, 0);
  assert.ok(total <= 45.01 && e.every((x) => x.fim - x.inicio >= 2), JSON.stringify(e));
  /* nada para ajustar: mantém */
  assert.deepEqual(L.ajustarTrechos([{ inicio: 5, fim: 15 }], { duracao: 100 }).map((x) => [x.inicio, x.fim]), [[5, 15]]);
});

test('escolherJanelaClipe: 6 a 10 s, plano contínuo; avisa quando precisa cortar no meio', async () => {
  const L = await f();
  const j = L.escolherJanelaClipe({ trechos: [{ inicio: 20, fim: 70 }], cenas: [30, 60], duracao: 150 });
  assert.ok(j && j.fim - j.inicio >= 6 && j.fim - j.inicio <= 10);
  assert.ok(!j.corteNoMeio);
  assert.ok(!(30 < j.fim && 30 > j.inicio) && !(60 < j.fim && 60 > j.inicio), 'sem corte dentro: ' + JSON.stringify(j));
  /* cortes a cada 3 s: não há plano de 6 s */
  const cortes = Array.from({ length: 40 }, (_, i) => (i + 1) * 3);
  const k = L.escolherJanelaClipe({ trechos: [{ inicio: 10, fim: 60 }], cenas: cortes, duracao: 150 });
  assert.equal(k.corteNoMeio, true);
  assert.ok(k.fim - k.inicio >= 6 && k.fim - k.inicio <= 10);
  assert.equal(L.escolherJanelaClipe({ trechos: [], cenas: [], duracao: 4 }), null);
  /* sem trechos usa o miolo do vídeo */
  const s = L.escolherJanelaClipe({ cenas: [], duracao: 100 });
  assert.ok(s.inicio >= 20 && s.fim <= 80);
});

test('trechosAutomaticos: espalhados, ordenados e dentro do vídeo', async () => {
  const L = await f();
  const a = L.trechosAutomaticos({ duracao: 300, n: 6, seg: 7 });
  assert.equal(a.length, 6);
  assert.ok(a.every((x, i) => x.fim - x.inicio > 0 && x.inicio >= 36 && x.fim <= 264 && (i === 0 || x.inicio > a[i - 1].fim)));
  assert.ok(L.trechosAutomaticos({ duracao: 8 }).length >= 1);
  assert.deepEqual(L.trechosAutomaticos({ duracao: 0 }), []);
});

test('lerRespostaDeTrechos entende as formas de resposta e trata INSUFICIENTE como "sem escolha"', async () => {
  const { lerRespostaDeTrechos: ler } = await t();
  const lista = [{ inicio: 1, fim: 9, motivo: 'x' }];
  assert.deepEqual(ler(lista), lista);
  assert.deepEqual(ler({ trechos: lista }), lista);
  assert.deepEqual(ler({ resultado: { trechos: lista }, modelo: 'm' }), lista);
  assert.equal(ler('INSUFICIENTE'), null);
  assert.equal(ler({ resultado: 'INSUFICIENTE' }), null);
  assert.equal(ler({ insuficiente: true }), null);
  assert.equal(ler({ trechos: [] }), null);
  assert.equal(ler(null), null);
  assert.equal(ler(42), null);
});

test('o esquema dos trechos exige inicio, fim e motivo', async () => {
  const { ESQUEMA_TRECHOS: e } = await t();
  assert.deepEqual(e.properties.trechos.items.required, ['inicio', 'fim', 'motivo']);
  assert.ok(Object.isFrozen(e));
});

test('proveniência, registro como sugestão, aceite e descarte', async () => {
  const G = await g();
  assert.throws(() => G.proveniencia({ origem: 'humano' }), /origem/);
  const p = G.proveniencia({ origem: 'ia', modelo: 'm', data: '2026-10-02T00:00:00Z' });
  assert.deepEqual(p, { origem: 'ia', modelo: 'm', data: '2026-10-02T00:00:00Z', revisado: false });

  const item = { id: 'a', titulo: 'A' };
  const s = G.registrarSugestao(item, 'clipe', { arquivo: '/x/clipe.mp4', duracao: 8, bytes: 1000 }, p);
  assert.equal(item.midia_sugerida, undefined, 'não muda o original');
  assert.equal(s.midia_sugerida.clipe.proveniencia.revisado, false);
  assert.equal(s.midia_gerada, undefined, 'sugestão não publica nada');
  assert.throws(() => G.registrarSugestao(item, 'banner', {}), /tipo/);
  /* o Worker NÃO enxerga sugestão */
  assert.deepEqual(G.mesclarMidiaGerada({ hls: 'https://h/x.m3u8' }, s), { hls: 'https://h/x.m3u8' });

  assert.throws(() => G.aceitarSugestao(s, 'clipe', { clipe: 'http://inseguro/x.mp4' }), /https/);
  assert.throws(() => G.aceitarSugestao(s, 'clipe', {}), /falta a URL/);
  assert.throws(() => G.aceitarSugestao(s, 'trailer', { trailer: 'https://x/t.mp4' }), /não há sugestão/);
  const ok = G.aceitarSugestao(s, 'clipe', { clipe: 'https://midia.exemplo.test/a.mp4', clipePoster: 'https://midia.exemplo.test/a.jpg' }, { quando: '2026-10-03T00:00:00Z' });
  assert.equal(ok.midia_gerada.clipe, 'https://midia.exemplo.test/a.mp4');
  assert.deepEqual(ok.midia_gerada.proveniencia, { origem: 'ia', modelo: 'm', data: '2026-10-02T00:00:00Z', revisado: true, revisadoEm: '2026-10-03T00:00:00Z' });
  assert.equal(ok.midia_sugerida, undefined, 'sai da fila');
  assert.equal(s.midia_sugerida.clipe.proveniencia.revisado, false, 'o original segue intacto');
  /* depois de aceito, o Worker mescla; sem sobrescrever clipe do provedor */
  assert.equal(G.mesclarMidiaGerada({ hls: 'h' }, ok).clipe, 'https://midia.exemplo.test/a.mp4');
  assert.equal(G.mesclarMidiaGerada({ hls: 'h', clipe: 'https://prov/c.m3u8' }, ok).clipe, 'https://prov/c.m3u8');
  /* revisado:false, mesmo com URL, não vaza */
  const forjado = { midia_gerada: { clipe: 'https://x/c.mp4', proveniencia: { revisado: false } } };
  assert.equal(G.mesclarMidiaGerada({ hls: 'h' }, forjado).clipe, undefined);
  /* URL não https no item é ignorada */
  assert.equal(G.mesclarMidiaGerada({}, { midia_gerada: { clipe: 'javascript:1', proveniencia: { revisado: true } } }).clipe, undefined);

  const d = G.descartarSugestao(s, 'clipe');
  assert.equal(d.midia_sugerida, undefined);
  assert.throws(() => G.aceitarSugestao(G.registrarSugestao(item, 'capas', { candidatas: [] }), 'capas', { capas: 'https://x' }), /capa se aceita/);
});

test('conferirClipe e conferirTrailer aplicam os limites do M9', async () => {
  const G = await g();
  assert.deepEqual(G.conferirClipe({ duracao: 8, bytes: 3_000_000, temAudio: false }), []);
  assert.equal(G.conferirClipe({ duracao: 12, bytes: 3_000_000, temAudio: false }).length, 1);
  assert.equal(G.conferirClipe({ duracao: 8, bytes: 5_000_000, temAudio: false }).length, 1);
  assert.equal(G.conferirClipe({ duracao: 8, bytes: 3_000_000, temAudio: true }).length, 1);
  assert.deepEqual(G.conferirTrailer({ duracao: 45, trechos: [{}] }), []);
  assert.equal(G.conferirTrailer({ duracao: 61, trechos: [{}] }).length, 1);
  assert.equal(G.conferirTrailer({ duracao: 30, trechos: [] }).length, 1);
});

test('destino: pasta e r2; provedor ainda não aceita clipe; chave de objeto só com caracteres seguros', async () => {
  const G = await g();
  assert.equal(G.escolherDestino({}), 'pasta');
  assert.equal(G.escolherDestino({ destino: 'r2' }), 'r2');
  assert.throws(() => G.escolherDestino({ destino: 'provedor', capacidades: { clipe: false } }), /não aceita clipe/);
  assert.throws(() => G.escolherDestino({ destino: 'ftp' }), /inválido/);
  assert.equal(G.chaveDeObjeto('Série 1/Ep 01', 'Clipe.MP4'), 'midia/s-rie-1-ep-01/clipe.mp4');
  assert.equal(G.chaveDeObjeto('../../etc', 'x.mp4').includes('..'), false);
  assert.throws(() => G.chaveDeObjeto('', 'x'), /vazio/);
});

test('enviarParaR2: monta o comando do wrangler sem segredo e devolve a URL pública; recusa entrada ruim', async () => {
  const G = await g();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-r2-'));
  try {
    const arq = path.join(dir, 'clipe.mp4'); fs.writeFileSync(arq, 'x');
    const chamadas = [];
    const r = await G.enviarParaR2({ bucket: 'meu-bucket', chave: 'midia/a/clipe.mp4', arquivo: arq, urlBase: 'https://midia.exemplo.test/', executarFn: async (p, a) => { chamadas.push([p, a]); return { stdout: '', stderr: '' }; } });
    assert.equal(r.url, 'https://midia.exemplo.test/midia/a/clipe.mp4');
    assert.equal(chamadas.length, 1);
    const [prog, args] = chamadas[0];
    assert.equal(prog, 'npx');
    assert.ok(args.includes('meu-bucket/midia/a/clipe.mp4') && args.includes('video/mp4') && args.includes('r2'));
    assert.ok(!args.join(' ').match(/token|secret|key/i));
    await assert.rejects(G.enviarParaR2({ bucket: 'X Y', chave: 'k', arquivo: arq, urlBase: 'https://a.test', executarFn: async () => {} }), /bucket/);
    await assert.rejects(G.enviarParaR2({ bucket: 'meu-bucket', chave: 'k', arquivo: arq, urlBase: 'http://a.test', executarFn: async () => {} }), /https/);
    const exe = path.join(dir, 'x.exe'); fs.writeFileSync(exe, 'x');
    await assert.rejects(G.enviarParaR2({ bucket: 'meu-bucket', chave: 'k', arquivo: exe, urlBase: 'https://a.test', executarFn: async () => {} }), /tipo de arquivo/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('entregarNaPasta recusa pasta dentro do repositório fora de dados/', async () => {
  const G = await g();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-pasta-'));
  try {
    const arq = path.join(dir, 'a.mp4'); fs.writeFileSync(arq, 'x');
    const raiz = path.join(dir, 'repo'); fs.mkdirSync(raiz);
    await assert.rejects(G.entregarNaPasta(arq, path.join(raiz, 'core', 'site'), 'a.mp4', { raiz }), /dentro do repositório/);
    const ok = await G.entregarNaPasta(arq, path.join(raiz, 'dados', 'x'), 'a.mp4', { raiz });
    assert.ok(fs.existsSync(ok));
    const fora = await G.entregarNaPasta(arq, path.join(dir, 'fora'), 'b.mp4', { raiz });
    assert.ok(fs.existsSync(fora));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('entregar (trailer.mjs) usa o R2 e devolve as quatro URLs; destino inválido falha', async () => {
  const T = await t();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-ent-'));
  try {
    const mk = (n) => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };
    const resultado = { clipe: { arquivo: mk('c.mp4'), poster: mk('c.jpg') }, trailer: { arquivo: mk('t.mp4'), poster: mk('t.jpg') } };
    const e = await T.entregar({ id: 'a', resultado, destino: 'r2', bucket: 'meu-bucket', urlBase: 'https://m.exemplo.test', executarFn: async () => ({}) });
    assert.deepEqual(Object.keys(e.urls).sort(), ['clipe', 'clipePoster', 'trailer', 'trailerPoster']);
    assert.equal(e.urls.clipe, 'https://m.exemplo.test/midia/a/clipe.mp4');
    await assert.rejects(T.entregar({ id: 'a', resultado, destino: 'provedor' }), /não aceita clipe/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('capa por modelo de imagem: desligada sem gerador; com gerador falso grava e marca como IA; Workers AI por fetch falso', async () => {
  const C = await c();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-img-'));
  try {
    await assert.rejects(C.gerarCapaPorModelo({ titulo: 'x', saida: path.join(dir, 'a.jpg') }), /desligada/);
    const r = await C.gerarCapaPorModelo({ titulo: 'Aula', sinopse: 's', saida: path.join(dir, 'a.jpg'), gerarImagem: async (p) => { assert.match(p, /Aula/); return Buffer.from([1, 2, 3]); } });
    assert.equal(r.proveniencia.origem, 'ia');
    assert.equal(r.proveniencia.revisado, false);
    assert.equal(fs.readFileSync(r.arquivo).length, 3);

    const visto = [];
    const gerar = C.geradorWorkersAi({ env: { CLOUDFLARE_ACCOUNT_ID: 'conta1', CLOUDFLARE_API_TOKEN: 'tok' }, fetchFn: async (url, init) => { visto.push([url, init]); return { ok: true, json: async () => ({ result: { image: Buffer.from('img').toString('base64') } }) }; } });
    assert.equal((await gerar('p')).toString(), 'img');
    assert.match(visto[0][0], /accounts\/conta1\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
    assert.equal(visto[0][1].headers.authorization, 'Bearer tok');
    await assert.rejects(C.geradorWorkersAi({ env: {} })('p'), /faltam/);
    await assert.rejects(C.geradorWorkersAi({ env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b' }, fetchFn: async () => ({ ok: false, status: 401 }) })('p'), /401/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('corParaFfmpeg aceita só #rrggbb', async () => {
  const M = await import('../scripts/lib/ffmpeg-midia.mjs');
  assert.equal(M.corParaFfmpeg('#2563eb'), '0x2563EB');
  assert.equal(M.corParaFfmpeg('red; rm -rf'), '0x2563EB');
  assert.equal(M.corParaFfmpeg(undefined, '0x000000'), '0x000000');
});
