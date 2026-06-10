import type Database from 'better-sqlite3'

export const version = 14
export const name = '014_sessions_repo_nullable'

// `sessions` é referenciada por feature_session_records (010); recriar a tabela
// com FK ON faria o DROP falhar. O runner desliga foreign_keys nesta migration
// e roda PRAGMA foreign_key_check ao final.
export const disableForeignKeys = true

// Padrão 12-step do SQLite: não existe ALTER COLUMN DROP NOT NULL, então
// recriamos `sessions` com repo_id nullable (sessão avulsa = sem repo).
// Schema idêntico ao vigente (001 + feature_id da 007), exceto o NOT NULL.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions_new (
      id              TEXT PRIMARY KEY,
      repo_id         TEXT REFERENCES repos(id) ON DELETE CASCADE,
      cc_session_id   TEXT,
      title           TEXT,
      pane_id         TEXT,
      status          TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER,
      feature_id      TEXT REFERENCES features(id) ON DELETE SET NULL
    );

    INSERT INTO sessions_new
      (id, repo_id, cc_session_id, title, pane_id, status, started_at, ended_at, feature_id)
    SELECT id, repo_id, cc_session_id, title, pane_id, status, started_at, ended_at, feature_id
    FROM sessions;

    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;

    CREATE INDEX idx_sessions_repo ON sessions(repo_id);
    CREATE INDEX idx_sessions_status ON sessions(status);
  `)
}
