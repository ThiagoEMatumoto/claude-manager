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

// Toast só-no-renderer (canal notify:event), SEM notificação nativa. Usado para
// progresso de fundo (ex: clone de repos faltantes) que não deve pipocar o SO a
// cada passo. Ignora a pref `enabled` (é feedback in-app de uma ação/boot).
export function emitToast(title: string, body: string): void {
  const event: NotificationEvent = { title, body, at: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('notify:event', event)
  }
}

export function notify({
  title,
  body,
  ccSessionId,
}: {
  title: string
  body: string
  ccSessionId?: string
}): void {
  const prefs = getNotifPrefs()
  if (!prefs.enabled) return

  if (Notification.isSupported()) {
    const native = new Notification({ title, body })
    native.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
      // Além de focar a janela, pede pro renderer abrir/focar a sessão do evento.
      if (ccSessionId) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('notify:open-session', ccSessionId)
        }
      }
    })
    native.show()
  }

  const event: NotificationEvent = { title, body, at: Date.now(), ccSessionId }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('notify:event', event)
  }
}
