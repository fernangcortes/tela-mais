/* ia/config.js — o que `config.ia` diz, já resolvido: provedor, modelo, chave presente ou não, estilo e recursos ligados.
 *
 * SEGREDO. A chave só entra como {"$env":"NOME"} (o validador recusa texto) e é lida de `env` AQUI, na hora de usar.
 * Nada daqui devolve o valor: `temChave` é só um booleano, para o /admin e o doctor mostrarem "chave ok" sem tocar nela.
 * Sem `chave` na config, vale o nome padrão da variável do provedor (ANTHROPIC_API_KEY...), que é o que o .env.example traz. */
import { ehReferenciaEnv } from '../config-validar.mjs';

export const PROVEDORES_TEXTO = Object.freeze(['anthropic', 'openai', 'gemini', 'workers-ai']);
export const PROVEDORES_TRANSCRICAO = Object.freeze(['workers-ai-whisper', 'assemblyai', 'openai', 'provedor-de-video']);

/* A tarefa existe, e o /admin liga e desliga cada uma. Tudo nasce DESLIGADO (regra 5: recurso pago nasce desligado). */
export const TAREFAS_LIGAVEIS = Object.freeze([
  'sinopse-curta', 'sinopse-longa', 'capitulos', 'tags', 'titulo-alternativo', 'descricao-acessivel', 'traducao-legenda', 'transcricao',
  /* clipe de fundo e trailer (scripts/trailer.mjs): os trechos vêm de um modelo de texto; o corte é do ffmpeg, que é grátis */
  'trailer'
]);

/* Modelos de partida. Sonnet 5.5 e Haiku 4.5 conferidos em platform.claude.com em 2026-10-02; os outros são sugestão, e o
 * cliente troca em `ia.textos.modelo` (o nome exato muda com o tempo: reconfira na página do provedor). */
export const MODELOS_PADRAO = Object.freeze({
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5-mini',
  gemini: 'gemini-3.5-flash-lite',
  'workers-ai': '@cf/google/gemma-4-26b-a4b-it'
});

export const MODELOS_SUGERIDOS = Object.freeze({
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5-mini', 'gpt-5-nano'],
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
  'workers-ai': ['@cf/google/gemma-4-26b-a4b-it']
});

export const MODELOS_TRANSCRICAO_PADRAO = Object.freeze({
  'workers-ai-whisper': '@cf/openai/whisper-large-v3-turbo',
  assemblyai: 'universal-3-5-pro',
  openai: 'whisper-1',
  'provedor-de-video': null
});

export const VARIAVEL_PADRAO = Object.freeze({
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  'workers-ai': 'CLOUDFLARE_API_TOKEN',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  'workers-ai-whisper': 'CLOUDFLARE_API_TOKEN'
});

const VARIAVEL_CONTA = 'CLOUDFLARE_ACCOUNT_ID';

/* Lê uma referência {"$env"} (ou um texto, só para o modelo, que não é segredo). */
function lerValor(ref, env) {
  if (ehReferenciaEnv(ref)) {
    const v = env ? env[ref.$env] : undefined;
    return typeof v === 'string' && v !== '' ? v : undefined;
  }
  return typeof ref === 'string' && ref !== '' ? ref : undefined;
}

function chaveDe(bloco, provedorDaChave, env) {
  if (bloco && ehReferenciaEnv(bloco.chave)) return lerValor(bloco.chave, env);
  const padrao = VARIAVEL_PADRAO[provedorDaChave];
  const v = padrao && env ? env[padrao] : undefined;
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/* O nome do binding do Workers AI neste deploy (config/site.json: implantacao.bindings.ia; padrão AI). */
export function bindingDeIA(config, env) {
  const nome = (config && config.implantacao && config.implantacao.bindings && config.implantacao.bindings.ia) || 'AI';
  const b = env ? env[nome] : undefined;
  return b && typeof b.run === 'function' ? b : null;
}

export function estiloDe(config) {
  const e = (config && config.ia && config.ia.textos && config.ia.textos.estilo) || {};
  const idiomaPadrao = (config && config.idiomas && config.idiomas.padrao) || 'pt-BR';
  return {
    idioma: typeof e.idioma === 'string' && e.idioma ? e.idioma : idiomaPadrao,
    tom: typeof e.tom === 'string' ? e.tom : '',
    tamanhoSinopse: Number.isInteger(e.tamanhoSinopse) ? e.tamanhoSinopse : 60,
    glossario: Array.isArray(e.glossario) ? e.glossario.filter((x) => typeof x === 'string' && x.trim()).slice(0, 200) : [],
    nomesProibidos: Array.isArray(e.nomesProibidos) ? e.nomesProibidos.filter((x) => typeof x === 'string' && x.trim()).slice(0, 100) : [],
    vocabularioTags: Array.isArray(e.vocabularioTags) ? e.vocabularioTags.filter((x) => typeof x === 'string' && x.trim()).slice(0, 200) : [],
    instrucaoExtra: typeof e.instrucaoExtra === 'string' ? e.instrucaoExtra.slice(0, 500) : ''
  };
}

/* O provedor de TEXTO. `pronto` = dá para chamar agora (provedor escolhido e chave/binding presentes). */
export function configDeTexto(config, env) {
  const t = (config && config.ia && config.ia.textos) || {};
  const provedor = PROVEDORES_TEXTO.includes(t.provedor) ? t.provedor : 'nenhum';
  const modelo = lerValor(t.modelo, env) || MODELOS_PADRAO[provedor] || null;
  const binding = provedor === 'workers-ai' ? bindingDeIA(config, env) : null;
  const chave = provedor === 'nenhum' ? undefined : chaveDe(t, provedor, env);
  const contaId = provedor === 'workers-ai' ? (lerValor(t.contaId, env) || (env && env[VARIAVEL_CONTA]) || undefined) : undefined;
  const temAcesso = provedor === 'workers-ai' ? Boolean(binding || (chave && contaId)) : Boolean(chave);
  return {
    provedor, modelo, chave, binding, contaId,
    temChave: Boolean(chave), temAcesso,
    pronto: provedor !== 'nenhum' && temAcesso,
    estilo: estiloDe(config)
  };
}

export function configDeTranscricao(config, env) {
  const t = (config && config.ia && config.ia.transcricao) || {};
  const provedor = PROVEDORES_TRANSCRICAO.includes(t.provedor) ? t.provedor : 'nenhum';
  const modelo = lerValor(t.modelo, env) || MODELOS_TRANSCRICAO_PADRAO[provedor] || null;
  const binding = provedor === 'workers-ai-whisper' ? bindingDeIA(config, env) : null;
  const chave = provedor === 'nenhum' || provedor === 'provedor-de-video' ? undefined : chaveDe(t, provedor === 'workers-ai-whisper' ? 'workers-ai-whisper' : provedor, env);
  const contaId = provedor === 'workers-ai-whisper' ? (lerValor(t.contaId, env) || (env && env[VARIAVEL_CONTA]) || undefined) : undefined;
  let temAcesso;
  if (provedor === 'workers-ai-whisper') temAcesso = Boolean(binding || (chave && contaId));
  else if (provedor === 'provedor-de-video') temAcesso = true;   /* quem confere é o adaptador de vídeo (capacidade legendaIA) */
  else temAcesso = Boolean(chave);
  return {
    provedor, modelo, chave, binding, contaId,
    idioma: typeof t.idioma === 'string' && t.idioma ? t.idioma : 'pt',
    temChave: Boolean(chave), temAcesso,
    pronto: provedor !== 'nenhum' && temAcesso
  };
}

/* O que o /admin liga e desliga fica no KV (`ia:ligados`); a config só dá o valor de partida. Tudo desligado por padrão. */
export function recursosLigados(config, ligadosKv) {
  const base = (config && config.ia && config.ia.recursos) || {};
  const saida = {};
  for (const t of TAREFAS_LIGAVEIS) {
    const doKv = ligadosKv && typeof ligadosKv[t] === 'boolean' ? ligadosKv[t] : null;
    const daConfig = base[t] === true;
    saida[t] = { ligado: doKv === null ? daConfig : doKv, origem: doKv === null ? 'config' : 'admin' };
  }
  return saida;
}

export function orcamentoMensalUSD(config) {
  const v = config && config.ia && config.ia.orcamentoMensalUSD;
  return typeof v === 'number' && v >= 0 ? v : 5;
}
