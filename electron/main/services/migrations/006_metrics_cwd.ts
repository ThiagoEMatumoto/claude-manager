import type Database from 'better-sqlite3'

export const version = 6
export const name = '006_metrics_cwd'

export function up(db: Database.Database): void {
  // Adiciona cwd ao cache e limpa o cache derivado: o próximo scan repopula
  // com cwd preenchido (necessário pra atribuição de projeto por cwd→repos.path).
  db.exec(`
    ALTER TABLE metrics_session_cache ADD COLUMN cwd TEXT;
    DELETE FROM metrics_session_cache;
  `)
}
