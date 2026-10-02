/* scripts/lib/setup/marca-icones.mjs — ícones da marca sem dependências: cor da marca + inicial do nome.
 *
 * Mesma técnica do scripts/gerar-marca-neutra.mjs (PNG escrito à mão com zlib, suavizado por supersampling),
 * mas parametrizada: aquele script desenha o "P" da marca neutra de exemplo e não aceita cor nem letra,
 * então a instalação do cliente usa este módulo e grava em core/site/marca/ (a marca neutra do produto fica intacta).
 * Quem quiser arte própria entrega PNGs prontos (--icone-512, --icone-192, --favicon-32). */
import { deflateSync } from 'node:zlib';

/* Letras e algarismos em grade 5x7 (1 = pintado). */
const GRADE = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100'
};

/* A primeira letra ou algarismo do nome, sem acento e em maiúscula; 'T' se não houver. */
export function inicialDoNome(nome) {
  const limpo = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const m = /[A-Z0-9]/.exec(limpo);
  return m ? m[0] : 'T';
}

const celulas = (letra) => GRADE[letra].split(' ').map((l) => [...l].map((c) => c === '1'));
const rgb = (hex) => { const h = hex.replace('#', ''); const t = h.length === 3 ? [...h].map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16)); };

const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function png(largura, altura, pixel) {
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (largura * 3 + 1) + 1 + x * 3;
      linhas[o] = r; linhas[o + 1] = g; linhas[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas, { level: 9 })), bloco('IEND', Buffer.alloc(0))]);
}

/* Dimensões de um PNG (lê só o cabeçalho). null se não for PNG. */
export function dimensoesDoPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

function dentroDoArredondado(u, v, raio) {
  if (raio <= 0) return true;
  const cx = Math.min(Math.max(u, raio), 1 - raio);
  const cy = Math.min(Math.max(v, raio), 1 - raio);
  return Math.hypot(u - cx, v - cy) <= raio;
}

/* Desenha a letra centrada: `alturaRel` = altura da letra como fração da altura da imagem. */
function rasterizar(largura, altura, { fundo, frente, fora, letra, alturaRel, raio }) {
  const grade = celulas(letra);
  const lado = (altura * alturaRel) / 7;
  const x0 = (largura - lado * 5) / 2;
  const y0 = (altura - lado * 7) / 2;
  const N = 3;
  const [cF, cT, cO] = [rgb(fundo), rgb(frente), rgb(fora)];
  return png(largura, altura, (x, y) => {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const px = x + (i + 0.5) / N, py = y + (j + 0.5) / N;
      let c = cO;
      if (dentroDoArredondado(px / largura, py / altura, raio)) {
        c = cF;
        const col = Math.floor((px - x0) / lado), lin = Math.floor((py - y0) / lado);
        if (col >= 0 && col < 5 && lin >= 0 && lin < 7 && grade[lin][col]) c = cT;
      }
      r += c[0]; g += c[1]; b += c[2];
    }
    return [Math.round(r / (N * N)), Math.round(g / (N * N)), Math.round(b / (N * N))];
  });
}

function svgDaLetra(letra, fundo, frente, raio) {
  const grade = celulas(letra);
  const lado = 32 * 0.64 / 7;
  const x0 = (32 - lado * 5) / 2, y0 = (32 - lado * 7) / 2;
  let d = '';
  grade.forEach((lin, j) => lin.forEach((on, i) => { if (on) d += `M${(x0 + i * lado).toFixed(3)} ${(y0 + j * lado).toFixed(3)}h${lado.toFixed(3)}v${lado.toFixed(3)}h-${lado.toFixed(3)}z`; }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n  <rect width="32" height="32" rx="${(raio * 32).toFixed(2)}" fill="${fundo}"/>\n  <path fill="${frente}" d="${d}"/>\n</svg>\n`;
}

/* { cor, corTexto, inicial, fundoFora } -> { 'icone.svg': string, 'icone-192.png': Buffer, 'icone-512.png', 'favicon-32.png', 'og-image.png' } */
export function gerarIcones({ cor, corTexto, inicial, fundoFora = '#101315' }) {
  const letra = GRADE[inicial] ? inicial : 'T';
  const base = { fundo: cor, frente: corTexto, fora: fundoFora, letra };
  return {
    'icone.svg': svgDaLetra(letra, cor, corTexto, 0),
    'icone-192.png': rasterizar(192, 192, { ...base, alturaRel: 0.52, raio: 0 }),     /* sangrado: o Android recorta em círculo */
    'icone-512.png': rasterizar(512, 512, { ...base, alturaRel: 0.52, raio: 0 }),
    'favicon-32.png': rasterizar(32, 32, { ...base, alturaRel: 0.64, raio: 0.19 }),
    'og-image.png': rasterizar(1200, 630, { ...base, alturaRel: 0.5, raio: 0 })
  };
}
