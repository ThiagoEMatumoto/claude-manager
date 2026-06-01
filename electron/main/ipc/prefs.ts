import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDb } from '../services/db'

const getSchema = z.object({ key: z.string().min(1) })
const setSchema = z.object({ key: z.string().min(1), value: z.unknown() })

export function registerPrefsIpc(): void {
  ipcMain.handle('prefs:get', (_e, payload: unknown) => {
    const { key } = getSchema.parse(payload)
    const row = getDb().prepare('SELECT value FROM app_prefs WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (row === undefined) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return null
    }
  })

  ipcMain.handle('prefs:set', (_e, payload: unknown) => {
    const { key, value } = setSchema.parse(payload)
    getDb()
      .prepare('INSERT OR REPLACE INTO app_prefs (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value))
  })
}
