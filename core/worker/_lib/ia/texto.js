/* ia/texto.js — gerarTexto({ tarefa, entrada, schema }): UMA função para qualquer provedor de texto.
 *
 *   tarefa    nome de uma tarefa de tarefas.js (sinopse-curta, capitulos...) ou um objeto de tarefa (para o que não está lá)
 *   entrada   { titulo, serie, transcricao | blocos, duracaoSeg, ... }: o que a tarefa lê
 *   schema    (opcional) troca o schema de saída da tarefa
 *   config    a config do site (`ia.textos`: provedor, modelo, chave por {"$env"}, estilo)
 *   env       onde a chave (e o binding do Workers AI) são lidos
 *   orcamento (opcional) o orçamento do mês (orcamento.js): confere ANTES de cada chamada e registra o gasto REAL
 *
 * DEVOLVE sempre um objeto, nunca lança (erro de provedor vira { estado:'falhou', codigo }):
 *   { estado:'ok',           valor, proveniencia, uso, custoUSD, tentativas }
 *   { estado:'insuficiente', ... }     a transcrição não sustenta o texto (nada foi inventado; nada a gravar)
 *   { estado:'falhou', codigo, detalhe, tentativas, custoUSD }
 *
 * SAÍDA JSON VALIDADA, 1 RETENTATIVA, DEPOIS 'falhou'. A resposta passa por: extração do JSON, schema, regras da tarefa
 * (palavras, capítulos crescentes, nome sem suporte na transcrição). Se qualquer uma falhar, UMA segunda chamada leva o
 * motivo da recusa; se falhar de novo, o resultado é 'falhou' e este módulo NÃO tem como gravar nada: ele só devolve.
 * Quem chama (sugestoes.js) só registra quando o estado é 'ok'. O que a IA gera é sugestão, nunca publicação. */
import { validarSchema } from '../config-validar.mjs';
import { configDeTexto } from './config.js';
import { tabelaDePrecos, custoDeTexto } from './precos.js';
import { adaptadorDeTexto } from './texto/index.js';
import { tarefaPorNome, montarPrompt, textoDaEntrada, CARACTERES_POR_TOKEN } from './tarefas.js';
import { estimarChamada } from './orcamento.js';
import { extrairJson } from './json.js';
import { proveniencia } from './proveniencia.js';
import { ErroIA } from './erros.js';

const TETO_DE_SAIDA = 16000;
export const MAX_CARACTERES_DA_ENTRADA = 400000;

const falha = (codigo, extra) => Object.assign({ estado: 'falhou', codigo, detalhe: '', tentativas: 0, custoUSD: 0 }, extra || {});

function resumoDosErros(erros) {
  return erros.slice(0, 2).map((e) => e.caminho + ': ' + e.mensagem).join(' ');
}

export async function gerarTexto({ tarefa, entrada, schema, config, env, fetch, orcamento, agora = Date.now, retentativas = 1 }) {
  const t = typeof tarefa === 'string' ? tarefaPorNome(tarefa) : (tarefa && typeof tarefa === 'object' ? tarefa : null);
  if (!t || !t.nome || !t.schema) return falha('ia-tarefa-invalida', { detalhe: typeof tarefa === 'string' ? tarefa : '' });
  if (!entrada || typeof entrada !== 'object') return falha('ia-entrada-invalida');

  const cfg = configDeTexto(config, env);
  if (cfg.provedor === 'nenhum') return falha('ia-desligada');
  if (!cfg.pronto) return falha('ia-sem-chave');

  if (typeof t.suficiente === 'function' && !t.suficiente(entrada)) {
    return { estado: 'insuficiente', codigo: 'ia-transcricao-insuficiente', tentativas: 0, custoUSD: 0, valor: null, proveniencia: null };
  }

  let adaptador;
  try { adaptador = adaptadorDeTexto(cfg.provedor); } catch (e) { return falha(e.codigo, { detalhe: e.detalhe }); }

  const esquema = schema || t.schema;
  const tabela = tabelaDePrecos(config);
  const contexto = { entrada, estilo: cfg.estilo };
  const caracteres = (t.nome === 'traducao-legenda' ? JSON.stringify(entrada.cues || []) : textoDaEntrada(entrada)).length;
  if (caracteres > MAX_CARACTERES_DA_ENTRADA) return falha('ia-entrada-invalida', { detalhe: 'entrada grande demais (' + caracteres + ' caracteres)' });
  const estimada = estimarChamada({ tabela, provedor: cfg.provedor, modelo: cfg.modelo, tarefa: t, caracteres });
  const maxTokens = Math.min(TETO_DE_SAIDA, Math.max(4096, Math.ceil((t.saidaTokens || estimada.saidaTokens) * 4)));

  let correcao = null;
  let ultimo = '';
  let custoUSD = 0;
  const uso = { entradaTokens: 0, saidaTokens: 0 };
  const total = 1 + Math.max(0, retentativas);

  for (let tentativa = 1; tentativa <= total; tentativa++) {
    if (orcamento && !(await orcamento.podeGastar(estimada.usd))) {
      return falha('ia-orcamento-estourado', { tentativas: tentativa - 1, custoUSD, detalhe: 'o orçamento do mês não cobre a chamada' });
    }
    const { sistema, usuario } = montarPrompt(t, entrada, cfg.estilo, correcao);
    let r;
    try {
      r = await adaptador.chamar({ fetch, chave: cfg.chave, modelo: cfg.modelo, sistema, usuario, maxTokens, binding: cfg.binding, contaId: cfg.contaId });
    } catch (e) {
      if (!(e instanceof ErroIA)) return falha('ia-provedor-inacessivel', { tentativas: tentativa, custoUSD, detalhe: (e && e.message) || '' });
      ultimo = e.detalhe;
      if (!e.retentavel || tentativa === total) return falha(e.codigo, { tentativas: tentativa, custoUSD, detalhe: e.detalhe, status: e.status });
      continue;
    }

    /* O gasto é REAL (o que o provedor cobrou), e conta mesmo quando a resposta for recusada logo abaixo. */
    const entradaTokens = r.entradaTokens || estimada.entradaTokens;
    const saidaTokens = r.saidaTokens || Math.ceil(String(r.texto || '').length / CARACTERES_POR_TOKEN);
    const gasto = custoDeTexto(tabela, { provedor: cfg.provedor, modelo: cfg.modelo, entradaTokens, saidaTokens });
    custoUSD = Math.round((custoUSD + gasto) * 1e6) / 1e6;
    uso.entradaTokens += entradaTokens;
    uso.saidaTokens += saidaTokens;
    if (orcamento) await orcamento.registrar({ usd: gasto, provedor: cfg.provedor, modelo: cfg.modelo, tarefa: t.nome, entradaTokens, saidaTokens });

    const base = { custoUSD, uso, tentativas: tentativa };
    const marca = () => proveniencia({ modelo: cfg.modelo, provedor: cfg.provedor, tarefa: t.nome, agora });

    if (r.recusou) { ultimo = 'o modelo recusou responder'; correcao = null; if (tentativa === total) break; continue; }

    /* O modelo pode dizer "INSUFICIENTE" em texto puro (o formato do script antigo) ou {"insuficiente": true}. */
    if (/^\W*insuficiente\W*$/i.test(String(r.texto || '').trim())) return Object.assign({ estado: 'insuficiente', codigo: 'ia-transcricao-insuficiente', valor: null, proveniencia: marca() }, base);

    const j = extrairJson(r.texto);
    if (!j.ok) { ultimo = j.motivo + (r.cortou ? ' (a resposta foi cortada no limite de tokens)' : ''); correcao = ultimo + '.'; continue; }
    if (j.valor && j.valor.insuficiente === true) return Object.assign({ estado: 'insuficiente', codigo: 'ia-transcricao-insuficiente', valor: null, proveniencia: marca() }, base);

    const errosDeSchema = validarSchema(esquema, j.valor);
    if (errosDeSchema.length) { ultimo = resumoDosErros(errosDeSchema); correcao = 'o JSON não segue o formato (' + ultimo + ').'; continue; }

    const motivo = typeof t.validar === 'function' ? t.validar(j.valor, contexto) : null;
    if (motivo) { ultimo = motivo; correcao = motivo; continue; }

    return Object.assign({ estado: 'ok', valor: typeof t.extrair === 'function' ? t.extrair(j.valor, contexto) : j.valor, bruto: j.valor, proveniencia: marca() }, base);
  }
  return falha('ia-resposta-invalida', { tentativas: total, custoUSD, uso, detalhe: ultimo });
}
