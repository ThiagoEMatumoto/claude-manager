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
import { registerClaudeConfigsIpc } from './ipc/claude-configs'
import { registerClaudePluginsIpc } from './ipc/claude-plugins'
import {
  registerWorkspaceIpc,
  markWorkspaceRunning,
  markWorkspaceCleanShutdown,
} from './ipc/workspace'
import { initUpdater } from './services/updater'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
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
  registerWorkspaceIpc()
  registerClaudeConfigsIpc()
  registerClaudePluginsIpc()

  createMainWindow()
  initUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
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
