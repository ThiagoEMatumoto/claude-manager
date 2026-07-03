import type Database from 'better-sqlite3'
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { join } from 'node:path'
import {
  type BundleManifest,
  type SyncedTable,
  PATH_COLUMNS,
  SYNCED_TABLES,
  TABLE_PRIMARY_KEYS,
  featuresDir,
  manifestPath,
  portablizePath,
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
  // Raiz absoluta dos projetos NESTA máquina. Paths sob ela viram <CM_ROOT>/...
  // (determinístico entre máquinas). null/ausente = paths exportados ficam
  // absolutos. Injetável p/ teste; produção passa o projectsRoot da sync-config.
  projectsRoot?: string | null
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
function writeTable(
  db: Database.Database,
  bundleDir: string,
  table: SyncedTable,
  projectsRoot: string | null,
): void {
  const cols = tableColumns(db, table)
  const pk = TABLE_PRIMARY_KEYS[table]
  const orderBy = pk.map((c) => `"${c}" ASC`).join(', ')
  const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY ${orderBy}`).all() as Array<
    Record<string, unknown>
  >
  const pathCols = new Set(PATH_COLUMNS[table] ?? [])

  const lines = rows.map((row) => {
    // Reconstrói o objeto na ordem de colunas do schema (stableStringify
    // reordena alfabeticamente de qualquer forma; isto só garante presença das
    // colunas mesmo quando o valor é null/undefined no driver).
    const obj: Record<string, unknown> = {}
    for (const c of cols) {
      const v = row[c] ?? null
      // Paths sob a raiz desta máquina viram <CM_ROOT>/... → portáveis entre
      // máquinas (some do diff). NULL passa intacto (portablizePath é no-op).
      obj[c] = pathCols.has(c) ? portablizePath(v, projectsRoot) : v
    }
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

// stat (não existsSync): symlink quebrado passa em lstat mas falha em stat —
// caso pós-migração/sync onde a linha do repo volta mas o diretório-alvo sumiu.
function dirExists(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Lê a URL do remote `origin` de um repo no disco (equivale ao refs.fetch).
// Síncrono de propósito: exportBundle é sync e é chamado por exportBackup (que
// também é sync, num finally de cleanup) — torná-lo async criaria ripple. Sem
// origin / não é repo git → null.
function readOriginUrl(repoPath: string): string | null {
  try {
    const out = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const url = out.trim()
    return url || null
  } catch {
    return null
  }
}

// Antes de exportar, captura o remote origin de cada repo presente no disco e o
// persiste em repos.remote_url. Assim o dump SELECT * carrega a URL entre
// máquinas e a restauração (repo:restore-missing) funciona a qualquer momento.
// Só grava quando encontra um origin — NUNCA apaga uma URL já herdada de outra
// máquina; repo sem origin conhecido permanece com o valor atual (tipicamente NULL).
function captureRemoteUrls(db: Database.Database): void {
  const repos = db.prepare('SELECT id, path FROM repos').all() as Array<{
    id: string
    path: string
  }>
  const update = db.prepare('UPDATE repos SET remote_url = ? WHERE id = ?')
  for (const r of repos) {
    if (!dirExists(r.path)) continue
    const url = readOriginUrl(r.path)
    if (url) update.run(url, r.id)
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

  // Popula repos.remote_url a partir do disco ANTES do dump, para que o
  // SELECT * das tabelas já inclua a URL de restauração.
  captureRemoteUrls(db)

  mkdirSync(tablesDir(bundleDir), { recursive: true })

  const projectsRoot = opts?.projectsRoot ?? null
  for (const table of SYNCED_TABLES) {
    writeTable(db, bundleDir, table, projectsRoot)
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
