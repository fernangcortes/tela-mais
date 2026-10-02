/* ia/executor.js — o botão "gerar no GitHub" do /admin: dispara o fluxo `.github/workflows/gerar-midia.yml` do repositório do cliente.
 *
 * POR QUE EXISTE: clipe de fundo e trailer precisam do ffmpeg, e o Worker não roda ffmpeg. O fluxo do GitHub Actions roda os scripts
 * (scripts/trailer.mjs, capas.mjs, ia-textos.mjs, ia-transcrever.mjs) com o ffmpeg do executor e as chaves guardadas como segredos do GitHub.
 *
 * DESLIGADO POR PADRÃO (`ia.executor.github.ligado`). O token do GitHub é segredo do Worker (`GITHUB_DISPATCH_TOKEN`, ou o nome que
 * `ia.executor.github.token` apontar), com o ESCOPO MÍNIMO: token fine-grained, SÓ este repositório, permissão "Actions: Read and write"
 * e mais nenhuma. Ele nunca é devolvido por rota nenhuma (só o booleano `temToken`). Quem aperta o botão é o superadmin. */
import { ehReferenciaEnv } from '../config-validar.mjs';

export const TAREFAS_DO_EXECUTOR = Object.freeze(['textos', 'transcrever', 'trailer', 'clipe']);
export const VARIAVEL_DO_TOKEN = 'GITHUB_DISPATCH_TOKEN';
const SUBTAREFAS_DE_TEXTO = Object.freeze(['sinopse-curta', 'sinopse-longa', 'capitulos', 'tags', 'titulo-alternativo', 'descricao-acessivel', 'traducao-legenda']);

export function configDoExecutor(config, env) {
  const g = (config && config.ia && config.ia.executor && config.ia.executor.github) || {};
  const ref = g.token;
  const nome = ehReferenciaEnv(ref) ? ref.$env : VARIAVEL_DO_TOKEN;
  const token = env && typeof env[nome] === 'string' && env[nome] ? env[nome] : undefined;
  const repositorio = typeof g.repositorio === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(g.repositorio) ? g.repositorio : null;
  const fluxo = typeof g.fluxo === 'string' && /^[A-Za-z0-9_.-]+\.ya?ml$/.test(g.fluxo) ? g.fluxo : 'gerar-midia.yml';
  const ref2 = typeof g.ref === 'string' && /^[A-Za-z0-9_./-]{1,100}$/.test(g.ref) ? g.ref : 'main';
  const ligado = g.ligado === true;
  return {
    ligado, repositorio, fluxo, ref: ref2, nomeDoToken: nome, token, temToken: Boolean(token),
    pronto: ligado && Boolean(repositorio) && Boolean(token)
  };
}

/* O que o /admin vê: nunca o token. */
export function retratoDoExecutor(config, env) {
  const c = configDoExecutor(config, env);
  return { ligado: c.ligado, repositorio: c.repositorio, fluxo: c.fluxo, ref: c.ref, nomeDoToken: c.nomeDoToken, temToken: c.temToken, pronto: c.pronto, tarefas: TAREFAS_DO_EXECUTOR };
}

/* Confere o pedido e monta as entradas do fluxo (todas texto, como o GitHub exige). `null` + `motivo` se estiver errado. */
export function entradasDoFluxo({ tarefa, ids, subtarefas, idiomas, usarIa }) {
  if (!TAREFAS_DO_EXECUTOR.includes(tarefa)) return { motivo: 'tarefa' };
  const lista = Array.isArray(ids) ? ids.filter((i) => typeof i === 'string' && /^[^\s,]{1,200}$/.test(i)) : [];
  if (!lista.length || lista.length > 20) return { motivo: 'ids' };
  /* `usar_ia` vai SEMPRE explícito: só `true` (confirmação da estimativa pelo superadmin) vira 'sim'; o resto, 'nao' (de graça). */
  const entradas = { tarefa, ids: lista.join(','), usar_ia: usarIa === true ? 'sim' : 'nao' };
  if (tarefa === 'textos') {
    const s = Array.isArray(subtarefas) ? subtarefas.filter((t) => SUBTAREFAS_DE_TEXTO.includes(t)) : [];
    if (!s.length) return { motivo: 'subtarefas' };
    entradas.subtarefas = Array.from(new Set(s)).join(',');
    const i = Array.isArray(idiomas) ? idiomas.filter((x) => typeof x === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(x)).slice(0, 5) : [];
    if (i.length) entradas.idiomas = i.join(',');
  }
  return { entradas };
}

/* Dispara o fluxo. Devolve { ok:true } ou { ok:false, codigo }. Nunca devolve nem registra o token. */
export async function dispararFluxo({ config, env, fetch = globalThis.fetch, entradas }) {
  const c = configDoExecutor(config, env);
  if (!c.ligado) return { ok: false, codigo: 'ia-executor-desligado', status: 409 };
  if (!c.repositorio) return { ok: false, codigo: 'ia-executor-sem-repositorio', status: 409 };
  if (!c.token) return { ok: false, codigo: 'ia-executor-sem-token', status: 409 };
  let r;
  try {
    r = await fetch('https://api.github.com/repos/' + c.repositorio + '/actions/workflows/' + encodeURIComponent(c.fluxo) + '/dispatches', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + c.token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
        'content-type': 'application/json', 'user-agent': 'streaming-white-label'
      },
      body: JSON.stringify({ ref: c.ref, inputs: entradas })
    });
  } catch (e) { return { ok: false, codigo: 'ia-executor-inacessivel', status: 502 }; }
  if (r.status === 204) return { ok: true, repositorio: c.repositorio, fluxo: c.fluxo, ref: c.ref };
  /* 401/403: token errado ou sem a permissão; 404: repositório ou fluxo não existe (o GitHub responde 404 a quem não tem acesso); 422: o ramo ou as entradas */
  return { ok: false, codigo: 'ia-executor-recusou', status: 502, httpStatus: r.status };
}
