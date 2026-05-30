import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../../../shared/types/ipc'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

function broadcast(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status', status)
  }
}

export function initUpdater(): void {
  // Em dev não há artefato publicado; o autoUpdater quebraria ao buscar feed.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'available', version: info.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    broadcast({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    broadcast({ state: 'error', message: err.message })
  })

  ipcMain.handle('updates:install', () => {
    autoUpdater.quitAndInstall()
  })

  void autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
}
