/* scripts/lib/midia-gerada.mjs — o que fazer com a mídia gerada (capas, trailer, clipe): registrar como
 * SUGESTÃO, publicar só depois de a pessoa aceitar, e entregar o arquivo ao destino.
 *
 * Regra do M9: nada gerado vai ao ar sem ação humana. Por isso há dois campos no item do catálogo:
 *
 *   item.midia_sugerida  o que os scripts geraram; revisado:false; NÃO aparece no site.
 *   item.midia_gerada    o que a pessoa aceitou; é o que `mesclarMidiaGerada` põe em `item.midia`
 *                        (`clipe`, `trailer`), e o fundo do destaque (core/site/destaque-fundo.js) passa a usar.
 *
 * Proveniência em cada peça: { origem: 'ia'|'automatica', modelo, data, revisado }. Capa por template e
 * recorte de trailer pelo ffmpeg são 'automatica'; o que o modelo de linguagem escolheu (trechos) é 'ia'.
 *
 * Destino do arquivo (o provedor de vídeo não aceita clipe hoje: `capacidades().clipe` é false em todos):
 *   'pasta'  copia para uma pasta local (padrão; a pessoa publica como quiser). Nunca dentro do repositório.
 *   'r2'     envia ao bucket R2 do cliente com `wrangler r2 object put` (opcional, custa centavos; ver docs/ia.md).
 * Funções puras onde dá, para testar sem rede e sem ffmpeg.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { executar, arred } from './ffmpeg.mjs';

export const MIDIA_LIMITES = Object.freeze({ clipeMinSeg: 6, clipeMaxSeg: 10, clipeMaxBytes: 4_000_000, trailerMaxSeg: 60 });

/** `{ origem, modelo, data, revisado:false }`. Quem aceita troca para `revisado:true`. */
export function proveniencia({ origem = 'automatica', modelo = null, data } = {}) {
  if (!['ia', 'automatica'].includes(origem)) throw new Error('origem inválida: ' + origem);
  return { origem, modelo: modelo || null, data: data || new Date().toISOString(), revisado: false };
}

/** Confere um clipe pronto contra os limites; devolve a lista de problemas (vazia = ok). */
export function conferirClipe({ duracao, bytes, temAudio }) {
  const p = [];
  if (!(duracao >= MIDIA_LIMITES.clipeMinSeg - 0.05 && duracao <= MIDIA_LIMITES.clipeMaxSeg + 0.05)) p.push(`duração ${duracao} s fora de ${MIDIA_LIMITES.clipeMinSeg} a ${MIDIA_LIMITES.clipeMaxSeg} s`);
  if (!(bytes > 0 && bytes <= MIDIA_LIMITES.clipeMaxBytes)) p.push(`tamanho ${bytes} bytes acima de ${MIDIA_LIMITES.clipeMaxBytes}`);
  if (temAudio) p.push('o clipe tem faixa de áudio (precisa ser mudo)');
  return p;
}

/** Confere o trailer: até 60 s e pelo menos 1 trecho. */
export function conferirTrailer({ duracao, trechos }) {
  const p = [];
  if (!(duracao > 0 && duracao <= MIDIA_LIMITES.trailerMaxSeg + 0.05)) p.push(`duração ${duracao} s acima de ${MIDIA_LIMITES.trailerMaxSeg} s`);
  if (!Array.isArray(trechos) || !trechos.length) p.push('sem trechos');
  return p;
}

const copia = (o) => JSON.parse(JSON.stringify(o));

/**
 * Registra uma peça gerada como sugestão. `tipo`: 'capas' | 'trailer' | 'clipe'. Devolve uma CÓPIA do item
 * (não muda o original) e substitui a sugestão anterior do mesmo tipo. Não toca em `midia_gerada`.
 */
export function registrarSugestao(item, tipo, dados, prov) {
  if (!['capas', 'trailer', 'clipe'].includes(tipo)) throw new Error('tipo de mídia inválido: ' + tipo);
  const novo = copia(item || {});
  novo.midia_sugerida = novo.midia_sugerida || {};
  novo.midia_sugerida[tipo] = { ...dados, proveniencia: { ...(prov || proveniencia()), revisado: false } };
  return novo;
}

/**
 * A pessoa aceitou: a sugestão do `tipo` vira `midia_gerada` (com as URLs já publicadas em `urls`) e some da fila.
 * `urls`: { clipe, clipePoster } ou { trailer, trailerPoster }. Recusa URL que não é https.
 */
export function aceitarSugestao(item, tipo, urls, { quando = new Date().toISOString() } = {}) {
  const sug = item && item.midia_sugerida && item.midia_sugerida[tipo];
  if (!sug) throw new Error(`não há sugestão de ${tipo} neste título`);
  if (tipo === 'capas') throw new Error('capa se aceita pelo envio da imagem escolhida (capas-legendas.mjs), não por URL');
  for (const [k, v] of Object.entries(urls || {})) {
    if (v != null && !/^https:\/\/[^\s]+$/.test(String(v))) throw new Error(`${k}: precisa ser um endereço https`);
  }
  if (!urls || !urls[tipo]) throw new Error(`falta a URL de ${tipo}`);
  const novo = copia(item);
  novo.midia_gerada = novo.midia_gerada || {};
  Object.assign(novo.midia_gerada, tipo === 'clipe' ? { clipe: urls.clipe, clipePoster: urls.clipePoster || null } : { trailer: urls.trailer, trailerPoster: urls.trailerPoster || null });
  novo.midia_gerada.proveniencia = { ...sug.proveniencia, revisado: true, revisadoEm: quando };
  delete novo.midia_sugerida[tipo];
  if (!Object.keys(novo.midia_sugerida).length) delete novo.midia_sugerida;
  return novo;
}

/** Descartar: some da fila, sem publicar nada. */
export function descartarSugestao(item, tipo) {
  const novo = copia(item || {});
  if (novo.midia_sugerida) { delete novo.midia_sugerida[tipo]; if (!Object.keys(novo.midia_sugerida).length) delete novo.midia_sugerida; }
  return novo;
}

/**
 * O pedaço que o Worker precisa para o fundo de vídeo funcionar: devolve `midia` com `clipe` (e `trailer`)
 * vindos de `item.midia_gerada`, SÓ se a pessoa já aceitou (`revisado:true`) e a URL é https. Não sobrescreve
 * um `clipe` que o adaptador do provedor já tenha entregado. Função pura, sem efeito colateral.
 * (O Worker não importa de scripts/: `comMidia` em core/worker/_lib/provedores/index.js aplica esta mesma regra.)
 */
export function mesclarMidiaGerada(midia, item) {
  const g = item && item.midia_gerada;
  if (!midia || !g || !g.proveniencia || g.proveniencia.revisado !== true) return midia;
  const https = (u) => typeof u === 'string' && /^https:\/\//.test(u);
  const saida = { ...midia };
  if (https(g.clipe) && !saida.clipe) saida.clipe = g.clipe;
  if (https(g.trailer) && !saida.trailer) saida.trailer = g.trailer;
  return saida;
}

/* ---------- destino ---------- */

/** Chave do objeto no bucket: `midia/<id>/<arquivo>`, só com caracteres seguros (o id vem do catálogo). */
export function chaveDeObjeto(idItem, nomeArquivo) {
  const limpa = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').replace(/^-+|-+$/g, '').slice(0, 80);
  const id = limpa(idItem); const nome = limpa(nomeArquivo);
  if (!id || !nome) throw new Error('id do título ou nome do arquivo vazio');
  return `midia/${id}/${nome}`;
}

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/**
 * Escolhe o destino. Hoje nenhum adaptador de provedor aceita clipe (`capacidades().clipe` false), então só
 * existem 'pasta' e 'r2'. Se um dia o contrato ganhar `enviarClipe`, é aqui que 'provedor' passa a existir.
 */
export function escolherDestino({ destino, capacidades } = {}) {
  const d = destino || 'pasta';
  if (d === 'provedor') {
    if (capacidades && capacidades.clipe) throw new Error('o contrato dos provedores ainda não tem `enviarClipe`; use --destino r2 ou pasta');
    throw new Error('o provedor de vídeo escolhido não aceita clipe; use --destino r2 ou pasta');
  }
  if (!['pasta', 'r2'].includes(d)) throw new Error('destino inválido: ' + d + ' (use pasta ou r2)');
  return d;
}

/** Copia para uma pasta de saída e devolve o caminho. Recusa pasta dentro do repositório (mídia não se versiona). */
export async function entregarNaPasta(arquivo, pastaSaida, nome, { raiz } = {}) {
  const destino = path.resolve(pastaSaida);
  if (raiz) {
    const rel = path.relative(path.resolve(raiz), destino);
    const dentro = !rel.startsWith('..') && !path.isAbsolute(rel);
    const permitida = dentro && /^(dados|data|tmp|saida)(\/|\\|$)/.test(rel);
    if (dentro && !permitida) throw new Error(`não grave mídia dentro do repositório (${rel}); use uma pasta fora dele ou dados/ (ignorada pelo git)`);
  }
  await mkdir(destino, { recursive: true });
  const alvo = path.join(destino, nome);
  await copyFile(arquivo, alvo);
  return alvo;
}

/**
 * Envia ao R2 pelo wrangler (`wrangler r2 object put bucket/chave --file ... --content-type ... --remote`) e devolve a URL
 * pública `urlBase/chave`. A pessoa precisa ter o `wrangler login` feito (ou CLOUDFLARE_API_TOKEN no executor);
 * nenhum segredo passa por aqui. `urlBase` é o domínio público do bucket (r2.dev ou domínio próprio), https.
 * `executarFn` é injetável para teste. NÃO CONFIRMADO ao vivo: a flag `--remote` do `r2 object put` (wrangler 4).
 */
export async function enviarParaR2({ bucket, chave, arquivo, urlBase, executarFn = executar }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(String(bucket || ''))) throw new Error('nome de bucket R2 inválido');
  if (!/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(String(urlBase || ''))) throw new Error('a URL pública do bucket precisa ser https (ex.: https://midia.seudominio.com)');
  const ext = path.extname(arquivo).toLowerCase();
  const tipo = MIME[ext];
  if (!tipo) throw new Error('tipo de arquivo não aceito: ' + ext);
  const s = await stat(arquivo);
  await executarFn('npx', ['--yes', 'wrangler@4', 'r2', 'object', 'put', `${bucket}/${chave}`, '--file', arquivo, '--content-type', tipo, '--cache-control', 'public, max-age=31536000, immutable', '--remote']);
  return { url: urlBase.replace(/\/+$/, '') + '/' + chave, bytes: s.size, tipo };
}

/** Custo estimado do armazenamento+entrega no R2, só para avisar (US$; entrega de saída grátis no R2). */
export function custoR2Mensal({ bytesTotal }) {
  const gb = bytesTotal / 1e9;
  return { usdPorMes: arred(Math.max(0, gb - 10) * 0.015, 4), gratisAte: '10 GB de armazenamento', observacao: 'sem cobrança de saída (egress) no R2; operações têm cota grátis' };
}
