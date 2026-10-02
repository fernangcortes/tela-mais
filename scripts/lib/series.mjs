/* scripts/lib/series.mjs — as partes puras do `series.mjs`: o material que vai ao modelo, o formato da
 * resposta e a conferência dela. Puras para o teste alcançar sem rede, sem chave e sem KV.
 */
import App from '../../core/site/catalogo-core.js';

/* As regras do texto são as da sinopse (`sinopses.mjs`), com o que muda por
 * falar de VÁRIOS títulos: a série inteira, não um episódio. */
export const INSTRUCAO = `Você escreve a apresentação de uma SÉRIE de vídeos para o catálogo da plataforma. Quem lê é um espectador escolhendo o que assistir.

O usuário envia, para cada título da série: o id, o título, a sinopse, os capítulos (segundo de início e nome) e a transcrição automática da fala.

Responda com quatro campos:

1. "sobre": a apresentação da série, em português do Brasil.
   - Um ou dois parágrafos, no máximo 110 palavras no total.
   - Terceira pessoa. Diga DO QUE TRATA a série e o que os títulos têm em comum; cite dois ou três assuntos concretos que aparecem nos episódios.
   - Nunca comece com "Nesta série", "A série", "Esta série", "Este conjunto" ou equivalente.
   - Sem juízo de valor: nada de "importante", "incrível", "imperdível", "rica", "fascinante".
   - Não invente nome de pessoa, cidade ou instituição que não apareça no material. A transcrição é automática e erra nomes próprios: se um nome parecer duvidoso, escreva sem ele.
   - Não fale do formato técnico (vídeo, transcrição, capítulos).

2. "comeco": o id do título que melhor serve de porta de entrada para quem nunca viu a série. Na dúvida, o primeiro episódio.

3. "momentos": de 3 a 5 capítulos, escolhidos entre TODOS os da série, que mostram o melhor dela — de títulos diferentes sempre que possível. Cada um é { "id", "inicio" }, e "inicio" tem de ser EXATAMENTE o segundo de início de um capítulo listado daquele título. Se a série não tiver capítulos, devolva a lista vazia.

4. "temas": de 3 a 5 temas curtos (uma a três palavras cada, com inicial maiúscula), do assunto e não do formato — "Culinária", "Viagens", "História"; nunca "Vídeo" ou "Entrevista".`;

/* A fala vem do `GET /api/busca/fala`: uma linha por vídeo, `id\t[[inicio, texto], …]`.
 * Linha que não parse é ignorada — a fala é complemento, não requisito. */
export function lerFala(tsv) {
  const falas = new Map();
  for (const linha of String(tsv || '').split(/\r?\n/)) {
    const tab = linha.indexOf('\t');
    if (tab <= 0) continue;
    try {
      const blocos = JSON.parse(linha.slice(tab + 1));
      if (Array.isArray(blocos)) falas.set(linha.slice(0, tab), blocos);
    } catch (e) { /* linha torta: sem fala para este vídeo */ }
  }
  return falas;
}

/* As séries que têm página (3 títulos ou mais, a D7), na ordem da página. */
export function seriesComPagina(itens) {
  const nomes = [];
  for (const g of App.gruposDeSeries(itens)) {
    for (const s of g.series) if (s.temPagina) nomes.push(s.nome);
  }
  return nomes;
}

/* Quem o script pode escrever. O `revisada` NUNCA — é o texto que uma pessoa
 * leu. O `auto` só com `--refazer`. */
export function podeEscrever(site, nome, refazer) {
  const atual = App.siteSaneado(site).series[nome];
  if (!atual) return true;
  if (atual.origem === 'revisada') return false;
  return refazer === true;
}

/* O material de uma série: os títulos no ar, na ordem da página, com o que o
 * modelo precisa para escolher. A fala entra INTEIRA — cortar em silêncio
 * mudaria o que o texto diz sem ninguém saber; a maior série cabe folgada. */
export function materialDaSerie(itens, nome, falas) {
  const pagina = App.paginaDaSerie(itens, nome);
  if (!pagina) return null;
  const titulos = pagina.itens.map((i) => {
    const videoId = i.fonte && i.fonte.videoId;
    const fala = (falas && (falas.get(i.id) || (videoId && falas.get(videoId)))) || [];
    return {
      id: i.id,
      titulo: i.titulo,
      episodio: i.episodio == null ? null : i.episodio,
      duracao: App.formatarDuracao(i) || null,
      sinopse: i.sinopse || '',
      capitulos: App.capitulos(i).map((c) => ({ inicio: c.inicio, titulo: c.titulo })),
      fala: fala.map((b) => (Array.isArray(b) ? b[1] : '')).filter(Boolean).join(' ')
    };
  });
  return { nome, titulos };
}

export function textoDoMaterial(material) {
  const partes = [`Série: ${material.nome}`, `Títulos: ${material.titulos.length}`, ''];
  for (const t of material.titulos) {
    partes.push(`## ${t.titulo}`);
    partes.push(`id: ${t.id}`);
    if (t.duracao) partes.push(`duração: ${t.duracao}`);
    partes.push(`sinopse: ${t.sinopse || '(sem sinopse)'}`);
    partes.push(t.capitulos.length
      ? 'capítulos:\n' + t.capitulos.map((c) => `  - inicio ${c.inicio}: ${c.titulo}`).join('\n')
      : 'capítulos: nenhum');
    partes.push(`fala: ${t.fala || '(sem transcrição)'}`);
    partes.push('');
  }
  return partes.join('\n');
}

/* O formato da resposta, com os ids da série em `enum`: o modelo não tem como
 * devolver um id que não existe. O segundo do capítulo não cabe num `enum`
 * por título, e por isso é conferido depois (`conferirResposta`). */
export function formatoDaResposta(material) {
  const ids = material.titulos.map((t) => t.id);
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sobre', 'comeco', 'momentos', 'temas'],
      properties: {
        sobre: { type: 'string' },
        comeco: { type: 'string', enum: ids },
        momentos: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'inicio'],
            properties: { id: { type: 'string', enum: ids }, inicio: { type: 'integer' } }
          }
        },
        temas: { type: 'array', items: { type: 'string' } }
      }
    }
  };
}

/* A resposta conferida contra a série: o que não confere cai e fica ANOTADO
 * em `avisos`, para quem lê o ensaio saber o que o modelo errou. Devolve a
 * entrada no formato de `site.series[nome]`, sempre `origem: 'auto'`. */
export function conferirResposta(itens, nome, resposta) {
  const avisos = [];
  const r = resposta && typeof resposta === 'object' ? resposta : {};
  const entrada = App.siteSaneado({ series: { [nome]: {
    sobre: r.sobre, comeco: r.comeco, momentos: r.momentos, temas: r.temas, origem: 'auto'
  } } }).series[nome] || { origem: 'auto' };

  const ap = App.apresentacaoDaSerie(itens, nome, { series: { [nome]: entrada } });
  const validos = new Set(((ap && ap.momentos) || []).map((m) => m.item.id + '@' + m.inicio));
  const momentos = (entrada.momentos || []).filter((m) => {
    if (validos.has(m.id + '@' + m.inicio)) return true;
    avisos.push(`momento fora de capítulo: ${m.id} em ${m.inicio} s`);
    return false;
  });
  if (momentos.length) entrada.momentos = momentos; else delete entrada.momentos;

  if (entrada.comeco && !(ap && ap.comeco)) {
    avisos.push(`começo que não é da série: ${entrada.comeco}`);
    delete entrada.comeco;
  }
  if (!entrada.sobre) avisos.push('sem texto');
  if (/^\s*(nesta|a|esta|este)\s+(série|conjunto)/i.test(entrada.sobre || '')) {
    avisos.push('o texto começa com a fórmula proibida');
  }
  const palavras = (entrada.sobre || '').split(/\s+/).filter(Boolean).length;
  if (palavras > 130) avisos.push(`texto com ${palavras} palavras`);

  return { entrada, avisos };
}
