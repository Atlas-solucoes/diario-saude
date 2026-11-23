-- Diário de Saúde (Atlas Saúde): banco D1 de UMA família. Só acrescenta; seguro rodar de novo.
-- Nenhum nome real: pessoas são ids; apelidos ficam no documento da família (só o responsável edita).
CREATE TABLE IF NOT EXISTS contador (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT OR IGNORE INTO contador (id, seq) VALUES (1, 0);

-- Uso único de cada código inicial: o primeiro pedido que grava o hash "ganha" (vira o responsável).
CREATE TABLE IF NOT EXISTS reivindicacoes (codigo_hash TEXT PRIMARY KEY, lance TEXT NOT NULL, em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS aparelhos (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, papel TEXT NOT NULL, responsavel INTEGER NOT NULL DEFAULT 0,
  nome TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, revogado INTEGER NOT NULL DEFAULT 0,
  codigo_hash TEXT); -- só no responsável: hash do código inicial que ele usou (trocar o código o desconecta)

CREATE TABLE IF NOT EXISTS convites (hash TEXT PRIMARY KEY, papel TEXT NOT NULL, expira INTEGER NOT NULL, usado INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS registros (
  id TEXT PRIMARY KEY, tipo TEXT NOT NULL, data_hora TEXT NOT NULL, dados TEXT NOT NULL,
  anotado_por TEXT NOT NULL, sobre TEXT NOT NULL, versao INTEGER NOT NULL, modelo_versao INTEGER NOT NULL,
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, atualizado_ms INTEGER NOT NULL, apagado INTEGER NOT NULL,
  seq INTEGER NOT NULL, origem TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS registros_seq ON registros (seq);

-- Versões que perderam um conflito (nada se perde no servidor por conflito).
CREATE TABLE IF NOT EXISTS historico (rid TEXT NOT NULL, conteudo TEXT NOT NULL, em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS historico_rid ON historico (rid);

-- Tentativas erradas (convite e código inicial). ip = SHA-256 do IP, nunca o IP em claro.
CREATE TABLE IF NOT EXISTS tentativas (ip TEXT NOT NULL, tipo TEXT NOT NULL, em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tentativas_ip_em ON tentativas (ip, em);

-- Documento da família (apelidos/emojis/apelido de quem a gente cuida) e foto: 1 linha cada, com versão.
CREATE TABLE IF NOT EXISTS familia (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, versao INTEGER NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS foto (id INTEGER PRIMARY KEY CHECK (id = 1), mime TEXT NOT NULL, base64 TEXT NOT NULL, versao INTEGER NOT NULL, atualizado_em TEXT NOT NULL);
