import type Database from 'better-sqlite3'

export const version = 32
export const name = '032_feature_app_dev'

// is_app_dev distingue features de trabalho de dev-do-próprio-app (achado-raiz
// #5 da curadoria: "app-dev e trabalho competem pelo mesmo espaço sem nenhum
// discriminador automático"). Vive só no SQLite (mesmo padrão de origin/
// archived_at) — resolveFeature estampa quando o repo da sessão é o próprio
// claude-manager (feature-memory.ts, isSelfRepoPath).
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE features ADD COLUMN is_app_dev INTEGER NOT NULL DEFAULT 0;
  `)
}
