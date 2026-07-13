import type Database from 'better-sqlite3'

export const version = 30
export const name = '030_sessions_title_source'

export function up(db: Database.Database): void {
  // Origem do title da sessão: 'manual' (rename do usuário no header) nunca é
  // sobrescrito pelo nome automático do Claude Code; null/'auto' segue a
  // precedência antiga (activity.name > title). Linhas antigas com title vêm de
  // rename manual (única escrita histórica) — backfill preserva o comportamento.
  db.exec(`
    ALTER TABLE sessions ADD COLUMN title_source TEXT;
    UPDATE sessions SET title_source = 'manual' WHERE title IS NOT NULL;
  `)
}
