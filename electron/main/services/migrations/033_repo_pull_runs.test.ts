import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up033 } from './033_repo_pull_runs'

// Aplica 001-032 (igual ao runner real, respeitando disableForeignKeys) p/
// deixar o schema pronto ANTES da 033.
function applyUpTo032(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 33)) {
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

describe('migration 033_repo_pull_runs', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo032(db)
  })

  afterEach(() => {
    db.close()
  })

  it('cria a tabela repo_pull_runs com as colunas esperadas', () => {
    up033(db)
    const cols = (
      db.prepare(`PRAGMA table_info(repo_pull_runs)`).all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toEqual([
      'id',
      'trigger',
      'started_at',
      'finished_at',
      'repos_total',
      'pulled',
      'skipped',
      'errored',
      'results_json',
    ])
  })

  it('persiste um run e lê de volta (roundtrip)', () => {
    up033(db)
    db.prepare(
      `INSERT INTO repo_pull_runs
         (id, trigger, started_at, finished_at, repos_total, pulled, skipped, errored, results_json)
       VALUES (@id, @trigger, @started_at, @finished_at, @repos_total, @pulled, @skipped, @errored, @results_json)`,
    ).run({
      id: 'run1',
      trigger: 'auto',
      started_at: 1000,
      finished_at: 2000,
      repos_total: 2,
      pulled: 1,
      skipped: 1,
      errored: 0,
      results_json: JSON.stringify([{ repoId: 'r1', label: 'r1', path: '/tmp/r1', status: 'pulled' }]),
    })

    const row = db.prepare(`SELECT * FROM repo_pull_runs WHERE id = 'run1'`).get() as Record<
      string,
      unknown
    >
    expect(row.trigger).toBe('auto')
    expect(row.started_at).toBe(1000)
    expect(row.finished_at).toBe(2000)
    expect(row.repos_total).toBe(2)
    expect(row.pulled).toBe(1)
    expect(row.skipped).toBe(1)
    expect(row.errored).toBe(0)
    expect(JSON.parse(row.results_json as string)).toEqual([
      { repoId: 'r1', label: 'r1', path: '/tmp/r1', status: 'pulled' },
    ])
  })

  it('rejeita trigger fora de auto|manual', () => {
    up033(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO repo_pull_runs
             (id, trigger, started_at, finished_at, repos_total, pulled, skipped, errored, results_json)
           VALUES ('run2', 'bogus', 1, 2, 0, 0, 0, 0, '[]')`,
        )
        .run(),
    ).toThrow()
  })
})
