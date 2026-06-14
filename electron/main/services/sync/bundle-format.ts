import { join } from 'node:path'

// ---- Bundle layout ----
//
// <bundleDir>/manifest.json            metadata (schemaVersion + único campo volátil exportedAt)
// <bundleDir>/tables/<tabela>.ndjson   SELECT * ORDER BY <pk>, 1 row/linha, stableStringify, \n final
// <bundleDir>/features/<projectId>/<slug>.md   cópia verbatim dos .md (corpo = fonte de verdade)

export const MANIFEST_FILE = 'manifest.json'
export const TABLES_DIR = 'tables'
export const FEATURES_DIR = 'features'

export function manifestPath(bundleDir: string): string {
  return join(bundleDir, MANIFEST_FILE)
}

export function tablesDir(bundleDir: string): string {
  return join(bundleDir, TABLES_DIR)
}

export function tableFilePath(bundleDir: string, table: string): string {
  return join(bundleDir, TABLES_DIR, `${table}.ndjson`)
}

export function featuresDir(bundleDir: string): string {
  return join(bundleDir, FEATURES_DIR)
}

// ---- Tabelas sincronizadas, em ORDEM DE FK (pais antes de filhos) ----
//
// Derivado das migrations reais (001_init, 007_features, 011_objectives,
// 012_tasks, 013_feature_links):
//   projects            (raiz)
//   repos               → projects
//   repo_dependencies   → repos, repos
//   features            → projects
//   feature_repos       → features, repos
//   objectives          → objectives (self, parent_objective_id)  [pai antes do filho via ordenação por created_at; ver nota]
//   key_results         → objectives
//   tasks               (sem FK)
//   task_links          → tasks  (parent_id polimórfico, sem FK)
//   feature_links       → features  (target_id polimórfico, sem FK)
//
// As tabelas EXCLUÍDAS (machine-local/derivado) NÃO entram aqui:
//   _migrations, metrics_session_cache, sessions, feature_session_records,
//   workspace_state, layouts, app_prefs.
//
// Nota sobre objectives self-FK (parent_objective_id REFERENCES objectives
// ON DELETE SET NULL): no INSERT em massa o import roda com foreign_keys=OFF,
// então a auto-referência não precisa de ordenação topológica entre rows — o
// foreign_key_check no fim valida a integridade.
export const SYNCED_TABLES = [
  'projects',
  'repos',
  'repo_dependencies',
  'features',
  'feature_repos',
  'objectives',
  'key_results',
  'tasks',
  'task_links',
  'feature_links',
] as const

export type SyncedTable = (typeof SYNCED_TABLES)[number]

// Primary keys por tabela, na ordem da declaração (usado no ORDER BY do export
// para um dump determinístico e diff-friendly). Derivado das migrations reais.
export const TABLE_PRIMARY_KEYS: Record<SyncedTable, readonly string[]> = {
  projects: ['id'],
  repos: ['id'],
  repo_dependencies: ['from_repo_id', 'to_repo_id'],
  features: ['id'],
  feature_repos: ['feature_id', 'repo_id'],
  objectives: ['id'],
  key_results: ['id'],
  tasks: ['id'],
  task_links: ['task_id', 'parent_type', 'parent_id'],
  feature_links: ['feature_id', 'target_type', 'target_id'],
}

// Conjunto para checagem rápida "essa tabela é sincronizada?".
export const SYNCED_TABLE_SET: ReadonlySet<string> = new Set(SYNCED_TABLES)

// ---- Serialização determinística ----

// JSON com chaves ordenadas alfabeticamente (em qualquer profundidade), sem
// pretty-print. Determinismo é o que mantém o diff git limpo: a mesma row vira
// sempre a mesma linha de texto.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortedReplacer(value))
}

// Replacer que reordena as chaves de cada objeto plano. JSON.stringify chama o
// replacer com o valor JÁ resolvido; reconstruímos cada objeto com chaves
// ordenadas para que a serialização final seja estável.
function sortedReplacer(_root: unknown): (key: string, value: unknown) => unknown {
  return function (this: unknown, _key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) {
        sorted[k] = obj[k]
      }
      return sorted
    }
    return value
  }
}

// ---- Manifest ----

export interface BundleManifest {
  schemaVersion: number
  appVersion: string
  exportedAt: number // ÚNICO campo volátil — isolado aqui para não poluir o diff dos dados
  machineId: string
  hostname: string
}
