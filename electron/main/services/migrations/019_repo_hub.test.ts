import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up019 } from './019_repo_hub'

// Aplica 001-018 (igual ao runner real, respeitando disableForeignKeys) p/ deixar
// o schema pronto ANTES da 019.
function applyUpTo018(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 19)) {
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

describe('migration 019_repo_hub', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo018(db)
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

  it('adiciona a coluna is_hub em repos com default 0', () => {
    up019(db)
    const cols = db.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('is_hub')
    const row = db.prepare(`SELECT is_hub FROM repos WHERE id = 'r1'`).get() as {
      is_hub: number
    }
    expect(row.is_hub).toBe(0)
  })

  it('persiste is_hub = 1 e lê de volta', () => {
    up019(db)
    db.prepare(`UPDATE repos SET is_hub = 1 WHERE id = 'r1'`).run()
    const row = db.prepare(`SELECT is_hub FROM repos WHERE id = 'r1'`).get() as {
      is_hub: number
    }
    expect(row.is_hub).toBe(1)
  })
})
