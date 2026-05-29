import { ipcMain, shell } from 'electron'

export function registerShellIpc(): void {
  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    await shell.openPath(path)
  })
}
