/* _lib/mcp-tokens.js — os tokens do MCP (agentes de IA) e a auditoria do que eles fizeram. D1, tabelas da migração 0003.
 *
 * O TOKEN. 32 bytes sorteados com o prefixo `mcp_`; só o SHA-256 vai para o banco (vazar o banco não vale acesso), e o valor
 * aparece UMA vez, na resposta que o criou. É de uma família diferente do token da equipe (HMAC, `v2.…`) e do cookie de
 * espectador (`ss_…`): um não vale no lugar do outro. Tem nome, ESCOPO (read < curate < admin) e validade obrigatória
 * (1 a 365 dias). Revogar é preencher `revogado_em`: vale no pedido seguinte. Vencido ou revogado = não autenticado.
 *
 * A AUDITORIA guarda quem (id e nome do token), qual ferramenta, os argumentos RESUMIDOS e o resultado. O resumo corta o que
 * parece segredo, e-mail ou link e limita o tamanho: o registro serve para saber o que foi pedido, não para guardar conteúdo. */
import { garantirBanco } from './contas-banco.js';
import { agoraS, idAleatorio, sha256Hex, sortearToken } from './contas-cripto.js';

export const ESCOPOS = Object.freeze(['read', 'curate', 'admin']);
export const PREFIXO_DO_TOKEN = 'mcp_';
export const DIAS_PADRAO = 90;
export const DIAS_MAXIMO = 365;
const FORMA_DO_TOKEN = /^mcp_[A-Za-z0-9_-]{43}$/;
const DIA = 86400;
const REUSO_A_CADA_S = 3600;   /* `ultimo_uso` é gravado no máximo uma vez por hora: sem escrita em toda chamada */
export const RETENCAO_DA_AUDITORIA_DIAS = 180;   /* a mesma em contas.js (limparExpirados) */

export const nivelDoEscopo = (escopo) => ESCOPOS.indexOf(escopo);
export const escopoValido = (escopo) => ESCOPOS.indexOf(escopo) >= 0;
/* O escopo MENOR dos dois: o do token e o que a configuração permite (`mcp.somenteLeitura`). */
export const escopoMenor = (a, b) => (nivelDoEscopo(a) <= nivelDoEscopo(b) ? a : b);

export async function hashDoToken(token) {
  return sha256Hex(String(token));
}

export function validarCriacao({ nome, escopo, dias } = {}) {
  const n = typeof nome === 'string' ? nome.trim() : '';
  if (!n || n.length > 60) return { ok: false, codigo: 'mcp-nome-invalido' };
  if (!escopoValido(escopo)) return { ok: false, codigo: 'mcp-escopo-invalido' };
  const d = dias === undefined || dias === null || dias === '' ? DIAS_PADRAO : Number(dias);
  if (!Number.isInteger(d) || d < 1 || d > DIAS_MAXIMO) return { ok: false, codigo: 'mcp-validade-invalida' };
  return { ok: true, nome: n, escopo, dias: d };
}

/* Cria o token. Devolve { id, token, prefixo, nome, escopo, expiraEm }: `token` só existe aqui. */
export async function criarToken(env, { nome, escopo, dias, criadoPor }) {
  const db = await garantirBanco(env);
  if (!db) throw new Error('banco-ausente');
  const v = validarCriacao({ nome, escopo, dias });
  if (!v.ok) throw new Error(v.codigo);
  const token = sortearToken(PREFIXO_DO_TOKEN);
  const id = idAleatorio();
  const t = agoraS();
  const expiraEm = t + v.dias * DIA;
  const prefixo = token.slice(0, PREFIXO_DO_TOKEN.length + 4);
  await db.prepare(
    'INSERT INTO mcp_tokens (id, nome, prefixo, token_hash, escopo, criado_em, criado_por, expira_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, v.nome, prefixo, await hashDoToken(token), v.escopo, t, criadoPor || null, expiraEm).run();
  return { id, token, prefixo, nome: v.nome, escopo: v.escopo, expiraEm };
}

export function bearerDoMcp(request) {
  const c = request.headers.get('authorization') || '';
  return c.toLowerCase().startsWith('bearer ') ? c.slice(7).trim() : '';
}

/* { ok: true, token: { id, nome, escopo } } ou { ok: false, motivo }. Falha FECHADA: banco fora do ar = não autenticado. */
export async function autenticar(env, request, { waitUntil } = {}) {
  const bruto = bearerDoMcp(request);
  if (!bruto) return { ok: false, motivo: 'sem-token' };
  if (!FORMA_DO_TOKEN.test(bruto)) return { ok: false, motivo: 'token-invalido' };
  let db;
  try { db = await garantirBanco(env); } catch (e) { return { ok: false, motivo: 'banco-indisponivel' }; }
  if (!db) return { ok: false, motivo: 'banco-ausente' };
  try {
    const l = await db.prepare(
      'SELECT id, nome, escopo, expira_em, revogado_em, ultimo_uso FROM mcp_tokens WHERE token_hash = ?'
    ).bind(await hashDoToken(bruto)).first();
    if (!l) return { ok: false, motivo: 'token-invalido' };
    const t = agoraS();
    if (l.revogado_em) return { ok: false, motivo: 'token-revogado' };
    if (l.expira_em <= t) return { ok: false, motivo: 'token-vencido' };
    if (!l.ultimo_uso || t - l.ultimo_uso >= REUSO_A_CADA_S) {
      const marca = db.prepare('UPDATE mcp_tokens SET ultimo_uso = ? WHERE id = ?').bind(t, l.id).run().catch(() => {});
      if (typeof waitUntil === 'function') waitUntil(marca); else await marca;
    }
    return { ok: true, token: { id: l.id, nome: l.nome, escopo: l.escopo } };
  } catch (e) {
    return { ok: false, motivo: 'banco-indisponivel' };
  }
}

/* A lista para a mesa e para o CLI: nunca o hash, nunca o token. */
export async function listarTokens(env) {
  const db = await garantirBanco(env);
  if (!db) return [];
  const t = agoraS();
  const linhas = (await db.prepare(
    'SELECT id, nome, prefixo, escopo, criado_em, criado_por, expira_em, revogado_em, ultimo_uso FROM mcp_tokens ORDER BY criado_em DESC LIMIT 200'
  ).all()).results || [];
  return linhas.map((l) => ({
    id: l.id, nome: l.nome, prefixo: l.prefixo, escopo: l.escopo,
    criadoEm: l.criado_em, criadoPor: l.criado_por || null, expiraEm: l.expira_em, revogadoEm: l.revogado_em || null, ultimoUso: l.ultimo_uso || null,
    estado: l.revogado_em ? 'revogado' : (l.expira_em <= t ? 'vencido' : 'ativo')
  }));
}

/* Revoga por id. `true` se havia um token ativo para revogar. */
export async function revogarToken(env, id) {
  const db = await garantirBanco(env);
  if (!db) return false;
  const r = await db.prepare('UPDATE mcp_tokens SET revogado_em = ? WHERE id = ? AND revogado_em IS NULL').bind(agoraS(), String(id || '')).run();
  return Boolean(r && r.meta && r.meta.changes > 0);
}

export async function contarTokensAtivos(env) {
  const db = await garantirBanco(env);
  if (!db) return 0;
  const l = await db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens WHERE revogado_em IS NULL AND expira_em > ?').bind(agoraS()).first();
  return l ? l.n : 0;
}

/* ------------------------------------------------------------------ auditoria */

const PARECE_SEGREDO = /senha|password|token|segredo|secret|chave|key|authorization|bearer|cookie|e-?mail|link|hash/i;
const LIMITE_TEXTO = 120;
const LIMITE_TOTAL = 1000;

/* Argumentos resumidos: campo com cara de segredo, e-mail ou link vira "[oculto]"; texto longo é cortado; lista e objeto
 * entram só até uma profundidade e tamanho pequenos. O resultado é sempre texto JSON curto. */
export function resumirArgumentos(argumentos) {
  function resumir(v, fundo) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (/^\s*(bearer\s+|mcp_|ss_|v2\.|https?:\/\/\S*#)/i.test(v) || /\S+@\S+\.\S+/.test(v)) return '[oculto]';
      return v.length > LIMITE_TEXTO ? v.slice(0, LIMITE_TEXTO) + '…' : v;
    }
    if (fundo >= 3) return '[…]';
    if (Array.isArray(v)) {
      const itens = v.slice(0, 10).map((x) => resumir(x, fundo + 1));
      return v.length > 10 ? itens.concat(['+' + (v.length - 10)]) : itens;
    }
    if (typeof v === 'object') {
      const saida = {};
      for (const k of Object.keys(v).slice(0, 20)) saida[k] = PARECE_SEGREDO.test(k) ? '[oculto]' : resumir(v[k], fundo + 1);
      return saida;
    }
    return String(typeof v);
  }
  let texto;
  try { texto = JSON.stringify(resumir(argumentos === undefined ? {} : argumentos, 0)); } catch (e) { texto = '{}'; }
  return texto.length > LIMITE_TOTAL ? texto.slice(0, LIMITE_TOTAL) + '…' : texto;
}

export async function registrarAuditoria(env, { token, ferramenta, argumentos, resultado, detalhe }) {
  try {
    const db = await garantirBanco(env);
    if (!db) return false;
    await db.prepare(
      'INSERT INTO mcp_auditoria (em, token_id, token_nome, ferramenta, argumentos, resultado, detalhe) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(agoraS(), token.id, token.nome, String(ferramenta || '').slice(0, 60), resumirArgumentos(argumentos), resultado, detalhe ? String(detalhe).slice(0, 120) : null).run();
    return true;
  } catch (e) {
    return false;   /* a auditoria é memória: o erro dela não derruba a chamada, mas o teste cobra que ela grave */
  }
}

export async function listarAuditoria(env, { limite = 50, antesDe = null } = {}) {
  const db = await garantirBanco(env);
  if (!db) return [];
  const n = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const linhas = antesDe
    ? (await db.prepare('SELECT id, em, token_id, token_nome, ferramenta, argumentos, resultado, detalhe FROM mcp_auditoria WHERE id < ? ORDER BY id DESC LIMIT ?').bind(Number(antesDe), n).all()).results
    : (await db.prepare('SELECT id, em, token_id, token_nome, ferramenta, argumentos, resultado, detalhe FROM mcp_auditoria ORDER BY id DESC LIMIT ?').bind(n).all()).results;
  return (linhas || []).map((l) => ({
    id: l.id, em: l.em, tokenId: l.token_id, tokenNome: l.token_nome, ferramenta: l.ferramenta,
    argumentos: l.argumentos, resultado: l.resultado, detalhe: l.detalhe || null
  }));
}
