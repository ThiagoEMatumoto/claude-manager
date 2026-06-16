import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up018 } from './018_handoffs'

// Aplica 001-017 (alguns precisam de foreign_keys OFF, igual ao runner real),
// deixando o schema pronto pra seedar ANTES da 018.
function applyUpTo017(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 18)) {
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

function insertHandoff(db: Database.Database, id: string): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO handoffs
       (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
     VALUES (?, 'r1', 'do thing', 'prompt', 'pending', ?, ?)`,
  ).run(id, now, now)
}

describe('migration 018_handoffs', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo017(db)
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'P1', ?, ?)`,
    ).run(Date.now(), Date.now())
    db.prepare(
      `INSERT INTO repos (id, project_id, label, path, position, created_at)
       VALUES ('r1', 'p1', 'r1', '/tmp/r1', 0, ?)`,
    ).run(Date.now())
  })

  afterEach(() => {
    db.close()
  })

  it('cria a tabela handoffs com defaults (status pending) e nullable mother/child', () => {
    up018(db)
    insertHandoff(db, 'h1')
    const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h1') as {
      status: string
      mother_session_id: string | null
      child_session_id: string | null
      summary: string | null
      error: string | null
    }
    expect(row.status).toBe('pending')
    expect(row.mother_session_id).toBeNull()
    expect(row.child_session_id).toBeNull()
    expect(row.summary).toBeNull()
    expect(row.error).toBeNull()
  })

  it('aceita a transição pending → approved → running → done', () => {
    up018(db)
    insertHandoff(db, 'h2')
    const status = () =>
      (db.prepare('SELECT status FROM handoffs WHERE id = ?').get('h2') as { status: string }).status

    db.prepare('UPDATE handoffs SET status = ? WHERE id = ?').run('approved', 'h2')
    expect(status()).toBe('approved')

    db.prepare('UPDATE handoffs SET status = ?, child_session_id = ? WHERE id = ?').run(
      'running',
      's-child',
      'h2',
    )
    const running = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h2') as {
      status: string
      child_session_id: string | null
    }
    expect(running.status).toBe('running')
    expect(running.child_session_id).toBe('s-child')

    db.prepare('UPDATE handoffs SET status = ?, summary = ? WHERE id = ?').run(
      'done',
      'resumo',
      'h2',
    )
    const done = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h2') as {
      status: string
      summary: string | null
    }
    expect(done.status).toBe('done')
    expect(done.summary).toBe('resumo')
  })

  it('aceita reject e fail (com error)', () => {
    up018(db)
    insertHandoff(db, 'h3')
    db.prepare('UPDATE handoffs SET status = ? WHERE id = ?').run('rejected', 'h3')
    expect(
      (db.prepare('SELECT status FROM handoffs WHERE id = ?').get('h3') as { status: string })
        .status,
    ).toBe('rejected')

    insertHandoff(db, 'h4')
    db.prepare('UPDATE handoffs SET status = ?, error = ? WHERE id = ?').run('failed', 'boom', 'h4')
    const failed = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h4') as {
      status: string
      error: string | null
    }
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('boom')
  })

  it('CASCADE: deletar o repo alvo remove os handoffs', () => {
    up018(db)
    insertHandoff(db, 'h5')
    db.prepare('DELETE FROM repos WHERE id = ?').run('r1')
    const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h5')
    expect(row).toBeUndefined()
  })
})
