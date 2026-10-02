/* /api/ia — a IA de conteúdo (M9): o retrato, a estimativa de custo, a geração de sugestões e o liga/desliga por recurso.
 *
 *   GET                       equipe  o retrato: provedor e modelo de cada coisa, se a chave existe (SÓ o booleano), o que está
 *                                     ligado, o orçamento do mês, a tabela de preços (com a data) e quantas sugestões esperam
 *   POST { acao:'estimar', tarefas, ids?, idiomasDestino? }
 *                             equipe  a estimativa ANTES do lote e se cabe no orçamento (não chama ninguém, não grava nada)
 *   POST { acao:'gerar', tarefas, ids, idiomasDestino? }
 *                             super   gera e põe na FILA de sugestões (até 3 títulos por chamada). Recusa o lote que passa do
 *                                     orçamento. Nada vai ao ar: quem decide é uma pessoa, em /api/ia-sugestoes
 *   POST { acao:'disparar', tarefa, ids, subtarefas?, idiomas? }
 *                             super   dispara o fluxo do GitHub Actions (gerar-midia.yml) que roda os scripts com ffmpeg. Desligado
 *                                     por padrão (ia.executor.github.ligado); o token é segredo do Worker e nunca sai daqui
 *   POST { acao:'gasto', usd, provedor, modelo, tarefa, ... }
 *                             super   registra um gasto feito FORA do Worker (os scripts de lote chamam isto)
 *   PUT  { recursos: { 'sinopse-curta': true, ... } }
 *                             super   liga e desliga cada recurso (tudo nasce desligado)
 *
 * O conteúdo (títulos, transcrição) vai ao provedor de IA escolhido: só o Workers AI fica dentro da Cloudflare do cliente. */
import { json, erro, pode, semPermissao } from '../_lib/sessao.js';
import { lerCorpo } from '../_lib/contas-fluxo.js';
import { lerCatalogo } from './catalogo.js';
import { opcoesDeAssinatura, respostaDeErro } from '../_lib/provedores/index.js';
import { ErroProvedor } from '../_lib/provedores/contrato.js';
import {
  estadoDaIA, lerLigados, gravarLigados, estimarLote, criarOrcamento, gerarSugestoes, recursosLigados, TAREFAS_LIGAVEIS, NOMES_DE_TAREFAS,
  entradasDoFluxo, dispararFluxo
} from '../_lib/ia/index.js';

export const MAX_TITULOS_POR_GERACAO = 3;
const MAX_TITULOS_POR_ESTIMATIVA = 2000;
const TAREFAS_DE_TEXTO = NOMES_DE_TAREFAS.filter((t) => t !== 'trechos-trailer');
/* `transcricao` só se estima aqui (quem transcreve é script ou provedor de vídeo, não o Worker). */
const TAREFAS_ESTIMAVEIS = TAREFAS_DE_TEXTO.concat(['transcricao', 'trechos-trailer']);

function tarefasDoPedido(corpo, permitidas) {
  const lista = Array.isArray(corpo.tarefas) ? corpo.tarefas.filter((t) => typeof t === 'string') : [];
  if (!lista.length || lista.some((t) => !permitidas.includes(t))) return null;
  return Array.from(new Set(lista));
}

const idsDoPedido = (corpo, max) => (Array.isArray(corpo.ids) ? corpo.ids.filter((i) => typeof i === 'string' && i).slice(0, max) : []);

export async function onRequestGet({ env, config, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const estado = await estadoDaIA({ env, config: config || {} });
  /* O que o /admin precisa para o botão: o superadmin pode gerar; a equipe só revisa. */
  estado.quemPode = { gerar: Boolean(data && data.conta && data.conta.super === true), revisar: pode(data && data.conta, 'conteudo') };
  return json(200, estado);
}

export async function onRequestPost({ request, env, data, config, modo }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const cfg = config || {};
  const ehSuper = Boolean(data && data.conta && data.conta.super === true);

  if (corpo.acao === 'estimar' || corpo.acao === 'gerar') {
    const gerar = corpo.acao === 'gerar';
    if (gerar && !ehSuper) return erro(403, 'so-superadmin');
    if (!gerar && !pode(data.conta, 'conteudo')) return semPermissao('conteudo');
    const tarefas = tarefasDoPedido(corpo, gerar ? TAREFAS_DE_TEXTO : TAREFAS_ESTIMAVEIS);
    if (!tarefas) return erro(400, 'ia-tarefa-invalida');

    const catalogo = await lerCatalogo(env);
    const todos = (catalogo && catalogo.itens) || [];
    const pedidos = idsDoPedido(corpo, gerar ? MAX_TITULOS_POR_GERACAO : MAX_TITULOS_POR_ESTIMATIVA);
    if (gerar && !pedidos.length) return erro(400, 'ia-entrada-invalida');
    const escolhidos = pedidos.length ? todos.filter((i) => pedidos.includes(i.id)) : todos.slice(0, MAX_TITULOS_POR_ESTIMATIVA);
    if (gerar && escolhidos.length !== pedidos.length) return erro(404, 'ia-titulo-nao-encontrado');

    const idiomasDestino = Array.isArray(corpo.idiomasDestino) ? corpo.idiomasDestino.filter((i) => typeof i === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(i)).slice(0, 5) : [];
    const orcamento = criarOrcamento({ env, config: cfg });
    const estimativa = estimarLote({
      config: cfg, env, tarefas, idiomasDestino: idiomasDestino.length || 1, gastoDoMesUSD: await orcamento.gastoDoMes(),
      itens: escolhidos.map((i) => ({ id: i.id, duracaoSeg: Number(i.duracao_seg) || null }))
    });
    const decisao = await orcamento.verificarLote(estimativa);
    if (!gerar) return json(200, { estimativa, decisao });

    /* Recurso que ninguém ligou vale como desligado: o padrão é "desligado" (regra 5). */
    const efetivos = {};
    const ligadosPeloAdmin = await lerLigados(env);
    for (const [t, v] of Object.entries(recursosLigados(cfg, ligadosPeloAdmin))) efetivos[t] = v.ligado;
    if (estimativa.avisos.includes('ia-desligada')) return erro(409, 'ia-desligada');
    if (!decisao.ok) return erro(402, 'ia-orcamento-estourado', { total: decisao.totalUSD, restante: decisao.restanteUSD }, { decisao, estimativa });

    const referer = new URL(request.url).origin + '/';
    const opcoesLegenda = opcoesDeAssinatura(data, {});
    const resultados = [];
    for (const item of escolhidos) {
      try {
        const r = await gerarSugestoes({
          env, config: cfg, item, tarefas, idiomasDestino, provedor: data.provedor, orcamento, referer, opcoesLegenda, ligados: efetivos
        });
        resultados.push({ id: item.id, resultados: r });
      } catch (e) {
        if (e instanceof ErroProvedor) return respostaDeErro(erro, e);
        throw e;
      }
    }
    return json(200, { ok: true, estimativa, resultados, orcamento: { gastoUSD: await orcamento.gastoDoMes(), limiteUSD: orcamento.limiteUSD } });
  }

  /* O botão "gerar no GitHub": só o superadmin, só com o executor ligado e o token guardado; devolve 202 (o trabalho roda lá). */
  if (corpo.acao === 'disparar') {
    if (!ehSuper) return erro(403, 'so-superadmin');
    const pedido = entradasDoFluxo({ tarefa: corpo.tarefa, ids: corpo.ids, subtarefas: corpo.subtarefas, idiomas: corpo.idiomas, usarIa: corpo.usarIa });
    if (!pedido.entradas) return erro(400, 'ia-entrada-invalida', null, { motivo: pedido.motivo });
    const r = await dispararFluxo({ config: cfg, env, entradas: pedido.entradas });
    if (!r.ok) return erro(r.status, r.codigo, null, r.httpStatus ? { httpStatus: r.httpStatus } : undefined);
    return json(202, { ok: true, repositorio: r.repositorio, fluxo: r.fluxo, ref: r.ref, entradas: pedido.entradas });
  }

  if (corpo.acao === 'gasto') {
    if (!ehSuper) return erro(403, 'so-superadmin');
    const usd = Number(corpo.usd);
    if (!(usd >= 0) || usd > 1000) return erro(400, 'ia-entrada-invalida');
    const texto = (v) => (typeof v === 'string' ? v.slice(0, 80) : null);
    const orcamento = criarOrcamento({ env, config: cfg });
    const doc = await orcamento.registrar({
      usd, provedor: texto(corpo.provedor), modelo: texto(corpo.modelo), tarefa: texto(corpo.tarefa),
      entradaTokens: Number(corpo.entradaTokens) || 0, saidaTokens: Number(corpo.saidaTokens) || 0, minutos: Number(corpo.minutos) || 0
    });
    return json(200, { ok: true, gastoUSD: doc ? doc.totalUSD : null, limiteUSD: orcamento.limiteUSD, restanteUSD: await orcamento.restanteUSD() });
  }

  return erro(400, 'acao-invalida');
}

export async function onRequestPut({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const corpo = await lerCorpo(request);
  if (!corpo || !corpo.recursos || typeof corpo.recursos !== 'object' || Array.isArray(corpo.recursos)) return erro(400, 'corpo-invalido');
  const desconhecidos = Object.keys(corpo.recursos).filter((k) => !TAREFAS_LIGAVEIS.includes(k));
  if (desconhecidos.length) return erro(400, 'ia-tarefa-invalida', null, { desconhecidos });
  const r = await gravarLigados(env, corpo.recursos, data.conta && data.conta.usuario);
  return json(200, { ok: true, recursos: r.recursos, mudou: r.mudou });
}
