import type Database from 'better-sqlite3'

export const version = 4
export const name = '004_dock_layout'

export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE workspace_state ADD COLUMN dock_layout TEXT;
  `)
}
