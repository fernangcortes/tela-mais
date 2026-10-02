/* ia/transcricao/limpeza.js — o que se faz com os segmentos antes de chamá-los de transcrição.
 *
 * O Whisper "alucina" em silêncio e música: inventa "Obrigado por assistir" ou repete a mesma frase em laço. Aqui se descarta
 * (1) segmento vazio, (2) segmento que o próprio modelo marca como sem fala (`no_speech_prob` alto com confiança baixa),
 * (3) as assinaturas conhecidas de alucinação e (4) a mesma frase repetida em 3 segmentos seguidos ou mais. O que sobra é
 * ainda ASR: erra nome próprio, e por isso sempre vira SUGESTÃO para revisar, nunca legenda publicada sozinha. */

const ASSINATURAS = /^(obrigad[oa]s? por assistir|legendas? pela comunidade|legenda(s)? (por|de|by)\b|amara\.org|thanks for watching|subtitles? by|gracias por ver|subt[ií]tulos? (por|de))/i;

export const MINIMO_DE_PALAVRAS = 8;

export function limparSegmentos(segmentos) {
  const base = [];
  for (const s of segmentos || []) {
    const texto = String(s && s.texto != null ? s.texto : '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    if (!(Number(s.fim) >= Number(s.inicio))) continue;
    if (Number(s.semFalaProb) > 0.8 && Number(s.logprob) < -1) continue;
    if (ASSINATURAS.test(texto)) continue;
    base.push({ inicio: Number(s.inicio), fim: Number(s.fim), texto });
  }
  /* repetição em laço: 3 ou mais iguais em sequência */
  const saida = [];
  let i = 0;
  while (i < base.length) {
    let j = i;
    while (j + 1 < base.length && base[j + 1].texto.toLowerCase() === base[i].texto.toLowerCase()) j++;
    if (j - i + 1 < 3) for (let k = i; k <= j; k++) saida.push(base[k]);
    i = j + 1;
  }
  return saida;
}

export function contarPalavras(segmentos) {
  return segmentos.reduce((s, c) => s + c.texto.split(/\s+/).filter(Boolean).length, 0);
}

export function paraBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* O idioma para os provedores que querem 2 letras ("pt-BR" -> "pt"). */
export const idiomaCurto = (idioma) => String(idioma || 'pt').split('-')[0].toLowerCase();
