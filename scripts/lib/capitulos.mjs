/* scripts/lib/capitulos.mjs — a conta dos capítulos, sem rede e sem disco.
 *
 * Mora aqui, e não dentro de `scripts/capitulos.mjs`, porque o script tem
 * `await` no topo: quem o importasse para testar rodaria a carga inteira
 * contra o Bunny. Estas funções são puras e o teste as carrega direto.
 *
 * `capitulos.json` guarda só `inicio` e `titulo`. Tudo o mais — o `end` que a
 * API do Bunny exige, a ordenação, a validação — é derivado aqui.
 */

/* Fecha cada capítulo no início do seguinte; o último, na duração do vídeo.
 *
 * Por que derivar em vez de escrever o `end` à mão em capitulos.json: com dois
 * campos por capítulo, mover um corte obriga a mexer no vizinho, e um esquecido
 * deixa um buraco na linha do tempo que ninguém vê até abrir o player. Com um
 * campo só, a linha do tempo é contígua por construção.
 *
 * ARMADILHA: a régua é o `length` que o Bunny mediu DEPOIS de transcodificar,
 * não o `duracao_seg` do catálogo — que vem do arquivo original e diverge em um
 * ou dois segundos. É o `length` que o player usa para desenhar a barra.
 *
 * Lança em vez de consertar: capítulo depois do fim do vídeo ou dois no mesmo
 * segundo é erro de quem escreveu o arquivo, e engolir isso gravaria lixo no
 * player de um vídeo que está no ar. */
export function fecharCapitulos(capitulos, duracao) {
  const ordenados = (capitulos || [])
    .map((c) => ({
      titulo: String((c && c.titulo) || '').replace(/\s+/g, ' ').trim(),
      inicio: Math.round(Number(c && c.inicio))
    }))
    .filter((c) => c.titulo && Number.isFinite(c.inicio) && c.inicio >= 0)
    .sort((a, b) => a.inicio - b.inicio);

  const fim = Math.round(Number(duracao));
  if (!Number.isFinite(fim) || fim <= 0) throw new Error('duração inválida: ' + duracao);
  if (!ordenados.length) throw new Error('nenhum capítulo aproveitável');

  const saida = [];
  for (let i = 0; i < ordenados.length; i++) {
    const { inicio, titulo } = ordenados[i];
    if (inicio >= fim) {
      throw new Error(`capítulo "${titulo}" começa em ${inicio}s, depois do fim do vídeo (${fim}s)`);
    }
    const proximo = i + 1 < ordenados.length ? ordenados[i + 1].inicio : fim;
    if (proximo === inicio) {
      throw new Error(`dois capítulos começam no mesmo segundo (${inicio}s): "${titulo}"`);
    }
    saida.push({ titulo, inicio, fim: proximo });
  }
  return saida;
}

/* O que o Bunny já tem, no vocabulário dele: title/start/end. */
export function iguaisNoBunny(capitulos, doBunny) {
  const meus = (capitulos || []).map((c) => `${c.inicio}|${c.fim}|${c.titulo}`);
  const deles = (doBunny || []).map((c) => `${c.start}|${c.end}|${c.title}`);
  return meus.length === deles.length && meus.every((m, i) => m === deles[i]);
}

/* No catálogo vai só `inicio` e `titulo`: guardar o `fim` derivado criaria um
 * segundo lugar para ficar desatualizado, e a lista da ficha não precisa dele —
 * ela usa o início do capítulo seguinte, exatamente como o player. */
export function paraCatalogo(capitulos) {
  return (capitulos || []).map((c) => ({ inicio: c.inicio, titulo: c.titulo }));
}

export function iguaisNoCatalogo(capitulos, doItem) {
  const meus = paraCatalogo(capitulos).map((c) => `${c.inicio}|${c.titulo}`);
  const deles = (doItem || []).map((c) => `${c.inicio}|${c.titulo}`);
  return meus.length === deles.length && meus.every((m, i) => m === deles[i]);
}
