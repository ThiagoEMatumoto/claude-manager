import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão do scheduled-job-store.test: mockamos './db' pra um SQLite
// in-memory migrado. Mockamos também './job-runner' pra quebrar a cadeia de
// import que puxaria electron (job-runner → ipc/sessions → electron); o spawn
// real é substituído por um dep injetado no scheduler nos testes.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))
vi.mock('./job-runner', () => ({
  spawnJobSession: vi.fn(() => ({ sessionId: 's-default', ccSessionId: 'cc-default' })),
}))

import { JobScheduler } from './job-scheduler'
import * as store from './scheduled-job-store'

function applyAllMigrations(db: Database.Database): void {
  for (const m of migrations) {
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

function seed(db: Database.Database): void {
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','P1',?,?)`).run(
    Date.now(),
    Date.now(),
  )
  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, position, created_at)
     VALUES ('r1','p1','Repo 1','/tmp/r1',0,?)`,
  ).run(Date.now())
}

function makeJob(over: Partial<Parameters<typeof store.create>[0]> = {}) {
  return store.create({
    name: 'crítique',
    repoId: 'r1',
    prompt: 'audite as extrações',
    schedule: { type: 'interval', hours: 24 },
    ...over,
  })
}

describe('JobScheduler', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
    seed(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  it('(a) tick com 1 job vencido cria 1 run e avança next_run_at', () => {
    const job = makeJob()
    const now = job.nextRunAt + 1000
    const spawn = vi.fn(() => ({ sessionId: 's1', ccSessionId: 'cc1' }))
    const scheduler = new JobScheduler({ now: () => now, spawn })

    scheduler.tick()

    expect(spawn).toHaveBeenCalledTimes(1)
    const runs = store.listRuns({ jobId: job.id })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')
    expect(runs[0].sessionId).toBe('s1')
    expect(runs[0].ccSessionId).toBe('cc1')
    expect(store.get(job.id)!.nextRunAt).toBeGreaterThan(now)
  })

  it('(b) double-tick no mesmo instante não cria 2 runs', () => {
    const job = makeJob()
    const now = job.nextRunAt + 1000
    const spawn = vi.fn(() => ({ sessionId: 's1', ccSessionId: 'cc1' }))
    const scheduler = new JobScheduler({ now: () => now, spawn })

    scheduler.tick()
    scheduler.tick()

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(store.listRuns({ jobId: job.id })).toHaveLength(1)
  })

  it('(c) boot com vencido e catch_up=0 marca run missed sem spawn', () => {
    const job = makeJob({ catchUp: false })
    const now = job.nextRunAt + 1000
    const spawn = vi.fn(() => ({ sessionId: 's1', ccSessionId: 'cc1' }))
    const scheduler = new JobScheduler({ now: () => now, spawn })

    scheduler.start()

    expect(spawn).not.toHaveBeenCalled()
    const runs = store.listRuns({ jobId: job.id })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('missed')
    expect(store.get(job.id)!.nextRunAt).toBeGreaterThan(now)

    scheduler.stop()
  })

  it('(c2) boot com vencido e catch_up=1 spawna 1 run de catch-up', () => {
    const job = makeJob({ catchUp: true })
    const now = job.nextRunAt + 1000
    const spawn = vi.fn(() => ({ sessionId: 's1', ccSessionId: 'cc1' }))
    const scheduler = new JobScheduler({ now: () => now, spawn })

    scheduler.start()

    expect(spawn).toHaveBeenCalledTimes(1)
    const runs = store.listRuns({ jobId: job.id })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')

    scheduler.stop()
  })

  it('(d) reconcileOrphanRuns marca run running->interrupted', () => {
    const job = makeJob()
    const run = store.claimDueJob(job.id, job.nextRunAt + 1)!
    store.updateRun({ id: run.id, status: 'running', sessionId: 's1', ccSessionId: 'cc1' })

    const changed = store.reconcileOrphanRuns(Date.now())

    expect(changed).toBe(1)
    expect(store.getRun(run.id)!.status).toBe('interrupted')
    expect(store.getRun(run.id)!.finishedAt).not.toBeNull()
  })
})
