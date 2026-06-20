import type Database from 'better-sqlite3'

export const version = 24
export const name = '024_meetings_fts'

// Busca full-text entre reuniões (FTS5). Um único índice contentless-ish que une
// três fontes de texto da reunião: os segmentos do transcript, as notas
// aumentadas da própria reunião e os itens extraídos. Cada linha do índice é
// "qual reunião + de onde veio o texto + qual o id da linha-fonte", para que a
// busca devolva o meeting_id (agrupável) e o snippet aponte a origem.
//
// Estratégia: NÃO usamos `content=` external-content (que exige rowid alinhado
// entre 3 tabelas de origem distintas — inviável aqui). Usamos uma FTS5 normal
// (própria cópia do texto) sincronizada por TRIGGERS em cada tabela-fonte. Cada
// trigger insere/atualiza/remove a linha correspondente no índice. `source` +
// `source_id` deixam o DELETE preciso (remove só a linha daquela fonte). É o
// padrão mais robusto p/ múltiplas fontes: o índice é a fonte da verdade da
// busca e nunca diverge das tabelas porque todo write passa pelos triggers.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE meeting_search USING fts5(
      meeting_id UNINDEXED,
      source UNINDEXED,
      source_id UNINDEXED,
      text,
      tokenize = "unicode61 remove_diacritics 2"
    );

    -- Backfill: indexa o que já existe antes dos triggers passarem a manter.
    INSERT INTO meeting_search (meeting_id, source, source_id, text)
      SELECT meeting_id, 'segment', id, text
      FROM meeting_segments WHERE text IS NOT NULL AND text <> '';

    INSERT INTO meeting_search (meeting_id, source, source_id, text)
      SELECT id, 'notes', id, augmented_notes
      FROM meetings WHERE augmented_notes IS NOT NULL AND augmented_notes <> '';

    INSERT INTO meeting_search (meeting_id, source, source_id, text)
      SELECT meeting_id, 'extraction', id, text
      FROM meeting_extractions WHERE text IS NOT NULL AND text <> '';

    -- ---- triggers: meeting_segments ----
    CREATE TRIGGER meeting_segments_ai AFTER INSERT ON meeting_segments BEGIN
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        VALUES (new.meeting_id, 'segment', new.id, new.text);
    END;
    CREATE TRIGGER meeting_segments_ad AFTER DELETE ON meeting_segments BEGIN
      DELETE FROM meeting_search WHERE source = 'segment' AND source_id = old.id;
    END;
    CREATE TRIGGER meeting_segments_au AFTER UPDATE ON meeting_segments BEGIN
      DELETE FROM meeting_search WHERE source = 'segment' AND source_id = old.id;
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        VALUES (new.meeting_id, 'segment', new.id, new.text);
    END;

    -- ---- triggers: meeting_extractions ----
    CREATE TRIGGER meeting_extractions_ai AFTER INSERT ON meeting_extractions BEGIN
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        VALUES (new.meeting_id, 'extraction', new.id, new.text);
    END;
    CREATE TRIGGER meeting_extractions_ad AFTER DELETE ON meeting_extractions BEGIN
      DELETE FROM meeting_search WHERE source = 'extraction' AND source_id = old.id;
    END;
    CREATE TRIGGER meeting_extractions_au AFTER UPDATE ON meeting_extractions BEGIN
      DELETE FROM meeting_search WHERE source = 'extraction' AND source_id = old.id;
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        VALUES (new.meeting_id, 'extraction', new.id, new.text);
    END;

    -- ---- triggers: meetings.augmented_notes ----
    -- Só augmented_notes entra no índice (é o texto "rico"; raw_notes é rascunho
    -- do usuário e some no enriquecimento). O id da reunião é o source_id.
    CREATE TRIGGER meetings_notes_ai AFTER INSERT ON meetings
      WHEN new.augmented_notes IS NOT NULL AND new.augmented_notes <> '' BEGIN
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        VALUES (new.id, 'notes', new.id, new.augmented_notes);
    END;
    CREATE TRIGGER meetings_notes_au AFTER UPDATE OF augmented_notes ON meetings BEGIN
      DELETE FROM meeting_search WHERE source = 'notes' AND source_id = old.id;
      INSERT INTO meeting_search (meeting_id, source, source_id, text)
        SELECT new.id, 'notes', new.id, new.augmented_notes
        WHERE new.augmented_notes IS NOT NULL AND new.augmented_notes <> '';
    END;
    CREATE TRIGGER meetings_notes_ad AFTER DELETE ON meetings BEGIN
      DELETE FROM meeting_search WHERE source = 'notes' AND source_id = old.id;
    END;
  `)
}
