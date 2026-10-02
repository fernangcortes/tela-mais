/* ia/sugestoes.js — a FILA de sugestões: o lugar onde tudo que a IA gera espera por uma pessoa.
 *
 * NADA GERADO É PUBLICADO SEM AÇÃO HUMANA. É a regra que este módulo existe para garantir, e a forma é simples:
 *   - `registrarSugestao` só escreve na fila (`ia:sug:<item>:<campo>` no KV). Nunca toca no catálogo.
 *   - `aceitar` é a ÚNICA função que passa uma sugestão para o catálogo, e passa pelo `gravarCatalogo` (o mesmo caminho do
 *     PUT da mesa e do MCP): permissão por campo, 409 se o catálogo mudou, histórico com desfazer. Quem chama é uma conta.
 *   - `descartar` joga fora. As decisões ficam num registro curto (`ia:decisoes`), os dados mudados ficam no histórico.
 *
 * UMA sugestão pendente por (título, campo): gerar de novo SUBSTITUI a pendente (a nova vem do mesmo vídeo, com o modelo de
 * agora). Cada sugestão leva a PROVENIÊNCIA: { origem:'ia', modelo, provedor, tarefa, data, revisado:false }. */
import { campoValido, ehCampoDeLegenda, idiomaDaLegenda, validarValor, CAMPOS, valorAtual } from './campos.js';
import { carimboAceito } from './proveniencia.js';
import { lerCatalogo as lerCatalogoPadrao, gravarCatalogo as gravarCatalogoPadrao } from '../../api/catalogo.js';

export const PREFIXO_DA_FILA = 'ia:sug:';
export const CHAVE_DECISOES = 'ia:decisoes';
const MAX_DECISOES = 200;

const relogio = (agora) => (typeof agora === 'function' ? agora() : Number(agora) || Date.now());
export const chaveDaSugestao = (itemId, campo) => PREFIXO_DA_FILA + encodeURIComponent(itemId) + ':' + campo;

const recusa = (status, codigo, params, extras) => ({ ok: false, status, codigo, params: params || null, extras: extras || null });

async function lerDoc(kv, chave) {
  try { return await kv.get(chave, 'json'); } catch (e) { return null; }
}

/* Entra na fila. Confere o campo e o valor; NÃO escreve no catálogo. */
export async function registrarSugestao(env, { itemId, campo, valor, proveniencia, custoUSD = 0, atual = null, agora = Date.now }) {
  if (!env || !env.CATALOGO) return recusa(500, 'kv-nao-vinculado');
  if (typeof itemId !== 'string' || !itemId || itemId.length > 200) return recusa(400, 'ia-sugestao-invalida', { detalhe: 'itemId' });
  if (!campoValido(campo)) return recusa(400, 'ia-sugestao-invalida', { detalhe: 'campo' });
  const problema = validarValor(campo, valor);
  if (problema) return recusa(400, 'ia-sugestao-invalida', { detalhe: problema });
  /* Mídia cortada só pelo ffmpeg (sem modelo) nasce 'automatica'; todo o resto vem de modelo ('ia'). */
  const origemOk = proveniencia && (proveniencia.origem === 'ia' || (proveniencia.origem === 'automatica' && CAMPOS[campo] && CAMPOS[campo].midia === true));
  if (!origemOk) return recusa(400, 'ia-sugestao-invalida', { detalhe: 'proveniencia' });
  const doc = {
    itemId, campo, valor,
    /* o carimbo nasce sempre revisado:false, venha o que vier de fora */
    proveniencia: Object.assign({}, proveniencia, { revisado: false }),
    estado: 'pendente', criadaEm: new Date(relogio(agora)).toISOString(),
    custoUSD: Number(custoUSD) || 0, atualNaGeracao: atual
  };
  await env.CATALOGO.put(chaveDaSugestao(itemId, campo), JSON.stringify(doc));
  return { ok: true, sugestao: doc };
}

export async function lerSugestao(env, itemId, campo) {
  if (!env || !env.CATALOGO) return null;
  return lerDoc(env.CATALOGO, chaveDaSugestao(itemId, campo));
}

/* A fila, mais antiga primeiro. `itemId` e `campo` filtram. */
export async function listarSugestoes(env, { itemId, campo } = {}) {
  if (!env || !env.CATALOGO) return [];
  const prefixo = itemId ? PREFIXO_DA_FILA + encodeURIComponent(itemId) + ':' : PREFIXO_DA_FILA;
  const saida = [];
  let cursor;
  for (let volta = 0; volta < 20; volta++) {
    const pagina = await env.CATALOGO.list({ prefix: prefixo, cursor, limit: 1000 });
    for (const k of pagina.keys || []) {
      const d = await lerDoc(env.CATALOGO, k.name);
      if (d && d.estado === 'pendente' && (!campo || d.campo === campo)) saida.push(d);
    }
    if (pagina.list_complete !== false || !pagina.cursor) break;
    cursor = pagina.cursor;
  }
  return saida.sort((a, b) => String(a.criadaEm).localeCompare(String(b.criadaEm)));
}

export async function contarPendentes(env) {
  return (await listarSugestoes(env)).length;
}

async function anotarDecisao(env, linha) {
  try {
    const atual = (await lerDoc(env.CATALOGO, CHAVE_DECISOES)) || [];
    await env.CATALOGO.put(CHAVE_DECISOES, JSON.stringify([linha].concat(Array.isArray(atual) ? atual : []).slice(0, MAX_DECISOES)));
  } catch (e) { /* o registro é memória: não derruba a decisão */ }
}

export async function descartar(env, { itemId, campo, conta, agora = Date.now }) {
  const doc = await lerSugestao(env, itemId, campo);
  if (!doc || doc.estado !== 'pendente') return recusa(404, 'ia-sugestao-nao-encontrada');
  await env.CATALOGO.delete(chaveDaSugestao(itemId, campo));
  await anotarDecisao(env, { itemId, campo, decisao: 'descartada', por: (conta && conta.usuario) || null, em: new Date(relogio(agora)).toISOString(), modelo: doc.proveniencia && doc.proveniencia.modelo });
  return { ok: true, decisao: 'descartada' };
}

const mesmoValor = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Aceita: passa a sugestão (ou a EDIÇÃO da pessoa) para o catálogo, pelo caminho validado.
 *   edicao             valor que a pessoa digitou no lugar do sugerido (confere com as mesmas regras do campo)
 *   incluirTagsNovas   só para o campo `tags`
 *   provedor           o adaptador de vídeo (só a legenda precisa: a faixa vai para o provedor)
 *   lerCatalogo/gravarCatalogo   injetáveis nos testes */
export async function aceitar(env, { itemId, campo, conta, edicao, incluirTagsNovas = false, provedor, agora = Date.now, lerCatalogo = lerCatalogoPadrao, gravarCatalogo = gravarCatalogoPadrao }) {
  if (!conta) return recusa(401, 'nao-autorizado');
  const doc = await lerSugestao(env, itemId, campo);
  if (!doc || doc.estado !== 'pendente') return recusa(404, 'ia-sugestao-nao-encontrada');

  const editado = edicao !== undefined && edicao !== null && !mesmoValor(edicao, doc.valor);
  const valor = editado ? edicao : doc.valor;
  if (editado) {
    const problema = validarValor(campo, valor);
    if (problema) return recusa(400, 'ia-sugestao-invalida', { detalhe: problema });
  }

  const catalogo = await lerCatalogo(env);
  const item = catalogo && (catalogo.itens || []).find((i) => i && i.id === itemId);
  if (!item) return recusa(404, 'ia-titulo-nao-encontrado');

  const carimbo = carimboAceito(doc.proveniencia, { editado, quem: conta.usuario, agora });
  const novoItem = JSON.parse(JSON.stringify(item));

  if (ehCampoDeLegenda(campo)) {
    /* A legenda traduzida vai para o PROVEDOR de vídeo; o catálogo só guarda o carimbo. Se o provedor recusar, nada é anotado. */
    if (!provedor || typeof provedor.enviarLegenda !== 'function') return recusa(501, 'ia-sugestao-invalida', { detalhe: 'provedor-sem-legenda' });
    const idioma = idiomaDaLegenda(campo);
    const idDoVideo = (item.fonte && item.fonte.id) || null;
    if (!idDoVideo) return recusa(400, 'ia-sugestao-invalida', { detalhe: 'titulo-sem-video' });
    try {
      await provedor.enviarLegenda(idDoVideo, { idioma, rotulo: idioma, srt: valor });
    } catch (e) {
      return { ok: false, status: 502, provedorErro: e };
    }
  } else {
    CAMPOS[campo].aplicar(novoItem, valor, { editado, incluirTagsNovas, carimbo });
  }
  novoItem.ia = Object.assign({}, novoItem.ia || {}, { [campo]: carimbo });

  const corpo = Object.assign({}, catalogo, { itens: catalogo.itens.map((i) => (i.id === itemId ? novoItem : i)) });
  const resposta = await gravarCatalogo({ env, corpo, conta });
  let saida = null;
  try { saida = await resposta.json(); } catch (e) { saida = null; }
  if (resposta.status !== 200) {
    const { codigo, params, erro, mensagem, ...resto } = saida || {};
    return recusa(resposta.status, codigo || 'erro-interno', params, resto);
  }

  await env.CATALOGO.delete(chaveDaSugestao(itemId, campo));
  await anotarDecisao(env, { itemId, campo, decisao: editado ? 'aceita-editada' : 'aceita', por: conta.usuario || null, em: carimbo.aceitoEm, modelo: carimbo.modelo, rev: saida.rev });
  return { ok: true, decisao: editado ? 'aceita-editada' : 'aceita', rev: saida.rev, mudancas: saida.mudancas, proveniencia: carimbo };
}

/* A fila JÁ com o valor de hoje ao lado (o lado a lado do /admin). `itens` é o catálogo lido uma vez. */
export function comLadoALado(sugestoes, catalogo) {
  const porId = new Map(((catalogo && catalogo.itens) || []).map((i) => [i.id, i]));
  return sugestoes.map((s) => {
    const item = porId.get(s.itemId) || null;
    const atual = valorAtual(s.campo, item);
    return Object.assign({}, s, {
      titulo: item ? item.titulo : null,
      atual,
      /* a pessoa mexeu no campo depois que a sugestão foi feita: o /admin avisa antes de sobrescrever */
      mudouDesde: s.atualNaGeracao !== null && s.atualNaGeracao !== undefined && atual !== null && !mesmoValor(s.atualNaGeracao, atual)
    });
  });
}
