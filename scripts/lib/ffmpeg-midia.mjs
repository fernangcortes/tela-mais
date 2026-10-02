/* scripts/lib/ffmpeg-midia.mjs — monta as peças (capa, trailer, clipe de fundo) com o ffmpeg.
 *
 * Parte "executa" de scripts/lib/ffmpeg.mjs (que tem as contas puras). Tudo aqui lê um arquivo
 * de vídeo local e escreve arquivos novos; nada vai para a rede.
 */
import { writeFile, stat, mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executar, extrairQuadro, quebrarTitulo, arred } from './ffmpeg.mjs';

const FF = ['-hide_banner', '-nostdin', '-y', '-v', 'error'];

/* Limites do clipe de fundo (docs/player.md: clipe curto, mudo e leve). */
export const CLIPE = Object.freeze({ minSeg: 6, maxSeg: 10, maxBytes: 4_000_000 });
/* O trailer não passa de 60 s; abaixo de 30 s não vale como trailer. */
export const TRAILER = Object.freeze({ minSeg: 30, maxSeg: 60, padraoSeg: 45 });

/** Escala que mantém a proporção (vertical continua vertical) e dá dimensões PARES, como o H.264 exige. */
const escala = (lado) =>
  `scale='trunc(if(gt(a,1),min(${lado},iw),-2)/2)*2':'trunc(if(gt(a,1),-2,min(${lado},ih))/2)*2'`;

/* ---------- trailer ---------- */

/**
 * Trailer com os trechos já ajustados: um corte por trecho, cada um com fade de imagem e de som nas pontas
 * (a emenda não estala), tudo concatenado num MP4 H.264/AAC com `faststart` (toca antes de baixar inteiro).
 * Sem áudio no original, sai sem áudio. Devolve `{ arquivo, duracao, bytes }`.
 */
export async function montarTrailer(entrada, saida, trechos, { temAudio = true, fade = 0.4, largura = 1280, crf = 23 } = {}) {
  if (!trechos.length) throw new Error('nenhum trecho para montar o trailer');
  const partes = []; const juntar = [];
  trechos.forEach((t, i) => {
    const len = t.fim - t.inicio;
    const f = Math.min(fade, len / 3);
    partes.push(`[0:v]trim=start=${t.inicio}:end=${t.fim},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${f},fade=t=out:st=${arred(len - f)}:d=${f}[v${i}]`);
    if (temAudio) partes.push(`[0:a]atrim=start=${t.inicio}:end=${t.fim},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${f},afade=t=out:st=${arred(len - f)}:d=${f}[a${i}]`);
    juntar.push(temAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  const concat = `${juntar.join('')}concat=n=${trechos.length}:v=1:a=${temAudio ? 1 : 0}${temAudio ? '[vc][ac]' : '[vc]'}`;
  const grafo = [...partes, concat, `[vc]${escala(largura)},format=yuv420p[vf]`].join(';');
  const args = [...FF, '-i', entrada, '-filter_complex', grafo, '-map', '[vf]'];
  if (temAudio) args.push('-map', '[ac]', '-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'main', '-movflags', '+faststart', saida);
  await executar('ffmpeg', args);
  const s = await stat(saida);
  return { arquivo: saida, duracao: arred(trechos.reduce((a, t) => a + (t.fim - t.inicio), 0), 2), bytes: s.size };
}

/* ---------- clipe mudo ---------- */

/** Degraus de qualidade, do melhor ao mais leve, tentados em ordem até caber em `maxBytes`. */
const DEGRAUS = [
  { lado: 1280, crf: 26, kbps: 2800 },
  { lado: 1280, crf: 29, kbps: 1800 },
  { lado: 960, crf: 30, kbps: 1200 },
  { lado: 854, crf: 32, kbps: 800 },
  { lado: 640, crf: 34, kbps: 500 }
];

/**
 * Clipe MUDO em MP4: sem faixa de áudio (`-an`), 24 quadros/s, fade curto nas pontas para o laço não dar tranco,
 * e o mais nítido que couber em `maxBytes`. Devolve `{ arquivo, duracao, bytes, degrau }`; rejeita se nem o
 * degrau mais leve cabe (um clipe de 10 s a 500 kbps tem ~0,6 MB, então só acontece com `maxBytes` absurdo).
 */
export async function montarClipe(entrada, saida, janela, { maxBytes = CLIPE.maxBytes, fade = 0.25 } = {}) {
  const seg = arred(janela.fim - janela.inicio, 3);
  if (seg < CLIPE.minSeg - 0.01 || seg > CLIPE.maxSeg + 0.01) throw new Error(`o clipe precisa ter de ${CLIPE.minSeg} a ${CLIPE.maxSeg} s (veio ${seg} s)`);
  let ultimo = 0;
  for (let i = 0; i < DEGRAUS.length; i++) {
    const g = DEGRAUS[i];
    const vf = `${escala(g.lado)},fps=24,fade=t=in:st=0:d=${fade},fade=t=out:st=${arred(seg - fade)}:d=${fade},format=yuv420p`;
    await executar('ffmpeg', [...FF, '-ss', String(janela.inicio), '-t', String(seg), '-i', entrada, '-an', '-sn', '-vf', vf,
      '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'main', '-crf', String(g.crf), '-maxrate', g.kbps + 'k', '-bufsize', (g.kbps * 2) + 'k',
      '-movflags', '+faststart', saida]);
    ultimo = (await stat(saida)).size;
    if (ultimo <= maxBytes) return { arquivo: saida, duracao: seg, bytes: ultimo, degrau: i };
  }
  throw new Error(`o clipe ficou com ${ultimo} bytes, acima do limite de ${maxBytes}`);
}

/** Capa de abertura (poster) do clipe ou do trailer: um quadro do meio, em JPEG. */
export async function montarPoster(video, saida, t, opcoes = {}) {
  await extrairQuadro(video, t, saida, { largura: 1280, qualidade: 3, ...opcoes });
  return saida;
}

/* ---------- capa com título e marca ---------- */

const FONTES_COMUNS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf'
];

/** A fonte em negrito para o título: a pedida (`--fonte`) ou a primeira que existir no sistema. `null` se nenhuma. */
export async function acharFonte(pedida) {
  for (const p of [pedida, process.env.TELA_FONTE, ...FONTES_COMUNS].filter(Boolean)) {
    try { await access(p); return p; } catch { /* próxima */ }
  }
  return null;
}

const paraFiltro = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** `#rrggbb` -> `0xRRGGBB`; devolve o padrão se inválida. */
export function corParaFfmpeg(hex, padrao = '0x2563EB') {
  return /^#[0-9a-fA-F]{6}$/.test(String(hex || '')) ? '0x' + hex.slice(1).toUpperCase() : padrao;
}

/**
 * Compõe a capa do template: o quadro, uma sombra embaixo (várias camadas translúcidas, o que dá um degradê sem
 * imagem auxiliar), uma barra na cor da marca, o título em até 3 linhas e o nome da marca no canto.
 * O texto entra por arquivo (`textfile=`), então aspas e `%` do título não quebram o filtro.
 *
 * `quadro`: imagem de entrada. `saida`: .jpg. Sem `fonte` (ou sem `drawtext` no ffmpeg) rejeita com
 * `codigo: 'sem-texto'`, e o chamador entrega o quadro limpo.
 */
export async function comporCapa(quadro, saida, { titulo, marca, cor, fonte, largura = 1280, altura = 720 } = {}) {
  if (!fonte) throw Object.assign(new Error('sem fonte para desenhar o título (use --fonte caminho.ttf)'), { codigo: 'sem-texto' });
  const pasta = await mkdtemp(path.join(os.tmpdir(), 'tela-capa-'));
  try {
    const linhas = quebrarTitulo(titulo, 22, 3);
    const arqTitulo = path.join(pasta, 'titulo.txt'); const arqMarca = path.join(pasta, 'marca.txt');
    await writeFile(arqTitulo, linhas.join('\n'), 'utf8');
    await writeFile(arqMarca, String(marca || '').slice(0, 40), 'utf8');
    const f = paraFiltro(fonte);
    const acento = corParaFfmpeg(cor);
    const camadas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `drawbox=x=0:y=ih*${arred(0.36 + 0.06 * i, 2)}:w=iw:h=ih:color=black@0.09:t=fill`);
    const filtros = [
      `scale=${largura}:-2`,
      ...camadas,
      `drawbox=x=iw*0.05:y=ih-ih*0.07-${linhas.length}*ih*0.085-ih*0.035:w=iw*0.07:h=ih*0.012:color=${acento}:t=fill`,
      `drawtext=fontfile='${f}':textfile='${paraFiltro(arqTitulo)}':fontcolor=white:fontsize=h*0.075:line_spacing=${Math.round(altura * 0.012)}:x=w*0.05:y=h-h*0.07-text_h:shadowcolor=black@0.6:shadowx=2:shadowy=2`
    ];
    if (marca) filtros.push(`drawtext=fontfile='${f}':textfile='${paraFiltro(arqMarca)}':fontcolor=white@0.9:fontsize=h*0.036:x=w*0.05:y=h*0.06:shadowcolor=black@0.6:shadowx=1:shadowy=1`);
    await executar('ffmpeg', [...FF, '-i', quadro, '-vf', filtros.join(','), '-frames:v', '1', '-q:v', '3', saida]);
    return { arquivo: saida, linhas };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
