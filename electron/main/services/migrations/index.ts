import type Database from 'better-sqlite3'
import * as init from './001_init'
import * as vault from './002_vault'
import * as workspacePanes from './003_workspace_panes'
import * as dockLayout from './004_dock_layout'
import * as metrics from './005_metrics'
import * as metricsCwd from './006_metrics_cwd'
import * as features from './007_features'
import * as metricsOrchestration from './008_metrics_orchestration'
import * as projectPosition from './009_project_position'
import * as featureSessionRecords from './010_feature_session_records'
import * as objectives from './011_objectives'
import * as tasks from './012_tasks'
import * as featureLinks from './013_feature_links'
import * as sessionsRepoNullable from './014_sessions_repo_nullable'
import * as featureOrigin from './015_feature_origin'
import * as metricsSubagentTurns from './016_metrics_subagent_turns'
import * as repoDepsCanvas from './017_repo_deps_canvas'
import * as handoffs from './018_handoffs'
import * as repoHub from './019_repo_hub'
import * as repoRemoteUrl from './020_repo_remote_url'

interface Migration {
  version: number
  name: string
  up(db: Database.Database): void
  // Migrations que recriam tabela referenciada por FK (DROP+RENAME) precisam de
  // foreign_keys OFF. SQLite ignora o pragma dentro de transação, então o runner
  // o aplica ANTES da transação e valida com foreign_key_check ao religar.
  disableForeignKeys?: boolean
}

// Exportada pra testes: permite aplicar um prefixo da cadeia (ex: 001-014),
// seedar dados e só então aplicar a migration sob teste.
export const migrations: Migration[] = [
  init,
  vault,
  workspacePanes,
  dockLayout,
  metrics,
  metricsCwd,
  features,
  metricsOrchestration,
  projectPosition,
  featureSessionRecords,
  objectives,
  tasks,
  featureLinks,
  sessionsRepoNullable,
  featureOrigin,
  metricsSubagentTurns,
  repoDepsCanvas,
  handoffs,
  repoHub,
  repoRemoteUrl,
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const appliedRows = db
    .prepare('SELECT version FROM _migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>
  const applied = new Set(appliedRows.map((r) => r.version))

  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  const insert = db.prepare(
    'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db)
      insert.run(m.version, m.name, Date.now())
    })
    if (m.disableForeignKeys) {
      db.pragma('foreign_keys = OFF')
      try {
        tx()
      } finally {
        db.pragma('foreign_keys = ON')
      }
      const violations = db.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) {
        throw new Error(
          `[db] migration ${m.name} left ${violations.length} foreign key violation(s): ` +
            JSON.stringify(violations.slice(0, 5)),
        )
      }
    } else {
      tx()
    }
    console.log(`[db] migration applied: ${m.name}`)
  }
}
