/* scripts/lib/ffmpeg.mjs — o ffmpeg por trás de capas e trailers, sem dependências.
 *
 * O ffmpeg é ferramenta EXTERNA e OPCIONAL: roda na máquina da pessoa ou no executor do
 * GitHub (.github/workflows/gerar-midia.yml), nunca no Worker. Aqui moram duas coisas:
 *
 *   1. funções PURAS (parsear a saída do ffmpeg, escolher quadros, ajustar trechos,
 *      quebrar título em linhas). Testadas sem ffmpeg.
 *   2. funções que CHAMAM o ffmpeg (sondar, detectar cenas e silêncios, extrair quadro,
 *      medir nitidez). Testadas com um vídeo sintético quando o ffmpeg existe.
 *
 * Nenhum argumento passa por shell (spawn com vetor), então título com aspas ou `$` não
 * vira comando. Texto desenhado entra por arquivo (`textfile=`), nunca escapado na linha.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

/* ---------- execução ---------- */

/** Roda um programa e junta stdout/stderr. Rejeita com a cauda do stderr se sair != 0. */
export function executar(programa, args, { entrada, limiteSaida = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let filho;
    try { filho = spawn(programa, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    let saida = ''; let erro = '';
    filho.stdout.on('data', (d) => { if (saida.length < limiteSaida) saida += d; });
    filho.stderr.on('data', (d) => { if (erro.length < limiteSaida) erro += d; });
    filho.on('error', (e) => reject(e.code === 'ENOENT'
      ? Object.assign(new Error(`não encontrei o programa "${programa}". Instale o ffmpeg (https://ffmpeg.org/download.html) e tente de novo.`), { codigo: 'sem-ffmpeg' })
      : e));
    filho.on('close', (codigo) => {
      if (codigo === 0) resolve({ stdout: saida, stderr: erro });
      else reject(Object.assign(new Error(`${programa} saiu com ${codigo}: ${erro.trim().split('\n').slice(-4).join(' | ').slice(0, 500)}`), { codigo: 'ffmpeg-falhou', stderr: erro }));
    });
    if (entrada) filho.stdin.end(entrada); else filho.stdin.end();
  });
}

const FF = ['-hide_banner', '-nostdin', '-y', '-v', 'error'];

/** `{ ok, versao, filtros:Set }`; `ok:false` quando o ffmpeg não está instalado. Nunca lança. */
export async function verificarFfmpeg() {
  try {
    const v = await executar('ffmpeg', ['-hide_banner', '-version']);
    const m = /ffmpeg version (\S+)/.exec(v.stdout);
    const f = await executar('ffmpeg', ['-hide_banner', '-filters']);
    const filtros = new Set();
    for (const l of f.stdout.split('\n')) { const x = /^\s*[A-Z.]{3}\s+(\S+)\s/.exec(l); if (x) filtros.add(x[1]); }
    return { ok: true, versao: m ? m[1] : 'desconhecida', filtros };
  } catch (e) {
    return { ok: false, versao: null, filtros: new Set(), motivo: e.message };
  }
}

/* ---------- funções puras ---------- */

export const arred = (n, casas = 3) => { const k = 10 ** casas; return Math.round(Number(n) * k) / k; };
const limitar = (n, a, b) => Math.min(b, Math.max(a, n));

/** Instantes (s) de corte de cena, da saída de `select='gt(scene,X)',metadata=print`. */
export function parsearCenas(texto) {
  const tempos = [];
  for (const m of String(texto || '').matchAll(/pts_time:(-?[0-9.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0) tempos.push(arred(t));
  }
  return [...new Set(tempos)].sort((a, b) => a - b);
}

/** Intervalos de silêncio [{inicio, fim}] da saída do `silencedetect`. Silêncio aberto até o fim usa `duracao`. */
export function parsearSilencios(texto, duracao) {
  const saida = [];
  let aberto = null;
  for (const l of String(texto || '').split('\n')) {
    const i = /silence_start:\s*(-?[0-9.]+)/.exec(l);
    if (i) { aberto = Math.max(0, Number(i[1])); continue; }
    const f = /silence_end:\s*(-?[0-9.]+)/.exec(l);
    if (f && aberto !== null) { saida.push({ inicio: arred(aberto), fim: arred(Number(f[1])) }); aberto = null; }
  }
  if (aberto !== null && Number.isFinite(duracao) && duracao > aberto) saida.push({ inicio: arred(aberto), fim: arred(duracao) });
  return saida.filter((s) => s.fim > s.inicio);
}

/** Valor de uma chave `lavfi.signalstats.*` na saída do `metadata=print` (média dos quadros). */
export function parsearMedida(texto, chave) {
  const valores = [];
  const er = new RegExp(chave.replace(/[.]/g, '\\.') + '=(-?[0-9.]+)', 'g');
  for (const m of String(texto || '').matchAll(er)) valores.push(Number(m[1]));
  if (!valores.length) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * Nota de um quadro candidato a capa (0 a 1+). `brilho` e `nitidez` vêm do ffmpeg
 * (signalstats: média da luma 0..255; sobel: média da luma das bordas 0..255).
 * Quadro escuro ou estourado (transição, preto, cartela branca) perde quase tudo.
 */
export function pontuarQuadro({ brilho, nitidez, contraste }) {
  if (![brilho, nitidez].every(Number.isFinite)) return 0;
  const faixa = brilho < 20 || brilho > 238 ? 0.05
    : brilho < 45 ? 0.5 + (brilho - 20) / 50
    : brilho > 215 ? 0.5 + (238 - brilho) / 46
    : 1;
  const borda = Math.min(1, nitidez / 40);
  const cont = Number.isFinite(contraste) ? Math.min(1, contraste / 140) : 0.7;
  return arred(faixa * (0.65 * borda + 0.35 * cont), 4);
}

/**
 * Instantes candidatos a capa: logo depois de cada corte de cena e uma grade regular,
 * sempre dentro de [margem, 1-margem] da duração (fora da vinheta e dos créditos).
 * `max` limita quantos se medem (cada medida é uma chamada ao ffmpeg).
 */
export function candidatosDeQuadro({ duracao, cenas = [], margem = 0.08, max = 24 }) {
  if (!(duracao > 0)) return [];
  const ini = duracao * margem; const fim = duracao * (1 - margem);
  const tempos = [];
  for (const c of cenas) { const t = c + 0.6; if (t >= ini && t <= fim) tempos.push(arred(t, 2)); }
  const passos = Math.max(6, Math.min(16, Math.floor(duracao / 15)));
  for (let i = 0; i < passos; i++) tempos.push(arred(ini + ((fim - ini) * (i + 0.5)) / passos, 2));
  const unicos = [...new Set(tempos)].sort((a, b) => a - b);
  if (unicos.length <= max) return unicos;
  const passo = unicos.length / max; /* amostra espalhada, sem concentrar no começo */
  return Array.from({ length: max }, (_, i) => unicos[Math.floor(i * passo)]);
}

/** Os N melhores quadros, distantes ao menos `distanciaMin` s uns dos outros (candidatas diferentes de verdade). */
export function escolherDistintos(medidos, n, distanciaMin) {
  const ordenados = medidos.filter((m) => m.nota > 0).sort((a, b) => b.nota - a.nota);
  const escolhidos = [];
  for (const m of ordenados) {
    if (escolhidos.every((e) => Math.abs(e.t - m.t) >= distanciaMin)) escolhidos.push(m);
    if (escolhidos.length >= n) break;
  }
  /* poucos quadros bons e distantes: completa com os melhores restantes, para sempre devolver N quando houver. */
  for (const m of ordenados) { if (escolhidos.length >= n) break; if (!escolhidos.includes(m)) escolhidos.push(m); }
  return escolhidos;
}

/** Quebra o título em até `maxLinhas` linhas de no máximo `largura` caracteres; reticências se não couber. */
export function quebrarTitulo(titulo, largura = 22, maxLinhas = 3) {
  const palavras = String(titulo || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const linhas = [];
  let atual = '';
  let sobrou = false;
  for (let i = 0; i < palavras.length; i++) {
    let p = palavras[i];
    if (p.length > largura) p = p.slice(0, largura - 1) + '…';
    const junto = atual ? atual + ' ' + p : p;
    if (junto.length <= largura) { atual = junto; continue; }
    linhas.push(atual); atual = p;
    if (linhas.length === maxLinhas) { sobrou = true; atual = ''; break; }
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  else if (atual) sobrou = true;
  if (sobrou && linhas.length) {
    const ult = linhas[linhas.length - 1];
    linhas[linhas.length - 1] = (ult.length >= largura ? ult.slice(0, largura - 1) : ult).replace(/[ ,.;:]+$/, '') + '…';
  }
  return linhas;
}

/* ---------- trechos para trailer e clipe ---------- */

/** Mais próximo de `alvo` em `pontos` dentro de `raio`; `null` se nenhum. */
export function maisProximo(pontos, alvo, raio) {
  let melhor = null; let dist = Infinity;
  for (const p of pontos) { const d = Math.abs(p - alvo); if (d <= raio && d < dist) { melhor = p; dist = d; } }
  return melhor;
}

/**
 * Valida o que o modelo devolveu: [{inicio, fim, motivo}] em segundos. Descarta (e conta em `descartados`)
 * o que é número inválido, fora da duração, ou curto demais; NUNCA inventa trecho. Corta o fim no fim do vídeo.
 */
export function validarTrechos(bruto, duracao, { minimo = 2 } = {}) {
  const lista = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.trechos) ? bruto.trechos : []);
  const validos = []; const descartados = [];
  for (const t of lista) {
    const inicio = Number(t && t.inicio); let fim = Number(t && t.fim);
    if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio < 0 || inicio >= duracao || fim <= inicio) { descartados.push({ trecho: t, motivo: 'tempo-invalido' }); continue; }
    fim = Math.min(fim, duracao);
    if (fim - inicio < minimo) { descartados.push({ trecho: t, motivo: 'curto' }); continue; }
    validos.push({ inicio: arred(inicio), fim: arred(fim), motivo: String((t && t.motivo) || '').slice(0, 200) });
  }
  return { trechos: validos, descartados };
}

/**
 * Encaixa os trechos do modelo nos cortes reais do vídeo, para o trailer não começar nem terminar no meio
 * de uma fala ou de um plano:
 *   - o INÍCIO vai para o corte de cena mais próximo (até `raio` s) ou, sem ele, para o fim de um silêncio;
 *   - o FIM vai para o começo de um silêncio (pausa na fala) ou, sem ele, para um corte de cena.
 * Depois ordena, funde os que se tocam e corta o excedente de `maxTotal`. Devolve o que sobrou, em ordem.
 */
export function ajustarTrechos(trechos, { cenas = [], silencios = [], duracao, raio = 1.5, maxTotal = 45, minimo = 2 }) {
  const fimsDeSilencio = silencios.map((s) => s.fim);
  const iniciosDeSilencio = silencios.map((s) => s.inicio);
  const ajustados = [];
  for (const t of trechos) {
    let inicio = maisProximo(cenas, t.inicio, raio);
    if (inicio === null) inicio = maisProximo(fimsDeSilencio, t.inicio, raio);
    if (inicio === null) inicio = t.inicio;
    let fim = maisProximo(iniciosDeSilencio, t.fim, raio);
    if (fim === null) fim = maisProximo(cenas, t.fim, raio);
    if (fim === null) fim = t.fim;
    inicio = limitar(inicio, 0, duracao); fim = limitar(fim, 0, duracao);
    if (fim - inicio >= minimo) ajustados.push({ inicio: arred(inicio), fim: arred(fim), motivo: t.motivo || '' });
  }
  ajustados.sort((a, b) => a.inicio - b.inicio);
  const fundidos = [];
  for (const t of ajustados) {
    const ult = fundidos[fundidos.length - 1];
    if (ult && t.inicio <= ult.fim + 0.2) { ult.fim = Math.max(ult.fim, t.fim); ult.motivo = ult.motivo || t.motivo; } else fundidos.push({ ...t });
  }
  /* excedente: encurta do fim dos trechos mais longos, sem passar do mínimo, até caber. */
  let total = fundidos.reduce((s, t) => s + (t.fim - t.inicio), 0);
  for (let volta = 0; total > maxTotal + 0.01 && volta < 200; volta++) {
    const maior = fundidos.reduce((m, t) => ((t.fim - t.inicio) > (m.fim - m.inicio) ? t : m), fundidos[0]);
    const folga = (maior.fim - maior.inicio) - minimo;
    if (folga <= 0) { fundidos.splice(fundidos.indexOf(maior), 1); total = fundidos.reduce((s, t) => s + (t.fim - t.inicio), 0); if (!fundidos.length) break; continue; }
    const corte = Math.min(folga, total - maxTotal);
    maior.fim = arred(maior.fim - corte);
    total -= corte;
  }
  return fundidos.map((t) => ({ ...t, inicio: arred(t.inicio), fim: arred(t.fim) }));
}

/** Pedaços de [a,b] sem corte de cena no meio (um plano contínuo faz um laço mais limpo). */
export function intervalosSemCorte(a, b, cenas) {
  const pontos = [a, ...cenas.filter((c) => c > a + 0.05 && c < b - 0.05), b];
  const pedacos = [];
  for (let i = 0; i < pontos.length - 1; i++) pedacos.push({ inicio: pontos[i], fim: pontos[i + 1] });
  return pedacos;
}

/**
 * A janela do clipe mudo (`seg` entre `minSeg` e `maxSeg`). Prefere, nos trechos escolhidos (ou no miolo do
 * vídeo, se não houver), o plano contínuo mais longo que caiba; se nenhum chega a `minSeg`, aceita o melhor
 * pedaço com corte no meio (e avisa em `corteNoMeio`). Devolve `null` se o vídeo é curto demais.
 */
export function escolherJanelaClipe({ trechos = [], cenas = [], duracao, minSeg = 6, maxSeg = 10, alvoSeg = 8 }) {
  if (!(duracao >= minSeg)) return null;
  const bases = trechos.length ? trechos : [{ inicio: duracao * 0.2, fim: duracao * 0.8 }];
  let melhor = null;
  for (const b of bases) {
    for (const p of intervalosSemCorte(Math.max(0, b.inicio), Math.min(duracao, b.fim), cenas)) {
      const len = p.fim - p.inicio;
      if (len < minSeg) continue;
      const seg = Math.min(maxSeg, Math.max(minSeg, Math.min(alvoSeg, len)));
      const folga = len - seg;
      const inicio = p.inicio + Math.min(0.3, folga / 2); /* um respiro depois do corte */
      const cand = { inicio: arred(inicio), fim: arred(inicio + seg), corteNoMeio: false, plano: len };
      if (!melhor || cand.plano > melhor.plano) melhor = cand;
    }
  }
  if (melhor) { delete melhor.plano; return melhor; }
  /* nenhum plano contínuo de minSeg: a janela mais longa de alvoSeg dentro dos trechos, com corte no meio */
  for (const b of bases) {
    const ini = Math.max(0, b.inicio); const fim = Math.min(duracao, b.fim);
    if (fim - ini >= minSeg) {
      const seg = Math.min(alvoSeg, fim - ini);
      return { inicio: arred(ini), fim: arred(ini + seg), corteNoMeio: true };
    }
  }
  const seg = Math.min(alvoSeg, duracao);
  const ini = Math.max(0, duracao / 2 - seg / 2);
  return { inicio: arred(ini), fim: arred(ini + seg), corteNoMeio: true };
}

/* ---------- chamadas ao ffmpeg ---------- */

/** `{ duracao, largura, altura, temAudio, fps }` lido pelo próprio ffmpeg (sem ffprobe, que nem sempre vem junto). */
export async function sondar(arquivo) {
  await access(arquivo);
  let texto;
  try { await executar('ffmpeg', ['-hide_banner', '-nostdin', '-i', arquivo]); texto = ''; } catch (e) { texto = e.stderr || ''; }
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(texto);
  if (!d) throw new Error(`não consegui ler a duração de ${arquivo}. O arquivo é um vídeo?`);
  const duracao = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = /Stream #\d+:\d+[^:]*: Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(texto);
  const fps = /(\d+(?:\.\d+)?) fps/.exec(texto);
  return {
    duracao: arred(duracao, 2),
    largura: v ? Number(v[1]) : null,
    altura: v ? Number(v[2]) : null,
    temAudio: /Stream #\d+:\d+[^:]*: Audio:/.test(texto),
    fps: fps ? Number(fps[1]) : null
  };
}

/** Cortes de cena (s). Analisa em 320 px de largura: é o que mantém viável num filme de horas. */
export async function detectarCenas(arquivo, { limiar = 0.3 } = {}) {
  const r = await executar('ffmpeg', [...FF, '-i', arquivo, '-an', '-vf', `scale=320:-2,select='gt(scene,${limiar})',metadata=print:file=-`, '-f', 'null', '-']);
  return parsearCenas(r.stdout);
}

/** Silêncios (s) com `silencedetect`. `ruidoDb` e `minSeg` são os padrões do ffmpeg para fala. */
export async function detectarSilencios(arquivo, { ruidoDb = -35, minSeg = 0.4, duracao } = {}) {
  const r = await executar('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-i', arquivo, '-vn', '-af', `silencedetect=noise=${ruidoDb}dB:d=${minSeg}`, '-f', 'null', '-']);
  return parsearSilencios(r.stderr, duracao);
}

/** Extrai UM quadro em `t` s para `saida` (jpg ou png), com largura máxima `largura` (a proporção se mantém). */
export async function extrairQuadro(arquivo, t, saida, { largura = 1280, qualidade = 3 } = {}) {
  const vf = `scale='if(gt(a,1),min(${largura},iw),-2)':'if(gt(a,1),-2,min(${largura},ih))'`;
  await executar('ffmpeg', [...FF, '-ss', String(Math.max(0, t)), '-i', arquivo, '-an', '-frames:v', '1', '-vf', vf, '-q:v', String(qualidade), saida]);
  return saida;
}

/** `{ brilho, nitidez, contraste }` de uma imagem: luma média, média da luma das bordas (sobel) e (máx-mín) do percentil. */
export async function medirImagem(imagem) {
  const base = await executar('ffmpeg', [...FF, '-i', imagem, '-vf', 'scale=480:-2,signalstats,metadata=print:file=-', '-f', 'null', '-']);
  const bordas = await executar('ffmpeg', [...FF, '-i', imagem, '-vf', 'scale=480:-2,format=gray,sobel,signalstats,metadata=print:file=-', '-f', 'null', '-']);
  const alto = parsearMedida(base.stdout, 'lavfi.signalstats.YHIGH');
  const baixo = parsearMedida(base.stdout, 'lavfi.signalstats.YLOW');
  return {
    brilho: parsearMedida(base.stdout, 'lavfi.signalstats.YAVG'),
    nitidez: parsearMedida(bordas.stdout, 'lavfi.signalstats.YAVG'),
    contraste: alto !== null && baixo !== null ? alto - baixo : null
  };
}

/**
 * Trechos SEM modelo de linguagem, para quando não há transcrição nem IA ligada: `n` pedaços de `seg` s espalhados
 * entre 12% e 88% do vídeo (fora da vinheta e dos créditos). O ajuste a cortes e silêncios vem depois, em `ajustarTrechos`.
 * É uma amostra, não uma escolha de conteúdo: o resultado é só sugestão, como tudo que se gera.
 */
export function trechosAutomaticos({ duracao, n = 6, seg = 7 }) {
  if (!(duracao > 0)) return [];
  const ini = duracao * 0.12; const fim = duracao * 0.88;
  const tam = Math.min(seg, (fim - ini) / n);
  if (tam < 2) return [{ inicio: arred(Math.max(0, duracao * 0.3)), fim: arred(Math.min(duracao, duracao * 0.3 + Math.min(seg * 2, duracao * 0.4))), motivo: 'amostra do miolo' }];
  const passo = (fim - ini) / n;
  return Array.from({ length: n }, (_, i) => ({ inicio: arred(ini + i * passo + (passo - tam) / 2), fim: arred(ini + i * passo + (passo - tam) / 2 + tam), motivo: 'amostra automática' }));
}
