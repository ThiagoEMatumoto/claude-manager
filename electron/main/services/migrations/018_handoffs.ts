import type Database from 'better-sqlite3'

export const version = 18
export const name = '018_handoffs'

// Handoff cross-repo: uma sessão-mãe pede pra abrir uma sessão-filha noutro repo
// com um prompt estruturado, passa por gate humano e a filha reporta de volta.
//
// mother_session_id e child_session_id são NULLABLE e SEM FK de propósito: a MCP
// tool pode não saber o id da própria sessão, e a sessão-filha só é criada na
// aprovação (wave posterior). Só target_repo_id tem FK (CASCADE). status app-level:
// pending|approved|running|done|rejected|failed. Nada referencia handoffs, então o
// runner não precisa de disableForeignKeys.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE handoffs (
      id                TEXT PRIMARY KEY,
      mother_session_id TEXT,
      target_repo_id    TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      child_session_id  TEXT,
      feature_id        TEXT,
      task              TEXT NOT NULL,
      context_json      TEXT,
      composed_prompt   TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      summary           TEXT,
      error             TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE INDEX idx_handoffs_status ON handoffs(status);
    CREATE INDEX idx_handoffs_target ON handoffs(target_repo_id);
  `)
}
