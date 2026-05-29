import type Database from 'better-sqlite3'

export const version = 3
export const name = '003_workspace_panes'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE workspace_state ADD COLUMN open_panes TEXT;
  `)
}
