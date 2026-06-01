import { ipcMain, BrowserWindow } from 'electron'

function winFromEvent(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (e) => {
    winFromEvent(e)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (e) => {
    const win = winFromEvent(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('window:close', (e) => {
    winFromEvent(e)?.close()
  })

  ipcMain.handle('window:is-maximized', (e) => {
    return winFromEvent(e)?.isMaximized() ?? false
  })
}

// Liga os eventos de maximize/unmaximize da janela ao broadcast pro renderer,
// pra que o botão de restaurar/maximizar reflita o estado real (inclusive quando
// o usuário maximiza via duplo-clique na barra de título nativa ou atalho do OS).
export function wireWindowMaximizeBroadcast(win: BrowserWindow): void {
  const send = () => win.webContents.send('window:maximize-changed', win.isMaximized())
  win.on('maximize', send)
  win.on('unmaximize', send)
}
