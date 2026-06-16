import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations } from './migrations/index'

// O store importa `getDb` de './db', que depende de electron.app. Mockamos pra
// devolver um SQLite in-memory seedado com a cadeia de migrations.
let testDb: Database.Database
vi.mock('./db', () => ({
  getDb: () => testDb,
}))

import * as store from './repo-dependency-store'

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

function seedProject(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(id, id, Date.now(), Date.now())
}

function seedRepo(db: Database.Database, id: string, projectId: string): void {
  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, position, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, projectId, id, `/tmp/${id}`, Date.now())
}

describe('repo-dependency-store', () => {
  beforeEach(() => {
    testDb = new Database(':memory:')
    testDb.pragma('foreign_keys = ON')
    applyAllMigrations(testDb)
  })

  afterEach(() => {
    testDb.close()
  })

  describe('listAll', () => {
    it('traz arestas de projetos diferentes; listByProject filtra por projeto', () => {
      seedProject(testDb, 'pA')
      seedProject(testDb, 'pB')
      seedRepo(testDb, 'a1', 'pA')
      seedRepo(testDb, 'a2', 'pA')
      seedRepo(testDb, 'b1', 'pB')
      seedRepo(testDb, 'b2', 'pB')
      store.create({ fromRepoId: 'a1', toRepoId: 'a2', kind: 'depends-on' })
      store.create({ fromRepoId: 'b1', toRepoId: 'b2', kind: 'calls-api' })

      expect(store.listAll()).toHaveLength(2)
      const onlyA = store.listByProject('pA')
      expect(onlyA).toHaveLength(1)
      expect(onlyA[0].fromRepoId).toBe('a1')
    })
  })

  describe('connectHubToAll', () => {
    beforeEach(() => {
      seedProject(testDb, 'pA')
      seedProject(testDb, 'pB')
      seedRepo(testDb, 'hub', 'pA')
      seedRepo(testDb, 'a2', 'pA')
      seedRepo(testDb, 'b1', 'pB')
    })

    it('conecta o hub a todos os outros repos (global) e é idempotente', () => {
      const first = store.connectHubToAll('hub', 'work-hub')
      // 3 repos no total, menos o próprio hub = 2 arestas.
      expect(first).toHaveLength(2)
      expect(store.listAll()).toHaveLength(2)
      // Nenhuma auto-aresta.
      expect(first.every((e) => e.toRepoId !== 'hub')).toBe(true)

      // 2ª chamada não duplica.
      store.connectHubToAll('hub', 'work-hub')
      expect(store.listAll()).toHaveLength(2)
    })

    it('com projectId restringe ao projeto do hub', () => {
      const created = store.connectHubToAll('hub', 'monorepo', 'pA')
      // Só 'a2' está em pA (hub também, mas é pulado) → 1 aresta.
      expect(created).toHaveLength(1)
      expect(created[0].toRepoId).toBe('a2')
    })
  })
})
