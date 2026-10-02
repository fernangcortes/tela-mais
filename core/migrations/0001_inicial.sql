-- 0001_inicial.sql — pessoas: equipe, espectadores, sessões, convites, links
-- mágicos, consentimentos, limites de tentativa e textos legais.
--
-- Roda de dois jeitos, com o mesmo resultado: `wrangler d1 migrations apply DB`
-- (a pasta é a `migrations_dir` do wrangler.jsonc) ou sozinho, na primeira
-- requisição que precisa do banco (core/worker/_lib/contas-banco.js). Por isso
-- tudo é IF NOT EXISTS. Mudou este arquivo? Atualize também indice.mjs: um
-- teste confere que os dois dizem a mesma coisa.
--
-- D1 GRÁTIS COBRA POR LINHA LIDA: toda consulta do caminho quente (sessão, conta
-- da equipe) tem índice, e tests/contas-d1.test.js confere com EXPLAIN QUERY
-- PLAN que nenhuma varre a tabela. Tempo é segundo Unix (inteiro).

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  login TEXT UNIQUE,
  nome TEXT NOT NULL DEFAULT '',
  papel TEXT NOT NULL DEFAULT 'espectador' CHECK (papel IN ('espectador', 'equipe')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'convidado', 'pendente', 'bloqueado')),
  senha TEXT,
  permissoes TEXT,
  limite_envio TEXT,
  envios INTEGER NOT NULL DEFAULT 0,
  versao INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL,
  criado_por TEXT,
  alterado_em INTEGER,
  ultimo_acesso INTEGER
);
CREATE INDEX IF NOT EXISTS usuarios_papel ON usuarios (papel, criado_em);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  renovada_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes (usuario_id, criado_em);
CREATE INDEX IF NOT EXISTS sessoes_expira ON sessoes (expira_em);

CREATE TABLE IF NOT EXISTS convites (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'espectador',
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER,
  criado_por TEXT
);
CREATE INDEX IF NOT EXISTS convites_email ON convites (email);
CREATE INDEX IF NOT EXISTS convites_expira ON convites (expira_em);

CREATE TABLE IF NOT EXISTS links_magicos (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  usado_em INTEGER
);
CREATE INDEX IF NOT EXISTS links_magicos_email ON links_magicos (email);
CREATE INDEX IF NOT EXISTS links_magicos_expira ON links_magicos (expira_em);

CREATE TABLE IF NOT EXISTS consentimentos (
  usuario_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  versao INTEGER NOT NULL,
  aceito_em INTEGER NOT NULL,
  ip_hash TEXT,
  PRIMARY KEY (usuario_id, tipo, versao)
);

CREATE TABLE IF NOT EXISTS limites (
  chave TEXT PRIMARY KEY,
  janela_ini INTEGER NOT NULL DEFAULT 0,
  contagem INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate INTEGER NOT NULL DEFAULT 0,
  atualizado_em INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS limites_atualizado ON limites (atualizado_em);

CREATE TABLE IF NOT EXISTS documentos (
  tipo TEXT PRIMARY KEY,
  versao INTEGER NOT NULL DEFAULT 1,
  campos TEXT,
  textos TEXT,
  atualizado_em INTEGER NOT NULL DEFAULT 0,
  atualizado_por TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
