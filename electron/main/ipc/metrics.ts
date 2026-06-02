import { ipcMain } from 'electron'
import { getMetrics, refreshMetrics } from '../services/metrics-service'
import type { MetricsSnapshot, MetricsWindow } from '../../../shared/types/ipc'

// metrics:get(window) agrega sem rescan; metrics:refresh força rescan e re-agrega.
// O progresso do scan é broadcast em 'metrics:progress' pelo metrics-service.
export function registerMetricsIpc(): void {
  ipcMain.handle('metrics:get', (_e, window: MetricsWindow): Promise<MetricsSnapshot> => {
    return getMetrics(window)
  })

  ipcMain.handle('metrics:refresh', (_e, window?: MetricsWindow): Promise<MetricsSnapshot> => {
    return refreshMetrics(window ?? 'all')
  })
}
