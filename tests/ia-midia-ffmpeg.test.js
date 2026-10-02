/* Pipeline de capas, trailer e clipe de fundo com ffmpeg DE VERDADE, num vídeo sintético
 * (testsrc + trechos de silêncio, 150 s, cortes duros a cada 30 s). Sem ffmpeg, tudo é pulado com motivo. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const temFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const SEM = 'ffmpeg não está instalado';
const lib = () => import('../scripts/lib/ffmpeg.mjs');
const libMidia = () => import('../scripts/lib/ffmpeg-midia.mjs');
const capas = () => import('../scripts/capas.mjs');
const trailer = () => import('../scripts/trailer.mjs');

let pasta; let video;
const DURACAO = 150;

before(() => {
  if (!temFfmpeg) return;
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tela-midia-'));
  video = path.join(pasta, 'sintetico.mp4');
  /* 5 planos de 30 s (fontes diferentes = cortes duros) e áudio com 2 s de silêncio no fim de cada 30 s. */
  const fontes = ['testsrc=s=640x360:r=24', 'testsrc2=s=640x360:r=24', 'smptebars=s=640x360:r=24', 'rgbtestsrc=s=640x360:r=24', 'testsrc=s=640x360:r=24,hue=h=90'];
  const args = ['-y', '-v', 'error'];
  fontes.forEach((f) => args.push('-f', 'lavfi', '-t', '30', '-i', f));
  args.push('-f', 'lavfi', '-t', String(DURACAO), '-i', 'aevalsrc=0.4*sin(2*PI*440*t)*lt(mod(t\\,30)\\,28):s=44100:c=mono');
  const concat = fontes.map((_, i) => `[${i}:v]format=yuv420p,setsar=1[v${i}]`).join(';') + ';' + fontes.map((_, i) => `[v${i}]`).join('') + `concat=n=${fontes.length}:v=1:a=0[v]`;
  args.push('-filter_complex', concat, '-map', '[v]', '-map', `${fontes.length}:a`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest', video);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
after(() => { if (pasta) fs.rmSync(pasta, { recursive: true, force: true }); });

test('sondar, cenas e silêncios batem com o que o vídeo sintético tem', { skip: !temFfmpeg && SEM }, async () => {
  const f = await lib();
  const info = await f.sondar(video);
  assert.ok(Math.abs(info.duracao - DURACAO) < 1, 'duração ' + info.duracao);
  assert.equal(info.temAudio, true);
  assert.equal(info.largura, 640);
  const cenas = await f.detectarCenas(video);
  for (const esperado of [30, 60, 90, 120]) assert.ok(cenas.some((c) => Math.abs(c - esperado) < 0.5), `corte perto de ${esperado}s em ${cenas}`);
  const sil = await f.detectarSilencios(video, { duracao: info.duracao });
  for (const esperado of [28, 58, 88, 118]) assert.ok(sil.some((s) => Math.abs(s.inicio - esperado) < 0.5), `silêncio perto de ${esperado}s em ${JSON.stringify(sil)}`);
});

test('capas: 3 candidatas distintas, nenhuma preta, com título e quadro limpo', { skip: !temFfmpeg && SEM }, async (t) => {
  const f = await lib(); const m = await libMidia(); const c = await capas();
  const fonte = await m.acharFonte();
  const r = await c.gerarCapas({ video, titulo: 'Título com "aspas", $cifrão e acentuação: ação', marca: 'Marca Teste', cor: '#2563eb', fonte, saida: path.join(pasta, 'capas'), quantas: 3 });
  assert.equal(r.candidatas.length, 3);
  const tempos = r.candidatas.map((x) => x.t).sort((a, b) => a - b);
  assert.ok(tempos[1] - tempos[0] >= 4 && tempos[2] - tempos[1] >= 4, 'candidatas afastadas: ' + tempos);
  for (const x of r.candidatas) {
    assert.ok(fs.statSync(x.arquivo).size > 5000, x.arquivo);
    assert.ok(fs.statSync(x.quadro).size > 5000);
    const med = await f.medirImagem(x.quadro);
    assert.ok(med.brilho > 20 && med.brilho < 238, 'quadro não é preto nem estourado: ' + med.brilho);
    if (fonte) assert.equal(x.comTitulo, true);
  }
  if (!fonte) t.diagnostic('sem fonte TTF no sistema: capas só com quadro limpo');
  /* o título desenhado muda a imagem: o arquivo com texto difere do quadro limpo */
  if (fonte) assert.notDeepEqual(fs.readFileSync(r.candidatas[0].arquivo), fs.readFileSync(r.candidatas[0].quadro));
});

test('trailer <= 60 s e clipe mudo <= 4 MB com poster, a partir de trechos escolhidos por uma função injetada', { skip: !temFfmpeg && SEM, timeout: 240000 }, async () => {
  const f = await lib(); const tr = await trailer();
  let recebido = null;
  /* o modelo "falso": devolve 3 trechos, um deles com o fim ALÉM do vídeo e outro com tempo inválido */
  const escolherTrechos = async (transcricao, ctx) => {
    recebido = { transcricao, ctx };
    return { resultado: { trechos: [
      { inicio: 10.4, fim: 27.7, motivo: 'abertura' },
      { inicio: 61.2, fim: 88.3, motivo: 'meio' },
      { inicio: 100, fim: 99, motivo: 'inválido' },
      { inicio: 121.5, fim: 400, motivo: 'fim além do vídeo' }
    ] }, modelo: 'modelo-falso' };
  };
  const r = await tr.gerarTrailerEClipe({ video, saida: path.join(pasta, 'trailer'), transcricao: '00:10 fala de abertura\n00:61 fala do meio', escolherTrechos, maxSeg: 60 });
  assert.ok(recebido && /abertura/.test(recebido.transcricao) && recebido.ctx.duracao > 140, 'a função recebeu a transcrição e o contexto');
  assert.equal(r.origemTrechos, 'ia');
  assert.equal(r.modelo, 'modelo-falso');
  assert.ok(r.avisos.some((a) => /descartado/.test(a)));

  const info = await f.sondar(r.trailer.arquivo);
  assert.ok(info.duracao <= 60.2 && info.duracao >= 20, 'duração do trailer ' + info.duracao);
  assert.equal(info.temAudio, true);
  /* trechos encaixados nos cortes de cena (30, 60, 90, 120) e nos silêncios (28, 58, 88, 118), com raio de 1,5 s */
  const ini = r.trailer.trechos.map((x) => x.inicio);
  assert.ok(ini.some((v) => Math.abs(v - 30) < 0.6 || Math.abs(v - 60) < 0.6 || Math.abs(v - 120) < 0.6), 'algum início encaixou num corte: ' + ini);
  assert.ok(r.trailer.trechos.every((x) => x.fim <= DURACAO && x.fim > x.inicio));
  assert.ok(fs.statSync(r.trailer.poster).size > 1000);

  const c = await f.sondar(r.clipe.arquivo);
  assert.equal(c.temAudio, false, 'clipe sem faixa de áudio');
  assert.ok(c.duracao >= 5.9 && c.duracao <= 10.1, 'clipe ' + c.duracao + ' s');
  assert.ok(r.clipe.bytes <= 4_000_000, 'clipe ' + r.clipe.bytes + ' bytes');
  assert.ok(fs.statSync(r.clipe.arquivo).size === r.clipe.bytes);
  assert.ok(fs.statSync(r.clipe.poster).size > 1000, 'poster do clipe');
  /* plano contínuo: nenhum corte de cena DENTRO do clipe */
  const cortes = await f.detectarCenas(r.clipe.arquivo);
  assert.deepEqual(cortes, [], 'sem corte no meio do clipe');
  assert.ok(!r.avisos.some((a) => /corte de cena no meio/.test(a)));
});

test('sem transcrição ou com INSUFICIENTE, cai na amostra automática (e avisa); trechos manuais mandam', { skip: !temFfmpeg && SEM, timeout: 240000 }, async () => {
  const tr = await trailer();
  const a = await tr.gerarTrailerEClipe({ video, saida: path.join(pasta, 't2'), transcricao: 'algo', escolherTrechos: async () => 'INSUFICIENTE', soClipe: true });
  assert.equal(a.origemTrechos, 'automatica');
  assert.ok(a.avisos.some((x) => /INSUFICIENTE/.test(x)));
  assert.equal(a.trailer, null);
  assert.ok(a.clipe && a.clipe.bytes <= 4_000_000);
  const b = await tr.gerarTrailerEClipe({ video, saida: path.join(pasta, 't3'), trechosManuais: [{ inicio: 31, fim: 56, motivo: 'meu' }], escolherTrechos: async () => { throw new Error('não devia chamar'); }, soTrailer: true });
  assert.equal(b.origemTrechos, 'manual');
  assert.ok(b.trailer.duracao > 20 && b.trailer.duracao <= 26);
});

test('vídeo sem áudio: trailer sem áudio e clipe mudo', { skip: !temFfmpeg && SEM, timeout: 240000 }, async () => {
  const f = await lib(); const tr = await trailer();
  const mudo = path.join(pasta, 'mudo.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-t', '50', '-i', 'testsrc2=s=320x240:r=24', '-c:v', 'libx264', '-preset', 'ultrafast', mudo]);
  assert.equal(r.status, 0);
  const x = await tr.gerarTrailerEClipe({ video: mudo, saida: path.join(pasta, 't4') });
  assert.equal((await f.sondar(x.trailer.arquivo)).temAudio, false);
  assert.equal((await f.sondar(x.clipe.arquivo)).temAudio, false);
});

test('o orçamento de tamanho força um degrau mais leve quando o limite é apertado', { skip: !temFfmpeg && SEM, timeout: 240000 }, async () => {
  const m = await libMidia(); const f = await lib();
  const r = await m.montarClipe(video, path.join(pasta, 'apertado.mp4'), { inicio: 5, fim: 13 }, { maxBytes: 50_000 });
  assert.ok(r.bytes <= 50_000 && r.degrau > 0, JSON.stringify(r));
  assert.equal((await f.sondar(r.arquivo)).temAudio, false);
  await assert.rejects(m.montarClipe(video, path.join(pasta, 'x.mp4'), { inicio: 5, fim: 9 }), /6 a 10 s/);
});
