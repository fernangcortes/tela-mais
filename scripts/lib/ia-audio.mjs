/* scripts/lib/ia-audio.mjs — o ffmpeg que a transcrição usa: tirar o áudio (mono, 16 kHz) e fatiar em pedaços.
 *
 * ffmpeg é ferramenta EXTERNA e opcional (regra do projeto): nada do Worker depende dele; só os scripts e o GitHub Actions. O áudio
 * sai pequeno de propósito (mono, 16 kHz, 48 kbps: 5 minutos ≈ 1,8 MB), porque o Whisper do Workers AI recebe o áudio em base64 no
 * corpo da chamada. A fonte pode ser um arquivo do disco ou o endereço HLS do provedor (o ffmpeg lê playlist .m3u8 direto). */
import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function ffmpegDisponivel(comando = 'ffmpeg') {
  try { return spawnSync(comando, ['-version'], { stdio: 'ignore' }).status === 0; } catch (e) { return false; }
}

function rodar(comando, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(comando, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let erro = '';
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-600); });
    p.on('error', (e) => reject(new Error('não consegui rodar o ' + comando + ': ' + e.message + '. Instale o ffmpeg (ffmpeg.org).')));
    p.on('close', (c) => (c === 0 ? resolve(saida) : reject(new Error(comando + ' saiu com ' + c + ': ' + erro.trim().split('\n').slice(-2).join(' ')))));
  });
}

export async function duracaoDe(entrada) {
  const saida = await rodar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', entrada]);
  const n = Number(saida.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Fatia em pedaços de `segundos`; devolve [{ audio: Uint8Array, deslocamentoSeg }]. */
export async function extrairPedacos({ entrada, pasta, segundos = 300, bitrate = '48k' }) {
  await mkdir(pasta, { recursive: true });
  await rodar('ffmpeg', ['-y', '-v', 'error', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-b:a', bitrate,
    '-f', 'segment', '-segment_time', String(segundos), '-reset_timestamps', '1', path.join(pasta, 'p%04d.mp3')]);
  const nomes = (await readdir(pasta)).filter((n) => /^p\d+\.mp3$/.test(n)).sort();
  const saida = [];
  for (let i = 0; i < nomes.length; i++) saida.push({ audio: new Uint8Array(await readFile(path.join(pasta, nomes[i]))), deslocamentoSeg: i * segundos });
  return saida;
}

/* Um arquivo só (AssemblyAI e OpenAI aceitam áudio inteiro, até o limite de cada um). */
export async function extrairAudioUnico({ entrada, saida, bitrate = '64k' }) {
  await mkdir(path.dirname(saida), { recursive: true });
  await rodar('ffmpeg', ['-y', '-v', 'error', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-b:a', bitrate, saida]);
  return new Uint8Array(await readFile(saida));
}
