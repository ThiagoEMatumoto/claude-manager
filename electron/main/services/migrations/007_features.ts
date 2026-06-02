import type Database from 'better-sqlite3'

export const version = 7
export const name = '007_features'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE features (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL,
      title       TEXT NOT NULL,
      status      TEXT NOT NULL,
      objective   TEXT,
      doc_path    TEXT NOT NULL,
      synth_mode  TEXT NOT NULL DEFAULT 'threshold',
      model       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at INTEGER
    );
    CREATE UNIQUE INDEX idx_features_proj_slug ON features(project_id, slug);

    CREATE TABLE feature_repos (
      feature_id    TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      repo_id       TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      branch        TEXT,
      worktree_path TEXT,
      PRIMARY KEY (feature_id, repo_id)
    );

    ALTER TABLE sessions ADD COLUMN feature_id TEXT REFERENCES features(id) ON DELETE SET NULL;
  `)
}
