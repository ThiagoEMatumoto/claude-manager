import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { getPref, setPref } from '../services/prefs-store'
import { getGpuState } from '../services/gpu-state'
import type { GpuStatus } from '../../../shared/types/ipc'

const boolSchema = z.boolean()

export function registerGpuIpc(): void {
  // Estado EM VIGOR (decidido no boot, imutável no processo) + prefs atuais.
  // A UI usa a divergência entre os dois pra mostrar "requer reiniciar".
  ipcMain.handle('gpu:status', (): GpuStatus => {
    const state = getGpuState()
    return {
      hwAccelDisabled: state.hwAccelDisabled,
      ozoneWayland: state.ozoneWayland,
      prefDisabled: getPref('gpu.disabled', false),
      prefOzone: getPref('gpu.ozoneWayland', false),
    }
  })

  ipcMain.handle('gpu:set-disabled', (_e, payload: unknown) => {
    setPref('gpu.disabled', boolSchema.parse(payload))
  })

  ipcMain.handle('gpu:set-ozone', (_e, payload: unknown) => {
    setPref('gpu.ozoneWayland', boolSchema.parse(payload))
  })

  // Reinicia o app pra aplicar mudanças de GPU (decididas antes do ready). O
  // quit dispara o before-quit existente (flush de sync + shutdown limpo).
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })
}
