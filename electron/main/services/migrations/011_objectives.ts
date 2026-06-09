import type Database from 'better-sqlite3'

export const version = 11
export const name = '011_objectives'

// Camada genérica de Objetivos/OKRs (Fase 1). Persistência SQLite-only — sem
// espelho .md nem watcher (diferente de Features). tags é TEXT JSON (strings
// opacas, sem FK); progresso é calculado em runtime via shared/progress.ts.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE objectives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('okr','personal_goal','project','custom')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','archived')),
      period TEXT,
      start_date INTEGER,
      end_date INTEGER,
      parent_objective_id TEXT REFERENCES objectives(id) ON DELETE SET NULL,
      priority TEXT CHECK (priority IN ('low','medium','high')),
      owner TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      progress_mode TEXT NOT NULL DEFAULT 'auto_rollup' CHECK (progress_mode IN ('auto_rollup','metric','manual')),
      progress_manual REAL,
      baseline REAL, current REAL, target REAL,
      unit TEXT,
      direction TEXT CHECK (direction IN ('increase','decrease','maintain')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at INTEGER
    );
    CREATE INDEX idx_objectives_status ON objectives(status);
    CREATE INDEX idx_objectives_kind ON objectives(kind);
    CREATE INDEX idx_objectives_parent ON objectives(parent_objective_id);

    CREATE TABLE key_results (
      id TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','cancelled')),
      weight REAL,
      progress_mode TEXT NOT NULL DEFAULT 'manual' CHECK (progress_mode IN ('auto_rollup','metric','manual')),
      progress_manual REAL,
      baseline REAL, current REAL, target REAL,
      unit TEXT,
      direction TEXT CHECK (direction IN ('increase','decrease','maintain')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_kr_objective ON key_results(objective_id);
  `)
}
