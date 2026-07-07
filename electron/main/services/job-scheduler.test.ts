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
import { composeJobKickoff } from './job-kickoff'
import type { SpawnJobSessionParams, SpawnJobSessionResult } from './job-runner'

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

  it('(e) runJobNow dispara run ad-hoc e NÃO altera next_run_at', () => {
    const job = makeJob()
    const nextBefore = store.get(job.id)!.nextRunAt
    // now ANTES do vencimento: prova que run_now ignora o schedule (não usa claim).
    const now = job.nextRunAt - 1000
    const spawn = vi.fn(() => ({ sessionId: 's-now', ccSessionId: 'cc-now' }))
    const scheduler = new JobScheduler({ now: () => now, spawn })

    const run = scheduler.runJobNow(job.id)

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(run.status).toBe('running')
    expect(run.sessionId).toBe('s-now')
    // invariante da tarefa: run_now não toca o agendamento (computeNextRunAt manda).
    expect(store.get(job.id)!.nextRunAt).toBe(nextBefore)
    expect(store.listRuns({ jobId: job.id })).toHaveLength(1)
  })

  it('(f) runJobNow injeta o report da run anterior no spawn (delta) + runId', () => {
    const job = makeJob()
    const prev = store.createRun({ jobId: job.id, status: 'success' })
    store.updateRun({ id: prev.id, reportText: '## Achados\n- fan-out no X' })

    const spawn = vi.fn(() => ({ sessionId: 's2', ccSessionId: 'cc2' }))
    const scheduler = new JobScheduler({ now: () => Date.now(), spawn })

    const run = scheduler.runJobNow(job.id)

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: run.id, previousReport: '## Achados\n- fan-out no X' }),
    )
  })

  it('(g) delta usa o último run COM report: success(report)→missed→ run3 injeta o report do success', () => {
    const job = makeJob()
    // run1: success com relatório.
    const r1 = store.createRun({ jobId: job.id, status: 'success' })
    store.updateRun({ id: r1.id, reportText: '## Achados\n- gap na extração' })
    // run2: missed sem relatório (app fechado no vencimento) — NÃO deve suprimir o delta.
    store.createRun({ jobId: job.id, status: 'missed' })

    const spawn = vi.fn(
      (_params: SpawnJobSessionParams): SpawnJobSessionResult => ({
        sessionId: 's3',
        ccSessionId: 'cc3',
      }),
    )
    const scheduler = new JobScheduler({ now: () => Date.now(), spawn })

    scheduler.runJobNow(job.id)

    const params = spawn.mock.calls[0]![0]
    expect(params.previousReport).toBe('## Achados\n- gap na extração')
    // o kickoff efetivo injeta o report do success anterior (pula o missed do meio).
    expect(composeJobKickoff(params)).toContain('gap na extração')
  })
})
