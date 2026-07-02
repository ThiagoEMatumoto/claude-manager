import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up027 } from './027_repo_remote'

// Aplica 001-026 (igual ao runner real, respeitando disableForeignKeys) p/ deixar
// o schema pronto ANTES da 027.
function applyUpTo026(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 27)) {
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

describe('migration 027_repo_remote', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo026(db)
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

  it('adiciona remote_url e default_branch em repos, default null', () => {
    up027(db)
    const cols = (db.prepare(`PRAGMA table_info(repos)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(cols).toContain('remote_url')
    expect(cols).toContain('default_branch')
    const row = db
      .prepare(`SELECT remote_url, default_branch FROM repos WHERE id = 'r1'`)
      .get() as { remote_url: string | null; default_branch: string | null }
    expect(row.remote_url).toBeNull()
    expect(row.default_branch).toBeNull()
  })

  it('persiste remote_url + default_branch e lê de volta', () => {
    up027(db)
    db.prepare(
      `UPDATE repos SET remote_url = ?, default_branch = ? WHERE id = 'r1'`,
    ).run('https://github.com/acme/r1.git', 'main')
    const row = db
      .prepare(`SELECT remote_url, default_branch FROM repos WHERE id = 'r1'`)
      .get() as { remote_url: string | null; default_branch: string | null }
    expect(row.remote_url).toBe('https://github.com/acme/r1.git')
    expect(row.default_branch).toBe('main')
  })
})
