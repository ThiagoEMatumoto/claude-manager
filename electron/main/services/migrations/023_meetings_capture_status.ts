import type Database from 'better-sqlite3'

export const version = 23
export const name = '023_meetings_capture_status'

// `meetings` é referenciada por FK em speakers/segments/extractions; recriar a
// tabela com FK ON faria o DROP falhar. O runner desliga foreign_keys nesta
// migration e roda PRAGMA foreign_key_check ao final.
export const disableForeignKeys = true

// O ciclo Granola começa em `idle` (rascunho, sem captura) e vira `capturing`
// só quando o sidecar dispara. A 022 não previa esses estados — não existe ALTER
// para mudar um CHECK no SQLite, então recriamos `meetings` (12-step) com o enum
// ampliado e default trocado para 'idle'. Schema idêntico ao da 022, exceto o
// CHECK e o DEFAULT do status.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE meetings_new (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      source TEXT,
      audio_path TEXT,
      duration_ms INTEGER,
      lang TEXT NOT NULL DEFAULT 'pt',
      stt_model TEXT,
      diar_model TEXT,
      extractor TEXT,
      status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle','capturing','recording','transcribing','diarizing','ready','extracted','failed')),
      raw_notes TEXT,
      augmented_notes TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO meetings_new
      (id, title, started_at, ended_at, source, audio_path, duration_ms, lang,
       stt_model, diar_model, extractor, status, raw_notes, augmented_notes,
       summary, created_at, updated_at)
    SELECT
      id, title, started_at, ended_at, source, audio_path, duration_ms, lang,
      stt_model, diar_model, extractor, status, raw_notes, augmented_notes,
      summary, created_at, updated_at
    FROM meetings;

    DROP TABLE meetings;
    ALTER TABLE meetings_new RENAME TO meetings;

    CREATE INDEX idx_meetings_status ON meetings(status);
  `)
}
