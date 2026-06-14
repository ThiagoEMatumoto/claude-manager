import type Database from 'better-sqlite3'
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { markSelfWrite, startFeatureWatcher, stopFeatureWatcher } from '../feature-store'
import {
  type SyncedTable,
  PATH_COLUMNS,
  SYNCED_TABLES,
  featuresDir,
  localizePath,
  manifestPath,
  tableFilePath,
} from './bundle-format'

export interface ImportOpts {
  // Raiz local dos `.md` (destino da reconciliação). Injetável p/ teste.
  featuresRoot?: string | (() => string)
  // Watcher hooks injetáveis (default = feature-store reais). Em teste passamos
  // no-ops para evitar tocar no chokidar/electron real.
  stopWatcher?: () => void
  startWatcher?: () => void
  markSelfWrite?: (path: string) => void
  // Indica se o watcher estava ativo (para reiniciar no finally). Default false.
  watcherWasActive?: boolean
  // Raiz absoluta dos projetos NESTA máquina. Paths <CM_ROOT>/... do bundle são
  // resolvidos contra ela (portabilidade cross-root). null/ausente = sentinela
  // resolvido best-effort (path relativo). Paths absolutos legados passam
  // intactos. Injetável p/ teste; produção passa o projectsRoot da sync-config.
  projectsRoot?: string | null
}

function resolveFeaturesRoot(opts?: ImportOpts): string {
  const r = opts?.featuresRoot
  if (typeof r === 'function') return r()
  if (typeof r === 'string') return r
  return join(app.getPath('userData'), 'features')
}

function localSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null }
  return row.v ?? 0
}

function readManifest(bundleDir: string): { schemaVersion: number } {
  const raw = readFileSync(manifestPath(bundleDir), 'utf8')
  const parsed = JSON.parse(raw) as { schemaVersion?: number }
  if (typeof parsed.schemaVersion !== 'number') {
    throw new Error('[sync] manifest inválido: schemaVersion ausente')
  }
  return { schemaVersion: parsed.schemaVersion }
}

function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

// Lê um .ndjson em array de objetos. Linhas vazias são ignoradas (tabela vazia
// => arquivo vazio ou só com \n).
function readTable(bundleDir: string, table: SyncedTable): Array<Record<string, unknown>> {
  const path = tableFilePath(bundleDir, table)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>)
}

// Reconcilia os `.md`: sobrescreve cada arquivo do bundle no destino local
// (via markSelfWrite para o watcher ignorar) e remove os `.md` locais que não
// existem no bundle. Replace-all => idempotente.
function reconcileFeatures(
  bundleDir: string,
  destRoot: string,
  mark: (path: string) => void,
): void {
  const srcRoot = featuresDir(bundleDir)
  mkdirSync(destRoot, { recursive: true })

  const wanted = new Set<string>() // "projectId/slug.md"

  if (existsSync(srcRoot)) {
    for (const projectId of readdirSync(srcRoot, { withFileTypes: true })) {
      if (!projectId.isDirectory()) continue
      const projDir = join(srcRoot, projectId.name)
      for (const entry of readdirSync(projDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const rel = join(projectId.name, entry.name)
        wanted.add(rel)
        const destDir = join(destRoot, projectId.name)
        mkdirSync(destDir, { recursive: true })
        const destPath = join(destRoot, rel)
        mark(destPath)
        writeFileSync(destPath, readFileSync(join(projDir, entry.name)))
      }
    }
  }

  // Remove .md locais ausentes no bundle.
  if (existsSync(destRoot)) {
    for (const projectId of readdirSync(destRoot, { withFileTypes: true })) {
      if (!projectId.isDirectory()) continue
      const projDir = join(destRoot, projectId.name)
      for (const entry of readdirSync(projDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const rel = join(projectId.name, entry.name)
        if (!wanted.has(rel)) {
          const p = join(projDir, entry.name)
          mark(p)
          rmSync(p)
        }
      }
      if (readdirSync(projDir).length === 0) rmSync(projDir, { recursive: true })
    }
  }
}

// Importa um bundle, substituindo TODO o estado sincronizável local
// (last-writer-wins, replace-all). Idempotente: rodar 2× = mesmo estado.
//
// Sequência:
//   1. valida schema (manifest vs MAX(_migrations) local; bundle MAIOR => erro)
//   2. pausa watcher
//   3. foreign_keys = OFF
//   4. transação: DELETE em ordem REVERSA de FK; INSERT em ordem de FK
//   5. reconcilia .md (sobrescreve via markSelfWrite, remove órfãos)
//   6. finally: foreign_keys = ON, foreign_key_check (lança se violar), reinicia watcher
export function importBundle(db: Database.Database, bundleDir: string, opts?: ImportOpts): void {
  const stop = opts?.stopWatcher ?? stopFeatureWatcher
  const start = opts?.startWatcher ?? startFeatureWatcher
  const mark = opts?.markSelfWrite ?? markSelfWrite
  const projectsRoot = opts?.projectsRoot ?? null

  const { schemaVersion } = readManifest(bundleDir)
  const local = localSchemaVersion(db)
  if (schemaVersion > local) {
    throw new Error(
      `[sync] bundle com schemaVersion ${schemaVersion} > local ${local}: ` +
        'app desatualizado, atualize antes de importar',
    )
  }

  stop()

  // Pré-lê todas as tabelas ANTES de mexer no DB (falha de parse aborta sem
  // deixar o DB num estado parcial).
  const tableData = new Map<SyncedTable, Array<Record<string, unknown>>>()
  for (const table of SYNCED_TABLES) {
    tableData.set(table, readTable(bundleDir, table))
  }

  db.pragma('foreign_keys = OFF')
  try {
    const tx = db.transaction(() => {
      // DELETE em ordem reversa de FK (filhos antes de pais).
      for (const table of [...SYNCED_TABLES].reverse()) {
        db.prepare(`DELETE FROM "${table}"`).run()
      }
      // INSERT em ordem de FK (pais antes de filhos).
      for (const table of SYNCED_TABLES) {
        const rows = tableData.get(table) ?? []
        if (rows.length === 0) continue
        const cols = tableColumns(db, table)
        const pathCols = new Set(PATH_COLUMNS[table] ?? [])
        const placeholders = cols.map((c) => `@${c}`).join(', ')
        const colList = cols.map((c) => `"${c}"`).join(', ')
        const ins = db.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`)
        for (const row of rows) {
          const params: Record<string, unknown> = {}
          for (const c of cols) {
            const v = row[c] ?? null
            // <CM_ROOT>/... → resolve contra a raiz LOCAL; absoluto legado passa
            // intacto; NULL intacto. (unresolved é ignorado aqui — sem raiz local
            // o path fica relativo/quebrado, mas o import não falha.)
            params[c] = pathCols.has(c) ? localizePath(v, projectsRoot).value : v
          }
          ins.run(params)
        }
      }
    })
    tx()

    reconcileFeatures(bundleDir, resolveFeaturesRoot(opts), mark)
  } finally {
    db.pragma('foreign_keys = ON')
    const violations = db.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      // Reinicia o watcher antes de propagar (mantém o app consistente).
      if (opts?.watcherWasActive) start()
      throw new Error(
        `[sync] import deixou ${violations.length} violação(ões) de FK: ` +
          JSON.stringify(violations.slice(0, 5)),
      )
    }
    if (opts?.watcherWasActive) start()
  }
}
