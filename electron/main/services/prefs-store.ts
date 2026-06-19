import { getDb } from './db'

// Helper reutilizável de preferências (key/value JSON em app_prefs). Extraído do
// handler IPC prefs:get/set para uso direto no main (ex.: tetos configuráveis no
// MCP). O contrato IPC permanece o mesmo — prefs.ts delega aqui.

export function getPref<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM app_prefs WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (row === undefined) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setPref(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value))
}
