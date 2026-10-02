/* _lib/limite.js — freio contra tentativa em série: janela fixa e bloqueio progressivo.
 *
 * DOIS MECANISMOS, PARA COISAS DIFERENTES:
 *
 *   limitar()          "no máximo N em J segundos" por chave (IP, e-mail). Serve
 *                      para rajada: a 11ª tentativa de login em 10 s é recusada.
 *   falhar()/bloqueio  contador de FALHAS por chave, com bloqueio que cresce:
 *                      a partir da 5ª falha seguida, 1 min, 2 min, 4 min... até 1 h.
 *                      Acerto zera (`limparFalhas`). A chave combina IP + conta,
 *                      de propósito: quem erra a senha de outra pessoa não a
 *                      tranca para o dono (sem negação de serviço).
 *
 * ONDE MORA. Se o Worker tem um binding de Rate Limiting do Cloudflare (nome
 * `LIMITE_ENTRADA`, ver wrangler.jsonc), `limitar` usa ele: é de graça e não
 * gasta escrita de D1. Sem o binding, cai num contador no D1 (tabela `limites`,
 * uma escrita por tentativa, só nas rotas de entrada — nunca em leitura de
 * catálogo). O binding é por localidade e aproximado; o contador do D1 é exato.
 * Sem nenhum dos dois (sem D1, sem binding), NÃO há limite: devolve ok e o
 * chamador segue — por isso as rotas de espectador, que exigem D1, sempre têm.
 *
 * A chave nunca é o IP nem o e-mail em claro: vai por hashDe(). */
import { garantirBanco } from './contas-banco.js';
import { agoraS, hashDe } from './contas-cripto.js';
import { erro } from './sessao.js';

export const BINDING_DE_LIMITE = 'LIMITE_ENTRADA';
const PRIMEIRA_FALHA_QUE_BLOQUEIA = 5;
const BLOQUEIO_MAXIMO_S = 3600;

/* `escopo` é o nome da rota ("login", "link"...); `quem` o que se limita (IP, e-mail). */
export async function chaveDe(env, escopo, quem) {
  return escopo + ':' + await hashDe(env, String(quem));
}

/* { ok, restante, tentarEmS }. */
export async function limitar(env, { chave, max, janelaS }) {
  const binding = env && env[BINDING_DE_LIMITE];
  if (binding && typeof binding.limit === 'function') {
    try {
      const r = await binding.limit({ key: chave });
      return r && r.success === false ? { ok: false, restante: 0, tentarEmS: janelaS } : { ok: true, restante: max };
    } catch (e) { /* binding quebrado: cai no D1 */ }
  }
  const db = await garantirBanco(env);
  if (!db) return { ok: true, restante: max };
  const t = agoraS();
  const r = await db.prepare(
    'INSERT INTO limites (chave, janela_ini, contagem, atualizado_em) VALUES (?1, ?2, 1, ?2) ' +
    'ON CONFLICT(chave) DO UPDATE SET ' + /* i18n-ignorar: SQL */
    'contagem = CASE WHEN janela_ini <= ?2 - ?3 THEN 1 ELSE contagem + 1 END, ' +
    'janela_ini = CASE WHEN janela_ini <= ?2 - ?3 THEN ?2 ELSE janela_ini END, ' +
    'atualizado_em = ?2 RETURNING contagem, janela_ini'
  ).bind(chave, t, janelaS).all();
  const l = (r.results || [])[0] || { contagem: 1, janela_ini: t };
  if (l.contagem > max) return { ok: false, restante: 0, tentarEmS: Math.max(1, l.janela_ini + janelaS - t) };
  return { ok: true, restante: max - l.contagem };
}

/* LIMITE POR CONTA, só de FALHAS e só no D1 (o binding não deixa espiar sem contar).
 * Complementa o bloqueio por IP + conta: quem varia o IP (ou um /64 de IPv6) não escapa
 * do teto da conta. É ALTO de propósito (o dono errando a própria senha não chega perto) e
 * só conta falha; acerto não gasta. O dono fica de fora do teto só pelos outros caminhos
 * (link mágico, convite do admin), que não passam por aqui. */
export async function contaSobrecarregada(env, chave, { max, janelaS }) {
  const db = await garantirBanco(env);
  if (!db) return { bloqueado: false };
  const l = await db.prepare('SELECT janela_ini, contagem FROM limites WHERE chave = ?').bind(chave).first();
  const t = agoraS();
  if (l && l.contagem >= max && l.janela_ini > t - janelaS) return { bloqueado: true, tentarEmS: Math.max(1, l.janela_ini + janelaS - t) };
  return { bloqueado: false };
}

export async function registrarFalhaDaConta(env, chave, janelaS) {
  const db = await garantirBanco(env);
  if (!db) return;
  const t = agoraS();
  await db.prepare(
    'INSERT INTO limites (chave, janela_ini, contagem, atualizado_em) VALUES (?1, ?2, 1, ?2) ' +
    'ON CONFLICT(chave) DO UPDATE SET ' + /* i18n-ignorar: SQL */
    'contagem = CASE WHEN janela_ini <= ?2 - ?3 THEN 1 ELSE contagem + 1 END, ' +
    'janela_ini = CASE WHEN janela_ini <= ?2 - ?3 THEN ?2 ELSE janela_ini END, ' +
    'atualizado_em = ?2'
  ).bind(chave, t, janelaS).run();
}

/* Está bloqueado agora? { bloqueado, tentarEmS }. Leitura de uma linha, por chave primária. */
export async function bloqueioAtivo(env, chave) {
  const db = await garantirBanco(env);
  if (!db) return { bloqueado: false };
  const l = await db.prepare('SELECT bloqueado_ate FROM limites WHERE chave = ?').bind(chave).first();
  const t = agoraS();
  return l && l.bloqueado_ate > t ? { bloqueado: true, tentarEmS: l.bloqueado_ate - t } : { bloqueado: false };
}

/* Registra uma falha; da 5ª em diante, bloqueia por 60 s * 2^(falhas - 5), no máximo 1 h. */
export async function falhar(env, chave) {
  const db = await garantirBanco(env);
  if (!db) return { falhas: 0 };
  const t = agoraS();
  const r = await db.prepare(
    'INSERT INTO limites (chave, falhas, atualizado_em) VALUES (?1, 1, ?2) ' +
    'ON CONFLICT(chave) DO UPDATE SET falhas = falhas + 1, atualizado_em = ?2 RETURNING falhas'
  ).bind(chave, t).all();
  const falhas = ((r.results || [])[0] || { falhas: 1 }).falhas;
  if (falhas >= PRIMEIRA_FALHA_QUE_BLOQUEIA) {
    const espera = Math.min(60 * 2 ** (falhas - PRIMEIRA_FALHA_QUE_BLOQUEIA), BLOQUEIO_MAXIMO_S);
    await db.prepare('UPDATE limites SET bloqueado_ate = ? WHERE chave = ?').bind(t + espera, chave).run();
    return { falhas, bloqueadoPorS: espera };
  }
  return { falhas };
}

export async function limparFalhas(env, chave) {
  const db = await garantirBanco(env);
  if (!db) return;
  await db.prepare('DELETE FROM limites WHERE chave = ?').bind(chave).run();
}

/* A resposta 429, com Retry-After: o mesmo formato em toda rota que freia. */
export function respostaDeLimite(tentarEmS) {
  const segundos = Math.max(1, Math.ceil(Number(tentarEmS) || 1));
  const r = erro(429, 'muitas-tentativas', { segundos }, { tentarEmS: segundos });
  const cab = new Headers(r.headers);
  cab.set('retry-after', String(segundos));
  return new Response(r.body, { status: 429, headers: cab });
}
