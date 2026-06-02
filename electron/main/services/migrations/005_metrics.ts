import type Database from 'better-sqlite3'

export const version = 5
export const name = '005_metrics'

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE metrics_session_cache (
      transcript_path    TEXT PRIMARY KEY,
      cc_session_id      TEXT NOT NULL,
      mtime_ms           REAL NOT NULL,
      size_bytes         INTEGER NOT NULL,
      first_ts           INTEGER,
      last_ts            INTEGER,
      turns              INTEGER NOT NULL,
      agent_calls        INTEGER NOT NULL,
      skill_calls        INTEGER NOT NULL,
      session_type       TEXT NOT NULL,
      input_tokens       INTEGER NOT NULL,
      output_tokens      INTEGER NOT NULL,
      cache_read_tokens  INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      cost_usd           REAL NOT NULL,
      models_json        TEXT NOT NULL,
      tools_json         TEXT NOT NULL,
      per_day_json       TEXT NOT NULL,
      scanned_at         INTEGER NOT NULL
    );
    CREATE INDEX idx_msc_cc ON metrics_session_cache(cc_session_id);
    CREATE INDEX idx_msc_last ON metrics_session_cache(last_ts);
  `)
}
