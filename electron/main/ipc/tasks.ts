import { ipcMain } from 'electron'
import * as taskStore from '../services/task-store'
import { broadcast, broadcastAffectedObjectives } from '../services/notify'
import type {
  CreateTaskInput,
  Task,
  TaskLink,
  TaskListFilter,
  TaskParentType,
  UpdateTaskInput,
} from '../../../shared/types/ipc'

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
