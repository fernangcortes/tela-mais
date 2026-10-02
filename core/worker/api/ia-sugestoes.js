/* /api/ia-sugestoes — a FILA de sugestões da IA: o que foi gerado e espera uma pessoa decidir.
 *
 *   GET [?itemId=&campo=]     equipe  a fila, com o valor de HOJE ao lado (o lado a lado do /admin) e `mudouDesde` (a pessoa
 *                                     mexeu no campo depois que a sugestão foi gerada). Legenda longa vem cortada, com
 *                                     `truncado`; com `itemId` e `campo` o valor vem inteiro.
 *   POST { itemId, campo, valor, proveniencia, custoUSD? }
 *                             super   coloca uma sugestão na fila (é por aqui que os scripts de lote entregam o que geraram).
 *                                     NUNCA toca no catálogo.
 *   PUT  { itemId, campo, edicao?, incluirTagsNovas? }
 *                             equipe  ACEITA: passa a sugestão (ou a edição da pessoa) para o catálogo pelo mesmo caminho do PUT
 *                                     da mesa: permissão por campo, 409 se o catálogo mudou, histórico com desfazer. Pede a
 *                                     permissão `conteudo`. Aceitar sem editar NÃO marca como revisado; editar marca.
 *   DELETE { itemId, campo }  equipe  descarta (permissão `conteudo`).
 *
 * Esta rota é a ÚNICA porta de uma sugestão da IA para o catálogo (a outra é a mesma função, `aceitar`, que o MCP pode chamar). */
import { json, erro, pode, semPermissao } from '../_lib/sessao.js';
import { lerCorpo } from '../_lib/contas-fluxo.js';
import { lerCatalogo } from './catalogo.js';
import { respostaDeErro } from '../_lib/provedores/index.js';
import { registrarSugestao, aceitar, descartar, listarSugestoes, lerSugestao, comLadoALado } from '../_lib/ia/index.js';

const CORTE_DA_LEGENDA = 600;

function resumir(s) {
  if (typeof s.valor === 'string' && s.valor.length > CORTE_DA_LEGENDA * 2) {
    return Object.assign({}, s, { valor: s.valor.slice(0, CORTE_DA_LEGENDA), valorTamanho: s.valor.length, truncado: true });
  }
  return s;
}

function resposta(r) {
  if (r.ok) return json(200, r);
  if (r.provedorErro) return respostaDeErro(erro, r.provedorErro);
  return erro(r.status, r.codigo, r.params, r.extras);
}

export async function onRequestGet({ request, env }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const p = new URL(request.url).searchParams;
  const itemId = p.get('itemId') || undefined;
  const campo = p.get('campo') || undefined;
  const catalogo = await lerCatalogo(env);
  const fila = comLadoALado(await listarSugestoes(env, { itemId, campo }), catalogo);
  return json(200, { total: fila.length, sugestoes: itemId && campo ? fila : fila.map(resumir) });
}

export async function onRequestPost({ request, env }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  const catalogo = await lerCatalogo(env);
  if (!catalogo || !(catalogo.itens || []).some((i) => i && i.id === corpo.itemId)) return erro(404, 'ia-titulo-nao-encontrado');
  return resposta(await registrarSugestao(env, {
    itemId: corpo.itemId, campo: corpo.campo, valor: corpo.valor, proveniencia: corpo.proveniencia, custoUSD: corpo.custoUSD,
    atual: corpo.atual === undefined ? null : corpo.atual
  }));
}

export async function onRequestPut({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  if (!pode(data.conta, 'conteudo')) return semPermissao('conteudo');
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  return resposta(await aceitar(env, {
    itemId: corpo.itemId, campo: corpo.campo, conta: data.conta, edicao: corpo.edicao,
    incluirTagsNovas: corpo.incluirTagsNovas === true, provedor: data.provedor
  }));
}

export async function onRequestDelete({ request, env, data }) {
  if (!env.CATALOGO) return erro(500, 'kv-nao-vinculado');
  if (!pode(data.conta, 'conteudo')) return semPermissao('conteudo');
  const corpo = await lerCorpo(request);
  /* DELETE sem corpo (ou com corpo vazio): nada a descartar */
  if (!corpo || typeof corpo.itemId !== 'string') return erro(400, 'corpo-invalido');
  const existe = await lerSugestao(env, corpo.itemId, corpo.campo);
  if (!existe) return erro(404, 'ia-sugestao-nao-encontrada');
  return resposta(await descartar(env, { itemId: corpo.itemId, campo: corpo.campo, conta: data.conta }));
}
