import type Database from 'better-sqlite3'

export const version = 16
export const name = '016_metrics_subagent_turns'

export function up(db: Database.Database): void {
  // subagent_turns = soma de linhas assistant nos transcripts aninhados
  // <sessionId>/subagents/*.jsonl. Limpa o cache pra o próximo scan repopular
  // a nova coluna (mesmo padrão da 006/008).
  db.exec(`
    ALTER TABLE metrics_session_cache ADD COLUMN subagent_turns INTEGER NOT NULL DEFAULT 0;
    DELETE FROM metrics_session_cache;
  `)
}
