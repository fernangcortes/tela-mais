/* ia/anti-alucinacao.js — a rede de segurança por trás da regra "só o que a transcrição sustenta".
 *
 * O prompt PEDE ao modelo que não invente nome. Prompt não é garantia, então o código CONFERE: todo nome próprio do texto
 * gerado (palavra com inicial maiúscula no meio da frase, e sequências de maiúsculas) precisa aparecer na transcrição, no
 * título, na série, no glossário ou nos nomes que a entrada trouxe. Nome que não aparece em nenhum deles = o texto é recusado
 * (e vira retentativa, e depois "falhou"). Falso positivo custa uma retentativa; falso negativo seria publicar um nome
 * inventado numa ficha de vídeo, e por isso a conferência é rígida.
 *
 * A palavra INICIAL de cada frase também é conferida (sinopse em terceira pessoa quase sempre começa pelo sujeito:
 * "Roberto ensina..."): ela passa se for palavra comum (lista abaixo), se estiver no vocabulário da entrada ou se
 * compartilhar o radical (5 letras) com uma palavra dele. Aceitamos algum falso positivo (uma retentativa) em troca de
 * não deixar passar nome inventado no começo da frase. */

const SEM_ACENTO = /[̀-ͯ]/g;
export const normalizar = (s) => String(s == null ? '' : s).normalize('NFD').replace(SEM_ACENTO, '').toLowerCase();

/* Maiúscula no meio da frase que NÃO é nome: dias, meses e ordinais nos três idiomas do produto. */
const NAO_E_NOME = new Set([
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'enero', 'febrero', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'i'
]);

/* Palavras comuns que abrem frase (pt, en, es): artigos, preposições, conjunções, advérbios e verbos típicos de sinopse.
 * Ficam sem acento (comparadas após `normalizar`). */
const COMUNS_DE_INICIO = new Set((
  'o a os as um uma uns umas de do da dos das no na nos nas em ao aos num numa por para com sem sob sobre entre ate desde ' +
  'e ou mas porem contudo entao assim depois antes agora hoje ainda tambem so apenas mesmo cada todo toda todos todas ' +
  'esse essa esses essas este esta estes estas isso isto aquele aquela aqui ali la onde quando como porque pois se que quem qual quais ' +
  'ele ela eles elas nos eu voce voces tu seu sua seus suas meu minha nosso nossa primeiro primeira segundo segunda terceiro ' +
  'por fim alem alias logo enfim bom boa bem ' +
  'ensina mostra explica apresenta conta traz reune acompanha fala aborda discute ensinam mostram explicam apresentam ' +
  'descreve detalha revela propoe orienta indica sugere lembra destaca comenta relata narra analisa compara combina ' +
  'passa guia ajuda cobre trata percorre demonstra aprende veja ve confira entenda saiba descubra conheca use faca ' +
  'the a an this that these those it its in on at to of for from with without by and or but so then first next finally also ' +
  'he she they we you i his her their our shows teaches explains presents covers walks follows tells explores describes ' +
  'el la los las un una unos unas del al en con sin por para sobre entre y o pero entonces asi despues ahora hoy tambien ' +
  'muestra ensena explica presenta cuenta recorre acompana habla aborda describe'
).split(/\s+/));

const PALAVRA_MAIUSCULA = /^\p{Lu}[\p{L}\p{N}'’-]*$/u;
const FIM_DE_FRASE = /[.!?…:]["”')\]]*$/;

const LIMPAR_INI = /^[("“'‘\[¿¡]+/;
const LIMPAR_FIM = /[.,;:!?…"”')\]]+$/g;
const limpar = (p) => String(p || '').replace(LIMPAR_INI, '').replace(LIMPAR_FIM, '');

/* Os nomes que o texto gerado escreve como nome próprio: sequências de palavras com inicial maiúscula ("Maria Silva"). */
export function candidatosANome(texto) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const achados = [];
  let inicioDeFrase = true;
  let i = 0;
  while (i < palavras.length) {
    const limpa = limpar(palavras[i]);
    const seguinte = limpar(palavras[i + 1]);
    if (limpa && PALAVRA_MAIUSCULA.test(limpa)) {
      const todaMaiuscula = limpa.length > 1 && limpa === limpa.toUpperCase() && /\p{L}/u.test(limpa);
      const compoe = PALAVRA_MAIUSCULA.test(seguinte) && !FIM_DE_FRASE.test(palavras[i]);
      if (!inicioDeFrase || compoe || todaMaiuscula) {
        const grupo = [limpa];
        let j = i;
        while (!FIM_DE_FRASE.test(palavras[j]) && !/[,;]$/.test(palavras[j]) && PALAVRA_MAIUSCULA.test(limpar(palavras[j + 1]))) { grupo.push(limpar(palavras[j + 1])); j++; }
        achados.push(grupo.join(' '));
        inicioDeFrase = FIM_DE_FRASE.test(palavras[j]);
        i = j + 1;
        continue;
      }
    }
    inicioDeFrase = FIM_DE_FRASE.test(palavras[i]);
    i++;
  }
  return [...new Set(achados)].filter((n) => !NAO_E_NOME.has(normalizar(n)));
}

/* Conjunto de palavras (normalizadas) que a entrada sustenta. */
export function vocabularioDe(...fontes) {
  const conjunto = new Set();
  for (const f of fontes) {
    for (const p of normalizar(Array.isArray(f) ? f.join(' ') : f).split(/[^\p{L}\p{N}]+/u)) if (p) conjunto.add(p);
  }
  return conjunto;
}

/* Nomes do texto que NENHUMA fonte sustenta. Casa também por plural/possessivo simples (S final, 's). */
export function nomesSemSuporte(texto, ...fontes) { return conferirNomes(texto, fontes, true); }

/* Para TÍTULOS curtos (título alternativo, capítulos): a 1ª palavra é maiúscula por ser título, não por ser nome; só
 * confere nomes compostos e maiúsculas no meio (limite conhecido: nome inventado sozinho na 1ª palavra do título). */
export function nomesSemSuporteEmTitulo(texto, ...fontes) { return conferirNomes(texto, fontes, false); }

function conferirNomes(texto, fontes, conferirInicios) {
  const vocab = vocabularioDe(...fontes);
  const falta = [];
  for (const nome of candidatosANome(texto)) {
    const n = normalizar(nome).replace(/['’]s$/, '');
    const partes = n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const sustenta = (p) => vocab.has(p) || vocab.has(p.replace(/s$/, '')) || vocab.has(p + 's');
    if (!partes.length || !partes.every(sustenta)) falta.push(nome);
  }
  if (conferirInicios) for (const p of iniciosSemSuporte(texto, vocab)) if (!falta.some((f) => normalizar(f).split(' ').includes(normalizar(p)))) falta.push(p);
  return falta;
}

/* Primeira palavra de cada frase (e do texto), quando começa com maiúscula e não é só uma letra. */
function iniciosDeFrase(texto) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const achados = [];
  let inicio = true;
  for (const bruta of palavras) {
    if (inicio) {
      const p = limpar(bruta);
      if (p.length > 1 && PALAVRA_MAIUSCULA.test(p)) achados.push(p);
    }
    inicio = FIM_DE_FRASE.test(bruta);
  }
  return achados;
}

function iniciosSemSuporte(texto, vocab) {
  const radicais = new Set();
  for (const w of vocab) if (w.length >= 5) radicais.add(w.slice(0, 5));
  const falta = [];
  for (const p of iniciosDeFrase(texto)) {
    const n = normalizar(p).replace(/['’]s$/, '');
    if (!n || COMUNS_DE_INICIO.has(n) || NAO_E_NOME.has(n)) continue;
    const todaMaiuscula = p === p.toUpperCase();
    if (vocab.has(n) || vocab.has(n.replace(/s$/, '')) || vocab.has(n + 's')) continue;
    if (!todaMaiuscula && n.length >= 6 && radicais.has(n.slice(0, 5))) continue;
    falta.push(p);
  }
  return falta;
}
