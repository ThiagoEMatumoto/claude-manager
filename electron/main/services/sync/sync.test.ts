import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// `exporter`/`importer` fazem `import { app } from 'electron'` (só como fallback;
// os testes injetam tudo). Mockamos electron minimamente para o módulo resolver.
// `feature-store` também importa electron/chokidar; ao mockar electron ele carrega.
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getVersion: () => '0.0.0-test',
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { SYNCED_TABLES, TABLE_PRIMARY_KEYS, stableStringify } from './bundle-format'
import { exportBundle } from './exporter'
import { importBundle } from './importer'
import { migrations } from '../migrations/index'

// Aplica o schema REAL (todas as migrations, respeitando disableForeignKeys
// como o runner de produção).
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

// Popula um DB com um grafo de dados realista cobrindo TODAS as tabelas
// sincronizadas e suas FKs.
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
    `INSERT INTO repos (id, project_id, label, path, position, created_at, link_kind)
     VALUES (?,?,?,?,?,?,?)`,
  ).run('repo-2', 'proj-1', 'ui', '/home/x/ui', 1, t, 'external')

  db.prepare(
    `INSERT INTO repo_dependencies (from_repo_id, to_repo_id, kind) VALUES (?,?,?)`,
  ).run('repo-2', 'repo-1', 'depends')

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
  // self-FK: obj-2 referencia obj-1 como parent
  db.prepare(
    `INSERT INTO objectives (id, title, kind, status, tags, progress_mode, parent_objective_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run('obj-2', 'Sub', 'custom', 'active', '[]', 'manual', 'obj-1', t, t)

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

// Lê uma tabela inteira ordenada por PK (forma canônica p/ comparação).
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

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
  vi.restoreAllMocks()
})

// Watcher no-ops para isolar do chokidar/electron real.
const noopWatcher = {
  stopWatcher: () => {},
  startWatcher: () => {},
  markSelfWrite: () => {},
}

describe('sync bundle export/import', () => {
  it('1. round-trip: DB-A → export → import em DB-B limpo → igualdade linha-a-linha + .md', () => {
    const dbA = newDb()
    seed(dbA)

    const featRootA = tmp('sync-feat-a-')
    mkdirSync(join(featRootA, 'proj-1'), { recursive: true })
    const mdContent = '---\nid: feat-1\n---\n\n## Visão geral\n\nconteúdo verdade\n'
    writeFileSync(join(featRootA, 'proj-1', 'minha-feature.md'), mdContent)

    const bundleDir = tmp('sync-bundle-')
    exportBundle(dbA, bundleDir, { featuresRoot: featRootA, exportedAt: 1, appVersion: 'x' })

    const dbB = newDb()
    const featRootB = tmp('sync-feat-b-')
    importBundle(dbB, bundleDir, { featuresRoot: featRootB, ...noopWatcher })

    for (const table of SYNCED_TABLES) {
      expect(dumpTable(dbB, table), `tabela ${table}`).toEqual(dumpTable(dbA, table))
    }

    // .md reconciliado byte-a-byte.
    const importedMd = readFileSync(join(featRootB, 'proj-1', 'minha-feature.md'), 'utf8')
    expect(importedMd).toBe(mdContent)

    dbA.close()
    dbB.close()
  })

  it('2. idempotência: importBundle 2× = mesmo estado', () => {
    const dbA = newDb()
    seed(dbA)
    const bundleDir = tmp('sync-bundle-')
    const featRootA = tmp('sync-feat-a-')
    exportBundle(dbA, bundleDir, { featuresRoot: featRootA, exportedAt: 1 })

    const dbB = newDb()
    const featRootB = tmp('sync-feat-b-')
    importBundle(dbB, bundleDir, { featuresRoot: featRootB, ...noopWatcher })
    const after1 = SYNCED_TABLES.map((t) => dumpTable(dbB, t))
    importBundle(dbB, bundleDir, { featuresRoot: featRootB, ...noopWatcher })
    const after2 = SYNCED_TABLES.map((t) => dumpTable(dbB, t))

    expect(after2).toEqual(after1)
    dbA.close()
    dbB.close()
  })

  it('3. determinismo: export 2× sem mutação = arquivos byte-idênticos (diff git limpo)', () => {
    const db = newDb()
    seed(db)
    const featRoot = tmp('sync-feat-')

    const b1 = tmp('sync-bundle-1-')
    const b2 = tmp('sync-bundle-2-')
    exportBundle(db, b1, { featuresRoot: featRoot, exportedAt: 42 })
    exportBundle(db, b2, { featuresRoot: featRoot, exportedAt: 42 })

    for (const table of SYNCED_TABLES) {
      const f1 = readFileSync(join(b1, 'tables', `${table}.ndjson`), 'utf8')
      const f2 = readFileSync(join(b2, 'tables', `${table}.ndjson`), 'utf8')
      expect(f2, `ndjson ${table}`).toBe(f1)
    }
    // manifest idêntico quando exportedAt é fixo.
    expect(readFileSync(join(b2, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(b1, 'manifest.json'), 'utf8'),
    )
    db.close()
  })

  it('4. FK integrity: foreign_key_check vazio após import', () => {
    const dbA = newDb()
    seed(dbA)
    const bundleDir = tmp('sync-bundle-')
    const featRoot = tmp('sync-feat-')
    exportBundle(dbA, bundleDir, { featuresRoot: featRoot, exportedAt: 1 })

    const dbB = newDb()
    importBundle(dbB, bundleDir, { featuresRoot: tmp('sync-feat-b-'), ...noopWatcher })

    const violations = dbB.pragma('foreign_key_check') as unknown[]
    expect(violations).toEqual([])
    dbA.close()
    dbB.close()
  })

  it('5. schema guard: manifest.schemaVersion > local → erro claro', () => {
    const dbA = newDb()
    seed(dbA)
    const bundleDir = tmp('sync-bundle-')
    exportBundle(dbA, bundleDir, { featuresRoot: tmp('sync-feat-'), exportedAt: 1 })

    // Forja schemaVersion futura no manifest.
    const manifestFile = join(bundleDir, 'manifest.json')
    const m = JSON.parse(readFileSync(manifestFile, 'utf8'))
    m.schemaVersion = 9999
    writeFileSync(manifestFile, stableStringify(m) + '\n')

    const dbB = newDb()
    expect(() =>
      importBundle(dbB, bundleDir, { featuresRoot: tmp('sync-feat-b-'), ...noopWatcher }),
    ).toThrow(/atualize antes de importar/)
    dbA.close()
    dbB.close()
  })

  it('6. tabelas excluídas NÃO aparecem no bundle', () => {
    const db = newDb()
    seed(db)
    const bundleDir = tmp('sync-bundle-')
    exportBundle(db, bundleDir, { featuresRoot: tmp('sync-feat-'), exportedAt: 1 })

    const files = readdirSync(join(bundleDir, 'tables'))
    const excluded = [
      '_migrations',
      'metrics_session_cache',
      'sessions',
      'feature_session_records',
      'workspace_state',
      'layouts',
      'app_prefs',
    ]
    for (const ex of excluded) {
      expect(files).not.toContain(`${ex}.ndjson`)
    }
    // E só as sincronizadas estão presentes.
    expect(files.sort()).toEqual(SYNCED_TABLES.map((t) => `${t}.ndjson`).sort())
    db.close()
  })

  it('export poda .md órfão: arquivo no bundle ausente na origem é removido', () => {
    const db = newDb()
    seed(db)
    const featRoot = tmp('sync-feat-')
    mkdirSync(join(featRoot, 'proj-1'), { recursive: true })
    writeFileSync(join(featRoot, 'proj-1', 'a.md'), 'A')

    const bundleDir = tmp('sync-bundle-')
    exportBundle(db, bundleDir, { featuresRoot: featRoot, exportedAt: 1 })
    expect(existsSync(join(bundleDir, 'features', 'proj-1', 'a.md'))).toBe(true)

    // Remove o .md da origem e re-exporta no MESMO bundle → deve podar.
    rmSync(join(featRoot, 'proj-1', 'a.md'))
    exportBundle(db, bundleDir, { featuresRoot: featRoot, exportedAt: 1 })
    expect(existsSync(join(bundleDir, 'features', 'proj-1', 'a.md'))).toBe(false)
    db.close()
  })

  it('import remove .md local ausente no bundle', () => {
    const db = newDb()
    seed(db)
    const bundleDir = tmp('sync-bundle-')
    const featRootSrc = tmp('sync-feat-src-')
    exportBundle(db, bundleDir, { featuresRoot: featRootSrc, exportedAt: 1 })

    const dbB = newDb()
    const featRootB = tmp('sync-feat-b-')
    mkdirSync(join(featRootB, 'proj-9'), { recursive: true })
    writeFileSync(join(featRootB, 'proj-9', 'stale.md'), 'velho')

    importBundle(dbB, bundleDir, { featuresRoot: featRootB, ...noopWatcher })
    expect(existsSync(join(featRootB, 'proj-9', 'stale.md'))).toBe(false)
    db.close()
    dbB.close()
  })
})
