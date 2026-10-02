/* ia/precos.js — a tabela de preços das APIs de IA, FORA da lógica (regra: preço muda, o código não pode depender dele).
 *
 * Todo valor é ESTIMATIVA com data. `confirmado: true` só onde a página oficial do fornecedor foi lida na data abaixo.
 * O cliente corrige qualquer linha em `ia.precos` (config/site.json) sem mexer no código; o /admin mostra a data.
 * Modelo que não está na tabela NÃO custa zero: custa o preço "desconhecido" (conservador) e a estimativa avisa. */

export const DATA_DOS_PRECOS = '2026-10-02';

export const PRECOS_PADRAO = Object.freeze({
  data: DATA_DOS_PRECOS,
  texto: Object.freeze({
    'anthropic:claude-sonnet-5-5': { entradaPorMTok: 2, saidaPorMTok: 10, confirmado: true, fonte: 'platform.claude.com/docs/en/about-claude/pricing, 2026-10-02' },
    'anthropic:claude-haiku-4-5-20251001': { entradaPorMTok: 1, saidaPorMTok: 5, confirmado: true, fonte: 'platform.claude.com/docs/en/about-claude/pricing, 2026-10-02' },
    'anthropic:claude-opus-5-5': { entradaPorMTok: 4, saidaPorMTok: 20, confirmado: true, fonte: 'platform.claude.com/docs/en/about-claude/pricing, 2026-10-02' },
    'openai:gpt-5-mini': { entradaPorMTok: 0.25, saidaPorMTok: 2, confirmado: false, fonte: 'pricepertoken.com (secundária), 2026-10-01' },
    'openai:gpt-5-nano': { entradaPorMTok: 0.05, saidaPorMTok: 0.4, confirmado: false, fonte: 'pricepertoken.com (secundária), 2026-10-01' },
    'gemini:gemini-3.5-flash-lite': { entradaPorMTok: 0.3, saidaPorMTok: 2.5, confirmado: false, fonte: 'openrouter.ai (secundária), 2026-10-01' },
    'gemini:gemini-3.5-flash': { entradaPorMTok: 1.5, saidaPorMTok: 9, confirmado: false, fonte: 'pricepertoken.com (secundária), 2026-10-01' },
    'workers-ai:@cf/google/gemma-4-26b-a4b-it': { entradaPorMTok: 0.1, saidaPorMTok: 0.3, confirmado: true, fonte: 'catálogo de modelos do Workers AI (cloudflare-docs), 2026-10-02' }
  }),
  transcricao: Object.freeze({
    'workers-ai-whisper': { porMinuto: 0.0005, confirmado: true, fonte: 'doc oficial Cloudflare (pesquisa de 2026-10-01): US$ 0,0005/min' },
    assemblyai: { porMinuto: 0.0035, confirmado: false, fonte: 'blog do fornecedor: US$ 0,21/h; um agregador cita US$ 0,45/h: reconferir' },
    'openai:whisper-1': { porMinuto: 0.006, confirmado: false, fonte: 'costgoat.com (secundária), 2026-10-01' },
    'openai:gpt-4o-mini-transcribe': { porMinuto: 0.003, confirmado: false, fonte: 'costgoat.com (secundária), 2026-10-01' },
    openai: { porMinuto: 0.006, confirmado: false, fonte: 'costgoat.com (secundária), 2026-10-01' },
    'provedor-de-video': { porMinuto: 0, confirmado: false, fonte: 'Cloudflare Stream: sem custo adicional; Bunny cobra por idioma (US$ 0,10/min): reconferir' }
  }),
  /* Preço de quem não está na tabela: conservador, para a estimativa nunca ficar abaixo do real. */
  desconhecido: Object.freeze({ entradaPorMTok: 3, saidaPorMTok: 15, porMinuto: 0.01 })
});

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/* Junta a tabela padrão com as linhas que o cliente corrigiu em `config.ia.precos`. */
export function tabelaDePrecos(config) {
  const extra = (config && config.ia && config.ia.precos) || {};
  const texto = Object.assign({}, PRECOS_PADRAO.texto);
  const transcricao = Object.assign({}, PRECOS_PADRAO.transcricao);
  for (const [k, v] of Object.entries(extra.texto || {})) {
    if (v && numero(v.entradaPorMTok) !== null && numero(v.saidaPorMTok) !== null) {
      texto[k] = { entradaPorMTok: v.entradaPorMTok, saidaPorMTok: v.saidaPorMTok, confirmado: false, fonte: 'config do cliente (ia.precos)' };
    }
  }
  for (const [k, v] of Object.entries(extra.transcricao || {})) {
    if (v && numero(v.porMinuto) !== null) transcricao[k] = { porMinuto: v.porMinuto, confirmado: false, fonte: 'config do cliente (ia.precos)' };
  }
  return { data: PRECOS_PADRAO.data, texto, transcricao, desconhecido: PRECOS_PADRAO.desconhecido };
}

export function precoDeTexto(tabela, provedor, modelo) {
  const p = tabela.texto[provedor + ':' + modelo];
  if (p) return Object.assign({ desconhecido: false }, p);
  return { entradaPorMTok: tabela.desconhecido.entradaPorMTok, saidaPorMTok: tabela.desconhecido.saidaPorMTok, confirmado: false, desconhecido: true, fonte: '' };
}

export function precoDeTranscricao(tabela, provedor, modelo) {
  const p = (modelo && tabela.transcricao[provedor + ':' + modelo]) || tabela.transcricao[provedor];
  if (p) return Object.assign({ desconhecido: false }, p);
  return { porMinuto: tabela.desconhecido.porMinuto, confirmado: false, desconhecido: true, fonte: '' };
}

export const arredondar = (usd) => Math.round(usd * 1e6) / 1e6;

export function custoDeTexto(tabela, { provedor, modelo, entradaTokens = 0, saidaTokens = 0 }) {
  const p = precoDeTexto(tabela, provedor, modelo);
  return arredondar((entradaTokens * p.entradaPorMTok + saidaTokens * p.saidaPorMTok) / 1e6);
}

export function custoDeTranscricao(tabela, { provedor, modelo, minutos = 0 }) {
  return arredondar(minutos * precoDeTranscricao(tabela, provedor, modelo).porMinuto);
}
