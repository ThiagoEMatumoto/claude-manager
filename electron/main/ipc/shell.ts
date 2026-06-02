import { app, ipcMain, shell } from 'electron'
import type { AppInfo } from '../../../shared/types/ipc'

export function registerShellIpc(): void {
  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    await shell.openPath(path)
  })

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle(
    'app:get-info',
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
  )
}
