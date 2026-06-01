import { BrowserWindow, Notification } from 'electron'
import { getDb } from './db'
import type { NotificationEvent, NotificationPrefs } from '../../../shared/types/ipc'

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  sessionWaiting: true,
  usageHigh: true,
}

// Referência à janela principal, injetada pelo index.ts. Usada pra isFocused()
// (não notificar com o app em foco) e pra focar no clique da notificação nativa.
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getNotifPrefs(): NotificationPrefs {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_prefs WHERE key = ?')
      .get('notifications') as { value: string } | undefined
    if (!row) return DEFAULT_PREFS
    const parsed = JSON.parse(row.value) as Partial<NotificationPrefs>
    return {
      enabled: parsed.enabled ?? DEFAULT_PREFS.enabled,
      sessionWaiting: parsed.sessionWaiting ?? DEFAULT_PREFS.sessionWaiting,
      usageHigh: parsed.usageHigh ?? DEFAULT_PREFS.usageHigh,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function notify({ title, body }: { title: string; body: string }): void {
  const prefs = getNotifPrefs()
  if (!prefs.enabled) return

  if (Notification.isSupported()) {
    const native = new Notification({ title, body })
    native.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    native.show()
  }

  const event: NotificationEvent = { title, body, at: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('notify:event', event)
  }
}
