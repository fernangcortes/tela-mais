/* _lib/sessoes.js — quem é a pessoa por trás da requisição.
 *
 *   sessaoDaRequisicao(request, env, { config?, waitUntil? })
 *       -> { papel, usuarioId?, conta?, email?, origem? }
 *
 *   papel 'anonimo'     ninguém identificado (também: sessão inválida, vencida,
 *                       revogada, banco fora do ar — falha FECHADA)
 *   papel 'espectador'  sessão de cookie de um espectador ativo (D1)
 *   papel 'equipe'      token Bearer de uma conta da equipe (`conta` preenchida)
 *   papel 'super'       token Bearer do superadmin (`conta` preenchida)
 *   usuarioId           id em `usuarios` (espectador e equipe; o super não tem linha)
 *   origem              'cookie' | 'bearer'
 *   expiraEm            (cookie) fim da sessão, UNIX s: limita a validade da URL de mídia assinada
 *
 * O Bearer da equipe segue como era (HMAC assinado por SESSION_SECRET, em
 * _lib/sessao.js): os scripts de carga e a mesa dependem dele. O espectador usa
 * COOKIE OPACO: 32 bytes sorteados, `HttpOnly; Secure; SameSite=Lax; Path=/`, e só o
 * SHA-256 dele fica na tabela `sessoes` — vazar o banco não vale sessão, e
 * revogar é apagar a linha (vale no pedido seguinte).
 *
 * CUSTO. Uma requisição com cookie lê 2 linhas, ambas por índice: `sessoes` pela
 * chave primária e `usuarios` pela chave primária (um JOIN). A sessão é
 * RENOVADA (deslizante) no máximo uma vez por dia: não há escrita por requisição.
 *
 * CSRF. O cookie é SameSite=Lax (o navegador não o manda em POST de outro site),
 * e, por cima, um método que muda estado com `Origin` de outro site, ou
 * `Sec-Fetch-Site: cross-site`, é tratado como anônimo. */
import { contaDoToken } from './sessao.js';
import { garantirBanco } from './contas-banco.js';
import { agoraS, sha256Hex, sortearToken } from './contas-cripto.js';

export const NOME_COOKIE = '__Host-sessao';
const FORMA_TOKEN = /^ss_[A-Za-z0-9_-]{43}$/;
const RENOVAR_A_CADA_S = 24 * 3600;
const HORAS_PADRAO = 720;

function valorDoCookie(request, nome) {
  const cabecalho = request.headers.get('cookie');
  if (!cabecalho) return '';
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return '';
}

export function bearerDe(request) {
  const c = request.headers.get('authorization') || '';
  return c.toLowerCase().startsWith('bearer ') ? c.slice(7).trim() : '';
}

/* Mudar estado com cookie só vale vindo do próprio site. */
export function origemConfiavel(request) {
  const metodo = request.method;
  if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return true;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origem = request.headers.get('origin');
  if (!origem) return true;
  try { return origem === new URL(request.url).origin; } catch (e) { return false; }
}

const ANONIMO = Object.freeze({ papel: 'anonimo' });

export async function sessaoDaRequisicao(request, env, opcoes = {}) {
  const bearer = bearerDe(request);
  if (bearer) {
    const conta = await contaDoToken(bearer, env);
    if (conta) {
      return { papel: conta.super === true ? 'super' : 'equipe', usuarioId: conta.id, conta, origem: 'bearer' };
    }
  }

  const token = valorDoCookie(request, NOME_COOKIE);
  if (!token || !FORMA_TOKEN.test(token) || !origemConfiavel(request)) return ANONIMO;

  let db;
  try { db = await garantirBanco(env); } catch (e) { return ANONIMO; }
  if (!db) return ANONIMO;

  try {
    const hash = await sha256Hex(token);
    const l = await db.prepare(
      'SELECT s.usuario_id, s.expira_em, s.renovada_em, u.email, u.papel, u.status ' +
      'FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?'
    ).bind(hash).first();
    const t = agoraS();
    if (!l || l.expira_em <= t || l.status !== 'ativo' || l.papel !== 'espectador') return ANONIMO;

    if (t - l.renovada_em > RENOVAR_A_CADA_S) {
      const horas = (opcoes.horasEspectador || HORAS_PADRAO);
      const renovar = db.batch([
        db.prepare('UPDATE sessoes SET renovada_em = ?, expira_em = ? WHERE token_hash = ?').bind(t, t + horas * 3600, hash),
        db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').bind(t, l.usuario_id)
      ]).catch(() => {});
      if (typeof opcoes.waitUntil === 'function') opcoes.waitUntil(renovar); else await renovar;
    }
    return { papel: 'espectador', usuarioId: l.usuario_id, email: l.email, origem: 'cookie', sessaoHash: hash, expiraEm: l.expira_em };
  } catch (e) {
    return ANONIMO;
  }
}

/* ---------------------------------------------------------- ciclo de vida */

/* Abre uma sessão. Respeita o teto de sessões simultâneas: ao passar dele, as
 * mais antigas caem (quem entra num aparelho novo derruba o mais velho). */
export async function criarSessao(db, { usuarioId, horas = HORAS_PADRAO, maximo = 5, ua = '' }) {
  const token = sortearToken('ss_');
  const hash = await sha256Hex(token);
  const t = agoraS();
  const atuais = ((await db.prepare('SELECT token_hash FROM sessoes WHERE usuario_id = ? AND expira_em > ? ORDER BY criado_em ASC')
    .bind(usuarioId, t).all()).results || []).map((l) => l.token_hash);
  const sobra = Math.max(0, atuais.length - (maximo - 1));
  const comandos = [db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND expira_em <= ?').bind(usuarioId, t)];
  for (const antigo of atuais.slice(0, sobra)) comandos.push(db.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(antigo));
  comandos.push(
    db.prepare('INSERT INTO sessoes (token_hash, usuario_id, criado_em, renovada_em, expira_em, ua) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(hash, usuarioId, t, t, t + horas * 3600, String(ua || '').slice(0, 120)),
    db.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?').bind(t, usuarioId)
  );
  await db.batch(comandos);
  return { token, expiraEm: t + horas * 3600, derrubadas: sobra };
}

export async function revogarSessao(db, hash) {
  await db.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(hash).run();
}

export async function revogarTodas(db, usuarioId, { exceto = null } = {}) {
  if (exceto) await db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?').bind(usuarioId, exceto).run();
  else await db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(usuarioId).run();
}

export async function contarSessoes(db, usuarioId) {
  const l = await db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ? AND expira_em > ?').bind(usuarioId, agoraS()).first();
  return l ? l.n : 0;
}

/* ------------------------------------------------------------------ cookie */

export function cookieDeSessao(token, { horas = HORAS_PADRAO, sameSite = 'Lax' /* i18n-ignorar: valor de cookie */ } = {}) {
  return `${NOME_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(horas * 3600)}; HttpOnly; Secure; SameSite=${sameSite}`;
}

export function cookieApagado() {
  return `${NOME_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/* O IP que o Cloudflare viu; sem ele (dev local, teste), um balde único. */
export function ipDe(request) {
  return request.headers.get('cf-connecting-ip') || 'desconhecido';
}
