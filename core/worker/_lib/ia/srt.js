/* ia/srt.js — legenda (SRT e WebVTT) de ida e volta, sem dependências.
 *
 * `cue` = { inicio, fim, texto } com tempos em SEGUNDOS (número). Os ASR "rolantes" (cada cue repete a linha de
 * cima) são tratados por `juntarSemRepetir`: sem isso o texto sai com cada frase duas ou três vezes. */

const TEMPO = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function paraSegundos(carimbo) {
  const m = String(carimbo).trim().match(TEMPO);
  if (!m) return null;
  const ms = Number(m[4].padEnd(3, '0'));
  return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]) + ms / 1000;
}

const dois = (n) => String(n).padStart(2, '0');

export function paraCarimbo(segundos, separador = ',') {
  const total = Math.max(0, Math.round(Number(segundos) * 1000) || 0);
  const ms = total % 1000;
  const s = Math.floor(total / 1000);
  return dois(Math.floor(s / 3600)) + ':' + dois(Math.floor(s / 60) % 60) + ':' + dois(s % 60) + separador + String(ms).padStart(3, '0');
}

/* Lê SRT ou VTT. Devolve [] se não houver cue. */
export function analisarLegenda(texto) {
  const linhas = String(texto == null ? '' : texto).replace(/^﻿/, '').split(/\r?\n/);
  const cues = [];
  let i = 0;
  while (i < linhas.length) {
    const m = linhas[i].match(/^\s*(\S+)\s+-->\s+(\S+)/);
    if (!m) { i++; continue; }
    const inicio = paraSegundos(m[1]);
    const fim = paraSegundos(m[2]);
    i++;
    const partes = [];
    while (i < linhas.length && linhas[i].trim() !== '') { partes.push(linhas[i].trim()); i++; }
    if (inicio == null || fim == null) continue;
    const t = partes.join('\n').replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').trim();
    if (t) cues.push({ inicio, fim, texto: t });
  }
  return cues;
}

/* Tira a repetição das legendas rolantes: se o texto da cue COMEÇA com o da anterior, fica só o que é novo. */
export function juntarSemRepetir(cues) {
  const saida = [];
  let anterior = '';
  for (const c of cues) {
    const t = c.texto.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t === anterior) continue;
    let novo = t;
    if (anterior && t.startsWith(anterior)) novo = t.slice(anterior.length).trim();
    else if (anterior) {
      /* a linha de baixo da cue anterior sobe: compara com o fim */
      const cauda = anterior.split(' ').slice(-8).join(' ');
      const k = cauda ? t.indexOf(cauda) : -1;
      if (k === 0) novo = t.slice(cauda.length).trim();
    }
    anterior = t;
    if (novo) saida.push({ inicio: c.inicio, fim: c.fim, texto: novo });
  }
  return saida;
}

export function paraSrt(cues) {
  return cues.map((c, i) => (i + 1) + '\n' + paraCarimbo(c.inicio) + ' --> ' + paraCarimbo(c.fim) + '\n' + c.texto + '\n').join('\n');
}

export function paraVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => paraCarimbo(c.inicio, '.') + ' --> ' + paraCarimbo(c.fim, '.') + '\n' + c.texto + '\n').join('\n');
}

export function textoDasCues(cues) {
  return cues.map((c) => c.texto.replace(/\s*\n\s*/g, ' ')).join(' ').replace(/\s+/g, ' ').trim();
}

/* Blocos de `janelaSeg` segundos: [{ inicio, texto }]. É o que os prompts de capítulo e trailer recebem. */
export function emBlocos(cues, janelaSeg = 30) {
  const blocos = [];
  let atual = null;
  for (const c of cues) {
    const idx = Math.floor(c.inicio / janelaSeg);
    if (!atual || atual.idx !== idx) {
      atual = { idx, inicio: idx * janelaSeg, partes: [] };
      blocos.push(atual);
    }
    atual.partes.push(c.texto.replace(/\s*\n\s*/g, ' '));
  }
  return blocos.map((b) => ({ inicio: b.inicio, texto: b.partes.join(' ').replace(/\s+/g, ' ').trim() })).filter((b) => b.texto);
}

/* Reduz uma lista de blocos a no máximo `maxCaracteres`, escolhendo blocos espaçados (cobre o vídeo inteiro). */
export function reduzirBlocos(blocos, maxCaracteres) {
  const total = blocos.reduce((s, b) => s + b.texto.length + 8, 0);
  if (total <= maxCaracteres || blocos.length < 2) return blocos;
  const manter = Math.max(1, Math.floor(blocos.length * (maxCaracteres / total)));
  const saida = [];
  for (let k = 0; k < manter; k++) saida.push(blocos[Math.floor((k * blocos.length) / manter)]);
  return saida;
}

export function mmss(segundos) {
  const s = Math.max(0, Math.floor(Number(segundos) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + dois(m) : String(m)) + ':' + dois(s % 60);
}

/* Divide em lotes de até `n` cues (a tradução manda um lote por chamada). */
export function emLotes(lista, n) {
  const saida = [];
  for (let i = 0; i < lista.length; i += n) saida.push(lista.slice(i, i + n));
  return saida;
}
