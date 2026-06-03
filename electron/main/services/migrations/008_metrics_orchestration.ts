import type Database from 'better-sqlite3'

export const version = 8
export const name = '008_metrics_orchestration'

export function up(db: Database.Database): void {
  // Métricas de orquestração derivadas do transcript. Limpa o cache pra o próximo
  // scan repopular as novas colunas (mesmo padrão da 006).
  db.exec(`
    ALTER TABLE metrics_session_cache ADD COLUMN agent_rounds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE metrics_session_cache ADD COLUMN parallel_rounds INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE metrics_session_cache ADD COLUMN inline_explore_calls INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE metrics_session_cache ADD COLUMN subagent_type_counts_json TEXT NOT NULL DEFAULT '{}';
    DELETE FROM metrics_session_cache;
  `)
}
