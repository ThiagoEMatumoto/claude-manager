import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up021 } from './021_handoff_pending_question'

// Aplica toda a cadeia ATÉ a 020 (inclui a 018 que cria handoffs + a 020 que
// adiciona mode/progress), deixando o schema pronto pra exercitar a 021 isolada.
function applyUpTo020(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 21)) {
    if (m.disableForeignKeys) {
      db.pragma('foreign_keys = OFF')
      try {
        m.up(db)
      } finally {
        db.pragma('foreign_keys = ON')
      }
    } else {
      m.up(db)
    }
  }
}

describe('migration 021_handoff_pending_question', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo020(db)
    db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','P1',?,?)`).run(
      Date.now(),
      Date.now(),
    )
    db.prepare(
      `INSERT INTO repos (id, project_id, label, path, position, created_at) VALUES ('r1','p1','r1','/tmp/r1',0,?)`,
    ).run(Date.now())
  })

  afterEach(() => {
    db.close()
  })

  it('adiciona pending_question + question_asked_at nullable (linha antiga herda NULL)', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
       VALUES ('h1','r1','t','p','pending',?,?)`,
    ).run(now, now)

    up021(db)

    const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h1') as {
      pending_question: string | null
      question_asked_at: number | null
    }
    expect(row.pending_question).toBeNull()
    expect(row.question_asked_at).toBeNull()
  })

  it('aceita gravar pergunta + timestamp após o ALTER', () => {
    up021(db)
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
       VALUES ('h2','r1','t','p','running',?,?)`,
    ).run(now, now)
    db.prepare(
      'UPDATE handoffs SET status = ?, pending_question = ?, question_asked_at = ? WHERE id = ?',
    ).run('needs_input', 'qual versão do node?', now, 'h2')

    const row = db
      .prepare('SELECT status, pending_question, question_asked_at FROM handoffs WHERE id = ?')
      .get('h2') as { status: string; pending_question: string | null; question_asked_at: number | null }
    expect(row.status).toBe('needs_input')
    expect(row.pending_question).toBe('qual versão do node?')
    expect(row.question_asked_at).toBe(now)
  })
})
