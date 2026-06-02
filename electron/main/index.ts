import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getDb, closeDb } from './services/db'
import { ptyManager } from './services/pty-manager'
import { sessionActivityService } from './services/session-activity'
import { registerProjectIpc } from './ipc/projects'
import { registerSessionIpc } from './ipc/sessions'
import { registerShellIpc } from './ipc/shell'
import { registerDialogIpc } from './ipc/dialog'
import { registerGitIpc } from './ipc/git'
import { registerPrefsIpc } from './ipc/prefs'
import { registerClaudeConfigsIpc } from './ipc/claude-configs'
import { registerClaudePluginsIpc } from './ipc/claude-plugins'
import { registerMetricsIpc } from './ipc/metrics'
import { registerFeaturesIpc } from './ipc/features'
import { startFeatureWatcher, stopFeatureWatcher } from './services/feature-store'
import { featureMemory } from './services/feature-memory'
import {
  registerWorkspaceIpc,
  markWorkspaceRunning,
  markWorkspaceCleanShutdown,
} from './ipc/workspace'
import { initUpdater } from './services/updater'
import { startUsageMonitor, stopUsageMonitor } from './services/usage-monitor'
import { registerWindowIpc, wireWindowMaximizeBroadcast } from './ipc/window'
import { setMainWindow } from './services/notifications'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

// No Linux, o compositing por GPU do Chromium falha em várias combinações de
// driver (ex: nVidia/Wayland) e pinta a janela inteira de preto, mesmo com o DOM
// renderizado normalmente. Desligar a aceleração de hardware evita isso; o custo
// é desprezível para um app focado em terminal. Precisa ser chamado antes do ready.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  setMainWindow(win)
  wireWindowMaximizeBroadcast(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  getDb()
  // Captura o clean_shutdown do boot anterior e o zera; deve rodar antes da
  // janela para que o renderer leia o valor correto via workspace:get-boot-state.
  markWorkspaceRunning()
  registerProjectIpc()
  registerSessionIpc()
  registerShellIpc()
  registerDialogIpc()
  registerGitIpc()
  registerPrefsIpc()
  registerWorkspaceIpc()
  registerClaudeConfigsIpc()
  registerClaudePluginsIpc()
  registerMetricsIpc()
  registerFeaturesIpc()
  registerWindowIpc()

  createMainWindow()
  initUpdater()
  startUsageMonitor()
  startFeatureWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  stopUsageMonitor()
  stopFeatureWatcher()
  featureMemory.close()
  ptyManager.killAll()
  sessionActivityService.closeAll()
  getDb()
    .prepare("UPDATE sessions SET status = 'exited', ended_at = ? WHERE status = 'running'")
    .run(Date.now())
  markWorkspaceCleanShutdown()
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
