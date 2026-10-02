/* tests/fixtures/d1-falso.js — um D1 de mentira, em memória, sobre o node:sqlite (Node 22).
 *
 * Implementa o que o código do Worker usa da API do D1: prepare().bind().run()/all()/first(),
 * batch() (uma transação) e exec(). SQL de verdade: as migrações rodam como em produção, e o
 * `EXPLAIN QUERY PLAN` do SQLite diz se uma consulta usa índice (o D1 cobra por linha lida).
 *
 * `chamadas` registra cada SQL executado, com os parâmetros, para os testes de custo. */
'use strict';
const { DatabaseSync } = require('node:sqlite');

function criarD1Falso() {
  const bd = new DatabaseSync(':memory:');
  const chamadas = [];

  function executar(sql, params, modo) {
    chamadas.push({ sql, params: params.slice() });
    const st = bd.prepare(sql);
    if (modo === 'run') {
      const r = st.run(...params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    const linhas = st.all(...params).map((l) => Object.assign({}, l));
    return { success: true, results: linhas, meta: { changes: 0, rows_read: linhas.length } };
  }

  function criarStmt(sql, params) {
    return {
      sql,
      params,
      bind(...p) { return criarStmt(sql, p); },
      async run() { return executar(sql, params, 'run'); },
      async all() { return executar(sql, params, 'all'); },
      async first(coluna) {
        const r = executar(sql, params, 'all').results[0];
        if (!r) return null;
        return coluna ? r[coluna] : r;
      }
    };
  }

  const db = {
    chamadas,
    bruto: bd,
    prepare(sql) { return criarStmt(sql, []); },
    async exec(sql) { bd.exec(sql); return { count: 1 }; },
    async batch(stmts) {
      bd.exec('BEGIN');
      try {
        const saida = stmts.map((s) => executar(s.sql, s.params, /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(s.sql) && !/RETURNING/i.test(s.sql) ? 'run' : 'all'));
        bd.exec('COMMIT');
        return saida;
      } catch (e) {
        try { bd.exec('ROLLBACK'); } catch (e2) { /* já desfeito */ }
        throw e;
      }
    },
    /* Plano de execução do SQLite: linhas de texto ("SEARCH usuarios USING INDEX ..."). */
    explicar(sql, params) {
      return bd.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(params || [])).map((l) => l.detail);
    },
    /* Atalho de teste: consulta direta, fora do registro de chamadas. */
    consultar(sql, ...params) { return bd.prepare(sql).all(...params).map((l) => Object.assign({}, l)); }
  };
  return db;
}

module.exports = { criarD1Falso };
