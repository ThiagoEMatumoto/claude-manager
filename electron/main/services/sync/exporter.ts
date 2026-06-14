import type Database from 'better-sqlite3'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import {
  type BundleManifest,
  type SyncedTable,
  SYNCED_TABLES,
  TABLE_PRIMARY_KEYS,
  featuresDir,
  manifestPath,
  stableStringify,
  tableFilePath,
  tablesDir,
} from './bundle-format'

export interface ExportOpts {
  // Raiz dos `.md` de feature. Injetável para teste; default = featuresRoot real.
  // Aceita string ou factory (alinha com a assinatura de feature-store.featuresRoot()).
  featuresRoot?: string | (() => string)
  // Metadados do manifest. Defaults derivam de electron/os quando ausentes.
  appVersion?: string
  machineId?: string
  exportedAt?: number // injetável p/ testes de determinismo; default = Date.now()
}

function resolveFeaturesRoot(opts?: ExportOpts): string {
  const r = opts?.featuresRoot
  if (typeof r === 'function') return r()
  if (typeof r === 'string') return r
  // default real: featuresRoot() = <userData>/features
  return join(app.getPath('userData'), 'features')
}

function resolveAppVersion(opts?: ExportOpts): string {
  if (opts?.appVersion) return opts.appVersion
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

// Colunas da tabela na ordem de declaração do schema (PRAGMA table_info).
// Derivar do DB real evita hardcodar colunas e sobrevive a migrations futuras.
function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

// Escreve uma tabela como .ndjson determinístico: SELECT * ORDER BY <pk>, cada
// row é um objeto {coluna: valor} serializado com stableStringify (chaves
// ordenadas), uma por linha, com \n final.
function writeTable(db: Database.Database, bundleDir: string, table: SyncedTable): void {
  const cols = tableColumns(db, table)
  const pk = TABLE_PRIMARY_KEYS[table]
  const orderBy = pk.map((c) => `"${c}" ASC`).join(', ')
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all() as Array<
    Record<string, unknown>
  >

  const lines = rows.map((row) => {
    // Reconstrói o objeto na ordem de colunas do schema (stableStringify
    // reordena alfabeticamente de qualquer forma; isto só garante presença das
    // colunas mesmo quando o valor é null/undefined no driver).
    const obj: Record<string, unknown> = {}
    for (const c of cols) obj[c] = row[c] ?? null
    return stableStringify(obj)
  })

  const content = lines.length ? lines.join('\n') + '\n' : ''
  writeFileSync(tableFilePath(bundleDir, table), content, 'utf8')
}

// Copia os `.md` de <featuresRoot>/<projectId>/<slug>.md para o bundle,
// podando órfãos: o conteúdo de features/ no bundle passa a refletir EXATAMENTE
// o disco de origem (arquivos que não existem mais são removidos do bundle).
function copyFeatures(bundleDir: string, srcRoot: string): void {
  const destRoot = featuresDir(bundleDir)
  mkdirSync(destRoot, { recursive: true })

  // 1. Coletar os .md de origem (<srcRoot>/<projectId>/<slug>.md).
  const wanted = new Set<string>() // caminhos relativos "projectId/slug.md"
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
        writeFileSync(join(destRoot, rel), readFileSync(join(projDir, entry.name)))
      }
    }
  }

  // 2. Podar órfãos do bundle (presentes no destino mas ausentes na origem).
  for (const projectId of readdirSync(destRoot, { withFileTypes: true })) {
    if (!projectId.isDirectory()) continue
    const projDir = join(destRoot, projectId.name)
    for (const entry of readdirSync(projDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const rel = join(projectId.name, entry.name)
      if (!wanted.has(rel)) rmSync(join(projDir, entry.name))
    }
    // Remove diretório de projeto vazio remanescente.
    if (readdirSync(projDir).length === 0) rmSync(projDir, { recursive: true })
  }
}

function maxSchemaVersion(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null }
  return row.v ?? 0
}

// Exporta o estado sincronizável do DB para um bundle determinístico em
// <bundleDir>. Idempotente em conteúdo de dados: exportar 2× sem mutação produz
// arquivos byte-idênticos (exceto exportedAt no manifest, isolado de propósito).
export function exportBundle(
  db: Database.Database,
  bundleDir: string,
  opts?: ExportOpts,
): BundleManifest {
  // Garante que o WAL foi aplicado ao .db antes de ler (relevante quando o
  // mesmo processo escreveu há pouco). TRUNCATE encolhe o -wal.
  db.pragma('wal_checkpoint(TRUNCATE)')

  mkdirSync(tablesDir(bundleDir), { recursive: true })

  for (const table of SYNCED_TABLES) {
    writeTable(db, bundleDir, table)
  }

  copyFeatures(bundleDir, resolveFeaturesRoot(opts))

  const manifest: BundleManifest = {
    schemaVersion: maxSchemaVersion(db),
    appVersion: resolveAppVersion(opts),
    exportedAt: opts?.exportedAt ?? Date.now(),
    machineId: opts?.machineId ?? hostname(),
    hostname: hostname(),
  }
  writeFileSync(manifestPath(bundleDir), stableStringify(manifest) + '\n', 'utf8')

  return manifest
}
