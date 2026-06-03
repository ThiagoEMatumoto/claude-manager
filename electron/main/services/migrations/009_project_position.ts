import type Database from 'better-sqlite3'

export const version = 9
export const name = '009_project_position'

export function up(db: Database.Database): void {
  db.exec('ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;')

  // Popula a posição preservando a ordem visível atual (updated_at DESC), pra que
  // o primeiro boot pós-migration não embaralhe a lista de quem já usa o app.
  const rows = db
    .prepare('SELECT id FROM projects ORDER BY updated_at DESC')
    .all() as Array<{ id: string }>
  const setPos = db.prepare('UPDATE projects SET position = ? WHERE id = ?')
  rows.forEach((row, i) => setPos.run(i, row.id))
}
