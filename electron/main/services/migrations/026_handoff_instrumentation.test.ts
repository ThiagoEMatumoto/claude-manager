import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up026 } from './026_handoff_instrumentation'

// Aplica toda a cadeia ATÉ a 025 (inclui a 018 que cria handoffs), deixando o
// schema pronto pra exercitar a 026 isolada.
function applyUpTo025(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 26)) {
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

interface ColumnInfo {
  name: string
  type: string
}

interface IndexInfo {
  name: string
}

describe('migration 026_handoff_instrumentation', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo025(db)
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

  it('adiciona consumed_at + from_repo_id + outcome nullable (linha antiga herda NULL)', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
       VALUES ('h1','r1','t','p','pending',?,?)`,
    ).run(now, now)

    up026(db)

    const cols = db.prepare(`PRAGMA table_info(handoffs)`).all() as ColumnInfo[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('consumed_at')
    expect(names).toContain('from_repo_id')
    expect(names).toContain('outcome')

    const row = db.prepare('SELECT * FROM handoffs WHERE id = ?').get('h1') as {
      consumed_at: number | null
      from_repo_id: string | null
      outcome: string | null
    }
    expect(row.consumed_at).toBeNull()
    expect(row.from_repo_id).toBeNull()
    expect(row.outcome).toBeNull()
  })

  it('cria a tabela handoff_events com a FK CASCADE pro handoff', () => {
    up026(db)
    const now = Date.now()
    db.prepare(
      `INSERT INTO handoffs (id, target_repo_id, task, composed_prompt, status, created_at, updated_at)
       VALUES ('h2','r1','t','p','pending',?,?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO handoff_events (id, handoff_id, from_status, to_status, event, detail, at)
       VALUES ('e1','h2',NULL,'pending','create',NULL,?)`,
    ).run(now)

    const before = db.prepare('SELECT COUNT(*) AS n FROM handoff_events').get() as { n: number }
    expect(before.n).toBe(1)

    // ON DELETE CASCADE: apagar o handoff some com os eventos.
    db.prepare('DELETE FROM handoffs WHERE id = ?').run('h2')
    const after = db.prepare('SELECT COUNT(*) AS n FROM handoff_events').get() as { n: number }
    expect(after.n).toBe(0)
  })

  it('cria os índices idx_handoff_events_handoff e idx_handoff_events_event', () => {
    up026(db)
    const idx = db
      .prepare(`PRAGMA index_list('handoff_events')`)
      .all() as IndexInfo[]
    const names = idx.map((i) => i.name)
    expect(names).toContain('idx_handoff_events_handoff')
    expect(names).toContain('idx_handoff_events_event')
  })
})
