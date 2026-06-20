import type Database from 'better-sqlite3'

export const version = 21
export const name = '021_handoff_pending_question'

// Estende handoffs com o canal de pergunta filha→mãe:
//  - pending_question:   pergunta aberta que a filha levantou via handoff_ask.
//    Não-null ⇒ o handoff está em status 'needs_input' aguardando a mãe.
//  - question_asked_at:  quando a pergunta foi levantada (epoch ms).
// Colunas aditivas nullable — ALTER ADD COLUMN é seguro (sem recriar tabela, sem
// tocar a FK CASCADE da 018). Linhas antigas herdam ambos NULL.
export function up(db: Database.Database): void {
  db.exec(`
    ALTER TABLE handoffs ADD COLUMN pending_question TEXT;
    ALTER TABLE handoffs ADD COLUMN question_asked_at INTEGER;
  `)
}
