-- 0003_mcp.sql — integração MCP (M10): tokens de agentes de IA e o registro de auditoria do que eles fizeram.
--
-- Mesma regra das anteriores: tudo IF NOT EXISTS, e o texto também vai em indice.mjs.
-- `mcp_tokens` guarda SÓ o SHA-256 do token (o token em si aparece uma vez, ao criar). `escopo` é read, curate ou admin.
-- `expira_em` é obrigatório: token sem validade não existe. Revogar é preencher `revogado_em` (vale no pedido seguinte).
-- `mcp_auditoria` guarda quem (token), qual ferramenta, os argumentos RESUMIDOS (sem segredo) e o resultado.
-- A consulta quente é a do token por `token_hash` (índice único); a auditoria é lida do mais novo para o mais velho.

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  prefixo TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  escopo TEXT NOT NULL CHECK (escopo IN ('read', 'curate', 'admin')),
  criado_em INTEGER NOT NULL,
  criado_por TEXT,
  expira_em INTEGER NOT NULL,
  revogado_em INTEGER,
  ultimo_uso INTEGER
);

CREATE TABLE IF NOT EXISTS mcp_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  em INTEGER NOT NULL,
  token_id TEXT NOT NULL,
  token_nome TEXT NOT NULL,
  ferramenta TEXT NOT NULL,
  argumentos TEXT,
  resultado TEXT NOT NULL,
  detalhe TEXT
);
CREATE INDEX IF NOT EXISTS mcp_auditoria_em ON mcp_auditoria (em);
