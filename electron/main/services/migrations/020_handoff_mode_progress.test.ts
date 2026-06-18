import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up020 } from './020_handoff_mode_progress'

// Aplica toda a cadeia ATÉ a 019 (inclui a 018 que cria handoffs), deixando o
// schema pronto pra exercitar a 020 isoladamente.
function applyUpTo019(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 20)) {
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

describe('migration 020_handoff_mode_progress', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo019(db)
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

  it('adiciona mode (default interactive) + current_step/step_updated_at nullable', () => {
    // Linha inserida ANTES da 020 herda os defaults após o ALTER.
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
       VALUES ('h1','r1','t','p','pending',?,?)`,
    ).run(now, now)

    up020(db)

    const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h1') as {
      mode: string
      current_step: string | null
      step_updated_at: number | null
    }
    expect(row.mode).toBe('interactive')
    expect(row.current_step).toBeNull()
    expect(row.step_updated_at).toBeNull()
  })

  it('aceita inserir com mode explícito e gravar progresso', () => {
    up020(db)
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, mode, created_at, updated_at)
       VALUES ('h2','r1','t','p','running','auto-edits',?,?)`,
    ).run(now, now)
    db.prepare('UPDATE handoffs SET current_step = ?, step_updated_at = ? WHERE id = ?').run(
      'rodando testes',
      now,
      'h2',
    )
    const row = db.prepare('SELECT mode, current_step FROM handoffs WHERE id = ?').get('h2') as {
      mode: string
      current_step: string | null
    }
    expect(row.mode).toBe('auto-edits')
    expect(row.current_step).toBe('rodando testes')
  })
})
