import type Database from 'better-sqlite3'

export const version = 26
export const name = '026_handoff_instrumentation'

// Fase 2 da instrumentação de handoffs: medir se as delegações são úteis e
// certeiras. Hoje o schema guarda só estado corrente (1 linha mutada in-place);
// esta migration adiciona:
//
//  - handoff_events: trilha imutável de transições (1 linha por mutação de status
//    ou evento de feedback/consumo). ON DELETE CASCADE acompanha o handoff.
//  - handoffs.consumed_at: quando a MÃE consumiu o resultado (proxy: leu via
//    handoff_result com status=done). NULL = nunca consumido.
//  - handoffs.from_repo_id: repo de ORIGEM (a mãe que delegou). TEXT simples —
//    SQLite não cria FK enforced via ADD COLUMN, então fica sem constraint.
//  - handoffs.outcome: feedback humano sobre a utilidade (useful|wrong|partial).
//
// Tudo aditivo: ALTER ADD COLUMN é seguro (sem recriar tabela, sem tocar a FK
// CASCADE da 018). Linhas antigas herdam NULL nas 3 colunas novas.
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE handoff_events (
      id          TEXT PRIMARY KEY,
      handoff_id  TEXT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status   TEXT NOT NULL,
      event       TEXT NOT NULL,
      detail      TEXT,
      at          INTEGER NOT NULL
    );

    CREATE INDEX idx_handoff_events_handoff ON handoff_events (handoff_id, at);
    CREATE INDEX idx_handoff_events_event ON handoff_events (event, at);

    ALTER TABLE handoffs ADD COLUMN consumed_at INTEGER;
    ALTER TABLE handoffs ADD COLUMN from_repo_id TEXT;
    ALTER TABLE handoffs ADD COLUMN outcome TEXT;
  `)
}
