/* scripts/lib/ia-trechos.mjs — liga o `trailer.mjs` ao `gerarTexto` do M9 (core/worker/_lib/ia/): o modelo ESCOLHE os trechos
 * do trailer lendo a legenda; o corte é do ffmpeg (grátis).
 *
 * Regras (as mesmas do resto da IA):
 *   - CUSTO ANTES: estima pelo site (`POST /api/ia { acao:'estimar', tarefas:['trechos-trailer'] }`), mostra, e só segue com `--yes`.
 *     Lote acima do orçamento do mês é recusado. O gasto real vai ao site (orçamento remoto).
 *   - O recurso "trailer" precisa estar ligado na tela IA do /admin (tudo nasce desligado).
 *   - Resposta validada contra o schema e as regras da tarefa (cada trecho de 3 a 20 s, dentro do vídeo, em ordem, somando perto do alvo),
 *     com 1 retentativa; depois disso, ou se a legenda não sustenta (INSUFICIENTE), devolve `null` e o trailer.mjs usa a amostra
 *     automática (que não custa nada). NADA É GRAVADO aqui: só se devolve a lista de trechos.
 * Funções com tudo injetável para testar sem rede. */
import { gerarTexto } from '../../core/worker/_lib/ia/texto.js';
import { configDeTexto } from '../../core/worker/_lib/ia/config.js';
import { analisarLegenda, juntarSemRepetir, emBlocos } from '../../core/worker/_lib/ia/srt.js';
import { orcamentoRemoto } from './ia-cliente.mjs';

const usd = (n) => 'US$ ' + (Math.round(n * 10000) / 10000).toFixed(4);

/** Legenda (SRT/VTT) ou texto corrido -> blocos [{inicio, texto}]. Texto sem tempos vira lista vazia (o modelo não escolheria tempos). */
export function blocosDeTexto(texto) {
  const cues = juntarSemRepetir(analisarLegenda(texto));
  return cues.length ? emBlocos(cues, 30) : [];
}

/**
 * `(transcricao, { duracao, alvoSeg }) => { resultado:[{inicio,fim,motivo}], modelo, custoUSD } | null`
 * `null` = a legenda não sustenta uma escolha (INSUFICIENTE) ou não há tempos. Lança se o provedor falhou (o trailer.mjs avisa e usa a amostra).
 */
export function criarEscolhedorDeTrechos({ config, env, fetch, orcamento, titulo = '', serie = '', blocos = null, agora }) {
  return async (transcricao, contexto = {}) => {
    const lista = blocos && blocos.length ? blocos : blocosDeTexto(transcricao);
    if (!lista.length) return null;
    const r = await gerarTexto({
      tarefa: 'trechos-trailer',
      entrada: { titulo, serie, blocos: lista, transcricao: lista.map((b) => b.texto).join(' '), duracaoSeg: Number(contexto.duracao) || 0, alvoSeg: Number(contexto.alvoSeg) || 45 },
      config, env, fetch, orcamento, agora
    });
    if (r.estado === 'ok') return { resultado: r.valor, modelo: (r.proveniencia && r.proveniencia.modelo) || null, custoUSD: r.custoUSD };
    if (r.estado === 'insuficiente') return null;
    throw new Error((r.codigo || 'falhou') + (r.detalhe ? ' (' + r.detalhe + ')' : ''));
  };
}

/**
 * O portão de custo do trailer: confere chave, recurso ligado, estimativa, orçamento e o `--yes`.
 * Devolve { escolherPara, orcamento, estimativa } quando liberado, ou { codigo, resumo } (1 falhou, 3 falta confirmação, 0 só simulou).
 */
export async function prepararEscolhedor({ opcoes, cliente, config, env, fetch, ids, log = console.log }) {
  const texto = configDeTexto(config, env);
  if (texto.provedor === 'nenhum') return { codigo: 1, resumo: 'a IA de textos está desligada (ia.textos.provedor = "nenhum" em config/site.json). Sem --ia o trailer usa a amostra automática, de graça.' };
  if (!texto.pronto) return { codigo: 1, resumo: 'falta a chave do provedor "' + texto.provedor + '": guarde-a como segredo e aponte ia.textos.chave para {"$env":"NOME"}.' };
  if (!cliente) return { codigo: 1, resumo: 'para usar a IA o orçamento do mês precisa ser conferido: defina APP_SITE_URL e APP_SENHA (login do superadmin).' };
  const estado = await cliente.estado();
  if (!(estado.recursos && estado.recursos.trailer && estado.recursos.trailer.ligado)) return { codigo: 1, resumo: 'o recurso "Trailer e clipe de fundo" está desligado na tela IA do /admin.' };
  const { estimativa, decisao } = await cliente.estimar({ tarefas: ['trechos-trailer'], ids });
  log('Estimativa da escolha dos trechos (valores de ' + estimativa.dataDosPrecos + (estimativa.precosConfirmados ? '' : '; há preço NÃO conferido na fonte oficial') + '): ' + usd(estimativa.totalUSD) + ' (sobram ' + usd(estimativa.restanteUSD) + ' no mês). O corte, o ffmpeg, é grátis.');
  if (!decisao.ok) return { codigo: 1, resumo: 'lote RECUSADO: custaria ' + usd(decisao.totalUSD) + ' e o mês só tem ' + usd(decisao.restanteUSD) + ' de orçamento. Nada foi feito.', estimativa };
  if (opcoes.simular) return { codigo: 0, resumo: '--simular: nada foi chamado.', estimativa };
  if (!opcoes.yes) return { codigo: 3, resumo: 'Isto vai gastar dinheiro (estimativa acima). Se concorda, rode de novo com --yes.', estimativa };
  const orcamento = orcamentoRemoto(cliente, estado.orcamento);
  /* `escolherPara({ titulo, serie, blocos })` dá o escolhedor de UM título (o orçamento é o mesmo para todos) */
  return { escolherPara: (por) => criarEscolhedorDeTrechos({ config, env, fetch, orcamento, ...(por || {}) }), orcamento, estimativa };
}
