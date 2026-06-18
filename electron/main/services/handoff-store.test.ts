import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// Mesmo padrão do repo-dependency-store.test: o store importa getDb de './db'
// (que depende de electron.app); mockamos pra um SQLite in-memory migrado.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import * as store from './handoff-store'

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
     VALUES ('r1','p1','Repo 1','/tmp/r1',0,?), ('r2','p1','Repo 2','/tmp/r2',1,?)`,
  ).run(Date.now(), Date.now())
}

function newHandoff(targetRepoId = 'r1') {
  return store.create({
    targetRepoId,
    task: 'do thing',
    composedPrompt: 'prompt',
  })
}

describe('handoff-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
    seed(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('create + mode', () => {
    it('default mode = interactive quando omitido', () => {
      const h = newHandoff()
      expect(h.mode).toBe('interactive')
      expect(h.currentStep).toBeNull()
      expect(h.stepUpdatedAt).toBeNull()
    })

    it('respeita o mode passado', () => {
      const h = store.create({
        targetRepoId: 'r1',
        task: 't',
        composedPrompt: 'p',
        mode: 'auto-edits',
      })
      expect(h.mode).toBe('auto-edits')
    })
  })

  describe('progress (não-terminal)', () => {
    it('grava current_step só quando running; NÃO vira done', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const after = store.progress(h.id, 'rodando testes')
      expect(after.status).toBe('running')
      expect(after.currentStep).toBe('rodando testes')
      expect(after.stepUpdatedAt).not.toBeNull()
    })

    it('ignora progress quando NÃO está running (ex.: pending)', () => {
      const h = newHandoff() // pending
      const after = store.progress(h.id, 'cedo demais')
      expect(after.currentStep).toBeNull()
    })
  })

  describe('failIfRunning (reconciliação de morte da filha)', () => {
    it('running → failed e retorna o handoff', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      const res = store.failIfRunning(h.id, 'filha morreu')
      expect(res).not.toBeNull()
      expect(res?.status).toBe('failed')
      expect(res?.error).toBe('filha morreu')
    })

    it('NÃO sobrescreve done: retorna null e mantém done', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child')
      store.report(h.id, 'concluído')
      const res = store.failIfRunning(h.id, 'morte tardia')
      expect(res).toBeNull()
      expect(store.get(h.id)?.status).toBe('done')
    })
  })

  describe('getByChildSession', () => {
    it('acha o handoff pela sessão-filha', () => {
      const h = newHandoff()
      store.approve(h.id, {})
      store.markRunning(h.id, 's-child-xyz')
      expect(store.getByChildSession('s-child-xyz')?.id).toBe(h.id)
      expect(store.getByChildSession('inexistente')).toBeNull()
    })
  })

  describe('findActiveByTarget (dedup por alvo)', () => {
    it('acha handoff ativo pro mesmo repo-alvo', () => {
      const h = newHandoff('r1')
      expect(store.findActiveByTarget('r1')?.id).toBe(h.id)
      expect(store.findActiveByTarget('r2')).toBeNull()
    })

    it('ignora handoffs em estado terminal (done/rejected/failed)', () => {
      const h = newHandoff('r1')
      store.approve(h.id, {})
      store.markRunning(h.id, 's')
      store.report(h.id, 'ok')
      expect(store.findActiveByTarget('r1')).toBeNull()
    })
  })
})
