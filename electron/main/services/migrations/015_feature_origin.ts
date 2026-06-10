import type Database from 'better-sqlite3'

export const version = 15
export const name = '015_feature_origin'

// Cutoff do data-fix: features auto-criadas pelo backfill de 03/jun/2026.
// Qualquer feature criada a partir de 08/jun fica fora do predicado.
export const ORPHAN_CUTOFF = Date.UTC(2026, 5, 8) // 2026-06-08T00:00:00Z

// `origin` distingue features criadas pelo usuário ('manual') das auto-criadas
// pela resolução de sessões ('auto'). Visibilidade de rascunho é DERIVADA
// (origin='auto' E 0 rows em feature_session_records) — sem flag mutável.
//
// Data-fix: arquiva as órfãs do backfill — features sem nenhum session record,
// nunca editadas (created_at = updated_at) e anteriores ao cutoff. No DB real
// isso pega exatamente as 6 órfãs auto-criadas em 03/jun.
export function up(db: Database.Database): void {
  db.exec(`ALTER TABLE features ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`)
  db.prepare(
    `UPDATE features
        SET archived_at = ?, origin = 'auto'
      WHERE archived_at IS NULL
        AND created_at = updated_at
        AND created_at < ?
        AND id NOT IN (SELECT feature_id FROM feature_session_records)`,
  ).run(Date.now(), ORPHAN_CUTOFF)
}
