/* _lib/saude.js — o diagnóstico que o Worker consegue fazer de DENTRO: a tela Saúde do /admin (GET /api/saude).
 *
 * São as checagens do `setup.mjs doctor` que fazem sentido no servidor (configuração, KV, D1, segredos presentes,
 * provedor de vídeo, modo de acesso, backup, versão). As que dependem do computador de quem instalou (Node, git,
 * wrangler login, .env, varredura de arquivos) ficam só no doctor.
 *
 * NADA AQUI VAZA SEGREDO. Os segredos aparecem só pelo NOME e por "presente ou não" (`typeof env[nome] === 'string'`);
 * o valor nunca é lido para fora desta função. A mensagem do teste de credencial vem do adaptador, que já a devolve
 * sem chave. Cada checagem é { id, estado, codigo, params? }: o TEXTO é do navegador, pelo catálogo de idiomas
 * (`saude.c.<codigo>` diz o que está acontecendo e `saude.f.<codigo>` como corrigir), então a tela acompanha o idioma
 * de quem edita. */
import pacote from '../../../package.json' with { type: 'json' };
import { diagnosticoDeAcesso } from './contas-fluxo.js';
import { temBanco } from './contas-banco.js';
import { politicaDeAcesso } from './contas.js';
import { ehReferenciaEnv } from './config-validar.mjs';
import { moduloDe, PROVEDOR_PADRAO } from './provedores/index.js';
import { NAO_SECRETAS, CREDENCIAIS_DE_ASSINATURA } from './assistente.js';

export const VERSAO_DO_CORE = String(pacote.version || '0.0.0');
export const CHAVE_ULTIMO_BACKUP = 'backup:ultimo';
export const CHAVE_ASSISTENTE = 'assistente:estado';
export const CHAVE_ULTIMA_VERSAO = 'versao:ultima';
export const REPOSITORIO_OFICIAL = 'fernangcortes/tela-mais';

/* A cada quantas horas o servidor olha de novo a última versão publicada. */
export const HORAS_DO_CACHE_DE_VERSAO = 6;
/* Backup mais velho que isto vira aviso (o plano: último backup em menos de 48 h). */
export const HORAS_DE_BACKUP_VELHO = 48;
/* O catálogo é UMA chave do KV, lida inteira e desmontada a cada visita: acima disto o corte de 10 ms de CPU do plano
 * grátis começa a ser um risco (estimativa; o limite de verdade é medido por quem opera). */
export const BYTES_DE_CATALOGO_QUE_PEDE_ATENCAO = 1024 * 1024;

const ESTADOS_DO_ASSISTENTE = ['pendente', 'concluido', 'dispensado'];
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ versão */

/* "v1.2.3" / "1.2.3-rc.1" -> [1,2,3] (o que vem depois do hífen é ignorado). null se não for uma versão. */
export function partesDaVersao(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/* -1, 0 ou 1; null se uma das duas não é uma versão. */
export function compararVersoes(a, b) {
  const x = partesDaVersao(a), y = partesDaVersao(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/* A última release PÚBLICA do repositório oficial. Tolerante: qualquer falha (rede, limite da API, resposta torta) devolve
 * { ok: false } e a tela segue sem o aviso de versão. O resultado fica no KV por HORAS_DO_CACHE_DE_VERSAO para não
 * bater na API do GitHub a cada visita à tela. `fetchFn` e `agora` são para os testes. */
export async function ultimaVersaoPublicada(env, { fetchFn = globalThis.fetch, agora = Date.now(), forcar = false, repositorio, soCache = false } = {}) {
  const kv = env && env.CATALOGO;
  if (!forcar && kv) {
    try {
      const guardado = await kv.get(CHAVE_ULTIMA_VERSAO, 'json');
      if (guardado && Number.isFinite(guardado.verificadaEm)) {
        const fresco = agora - guardado.verificadaEm < HORAS_DO_CACHE_DE_VERSAO * 3600 * 1000;
        /* só do cache: serve até o velho (melhor um aviso de ontem do que nenhum); com rede, só o fresco */
        if (fresco || soCache) return Object.assign({}, guardado, { ok: guardado.ok !== false });
      }
    } catch (e) { /* sem cache: segue para a rede */ }
  }
  if (soCache) return { ok: false, verificadaEm: null, motivo: 'sem-cache' };
  const repo = repositorio || (env && env.CORE_REPOSITORIO) || REPOSITORIO_OFICIAL;
  let resultado = { ok: false, verificadaEm: agora, motivo: 'rede' };
  try {
    if (typeof fetchFn !== 'function') throw new Error('sem-fetch');
    const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'streaming-white-label' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
    });
    if (!r.ok) resultado = { ok: false, verificadaEm: agora, motivo: 'http-' + r.status };
    else {
      const j = await r.json();
      const tag = j && typeof j.tag_name === 'string' ? j.tag_name : '';
      if (!partesDaVersao(tag)) resultado = { ok: false, verificadaEm: agora, motivo: 'sem-versao' };
      else {
        const url = typeof j.html_url === 'string' && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : `https://github.com/${repo}/releases`;
        resultado = { ok: true, verificadaEm: agora, versao: tag.replace(/^v/, ''), url };
      }
    }
  } catch (e) {
    resultado = { ok: false, verificadaEm: agora, motivo: 'rede' };
  }
  if (kv) { try { await kv.put(CHAVE_ULTIMA_VERSAO, JSON.stringify(resultado)); } catch (e) { /* o KV não grava: o aviso só não fica guardado */ } }
  return resultado;
}

/* ------------------------------------------------------------------ estado guardado no KV */

export async function lerUltimoBackup(env) {
  try {
    const v = env && env.CATALOGO ? await env.CATALOGO.get(CHAVE_ULTIMO_BACKUP, 'json') : null;
    return ehObjeto(v) && typeof v.em === 'string' ? v : null;
  } catch (e) { return null; }
}

export async function lerEstadoDoAssistente(env) {
  try {
    const v = env && env.CATALOGO ? await env.CATALOGO.get(CHAVE_ASSISTENTE, 'json') : null;
    if (ehObjeto(v) && ESTADOS_DO_ASSISTENTE.includes(v.estado)) return v;
  } catch (e) { /* sem KV: o assistente fica pendente */ }
  return { estado: 'pendente' };
}

export async function gravarEstadoDoAssistente(env, estado, por) {
  const doc = { estado, em: new Date().toISOString(), por: por || null };
  await env.CATALOGO.put(CHAVE_ASSISTENTE, JSON.stringify(doc));
  return doc;
}
export { ESTADOS_DO_ASSISTENTE };

/* ------------------------------------------------------------------ segredos (só os NOMES) */

const presente = (env, nome) => Boolean(env) && typeof env[nome] === 'string' && env[nome] !== '';

/* A lista de variáveis que esta instalação usa hoje, com "presente ou não". Nunca o valor. */
export function listarSegredos({ env, config, modo }) {
  const restrito = modo !== 'publico';
  const lista = [];
  const poe = (nome, extra) => { if (!lista.some((x) => x.nome === nome)) lista.push(Object.assign({ nome, presente: presente(env, nome), secreta: !NAO_SECRETAS.has(nome) }, extra)); };

  poe('ADMIN_PASSWORD', { necessario: true, grupo: 'admin' });
  poe('SESSION_SECRET', { necessario: true, grupo: 'admin' });

  const id = (config && config.video && config.video.provedor) || PROVEDOR_PADRAO;
  const modulo = moduloDe(id) || moduloDe(PROVEDOR_PADRAO);
  const bloco = (config && config.video && config.video[modulo.CHAVE_CONFIG]) || {};
  const assinatura = CREDENCIAIS_DE_ASSINATURA[modulo.ID] || [];
  for (const [nome, def] of Object.entries(modulo.CREDENCIAIS)) {
    const ref = bloco[nome];
    const variavel = ehReferenciaEnv(ref) ? ref.$env : def.env;
    const paraAssinar = assinatura.includes(nome);
    poe(variavel, {
      necessario: def.obrigatoria === true || (restrito && paraAssinar),
      grupo: 'video',
      assinatura: paraAssinar,
      provedor: modulo.ID
    });
  }
  if (modo === 'cadastro') poe('TURNSTILE_SECRET', { necessario: true, grupo: 'acesso' });
  const email = config && config.acesso && config.acesso.email && config.acesso.email.adaptador;
  if (email === 'resend') poe('RESEND_API_KEY', { necessario: true, grupo: 'acesso' });
  return lista;
}

/* ------------------------------------------------------------------ a coleta */

const horasDesde = (iso, agora) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.max(0, (agora - t) / 3600000) : null;
};

/* Monta o retrato de saúde. `testar` faz UMA chamada de verdade ao provedor (validarCredenciais); sem ele, a checagem
 * de conexão aparece como "não testada". `versao` é o que ultimaVersaoPublicada devolveu (ou null: não consultado). */
export async function montarSaude({ env, config, data, modo, testar = false, versao = null, agora = Date.now() }) {
  const cfg = ehObjeto(config) ? config : {};
  const checagens = [];
  const c = (id, estado, codigo, params) => checagens.push(Object.assign({ id, estado, codigo }, params ? { params } : {}));
  const provedorId = (cfg.video && cfg.video.provedor) || PROVEDOR_PADRAO;
  const restrito = modo !== 'publico';

  /* configuração */
  const estadoCfg = cfg._estado;
  if (!estadoCfg) c('config', 'pulado', 'config-sem-estado');
  else if (estadoCfg.valido === false) c('config', 'erro', 'config-invalida', { n: (estadoCfg.erros || []).length });
  else if ((estadoCfg.avisos || []).length) c('config', 'aviso', 'config-avisos', { n: estadoCfg.avisos.length });
  else c('config', 'ok', 'config-ok');

  /* armazenamento: KV e catálogo */
  let titulos = null, noAr = null, bytes = null;
  if (!env || !env.CATALOGO) c('kv', 'erro', 'kv-ausente');
  else {
    try {
      const texto = await env.CATALOGO.get('catalogo', 'text');
      c('kv', 'ok', 'kv-ok');
      if (texto) {
        bytes = texto.length;
        try {
          const doc = JSON.parse(texto);
          const itens = Array.isArray(doc.itens) ? doc.itens : [];
          titulos = itens.length;
          noAr = itens.filter((i) => i && i.publicar === true).length;
        } catch (e) { titulos = null; }
      }
      if (!titulos) c('catalogo', 'aviso', 'catalogo-vazio');
      else c('catalogo', 'ok', 'catalogo-ok', { n: titulos, noAr });
      if (bytes !== null && bytes >= BYTES_DE_CATALOGO_QUE_PEDE_ATENCAO) c('catalogo-tamanho', 'aviso', 'catalogo-grande', { kb: Math.round(bytes / 1024), titulos: titulos == null ? 0 : titulos });
    } catch (e) {
      c('kv', 'erro', 'kv-falhou');
    }
  }

  /* D1 */
  if (!temBanco(env)) c('d1', restrito ? 'erro' : 'ok', restrito ? 'd1-ausente' : 'd1-dispensado');
  else {
    try { await env.DB.prepare('SELECT 1 AS ok' /* i18n-ignorar: SQL */).first(); c('d1', 'ok', 'd1-ok'); } catch (e) { c('d1', 'erro', 'd1-falhou'); }
  }

  /* senhas e chaves de sessão */
  if (presente(env, 'ADMIN_PASSWORD')) c('admin-senha', 'ok', 'admin-senha-ok');
  else c('admin-senha', 'erro', 'admin-senha-falta');
  if (!presente(env, 'SESSION_SECRET')) c('sessao', 'erro', 'sessao-falta');
  else if (env.SESSION_SECRET.length < 32) c('sessao', 'erro', 'sessao-curta');
  else if (presente(env, 'ADMIN_PASSWORD') && env.SESSION_SECRET === env.ADMIN_PASSWORD) c('sessao', 'erro', 'sessao-igual-a-senha');
  else c('sessao', 'ok', 'sessao-ok');

  /* provedor de vídeo */
  const segredos = listarSegredos({ env, config: cfg, modo });
  const faltamDoVideo = segredos.filter((s) => s.grupo === 'video' && s.necessario && !s.presente).map((s) => s.nome);
  const adaptador = data && data.provedor;
  if (faltamDoVideo.length) {
    c('video-credenciais', 'erro', 'video-credenciais-faltam', { provedor: provedorId, nomes: faltamDoVideo.join(', ') });
    c('video-conexao', 'pulado', 'video-conexao-sem-credenciais');
  } else {
    c('video-credenciais', 'ok', 'video-credenciais-ok', { provedor: provedorId });
    if (!testar) c('video-conexao', 'pulado', 'video-conexao-nao-testada');
    else if (!adaptador || typeof adaptador.validarCredenciais !== 'function') c('video-conexao', 'aviso', 'video-conexao-sem-teste');
    else {
      let t;
      try { t = await adaptador.validarCredenciais(); } catch (e) { t = { ok: false, mensagem: '' }; }
      if (t && t.ok) c('video-conexao', 'ok', 'video-conexao-ok', { provedor: provedorId });
      else c('video-conexao', 'erro', 'video-conexao-recusou', { provedor: provedorId, codigo: String((t && t.codigo) || ''), detalhe: String((t && t.mensagem) || '').slice(0, 200) });
    }
  }
  if (restrito) {
    if (provedorId === 'hls-generico') c('video-assinatura', 'erro', 'video-assinatura-impossivel', { provedor: provedorId });
    else if (cfg.acesso && cfg.acesso.privado && cfg.acesso.privado.assinarMidia === false) c('video-assinatura', 'erro', 'video-assinatura-desligada');
    else {
      const faltam = segredos.filter((s) => s.grupo === 'video' && s.assinatura && !s.presente);
      const alguma = (CREDENCIAIS_DE_ASSINATURA[provedorId] || []).length > 0;
      /* Bunny: precisa da chave do token E do host da pull zone; Stream: o id e a chave (JWK ou PEM). */
      const pem = provedorId === 'cloudflare-stream' && presente(env, 'CLOUDFLARE_STREAM_KEY_PEM');
      const faltaDeVerdade = faltam.filter((s) => !(pem && s.nome === 'CLOUDFLARE_STREAM_KEY_JWK'));
      if (alguma && faltaDeVerdade.length) c('video-assinatura', 'erro', 'video-assinatura-faltam', { provedor: provedorId, nomes: faltaDeVerdade.map((s) => s.nome).join(', ') });
      else c('video-assinatura', 'ok', 'video-assinatura-ok');
    }
  }

  /* acesso */
  const politica = (data && data.politica) || politicaDeAcesso(cfg);
  const acesso = diagnosticoDeAcesso({ env, config: cfg, politica, modo });
  c('acesso', 'ok', 'acesso-modo', { modo });
  if (modo === 'cadastro') {
    if (!acesso.turnstile.configurado) c('turnstile', 'aviso', 'turnstile-sem-segredo');
    else if (!acesso.turnstile.chavePublica) c('turnstile', 'aviso', 'turnstile-sem-chave-publica');
    else c('turnstile', 'ok', 'turnstile-ok');
    if (!acesso.cadastro.disponivel && acesso.cadastro.motivo === 'cadastro-sem-email') c('email', 'aviso', 'email-sem-envio');
  }

  /* backup */
  const ultimoBackup = await lerUltimoBackup(env);
  const horas = ultimoBackup ? horasDesde(ultimoBackup.em, agora) : null;
  if (!ultimoBackup || horas === null) c('backup', 'aviso', 'backup-nunca');
  else if (horas > HORAS_DE_BACKUP_VELHO) c('backup', 'aviso', 'backup-velho', { horas: Math.floor(horas) });
  else c('backup', 'ok', 'backup-recente', { horas: Math.floor(horas) });

  /* versão do core */
  let nova = false;
  if (versao && versao.ok && versao.versao) {
    const cmp = compararVersoes(VERSAO_DO_CORE, versao.versao);
    if (cmp === -1) { nova = true; c('versao', 'aviso', 'versao-nova', { atual: VERSAO_DO_CORE, nova: versao.versao }); }
    else c('versao', 'ok', 'versao-atual', { atual: VERSAO_DO_CORE });
  } else c('versao', 'pulado', 'versao-desconhecida', { atual: VERSAO_DO_CORE });

  const resumo = { ok: 0, aviso: 0, erro: 0, pulado: 0 };
  for (const x of checagens) resumo[x.estado] = (resumo[x.estado] || 0) + 1;

  return {
    geradoEm: new Date(agora).toISOString(),
    versao: {
      core: VERSAO_DO_CORE,
      ultima: versao && versao.ok ? { versao: versao.versao, url: versao.url || null, verificadaEm: versao.verificadaEm } : null,
      nova
    },
    modo,
    provedor: provedorId,
    segredos,
    armazenamento: { titulos, noAr, bytesDoCatalogo: bytes, d1: temBanco(env) },
    backup: { ultimo: ultimoBackup, horas: horas === null ? null : Math.floor(horas) },
    checagens,
    resumo
  };
}
