import type Database from 'better-sqlite3'

export const version = 2
export const name = '002_vault'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE projects ADD COLUMN vault_path TEXT;
    ALTER TABLE repos ADD COLUMN link_kind TEXT NOT NULL DEFAULT 'external';
    ALTER TABLE repos ADD COLUMN source TEXT;
  `)
}
