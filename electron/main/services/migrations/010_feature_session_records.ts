import type Database from 'better-sqlite3'

export const version = 10
export const name = '010_feature_session_records'

// Registros ricos por sessão (Stage 1 do two-stage). Cada sessão linkada a uma
// feature gera um resumo destilado via LLM; o Stage 2 (síntese holística do doc)
// relê TODOS os registros da feature. session_id é PK: uma sessão = um registro
// (idempotente — re-sintetizar a mesma sessão substitui o registro).
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE feature_session_records (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      feature_id    TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      cc_session_id TEXT,
      summary       TEXT NOT NULL,
      model         TEXT,
      -- Quando a sessão REALMENTE rodou (sessions.started_at). É o que datas a
      -- "Linha do tempo" — created_at (horário da síntese) achatava tudo no mesmo dia.
      session_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX idx_fsr_feature ON feature_session_records(feature_id);
  `)
}
