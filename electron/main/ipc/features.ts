import { BrowserWindow, ipcMain } from 'electron'
import * as featureStore from '../services/feature-store'
import type {
  Feature,
  CreateFeatureInput,
  UpdateFeatureInput,
  SetFeatureReposInput,
} from '../../../shared/types/ipc'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerFeaturesIpc(): void {
  ipcMain.handle('features:list', (_e, projectId?: string): Feature[] => {
    return featureStore.list(projectId)
  })

  ipcMain.handle('features:get', (_e, id: string): Feature | null => {
    return featureStore.get(id)
  })

  ipcMain.handle('features:create', (_e, input: CreateFeatureInput): Feature => {
    const feature = featureStore.create(input)
    broadcast('feature:updated', feature)
    return feature
  })

  ipcMain.handle('features:update', (_e, input: UpdateFeatureInput): Feature => {
    const feature = featureStore.update(input)
    broadcast('feature:updated', feature)
    return feature
  })

  ipcMain.handle('features:archive', (_e, id: string): void => {
    featureStore.archive(id)
    // Sinaliza o renderer pra recarregar a lista (a feature some dela).
    broadcast('feature:updated', { id, archived: true })
  })

  ipcMain.handle('features:set-repos', (_e, input: SetFeatureReposInput): Feature => {
    const feature = featureStore.setRepos(input.id, input.repos)
    broadcast('feature:updated', feature)
    return feature
  })
}
