import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up017 } from './017_repo_deps_canvas'

// Aplica as migrations 001-016 (algumas precisam de foreign_keys OFF, igual ao
// runner real), deixando o schema pronto pra seedar ANTES da 017.
function applyUpTo016(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 17)) {
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

function seedRepo(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, position, created_at)
     VALUES (?, 'p1', ?, ?, 0, ?)`,
  ).run(id, id, `/tmp/${id}`, Date.now())
}

describe('migration 017_repo_deps_canvas', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo016(db)
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'P1', ?, ?)`,
    ).run(Date.now(), Date.now())
    seedRepo(db, 'r1')
    seedRepo(db, 'r2')
    // Row antiga no schema VELHO (PK composta, kind nullable) — inserida ANTES da 017.
    db.prepare(
      `INSERT INTO repo_dependencies (from_repo_id, to_repo_id, kind) VALUES ('r1', 'r2', 'depends-on')`,
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it('migra a row antiga com id e created_at não-nulos, preservando o kind', () => {
    up017(db)
    const row = db
      .prepare(`SELECT id, from_repo_id, to_repo_id, kind, label, created_at FROM repo_dependencies`)
      .get() as {
      id: string | null
      from_repo_id: string
      to_repo_id: string
      kind: string
      label: string | null
      created_at: number | null
    }
    expect(row.id).toBeTruthy()
    expect(typeof row.id).toBe('string')
    expect(row.from_repo_id).toBe('r1')
    expect(row.to_repo_id).toBe('r2')
    expect(row.kind).toBe('depends-on')
    expect(row.label).toBeNull()
    expect(row.created_at).toBeGreaterThan(0)
  })

  it('adiciona as colunas canvas_x e canvas_y em repos', () => {
    up017(db)
    const cols = db.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('canvas_x')
    expect(names).toContain('canvas_y')
  })

  it('UNIQUE(from,to,kind) permite kinds diferentes no mesmo par mas bloqueia duplicata exata', () => {
    up017(db)
    const insert = db.prepare(
      `INSERT INTO repo_dependencies (id, from_repo_id, to_repo_id, kind, created_at)
       VALUES (?, 'r1', 'r2', ?, ?)`,
    )
    // kind diferente no mesmo par → permitido
    expect(() => insert.run('id-calls', 'calls-api', Date.now())).not.toThrow()
    // duplicata exata (mesmo par + mesmo kind já migrado) → bloqueada
    expect(() => insert.run('id-dup', 'depends-on', Date.now())).toThrow(/UNIQUE/i)
  })
})
