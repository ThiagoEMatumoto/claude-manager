import type Database from 'better-sqlite3'

export const version = 22
export const name = '022_meetings'

// Meeting Intelligence (estilo Granola). Espinha da entidade espelha 012_tasks:
// persistência SQLite-only, raw_notes/augmented_notes/summary livres. As tabelas
// filhas (speakers/segments/extractions) saem em cascata com a reunião.
//   - meetings:            cabeçalho + proveniência (stt/diar/extractor) + status.
//   - meeting_speakers:    PK composta (meeting_id, label); label→pessoa na UI.
//   - meeting_segments:    transcript ao vivo (is_partial) + words_json p/ citação.
//   - meeting_extractions: action items/decisões/feedbacks com quote literal +
//                          grounded; materialized_task_id dá idempotência.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE meetings (
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
      status TEXT NOT NULL DEFAULT 'recording'
        CHECK (status IN ('recording','transcribing','diarizing','ready','extracted','failed')),
      raw_notes TEXT,
      augmented_notes TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_meetings_status ON meetings(status);

    CREATE TABLE meeting_speakers (
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      display_name TEXT,
      is_local_user INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (meeting_id, label)
    );

    CREATE TABLE meeting_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start_ms INTEGER,
      end_ms INTEGER,
      speaker_label TEXT,
      text TEXT NOT NULL,
      words_json TEXT,
      avg_logprob REAL,
      no_speech_prob REAL,
      is_partial INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_meeting_segments_meeting ON meeting_segments(meeting_id, idx);

    CREATE TABLE meeting_extractions (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      type TEXT NOT NULL
        CHECK (type IN ('action_item','decision','feedback','risk','question')),
      text TEXT NOT NULL,
      assignee TEXT,
      due_hint TEXT,
      quote TEXT,
      quote_segment_id TEXT,
      start_ms INTEGER,
      end_ms INTEGER,
      speaker_label TEXT,
      confidence REAL,
      grounded INTEGER NOT NULL DEFAULT 0,
      materialized_task_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_meeting_extractions_meeting ON meeting_extractions(meeting_id);
  `)
}
