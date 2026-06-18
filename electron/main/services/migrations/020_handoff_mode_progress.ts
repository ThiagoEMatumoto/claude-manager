import type Database from 'better-sqlite3'

export const version = 20
export const name = '020_handoff_mode_progress'

// Estende handoffs com:
//  - mode: modo de permissão com que a sessão-filha sobe ('plan'|'auto-edits'|
//    'interactive'). Default 'interactive' = comportamento legado (pergunta tudo).
//  - current_step / step_updated_at: progresso não-terminal reportado pela filha
//    via handoff_progress. Separa "andamento" de "done" (done só via handoff_report).
// Colunas aditivas com default — ALTER ADD COLUMN é seguro (sem recriar tabela, sem
// tocar FK). Linhas antigas herdam mode='interactive' e current_step NULL.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE handoffs ADD COLUMN mode TEXT NOT NULL DEFAULT 'interactive';
    ALTER TABLE handoffs ADD COLUMN current_step TEXT;
    ALTER TABLE handoffs ADD COLUMN step_updated_at INTEGER;
  `)
}
