/* ia/orcamento.js — quanto a IA pode gastar (`ia.orcamentoMensalUSD`), a estimativa ANTES de cada lote e a conta do mês.
 *
 * REGRAS
 *   1. ANTES de qualquer lote: `estimarLote` calcula (por provedor, tokens e minutos, com a tabela de precos.js) e
 *      `verificarLote` RECUSA o que não cabe no que sobra do mês. Nada é chamado se a recusa vier.
 *   2. DURANTE: cada chamada confere `podeGastar` antes e `registrar` depois (gasto REAL, com o uso que o provedor devolveu).
 *   3. A conta do mês mora no KV (`ia:gasto:AAAA-MM`). Ler-e-gravar no KV não é atômico: duas chamadas simultâneas podem
 *      perder uma parcela. Para um orçamento de poucos dólares com lote sequencial isso não importa; o teto real continua
 *      sendo o limite de gasto que a pessoa põe na conta do provedor (o assistente avisa).
 *   4. Estimativa NUNCA é zero por falta de preço: modelo fora da tabela custa o preço conservador e o aviso diz isso.
 *
 * Toda estimativa é ESTIMATIVA, datada (`dataDosPrecos`) e marcada se algum preço não foi conferido na fonte oficial. */
import { tabelaDePrecos, precoDeTexto, precoDeTranscricao, custoDeTexto, custoDeTranscricao, arredondar } from './precos.js';
import { configDeTexto, configDeTranscricao, orcamentoMensalUSD } from './config.js';
import { TAREFAS, CARACTERES_POR_TOKEN, TOKENS_DO_PROMPT_FIXO } from './tarefas.js';
import { ErroIA } from './erros.js';

export const PREFIXO_DO_GASTO = 'ia:gasto:';
/* Retentativa (1 a mais por chamada, em parte dos casos) e variação de contagem de tokens. */
export const MARGEM = 1.2;
/* 1 hora de fala ≈ 9 mil palavras ≈ 55 mil caracteres (pesquisa M9). */
export const CARACTERES_POR_MINUTO_DE_FALA = 900;
export const HORAS_PADRAO = 1;

const relogio = (agora) => (typeof agora === 'function' ? agora() : Number(agora) || Date.now());
export const mesDe = (ms) => new Date(ms).toISOString().slice(0, 7);

/* O custo estimado de UMA chamada de texto. */
export function estimarChamada({ tabela, provedor, modelo, tarefa, caracteres }) {
  const t = typeof tarefa === 'string' ? TAREFAS[tarefa] : tarefa;
  const entradaTokens = Math.ceil(caracteres / CARACTERES_POR_TOKEN) + TOKENS_DO_PROMPT_FIXO;
  const saidaTokens = t && t.saidaTokens ? t.saidaTokens : Math.ceil(entradaTokens * 1.2);
  const usd = arredondar(custoDeTexto(tabela, { provedor, modelo, entradaTokens, saidaTokens }) * MARGEM);
  return { entradaTokens, saidaTokens, usd };
}

/* A estimativa de um lote: { itens: [{ id, duracaoSeg?, caracteres? }], tarefas: ['sinopse-curta', ..., 'transcricao'] }.
 * `idiomasDestino` multiplica a tradução. `gastoDoMesUSD` é o que já foi gasto no mês (quem chama lê do orçamento). */
export function estimarLote({ config, env, itens, tarefas, idiomasDestino = 1, gastoDoMesUSD = 0 }) {
  const tabela = tabelaDePrecos(config);
  const texto = configDeTexto(config, env || {});
  const fala = configDeTranscricao(config, env || {});
  const limiteUSD = orcamentoMensalUSD(config);
  const avisos = [];
  const linhas = [];
  const porTarefa = {};
  const usados = [];

  for (const tarefa of tarefas || []) {
    if (tarefa === 'transcricao') {
      if (fala.provedor === 'nenhum') { avisos.push('ia-transcricao-desligada'); continue; }
      const p = precoDeTranscricao(tabela, fala.provedor, fala.modelo);
      usados.push(p);
      if (p.desconhecido) avisos.push('preco-desconhecido:' + fala.provedor);
      for (const it of itens || []) {
        const minutos = it.duracaoSeg ? it.duracaoSeg / 60 : HORAS_PADRAO * 60;
        const usd = arredondar(custoDeTranscricao(tabela, { provedor: fala.provedor, modelo: fala.modelo, minutos }) * MARGEM);
        linhas.push({ id: it.id, tarefa, minutos: Math.round(minutos * 10) / 10, usd });
      }
      continue;
    }
    if (!TAREFAS[tarefa]) { avisos.push('ia-tarefa-invalida:' + tarefa); continue; }
    if (texto.provedor === 'nenhum') { avisos.push('ia-desligada'); continue; }
    const p = precoDeTexto(tabela, texto.provedor, texto.modelo);
    usados.push(p);
    if (p.desconhecido) avisos.push('preco-desconhecido:' + texto.provedor + ':' + texto.modelo);
    const vezes = tarefa === 'traducao-legenda' ? Math.max(1, idiomasDestino) : 1;
    for (const it of itens || []) {
      const caracteres = it.caracteres != null ? it.caracteres : (it.duracaoSeg ? (it.duracaoSeg / 60) * CARACTERES_POR_MINUTO_DE_FALA : HORAS_PADRAO * 60 * CARACTERES_POR_MINUTO_DE_FALA);
      const e = estimarChamada({ tabela, provedor: texto.provedor, modelo: texto.modelo, tarefa, caracteres });
      linhas.push({ id: it.id, tarefa, entradaTokens: e.entradaTokens * vezes, saidaTokens: e.saidaTokens * vezes, usd: arredondar(e.usd * vezes) });
    }
  }

  for (const l of linhas) porTarefa[l.tarefa] = arredondar((porTarefa[l.tarefa] || 0) + l.usd);
  const totalUSD = arredondar(linhas.reduce((s, l) => s + l.usd, 0));
  const restanteUSD = arredondar(Math.max(0, limiteUSD - gastoDoMesUSD));
  return {
    estimativa: true,
    dataDosPrecos: tabela.data,
    precosConfirmados: usados.length > 0 && usados.every((p) => p.confirmado === true),
    margem: MARGEM,
    provedorDeTexto: texto.provedor, modeloDeTexto: texto.modelo,
    provedorDeTranscricao: fala.provedor,
    itens: linhas, porTarefa, totalUSD,
    limiteUSD, gastoDoMesUSD: arredondar(gastoDoMesUSD), restanteUSD,
    cabe: totalUSD <= restanteUSD + 1e-9,
    avisos
  };
}

/* A conta do mês no KV. `kv` é o namespace; sem ele nada é registrado e NADA é liberado (falha fechada). */
export function criarOrcamento({ env, config, agora = Date.now }) {
  const kv = env && env.CATALOGO;
  const limiteUSD = orcamentoMensalUSD(config);
  const chave = () => PREFIXO_DO_GASTO + mesDe(relogio(agora));

  async function ler() {
    const vazio = { mes: mesDe(relogio(agora)), totalUSD: 0, chamadas: 0, porProvedor: {}, porTarefa: {}, ultimos: [], atualizadoEm: null };
    if (!kv) return vazio;
    let doc = null;
    try { doc = await kv.get(chave(), 'json'); } catch (e) { doc = null; }
    return doc && typeof doc === 'object' ? Object.assign(vazio, doc) : vazio;
  }

  const obj = {
    limiteUSD,
    temArmazenamento: Boolean(kv),
    ler,
    async gastoDoMes() { return (await ler()).totalUSD; },
    async restanteUSD() { return arredondar(Math.max(0, limiteUSD - (await ler()).totalUSD)); },
    async podeGastar(usd) {
      if (!kv) return usd <= 0;
      return (await ler()).totalUSD + usd <= limiteUSD + 1e-9;
    },
    async registrar({ usd, provedor, modelo, tarefa, entradaTokens = 0, saidaTokens = 0, minutos = 0 }) {
      if (!kv) return null;
      const valor = Number(usd);
      if (!(valor >= 0)) return null;
      const doc = await ler();
      doc.totalUSD = arredondar(doc.totalUSD + valor);
      doc.chamadas += 1;
      if (provedor) doc.porProvedor[provedor] = arredondar((doc.porProvedor[provedor] || 0) + valor);
      if (tarefa) doc.porTarefa[tarefa] = arredondar((doc.porTarefa[tarefa] || 0) + valor);
      doc.ultimos = [{ em: new Date(relogio(agora)).toISOString(), provedor: provedor || null, modelo: modelo || null, tarefa: tarefa || null, usd: valor, entradaTokens, saidaTokens, minutos }]
        .concat(doc.ultimos || []).slice(0, 30);
      doc.atualizadoEm = new Date(relogio(agora)).toISOString();
      await kv.put(chave(), JSON.stringify(doc));
      return doc;
    },
    /* A decisão do lote: ok, ou recusa com o motivo. Não grava nada. */
    async verificarLote(estimativa) {
      const gasto = await obj.gastoDoMes();
      const restante = arredondar(Math.max(0, limiteUSD - gasto));
      if (!kv && estimativa.totalUSD > 0) return { ok: false, codigo: 'ia-orcamento-estourado', motivo: 'sem-armazenamento', totalUSD: estimativa.totalUSD, restanteUSD: 0, limiteUSD };
      if (estimativa.totalUSD > restante + 1e-9) {
        return { ok: false, codigo: 'ia-orcamento-estourado', motivo: 'acima-do-restante', totalUSD: estimativa.totalUSD, restanteUSD: restante, limiteUSD, gastoDoMesUSD: gasto };
      }
      return { ok: true, totalUSD: estimativa.totalUSD, restanteUSD: restante, limiteUSD, gastoDoMesUSD: gasto };
    }
  };
  return obj;
}

/* Um erro pronto para quem prefere lançar a devolver. */
export function erroDeOrcamento(decisao) {
  return new ErroIA('ia-orcamento-estourado', { detalhe: 'estimado US$ ' + decisao.totalUSD + ', restam US$ ' + decisao.restanteUSD });
}
