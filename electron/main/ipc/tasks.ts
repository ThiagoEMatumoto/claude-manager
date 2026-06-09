import { BrowserWindow, ipcMain } from 'electron'
import * as taskStore from '../services/task-store'
import type {
  CreateTaskInput,
  Task,
  TaskLink,
  TaskListFilter,
  TaskParentType,
  UpdateTaskInput,
} from '../../../shared/types/ipc'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// Mutações de tarefa que tocam parents objective/key_result mudam o progresso
// calculado desses objetivos → além de 'task:updated', emite 'objective:updated'
// com { id } por objetivo afetado (mesmo canal que o IPC de objectives usa,
// então a UI de objetivos recarrega sem listener novo).
function broadcastAffectedObjectives(links: TaskLink[]): void {
  for (const id of taskStore.affectedObjectiveIds(links)) {
    broadcast('objective:updated', { id })
  }
}

export function registerTasksIpc(): void {
  ipcMain.handle('tasks:list', (_e, filter?: TaskListFilter): Task[] => {
    return taskStore.list(filter)
  })

  ipcMain.handle('tasks:get', (_e, id: string): Task | null => {
    return taskStore.get(id)
  })

  ipcMain.handle(
    'tasks:list-by-parent',
    (_e, parentType: TaskParentType, parentId: string): Task[] => {
      return taskStore.listByParent(parentType, parentId)
    },
  )

  ipcMain.handle('tasks:create', (_e, input: CreateTaskInput): Task => {
    const task = taskStore.create(input)
    broadcast('task:updated', task)
    broadcastAffectedObjectives(task.links)
    return task
  })

  ipcMain.handle('tasks:update', (_e, input: UpdateTaskInput): Task => {
    const task = taskStore.update(input)
    broadcast('task:updated', task)
    broadcastAffectedObjectives(task.links)
    return task
  })

  ipcMain.handle('tasks:delete', (_e, id: string): void => {
    const removedLinks = taskStore.remove(id)
    broadcast('task:updated', { id, deleted: true })
    broadcastAffectedObjectives(removedLinks)
  })

  ipcMain.handle('tasks:set-links', (_e, taskId: string, links: TaskLink[]): Task => {
    const previous = taskStore.setLinks(taskId, links)
    const task = taskStore.get(taskId)
    if (!task) throw new Error(`task not found: ${taskId}`)
    broadcast('task:updated', task)
    // Notifica tanto quem ganhou quanto quem perdeu a tarefa.
    broadcastAffectedObjectives([...previous, ...links])
    return task
  })

  ipcMain.handle('tasks:reorder', (_e, taskId: string, position: number): Task => {
    const task = taskStore.reorder(taskId, position)
    broadcast('task:updated', task)
    return task
  })
}
