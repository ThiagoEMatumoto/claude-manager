import Database from 'better-sqlite3'
import { unzipSync } from 'fflate'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mesmo mock mínimo de electron que sync.test.ts (exporter/importer/feature-store
// importam electron só como fallback; os testes injetam tudo).
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getVersion: () => '0.0.0-test',
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { SYNCED_TABLES, TABLE_PRIMARY_KEYS } from './bundle-format'
import { exportBackup, importBackup } from './backup'
import { migrations } from '../migrations/index'

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`)
  const insert = db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)')
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
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
    insert.run(m.version, m.name, Date.now())
  }
}

function newDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

// Grafo realista cobrindo todas as tabelas sincronizadas + FKs (espelho do
// seed de sync.test.ts).
function seed(db: Database.Database): void {
  const t = 1_700_000_000_000
  db.prepare(
    `INSERT INTO projects (id, name, color, icon, created_at, updated_at, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('proj-1', 'Projeto Um', '#fff', 'icon', t, t, 0)
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at, position) VALUES (?,?,?,?,?)`).run(
    'proj-2',
    'Projeto Dois',
    t,
    t,
    1,
  )

  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, role, position, created_at, link_kind)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run('repo-1', 'proj-1', 'core', '/home/x/core', 'primary', 0, t, 'external')

  db.prepare(
    `INSERT INTO features (id, project_id, slug, title, status, objective, doc_path, synth_mode, model, created_at, updated_at, completed_at, archived_at, origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    'feat-1',
    'proj-1',
    'minha-feature',
    'Minha Feature',
    'in-progress',
    'fazer X',
    '/tmp/whatever/proj-1/minha-feature.md',
    'threshold',
    null,
    t,
    t,
    null,
    null,
    'manual',
  )

  db.prepare(
    `INSERT INTO feature_repos (feature_id, repo_id, branch, worktree_path) VALUES (?,?,?,?)`,
  ).run('feat-1', 'repo-1', 'feat/x', '/home/x/core/.worktrees/x')

  db.prepare(
    `INSERT INTO objectives (id, title, description, kind, status, tags, progress_mode, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run('obj-1', 'Objetivo', 'desc', 'okr', 'active', '["a","b"]', 'auto_rollup', t, t)

  db.prepare(
    `INSERT INTO key_results (id, objective_id, title, status, progress_mode, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run('kr-1', 'obj-1', 'KR um', 'active', 'manual', t, t)

  db.prepare(
    `INSERT INTO tasks (id, title, description, status, tags, position, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run('task-1', 'Tarefa', 'd', 'todo', '[]', 0, t, t)

  db.prepare(`INSERT INTO task_links (task_id, parent_type, parent_id) VALUES (?,?,?)`).run(
    'task-1',
    'objective',
    'obj-1',
  )
  db.prepare(`INSERT INTO feature_links (feature_id, target_type, target_id) VALUES (?,?,?)`).run(
    'feat-1',
    'key_result',
    'kr-1',
  )
}

function dumpTable(db: Database.Database, table: string): unknown[] {
  const pk = (TABLE_PRIMARY_KEYS as Record<string, readonly string[]>)[table]
  const orderBy = pk.map((c) => `"${c}" ASC`).join(', ')
  return db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all()
}

let dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

const noopWatcher = {
  stopWatcher: () => {},
  startWatcher: () => {},
  markSelfWrite: () => {},
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
  vi.restoreAllMocks()
})

describe('backup .zip export/import', () => {
  it('1. round-trip: DB-A → exportBackup(.zip) → importBackup em DB-B limpo → paridade + .md', () => {
    const dbA = newDb()
    seed(dbA)

    const featRootA = tmp('cm-bak-feat-a-')
    mkdirSync(join(featRootA, 'proj-1'), { recursive: true })
    const mdContent = '---\nid: feat-1\n---\n\n## Visão geral\n\nconteúdo verdade\n'
    writeFileSync(join(featRootA, 'proj-1', 'minha-feature.md'), mdContent)

    const zipDir = tmp('cm-bak-zip-')
    const zipPath = join(zipDir, 'backup.zip')
    const returned = exportBackup(dbA, zipPath, { featuresRoot: featRootA, exportedAt: 1, appVersion: 'x' })
    expect(returned).toBe(zipPath)

    const dbB = newDb()
    const featRootB = tmp('cm-bak-feat-b-')
    importBackup(dbB, zipPath, { featuresRoot: featRootB, ...noopWatcher })

    for (const table of SYNCED_TABLES) {
      expect(dumpTable(dbB, table), `tabela ${table}`).toEqual(dumpTable(dbA, table))
    }

    // .md restaurado byte-a-byte.
    const importedMd = readFileSync(join(featRootB, 'proj-1', 'minha-feature.md'), 'utf8')
    expect(importedMd).toBe(mdContent)

    dbA.close()
    dbB.close()
  })

  it('2. o .zip é um arquivo único válido (unzipSync lê de volta com manifest + tabelas)', () => {
    const dbA = newDb()
    seed(dbA)
    const zipDir = tmp('cm-bak-zip-')
    const zipPath = join(zipDir, 'backup.zip')
    exportBackup(dbA, zipPath, { featuresRoot: tmp('cm-bak-feat-'), exportedAt: 1 })

    // É UM arquivo (não um diretório) e tem bytes.
    const st = statSync(zipPath)
    expect(st.isFile()).toBe(true)
    expect(st.size).toBeGreaterThan(0)

    // unzipSync lê o zip inteiro; deve conter manifest + cada tabela sincronizada.
    const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
    expect(Object.keys(files)).toContain('manifest.json')
    for (const table of SYNCED_TABLES) {
      expect(Object.keys(files), `entrada ${table}`).toContain(`tables/${table}.ndjson`)
    }
    dbA.close()
  })

  it('3. idempotência: importBackup 2× = mesmo estado', () => {
    const dbA = newDb()
    seed(dbA)
    const zipDir = tmp('cm-bak-zip-')
    const zipPath = join(zipDir, 'backup.zip')
    exportBackup(dbA, zipPath, { featuresRoot: tmp('cm-bak-feat-a-'), exportedAt: 1 })

    const dbB = newDb()
    const featRootB = tmp('cm-bak-feat-b-')
    importBackup(dbB, zipPath, { featuresRoot: featRootB, ...noopWatcher })
    const after1 = SYNCED_TABLES.map((t) => dumpTable(dbB, t))
    importBackup(dbB, zipPath, { featuresRoot: featRootB, ...noopWatcher })
    const after2 = SYNCED_TABLES.map((t) => dumpTable(dbB, t))

    expect(after2).toEqual(after1)
    // E paridade com a origem após a 2ª importação.
    for (const table of SYNCED_TABLES) {
      expect(dumpTable(dbB, table), `tabela ${table}`).toEqual(dumpTable(dbA, table))
    }
    dbA.close()
    dbB.close()
  })

  it('4. import destrutivo: substitui TODO o estado local (replace-all)', () => {
    const dbA = newDb()
    seed(dbA)
    const zipDir = tmp('cm-bak-zip-')
    const zipPath = join(zipDir, 'backup.zip')
    exportBackup(dbA, zipPath, { featuresRoot: tmp('cm-bak-feat-a-'), exportedAt: 1 })

    // DB-B começa com dados DIFERENTES; o backup deve apagá-los.
    const dbB = newDb()
    const t = 1_700_000_000_000
    dbB.prepare(`INSERT INTO projects (id, name, created_at, updated_at, position) VALUES (?,?,?,?,?)`).run(
      'proj-velho',
      'Velho',
      t,
      t,
      0,
    )
    importBackup(dbB, zipPath, { featuresRoot: tmp('cm-bak-feat-b-'), ...noopWatcher })

    const ids = (dbB.prepare('SELECT id FROM projects ORDER BY id').all() as Array<{ id: string }>).map(
      (r) => r.id,
    )
    expect(ids).toEqual(['proj-1', 'proj-2']) // proj-velho sumiu; só os do backup
    const violations = dbB.pragma('foreign_key_check') as unknown[]
    expect(violations).toEqual([])
    dbA.close()
    dbB.close()
  })

  it('5. portabilidade: projectsRoot é respeitado no backup (paths cross-root)', () => {
    const rootA = '/home/x/ClaudeManager'
    const rootB = '/Users/y/ClaudeManager'
    const dbA = newDb()
    const t = 1_700_000_000_000
    dbA.prepare(
      `INSERT INTO projects (id, name, vault_path, created_at, updated_at, position) VALUES (?,?,?,?,?,?)`,
    ).run('proj-1', 'P1', join(rootA, 'projetos', 'p1'), t, t, 0)

    const zipDir = tmp('cm-bak-zip-')
    const zipPath = join(zipDir, 'backup.zip')
    exportBackup(dbA, zipPath, { featuresRoot: tmp('cm-bak-feat-'), exportedAt: 1, projectsRoot: rootA })

    const dbB = newDb()
    importBackup(dbB, zipPath, {
      featuresRoot: tmp('cm-bak-feat-b-'),
      ...noopWatcher,
      projectsRoot: rootB,
    })

    const p1 = dbB.prepare(`SELECT vault_path FROM projects WHERE id='proj-1'`).get() as {
      vault_path: string
    }
    expect(p1.vault_path).toBe(join(rootB, 'projetos/p1')) // resolveu contra rootB
    dbA.close()
    dbB.close()
  })
})
