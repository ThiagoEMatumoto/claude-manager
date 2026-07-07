import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão de handoff-store.test: o store importa getDb de './db' (que
// depende de electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

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

describe('scheduled-job-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
    seed(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('computeNextRunAt (fonte única, sempre > from)', () => {
    it('interval avança exatamente N horas', () => {
      const from = Date.UTC(2026, 0, 15, 10, 0, 0)
      expect(store.computeNextRunAt({ type: 'interval', hours: 6 }, from)).toBe(
        from + 6 * 3_600_000,
      )
    })

    it('interval nunca retorna <= from (hours mínimo 1)', () => {
      const from = Date.now()
      expect(store.computeNextRunAt({ type: 'interval', hours: 0 }, from)).toBeGreaterThan(from)
    })

    it('daily: horário de hoje ainda não passou → marca hoje', () => {
      const from = new Date(2026, 0, 15, 8, 0, 0, 0).getTime()
      const next = new Date(store.computeNextRunAt({ type: 'daily', hour: 9, minute: 30 }, from))
      expect(next.getDate()).toBe(15)
      expect(next.getHours()).toBe(9)
      expect(next.getMinutes()).toBe(30)
    })

    it('daily: horário de hoje já passou → rola pro dia seguinte', () => {
      const from = new Date(2026, 0, 15, 10, 0, 0, 0).getTime()
      const next = new Date(store.computeNextRunAt({ type: 'daily', hour: 9, minute: 0 }, from))
      expect(next.getTime()).toBeGreaterThan(from)
      expect(next.getDate()).toBe(16)
      expect(next.getHours()).toBe(9)
    })

    it('weekly: mesmo dia com horário já passado rola +7 dias', () => {
      const from = new Date(2026, 0, 15, 12, 0, 0, 0).getTime() // uma quinta
      const dow = new Date(from).getDay()
      const next = store.computeNextRunAt({ type: 'weekly', dayOfWeek: dow, hour: 9, minute: 0 }, from)
      expect(next).toBeGreaterThan(from)
      expect(new Date(next).getDay()).toBe(dow)
      expect((next - from) / 86_400_000).toBeGreaterThan(6) // ~7 dias à frente
    })
  })

  describe('claimDueJob (claim atômico, sem double-fire)', () => {
    function dueJob() {
      return store.create({
        name: 'crítique',
        repoId: 'r1',
        prompt: 'audite as extrações',
        schedule: { type: 'interval', hours: 24 },
      })
    }

    it('dois claims no mesmo tick criam UMA run e avançam next_run_at', () => {
      const job = dueJob()
      const now = job.nextRunAt + 1000 // vencido

      const first = store.claimDueJob(job.id, now)
      const second = store.claimDueJob(job.id, now)

      expect(first).not.toBeNull()
      expect(second).toBeNull()

      const runs = store.listRuns({ jobId: job.id })
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe('scheduled')

      const reloaded = store.get(job.id)!
      expect(reloaded.nextRunAt).toBeGreaterThan(now)
      expect(reloaded.lastRunAt).toBe(now)
    })

    it('não reclama job desabilitado', () => {
      const job = store.create({
        name: 'off',
        repoId: 'r1',
        prompt: 'x',
        schedule: { type: 'interval', hours: 1 },
        enabled: false,
      })
      const now = job.nextRunAt + 1000
      expect(store.claimDueJob(job.id, now)).toBeNull()
      expect(store.listRuns({ jobId: job.id })).toHaveLength(0)
    })

    it('não reclama job ainda não vencido', () => {
      const job = dueJob()
      const now = job.nextRunAt - 1000
      expect(store.claimDueJob(job.id, now)).toBeNull()
      expect(store.listRuns({ jobId: job.id })).toHaveLength(0)
    })

    it('claim herda o model do job na run', () => {
      const job = store.create({
        name: 'm',
        repoId: 'r1',
        prompt: 'x',
        schedule: { type: 'interval', hours: 24 },
        model: 'opus',
      })
      const run = store.claimDueJob(job.id, job.nextRunAt + 1)
      expect(run?.model).toBe('opus')
    })
  })

  describe('CRUD + defaults + CASCADE', () => {
    it('create aplica defaults: enabled, observe-only, catchUp off', () => {
      const job = store.create({
        name: 'J',
        repoId: 'r1',
        prompt: 'p',
        schedule: { type: 'daily', hour: 9, minute: 0 },
      })
      expect(job.enabled).toBe(true)
      expect(job.catchUp).toBe(false)
      expect(job.permissionMode).toBe('plan')
      expect(job.disallowedTools).toEqual([])
      expect(store.get(job.id)?.name).toBe('J')
    })

    it('update recomputa next_run_at só quando o schedule muda', () => {
      const job = store.create({
        name: 'J',
        repoId: 'r1',
        prompt: 'p',
        schedule: { type: 'interval', hours: 24 },
      })
      const sameSchedule = store.update({ id: job.id, name: 'J2' })
      expect(sameSchedule.nextRunAt).toBe(job.nextRunAt)

      const changed = store.update({ id: job.id, schedule: { type: 'interval', hours: 1 } })
      expect(changed.nextRunAt).not.toBe(job.nextRunAt)
    })

    it('deletar o job remove as runs (CASCADE)', () => {
      const job = store.create({
        name: 'J',
        repoId: 'r1',
        prompt: 'p',
        schedule: { type: 'interval', hours: 24 },
      })
      store.claimDueJob(job.id, job.nextRunAt + 1)
      expect(store.listRuns({ jobId: job.id })).toHaveLength(1)

      store.remove(job.id)
      expect(store.get(job.id)).toBeNull()
      expect(store.listRuns({ jobId: job.id })).toHaveLength(0)
    })

    it('updateRun aplica keep-semantics (undefined mantém, null limpa)', () => {
      const job = store.create({
        name: 'J',
        repoId: 'r1',
        prompt: 'p',
        schedule: { type: 'interval', hours: 24 },
      })
      const run = store.claimDueJob(job.id, job.nextRunAt + 1)!
      const running = store.updateRun({
        id: run.id,
        status: 'running',
        sessionId: 's1',
        ccSessionId: 'cc1',
        startedAt: 123,
      })
      expect(running.status).toBe('running')
      expect(running.ccSessionId).toBe('cc1')

      const done = store.updateRun({
        id: run.id,
        status: 'success',
        reportText: '# achados',
        captureQuality: 'full',
      })
      expect(done.sessionId).toBe('s1') // preservado (undefined = keep)
      expect(done.reportText).toBe('# achados')
      expect(store.getLastRun(job.id)?.status).toBe('success')
    })
  })
})
