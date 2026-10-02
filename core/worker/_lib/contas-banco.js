/* _lib/contas-banco.js — o D1 (binding `DB`): criação preguiçosa e a migração da
 * equipe que morava no KV.
 *
 * CRIAÇÃO PREGUIÇOSA. O cliente não precisa rodar `wrangler d1 migrations apply`:
 * a primeira requisição que precisa do banco aplica as migrações que faltam
 * (core/migrations/indice.mjs, o mesmo SQL dos .sql) dentro de um `batch`, que o
 * D1 executa como uma transação. É idempotente (IF NOT EXISTS) e usa a mesma
 * tabela `d1_migrations` do wrangler, então os dois caminhos convivem. O
 * resultado fica guardado por isolate: só o primeiro pedido de cada isolate paga
 * as 2 consultas de conferência; os seguintes não tocam o banco por isso.
 *
 * MIGRAÇÃO DA EQUIPE. Quem já tinha contas de equipe no KV (chave `admins`) as
 * vê passar para a tabela `usuarios` na primeira execução com D1, com a mesma
 * `versao` (os tokens abertos continuam valendo) e o mesmo hash de senha. A chave
 * do KV NÃO é apagada: fica como cópia de segurança, e o marcador
 * `equipe-importada-do-kv` na tabela `meta` impede de importar duas vezes.
 *
 * SEM `DB`: `garantirBanco` devolve null, e quem chama decide. A equipe cai de
 * volta para o KV (instalações antigas e testes); contas de espectador e tudo o
 * que depende de pessoas respondem 503 `banco-ausente` — falha fechada. */
import { MIGRACOES } from '../../migrations/indice.mjs';
import { agoraS, idAleatorio } from './contas-cripto.js';

export function temBanco(env) {
  return Boolean(env && env.DB && typeof env.DB.prepare === 'function');
}

/* "-- comentário" some, `;` separa. Não há `;` nem `--` dentro de texto nas migrações. */
export function dividirSql(sql) {
  return String(sql)
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

const CHAVE_KV_EQUIPE = 'admins';
export const MARCADOR_IMPORTACAO = 'equipe-importada-do-kv';

const prontos = new WeakMap();   /* DB -> Promise */

async function aplicarMigracoes(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  const feitas = new Set(((await db.prepare('SELECT name FROM d1_migrations').all()).results || []).map((l) => l.name));
  for (const m of MIGRACOES) {
    if (feitas.has(m.nome)) continue;
    const comandos = dividirSql(m.sql).map((s) => db.prepare(s));
    comandos.push(db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(m.nome));
    await db.batch(comandos);
  }
}

async function importarEquipeDoKv(env, db) {
  const marcada = await db.prepare('SELECT valor FROM meta WHERE chave = ?').bind(MARCADOR_IMPORTACAO).first();
  if (marcada) return;
  let contas = [];
  if (env.CATALOGO && typeof env.CATALOGO.get === 'function') {
    const guardado = await env.CATALOGO.get(CHAVE_KV_EQUIPE, 'json');
    if (guardado && Array.isArray(guardado.contas)) contas = guardado.contas;
  }
  const paraS = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) ? Math.floor(t / 1000) : agoraS();
  };
  const comandos = [];
  for (const c of contas) {
    if (!c || typeof c.usuario !== 'string' || !c.usuario) continue;
    comandos.push(db.prepare(
      'INSERT OR IGNORE INTO usuarios (id, login, nome, papel, status, senha, permissoes, limite_envio, envios, versao, criado_em, criado_por, alterado_em) ' +
      "VALUES (?, ?, ?, 'equipe', ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      idAleatorio(), c.usuario, c.nome || c.usuario, c.ativa === false ? 'bloqueado' : 'ativo',
      c.senha ? JSON.stringify(c.senha) : null,
      JSON.stringify(Array.isArray(c.permissoes) ? c.permissoes : []),
      c.limiteEnvio ? JSON.stringify(c.limiteEnvio) : null,
      Number(c.enviosContagem) || 0, Number(c.versao) || 1,
      paraS(c.criada_em), c.criada_por || null, c.alterada_em ? paraS(c.alterada_em) : null
    ));
  }
  comandos.push(db.prepare('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)').bind(MARCADOR_IMPORTACAO, String(contas.length) + ':' + agoraS()));
  await db.batch(comandos);
}

/* O banco pronto, ou null se não há binding `DB`. Lança se o D1 falhar: quem
 * chama trata como "indisponível" e fecha. */
export function garantirBanco(env) {
  if (!temBanco(env)) return Promise.resolve(null);
  const db = env.DB;
  let p = prontos.get(db);
  if (!p) {
    p = (async () => {
      await aplicarMigracoes(db);
      await importarEquipeDoKv(env, db);
      return db;
    })();
    prontos.set(db, p);
    p.catch(() => { if (prontos.get(db) === p) prontos.delete(db); });
  }
  return p;
}
