import { BrowserWindow, ipcMain } from 'electron'
import * as objectiveStore from '../services/objective-store'
import * as overviewStore from '../services/overview-store'
import type {
  CreateKeyResultInput,
  CreateObjectiveInput,
  KeyResult,
  Objective,
  ObjectiveDetail,
  ObjectiveListFilter,
  ObjectiveWithProgress,
  OverviewData,
  UpdateKeyResultInput,
  UpdateObjectiveInput,
} from '../../../shared/types/ipc'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerObjectivesIpc(): void {
  ipcMain.handle(
    'objectives:list',
    (_e, filter?: ObjectiveListFilter): ObjectiveWithProgress[] => {
      return objectiveStore.list(filter)
    },
  )

  ipcMain.handle('objectives:get', (_e, id: string): ObjectiveDetail | null => {
    return objectiveStore.get(id)
  })

  ipcMain.handle('objectives:overview', (): OverviewData => {
    return overviewStore.getOverview()
  })

  ipcMain.handle('objectives:create', (_e, input: CreateObjectiveInput): Objective => {
    const objective = objectiveStore.create(input)
    broadcast('objective:updated', objective)
    return objective
  })

  ipcMain.handle('objectives:update', (_e, input: UpdateObjectiveInput): Objective => {
    const objective = objectiveStore.update(input)
    broadcast('objective:updated', objective)
    return objective
  })

  ipcMain.handle('objectives:archive', (_e, id: string): void => {
    objectiveStore.archive(id)
    // Sinaliza o renderer pra recarregar a lista (o objetivo some dela).
    broadcast('objective:updated', { id, archived: true })
  })

  ipcMain.handle('objectives:kr-create', (_e, input: CreateKeyResultInput): KeyResult => {
    const kr = objectiveStore.createKeyResult(input)
    broadcast('objective:updated', { id: kr.objectiveId, keyResultId: kr.id })
    return kr
  })

  ipcMain.handle('objectives:kr-update', (_e, input: UpdateKeyResultInput): KeyResult => {
    const kr = objectiveStore.updateKeyResult(input)
    broadcast('objective:updated', { id: kr.objectiveId, keyResultId: kr.id })
    return kr
  })

  ipcMain.handle('objectives:kr-delete', (_e, id: string): void => {
    objectiveStore.deleteKeyResult(id)
    broadcast('objective:updated', { keyResultId: id, deleted: true })
  })
}
