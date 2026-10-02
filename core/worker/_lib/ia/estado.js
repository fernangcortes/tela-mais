/* ia/estado.js — o retrato da IA para o /admin: o que está ligado, qual provedor e modelo, se a chave existe (só o booleano),
 * o orçamento do mês, a tabela de preços com a data e quantas sugestões esperam. Nada aqui devolve valor de segredo.
 *
 * Quem liga e desliga cada recurso é o superadmin, e isso mora no KV (`ia:ligados`), não no site.json: mudar de ideia não pede
 * deploy. TUDO NASCE DESLIGADO (regra 5: recurso pago nasce desligado). */
import { configDeTexto, configDeTranscricao, recursosLigados, TAREFAS_LIGAVEIS, PROVEDORES_TEXTO, PROVEDORES_TRANSCRICAO, MODELOS_SUGERIDOS, MODELOS_PADRAO, MODELOS_TRANSCRICAO_PADRAO } from './config.js';
import { criarOrcamento } from './orcamento.js';
import { tabelaDePrecos } from './precos.js';
import { contarPendentes } from './sugestoes.js';
import { retratoDoExecutor } from './executor.js';

export const CHAVE_LIGADOS = 'ia:ligados';

export async function lerLigados(env) {
  if (!env || !env.CATALOGO) return {};
  try {
    const doc = await env.CATALOGO.get(CHAVE_LIGADOS, 'json');
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc.recursos || {}) : {};
  } catch (e) { return {}; }
}

/* `patch` = { 'sinopse-curta': true, ... }. Só tarefas conhecidas e só booleanos; o resto é ignorado. */
export async function gravarLigados(env, patch, quem, agora = Date.now) {
  const atual = await lerLigados(env);
  const novo = Object.assign({}, atual);
  let mudou = 0;
  for (const t of TAREFAS_LIGAVEIS) {
    if (patch && typeof patch[t] === 'boolean' && novo[t] !== patch[t]) { novo[t] = patch[t]; mudou++; }
  }
  if (mudou) await env.CATALOGO.put(CHAVE_LIGADOS, JSON.stringify({ recursos: novo, por: quem || null, em: new Date(typeof agora === 'function' ? agora() : agora).toISOString() }));
  return { recursos: novo, mudou };
}

export async function estadoDaIA({ env, config, agora = Date.now }) {
  const texto = configDeTexto(config, env);
  const fala = configDeTranscricao(config, env);
  const ligados = await lerLigados(env);
  const orc = criarOrcamento({ env, config, agora });
  const mes = await orc.ler();
  const tabela = tabelaDePrecos(config);
  return {
    textos: { provedor: texto.provedor, modelo: texto.modelo, temChave: texto.temChave, pronto: texto.pronto, provedores: PROVEDORES_TEXTO, modelosSugeridos: MODELOS_SUGERIDOS, modelosPadrao: MODELOS_PADRAO },
    transcricao: { provedor: fala.provedor, modelo: fala.modelo, idioma: fala.idioma, temChave: fala.temChave, pronto: fala.pronto, provedores: PROVEDORES_TRANSCRICAO, modelosPadrao: MODELOS_TRANSCRICAO_PADRAO },
    estilo: texto.estilo,
    recursos: recursosLigados(config, ligados),
    orcamento: { limiteUSD: orc.limiteUSD, gastoUSD: mes.totalUSD, restanteUSD: Math.max(0, Math.round((orc.limiteUSD - mes.totalUSD) * 1e6) / 1e6), mes: mes.mes, chamadas: mes.chamadas, porProvedor: mes.porProvedor, porTarefa: mes.porTarefa, ultimos: mes.ultimos },
    precos: { data: tabela.data, texto: tabela.texto, transcricao: tabela.transcricao },
    pendentes: await contarPendentes(env),
    executor: { github: retratoDoExecutor(config, env) },
    midia: { destino: (config && config.ia && config.ia.midia && config.ia.midia.destino) || 'pasta', urlBase: (config && config.ia && config.ia.midia && config.ia.midia.urlBase) || null },
    /* o conteúdo (transcrição, títulos) SAI da conta do cliente e vai ao provedor escolhido; só o Workers AI fica na Cloudflare */
    privacidade: { conteudoSaiDaConta: texto.provedor !== 'nenhum' && texto.provedor !== 'workers-ai' || (fala.provedor !== 'nenhum' && fala.provedor !== 'workers-ai-whisper' && fala.provedor !== 'provedor-de-video') }
  };
}
