// PARTE A — E2E real do sync git-backed contra um repo GitHub de verdade.
//
// Roda com tsx (Node ABI). O better_sqlite3.node em node_modules DEVE estar na
// variante node-abi (o caller faz o swap antes e restaura Electron-ABI depois).
//
//   npx tsx e2e/scenarios/sync-e2e-real.ts
//
// NÃO deleta o repo GitHub. Limpa apenas os tmpdirs locais.

import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'

// O harness bloqueia PAGER/GIT_EDITOR no spawn de git — limpamos para não
// travar. A AUTH é resolvida pelo CÓDIGO DE PRODUÇÃO (credential helper do gh,
// injetado por-operação em git-sync), não por este script: este E2E exercita o
// caminho de auth REAL contra o GitHub.
delete process.env.PAGER
delete process.env.GIT_PAGER
delete process.env.GIT_EDITOR
delete process.env.EDITOR

import { SYNCED_TABLES, TABLE_PRIMARY_KEYS } from '../../electron/main/services/sync/bundle-format'
import { ensureRepo, ghAvailable, pull, applyRemote, pushBundle, bundleDirFor } from '../../electron/main/services/sync/git-sync'
import { importBundle } from '../../electron/main/services/sync/importer'
import { migrations } from '../../electron/main/services/migrations/index'

const REPO_URL = 'https://github.com/ThiagoEMatumoto/claude-manager-sync-e2e-test.git'

// ---- helpers ----

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

function newDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

// Popula DB-A cobrindo TODAS as tabelas sincronizadas + FKs.
function seed(db: Database.Database): void {
  const t = 1_700_000_000_000
  db.prepare(
    `INSERT INTO projects (id, name, color, icon, created_at, updated_at, position) VALUES (?,?,?,?,?,?,?)`,
  ).run('proj-1', 'Projeto E2E', '#0af', 'rocket', t, t, 0)

  db.prepare(
    `INSERT INTO repos (id, project_id, label, path, role, position, created_at, link_kind) VALUES (?,?,?,?,?,?,?,?)`,
  ).run('repo-1', 'proj-1', 'core', '/home/x/core', 'primary', 0, t, 'external')

  db.prepare(
    `INSERT INTO features (id, project_id, slug, title, status, objective, doc_path, synth_mode, model, created_at, updated_at, completed_at, archived_at, origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    'feat-1', 'proj-1', 'data-sync', 'Data Sync', 'in-progress', 'sincronizar', '/x/proj-1/data-sync.md',
    'threshold', null, t, t, null, null, 'manual',
  )

  db.prepare(
    `INSERT INTO objectives (id, title, description, kind, status, tags, progress_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run('obj-1', 'Objetivo E2E', 'desc', 'okr', 'active', '["sync"]', 'auto_rollup', t, t)

  db.prepare(
    `INSERT INTO key_results (id, objective_id, title, status, progress_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
  ).run('kr-1', 'obj-1', 'KR E2E', 'active', 'manual', t, t)

  db.prepare(
    `INSERT INTO tasks (id, title, description, status, tags, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run('task-1', 'Tarefa A', 'da', 'todo', '[]', 0, t, t)
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, tags, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
  ).run('task-2', 'Tarefa B', 'db', 'done', '["x"]', 1, t, t)

  db.prepare(`INSERT INTO task_links (task_id, parent_type, parent_id) VALUES (?,?,?)`).run(
    'task-1', 'objective', 'obj-1',
  )
  db.prepare(`INSERT INTO feature_links (feature_id, target_type, target_id) VALUES (?,?,?)`).run(
    'feat-1', 'key_result', 'kr-1',
  )
}

function dumpTable(db: Database.Database, table: string): unknown[] {
  const pk = (TABLE_PRIMARY_KEYS as Record<string, readonly string[]>)[table]
  const orderBy = pk.map((c) => `"${c}" ASC`).join(', ')
  return db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all()
}

const dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

let failures = 0
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    failures++
    console.log(`  ❌ ${label}${detail ? `\n     ${detail}` : ''}`)
  }
}

async function remoteHeadSha(workdir: string): Promise<string> {
  const git = simpleGit(workdir)
  return (await git.raw(['rev-parse', 'HEAD'])).trim()
}

async function main(): Promise<void> {
  if (!ghAvailable()) {
    console.error('PARE: `gh` não autenticado. Rode `gh auth login`. Sem workaround.')
    process.exit(2)
  }
  // Auth resolvida pelo CÓDIGO DE PRODUÇÃO (git-sync injeta o credential helper
  // do gh por-operação). NÃO configuramos credential.helper aqui — provar o
  // caminho default real é o ponto deste E2E.
  console.log('gh autenticado; auth via credential helper de PRODUÇÃO. Push/clone HTTPS reais contra GitHub.\n')
  const opts = {} as const

  // === Setup DBs e featuresRoots ===
  const dbAPath = join(tmp('cm-e2e-dba-'), 'a.db')
  const dbBPath = join(tmp('cm-e2e-dbb-'), 'b.db')
  const featRootA = tmp('cm-e2e-feat-a-')
  const featRootB = tmp('cm-e2e-feat-b-')
  const workdirA = tmp('cm-e2e-wd-a-')
  const workdirB = tmp('cm-e2e-wd-b-')

  const dbA = newDb(dbAPath)
  seed(dbA)

  // .md de origem (corpo = fonte de verdade).
  mkdirSync(join(featRootA, 'proj-1'), { recursive: true })
  const mdContent = '---\nid: feat-1\nslug: data-sync\n---\n\n## Visão geral\n\nE2E real round-trip via GitHub.\n'
  writeFileSync(join(featRootA, 'proj-1', 'data-sync.md'), mdContent)

  // === Máquina A: ensureRepo + pushBundle (HTTPS REAL) ===
  console.log('=== Máquina A: ensureRepo + pushBundle (push HTTPS real) ===')
  await ensureRepo(workdirA, REPO_URL, opts)
  const pushRes = await pushBundle(workdirA, dbA, 'e2e from A', {
    ...opts,
    exportOpts: { featuresRoot: featRootA, exportedAt: 1, appVersion: 'e2e' },
  })
  ok(pushRes.pushed && !pushRes.rejected, 'push A → GitHub aceito (fast-forward)', JSON.stringify(pushRes))
  const shaA = await remoteHeadSha(workdirA)
  console.log(`  → commit local A: ${shaA}`)

  // === Máquina B: ensureRepo (clona o que A enviou) + pull + applyRemote + importBundle ===
  console.log('\n=== Máquina B: clone + pull + applyRemote + importBundle ===')
  await ensureRepo(workdirB, REPO_URL, opts)
  const pullState = await pull(workdirB, opts)
  console.log(`  → pullState B: ${JSON.stringify(pullState)}`)
  await applyRemote(workdirB)
  const shaB = await remoteHeadSha(workdirB)
  ok(shaB === shaA, 'commit clonado em B == commit empurrado por A', `A=${shaA} B=${shaB}`)
  console.log(`  → SHA confirmado contra GitHub real: ${shaB}`)

  const dbB = newDb(dbBPath)
  importBundle(dbB, bundleDirFor(workdirB), {
    featuresRoot: featRootB,
    stopWatcher: () => {},
    startWatcher: () => {},
    markSelfWrite: () => {},
  })

  // === Paridade por tabela ===
  console.log('\n=== Paridade por tabela (A vs B) ===')
  for (const table of SYNCED_TABLES) {
    const a = dumpTable(dbA, table)
    const b = dumpTable(dbB, table)
    const eq = JSON.stringify(a) === JSON.stringify(b)
    ok(eq, `${table} (${a.length} rows)`, eq ? undefined : `A=${JSON.stringify(a)}\n     B=${JSON.stringify(b)}`)
  }

  // === Paridade .md ===
  const importedMd = readFileSync(join(featRootB, 'proj-1', 'data-sync.md'), 'utf8')
  ok(importedMd === mdContent, '.md reconciliado byte-a-byte em B')

  // === 2ª rodada: LWW (muta A, push, B puxa) ===
  console.log('\n=== 2ª rodada (LWW): muta título de task-1 em A → push → B aplica ===')
  dbA.prepare(`UPDATE tasks SET title = ? WHERE id = ?`).run('Tarefa A (editada)', 'task-1')
  const push2 = await pushBundle(workdirA, dbA, 'e2e from A — round 2', {
    ...opts,
    exportOpts: { featuresRoot: featRootA, exportedAt: 2, appVersion: 'e2e' },
  })
  ok(push2.pushed && !push2.rejected, 'push A round-2 aceito', JSON.stringify(push2))
  const sha2 = await remoteHeadSha(workdirA)
  console.log(`  → novo commit A: ${sha2}`)

  await pull(workdirB, opts)
  await applyRemote(workdirB)
  importBundle(dbB, bundleDirFor(workdirB), {
    featuresRoot: featRootB,
    stopWatcher: () => {},
    startWatcher: () => {},
    markSelfWrite: () => {},
  })
  const titleB = (dbB.prepare(`SELECT title FROM tasks WHERE id = ?`).get('task-1') as { title: string }).title
  ok(titleB === 'Tarefa A (editada)', 'mutação LWW chegou em B', `titleB=${titleB}`)

  // paridade total de novo
  let allEq = true
  for (const table of SYNCED_TABLES) {
    if (JSON.stringify(dumpTable(dbA, table)) !== JSON.stringify(dumpTable(dbB, table))) {
      allEq = false
      console.log(`  ❌ divergência pós-LWW em ${table}`)
    }
  }
  ok(allEq, 'paridade total mantida após 2ª rodada')

  dbA.close()
  dbB.close()

  console.log(`\n=== RESULTADO: ${failures === 0 ? 'TODOS PASSARAM ✅' : `${failures} FALHA(S) ❌`} ===`)
  console.log(`SHA remoto round-1: ${shaA}`)
  console.log(`SHA remoto round-2: ${sha2}`)
}

main()
  .catch((err) => {
    console.error('\nERRO FATAL:', err)
    process.exitCode = 1
  })
  .finally(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })
