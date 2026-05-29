import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { runMigrations } from './migrations/index'

let dbInstance: Database.Database | null = null

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  const dbPath = join(userDataDir, 'app.db')

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  runMigrations(db)

  // Sessões marcadas 'running' de um boot anterior são órfãs: o processo claude
  // morre junto com o app, então nenhuma está realmente viva ao iniciar.
  db.prepare("UPDATE sessions SET status = 'exited', ended_at = ? WHERE status = 'running'").run(
    Date.now(),
  )

  dbInstance = db
  return db
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
