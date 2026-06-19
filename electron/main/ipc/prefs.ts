import { ipcMain } from 'electron'
import { z } from 'zod'
import { getPref, setPref } from '../services/prefs-store'

const getSchema = z.object({ key: z.string().min(1) })
const setSchema = z.object({ key: z.string().min(1), value: z.unknown() })

export function registerPrefsIpc(): void {
  ipcMain.handle('prefs:get', (_e, payload: unknown) => {
    const { key } = getSchema.parse(payload)
    // Contrato IPC inalterado: ausência/JSON inválido → null.
    return getPref<unknown>(key, null)
  })

  ipcMain.handle('prefs:set', (_e, payload: unknown) => {
    const { key, value } = setSchema.parse(payload)
    setPref(key, value)
  })
}
