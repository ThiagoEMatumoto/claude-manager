import type Database from 'better-sqlite3'

export const version = 1
export const name = '001_init'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       TEXT,
      icon        TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE repos (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      path        TEXT NOT NULL,
      role        TEXT,
      position    INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_repos_project ON repos(project_id);

    CREATE TABLE repo_dependencies (
      from_repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      to_repo_id   TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      kind         TEXT,
      PRIMARY KEY (from_repo_id, to_repo_id)
    );

    CREATE TABLE sessions (
      id              TEXT PRIMARY KEY,
      repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      cc_session_id   TEXT,
      title           TEXT,
      pane_id         TEXT,
      status          TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      ended_at        INTEGER
    );
    CREATE INDEX idx_sessions_repo ON sessions(repo_id);
    CREATE INDEX idx_sessions_status ON sessions(status);

    CREATE TABLE layouts (
      project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE workspace_state (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      last_opened_at    INTEGER NOT NULL,
      clean_shutdown    INTEGER NOT NULL DEFAULT 0,
      restore_attempts  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE app_prefs (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}
