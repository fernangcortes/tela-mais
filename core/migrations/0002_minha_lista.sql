-- 0002_minha_lista.sql — "Minha lista": os títulos que cada espectador guardou para ver depois (M6).
--
-- Mesma regra da 0001: tudo IF NOT EXISTS, e o texto também vai em indice.mjs. Uma linha por título e por
-- pessoa. A chave é (usuario_id, titulo_id): guardar duas vezes não duplica. O índice por (usuario_id,
-- adicionado_em) é o que a leitura usa — "os meus, do mais novo para o mais velho" — e o D1 grátis cobra por
-- linha lida, então a consulta sempre leva LIMIT (tests/home-minha-lista.test.js confere o plano com EXPLAIN).
-- Excluir a conta apaga estas linhas (contas.js, excluirUsuario) e a exportação as inclui.

CREATE TABLE IF NOT EXISTS minha_lista (
  usuario_id TEXT NOT NULL,
  titulo_id TEXT NOT NULL,
  adicionado_em INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, titulo_id)
);
CREATE INDEX IF NOT EXISTS minha_lista_recentes ON minha_lista (usuario_id, adicionado_em);
