import { ipcMain } from 'electron'
import { z } from 'zod'
import { getPref, setPref } from '../services/prefs-store'
import {
  calendarWatcher,
  MEETING_CALENDAR_ICS_URL_KEY,
} from '../services/calendar/calendar-watcher'

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
    // Mudar a URL secreta do calendário liga/desliga/reaponta o watcher na hora,
    // sem exigir restart do app (restart limpa o dedupe da URL anterior).
    if (key === MEETING_CALENDAR_ICS_URL_KEY) calendarWatcher.restart()
  })
}
