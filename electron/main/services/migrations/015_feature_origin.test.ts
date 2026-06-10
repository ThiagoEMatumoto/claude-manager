import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrations } from './index'
import { ORPHAN_CUTOFF, up as up015 } from './015_feature_origin'

// Aplica as migrations 001-014 (a 014 precisa de foreign_keys OFF, igual ao
// runner real), deixando o schema pronto pra seedar ANTES da 015.
function applyUpTo014(db: Database.Database): void {
  for (const m of migrations.filter((m) => m.version < 15)) {
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

const JUN_03 = Date.UTC(2026, 5, 3) // dia do backfill que gerou as órfãs
const JUN_09 = Date.UTC(2026, 5, 9) // depois do cutoff

interface SeedFeature {
  id: string
  createdAt: number
  updatedAt: number
  archivedAt?: number | null
}

function seedFeature(db: Database.Database, f: SeedFeature): void {
  db.prepare(
    `INSERT INTO features
       (id, project_id, slug, title, status, doc_path, synth_mode, created_at, updated_at, archived_at)
     VALUES (?, 'p1', ?, ?, 'in-progress', ?, 'threshold', ?, ?, ?)`,
  ).run(f.id, f.id, f.id, `/tmp/${f.id}.md`, f.createdAt, f.updatedAt, f.archivedAt ?? null)
}

function seedRecord(db: Database.Database, sessionId: string, featureId: string): void {
  db.prepare(
    `INSERT INTO sessions (id, repo_id, status, started_at) VALUES (?, NULL, 'exited', ?)`,
  ).run(sessionId, JUN_03)
  db.prepare(
    `INSERT INTO feature_session_records
       (session_id, feature_id, summary, session_at, created_at)
     VALUES (?, ?, 'resumo', ?, ?)`,
  ).run(sessionId, featureId, JUN_03, JUN_03)
}

describe('migration 015_feature_origin', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyUpTo014(db)
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'P1', ?, ?)`,
    ).run(JUN_03, JUN_03)
  })

  afterEach(() => {
    db.close()
  })

  it('adiciona origin com default manual em rows existentes e novas', () => {
    seedFeature(db, { id: 'f1', createdAt: JUN_09, updatedAt: JUN_09 })
    up015(db)
    const row = db.prepare(`SELECT origin FROM features WHERE id = 'f1'`).get() as {
      origin: string
    }
    expect(row.origin).toBe('manual')
  })

  it('arquiva exatamente as órfãs do backfill (0 records, nunca editadas, antes do cutoff)', () => {
    // As 6 órfãs reais: auto-criadas em 03/jun, created==updated, 0 records.
    for (let i = 1; i <= 6; i++) {
      seedFeature(db, { id: `orphan-${i}`, createdAt: JUN_03 + i, updatedAt: JUN_03 + i })
    }
    // Legítimas que o predicado NÃO pode pegar:
    // a) antiga, created==updated, MAS tem session record
    seedFeature(db, { id: 'with-record', createdAt: JUN_03, updatedAt: JUN_03 })
    seedRecord(db, 's-rec', 'with-record')
    // b) antiga, sem records, mas foi EDITADA (created != updated)
    seedFeature(db, { id: 'edited', createdAt: JUN_03, updatedAt: JUN_03 + 1000 })
    // c) recente (depois do cutoff), created==updated, sem records
    seedFeature(db, { id: 'recent', createdAt: JUN_09, updatedAt: JUN_09 })
    // d) já arquivada antes — archived_at não pode ser sobrescrito
    seedFeature(db, { id: 'pre-archived', createdAt: JUN_03, updatedAt: JUN_03, archivedAt: 123 })

    up015(db)

    const archived = db
      .prepare(`SELECT id FROM features WHERE archived_at IS NOT NULL AND id != 'pre-archived' ORDER BY id`)
      .all() as Array<{ id: string }>
    expect(archived.map((r) => r.id)).toEqual([
      'orphan-1',
      'orphan-2',
      'orphan-3',
      'orphan-4',
      'orphan-5',
      'orphan-6',
    ])

    // Órfãs também ficam marcadas como auto-criadas.
    const origins = db
      .prepare(`SELECT DISTINCT origin FROM features WHERE id LIKE 'orphan-%'`)
      .all() as Array<{ origin: string }>
    expect(origins).toEqual([{ origin: 'auto' }])

    // Legítimas intactas (origin manual, não arquivadas).
    const intact = db
      .prepare(
        `SELECT id, origin, archived_at FROM features WHERE id IN ('with-record','edited','recent')`,
      )
      .all() as Array<{ id: string; origin: string; archived_at: number | null }>
    for (const row of intact) {
      expect(row.archived_at).toBeNull()
      expect(row.origin).toBe('manual')
    }

    // Pré-arquivada preserva o archived_at original.
    const pre = db
      .prepare(`SELECT archived_at FROM features WHERE id = 'pre-archived'`)
      .get() as { archived_at: number }
    expect(pre.archived_at).toBe(123)
  })

  it('cutoff fica antes de qualquer feature criada de 08/jun em diante', () => {
    expect(ORPHAN_CUTOFF).toBe(Date.UTC(2026, 5, 8))
    expect(JUN_03).toBeLessThan(ORPHAN_CUTOFF)
    expect(JUN_09).toBeGreaterThan(ORPHAN_CUTOFF)
  })
})
