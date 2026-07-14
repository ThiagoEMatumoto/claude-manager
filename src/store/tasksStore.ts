import { create } from 'zustand'
import { tasksApi } from '@/lib/ipc'
import type {
  CreateTaskInput,
  Task,
  TaskLink,
  TaskListFilter,
  UpdateTaskInput,
} from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe),
// mesmo padrão do objectivesStore/featuresStore.
let offUpdated: (() => void) | null = null
let updatedStarted = false

interface TasksState {
  // Índice de tarefas (links já embutidos). Fonte da lista/board/pendências.
  tasks: Task[]
  filter: TaskListFilter
  loading: boolean
  error: string | null
  // Tarefa alvo de navigateToTask (nav.ts): TasksArea observa e abre o dialog
  // de edição dela assim que aparecer em `tasks`, depois limpa.
  focusTaskId: string | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  setFilter: (filter: TaskListFilter) => Promise<void>

  createTask: (input: CreateTaskInput) => Promise<Task>
  updateTask: (input: UpdateTaskInput) => Promise<Task>
  deleteTask: (id: string) => Promise<void>
  setLinks: (taskId: string, links: TaskLink[]) => Promise<Task>

  focusTask: (id: string) => void
  clearFocusTask: () => void

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  filter: {},
  loading: false,
  error: null,
  focusTaskId: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const tasks = await tasksApi.list(get().filter)
      set({ tasks, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    await get().load()
  },

  setFilter: async (filter) => {
    set({ filter })
    await get().load()
  },

  createTask: async (input) => {
    const created = await tasksApi.create(input)
    await get().refresh()
    return created
  },

  updateTask: async (input) => {
    const updated = await tasksApi.update(input)
    await get().refresh()
    return updated
  },

  deleteTask: async (id) => {
    await tasksApi.delete(id)
    await get().refresh()
  },

  setLinks: async (taskId, links) => {
    const updated = await tasksApi.setLinks(taskId, links)
    await get().refresh()
    return updated
  },

  focusTask: (id) => set({ focusTaskId: id }),
  clearFocusTask: () => set({ focusTaskId: null }),

  startUpdatedWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = tasksApi.onUpdated(() => {
      // O payload do canal `task:updated` varia por mutação (Task completa ou
      // marcador {id, deleted}) — tratamos sempre como sinal de recarga.
      void get().refresh()
    })
  },

  stopUpdatedWatch: () => {
    if (offUpdated) {
      offUpdated()
      offUpdated = null
    }
    updatedStarted = false
  },
}))
