import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { up as up029 } from './029_web_audit'

// Aplica 001-028 (igual ao runner real, respeitando disableForeignKeys) p/ deixar
// o schema pronto ANTES da 029.
function applyUpTo028(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 29)) {
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

describe('migration 029_web_audit', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo028(db)
    // Job pré-existente (sem kind/target_url) p/ provar a retrocompatibilidade.
    db.prepare(
      `INSERT INTO scheduled_jobs
         (id, name, prompt, schedule, next_run_at, created_at, updated_at)
       VALUES ('j1', 'legado', 'critique X', '{"type":"interval","hours":24}', ?, ?, ?)`,
    ).run(Date.now(), Date.now(), Date.now())
    db.prepare(
      `INSERT INTO job_runs (id, job_id, status, created_at) VALUES ('run1', 'j1', 'success', ?)`,
    ).run(Date.now())
  })

  afterEach(() => {
    db.close()
  })

  it('adiciona kind (default critique) e target_url em scheduled_jobs', () => {
    up029(db)
    const cols = (
      db.prepare(`PRAGMA table_info(scheduled_jobs)`).all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toContain('kind')
    expect(cols).toContain('target_url')
    // row pré-existente herda o default 'critique' e target_url null.
    const row = db
      .prepare(`SELECT kind, target_url FROM scheduled_jobs WHERE id = 'j1'`)
      .get() as { kind: string; target_url: string | null }
    expect(row.kind).toBe('critique')
    expect(row.target_url).toBeNull()
  })

  it('adiciona metrics_json (nullable) em job_runs', () => {
    up029(db)
    const cols = (db.prepare(`PRAGMA table_info(job_runs)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(cols).toContain('metrics_json')
    const row = db
      .prepare(`SELECT metrics_json FROM job_runs WHERE id = 'run1'`)
      .get() as { metrics_json: string | null }
    expect(row.metrics_json).toBeNull()
  })

  it('persiste kind web-audit + target_url + metrics_json e lê de volta', () => {
    up029(db)
    db.prepare(
      `UPDATE scheduled_jobs SET kind = 'web-audit', target_url = ? WHERE id = 'j1'`,
    ).run('https://app.legalstaging.lexter.ai')
    db.prepare(`UPDATE job_runs SET metrics_json = ? WHERE id = 'run1'`).run(
      '{"lcp":3832,"ttfb":210,"consoleErrors":9,"networkFailures":0}',
    )
    const job = db
      .prepare(`SELECT kind, target_url FROM scheduled_jobs WHERE id = 'j1'`)
      .get() as { kind: string; target_url: string | null }
    expect(job.kind).toBe('web-audit')
    expect(job.target_url).toBe('https://app.legalstaging.lexter.ai')
    const run = db
      .prepare(`SELECT metrics_json FROM job_runs WHERE id = 'run1'`)
      .get() as { metrics_json: string | null }
    expect(run.metrics_json).toContain('"lcp":3832')
  })
})
