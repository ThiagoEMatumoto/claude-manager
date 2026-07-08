import { create } from 'zustand'
import { scheduledJobsApi } from '@/lib/ipc'
import type {
  CreateScheduledJobInput,
  JobRun,
  ScheduledJob,
  UpdateScheduledJobInput,
} from '../../shared/types/ipc'

// Donos únicos das assinaturas (StrictMode-safe): jobs e runs são canais IPC
// distintos, cada um com seu unsubscribe. `watchStarted` guarda contra o duplo-
// mount do effect no StrictMode (a 2ª chamada de startWatch é no-op).
let offUpdated: (() => void) | null = null
let offRunUpdated: (() => void) | null = null
let watchStarted = false

interface JobsState {
  jobs: ScheduledJob[]
  selectedJobId: string | null
  // Histórico de runs do job selecionado (recarregado a cada seleção/broadcast).
  runs: JobRun[]
  loading: boolean
  runsLoading: boolean
  error: string | null

  load: () => Promise<void>
  loadRuns: (jobId: string) => Promise<void>
  selectJob: (id: string | null) => Promise<void>
  create: (input: CreateScheduledJobInput) => Promise<ScheduledJob>
  update: (input: UpdateScheduledJobInput) => Promise<ScheduledJob>
  delete: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>
  startWatch: () => void
  stopWatch: () => void
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  selectedJobId: null,
  runs: [],
  loading: false,
  runsLoading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const jobs = await scheduledJobsApi.list()
      set({ jobs, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadRuns: async (jobId) => {
    set({ runsLoading: true })
    try {
      const runs = await scheduledJobsApi.listRuns({ jobId })
      // Ignora resultado obsoleto se o usuário já trocou de job selecionado.
      if (get().selectedJobId !== jobId) return
      set({ runs, runsLoading: false })
    } catch {
      if (get().selectedJobId !== jobId) return
      set({ runs: [], runsLoading: false })
    }
  },

  selectJob: async (id) => {
    if (!id) {
      set({ selectedJobId: null, runs: [] })
      return
    }
    set({ selectedJobId: id, runs: [] })
    await get().loadRuns(id)
  },

  create: async (input) => {
    const job = await scheduledJobsApi.create(input)
    await get().load()
    return job
  },

  update: async (input) => {
    const job = await scheduledJobsApi.update(input)
    await get().load()
    return job
  },

  delete: async (id) => {
    await scheduledJobsApi.delete(id)
    if (get().selectedJobId === id) set({ selectedJobId: null, runs: [] })
    await get().load()
  },

  runNow: async (id) => {
    await scheduledJobsApi.runNow(id)
    // O broadcast jobRun:updated já dispara o reload; adianta o do job aberto.
    if (get().selectedJobId === id) await get().loadRuns(id)
  },

  toggleEnabled: async (id, enabled) => {
    await get().update({ id, enabled })
  },

  startWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real por canal.
    if (watchStarted) return
    watchStarted = true
    offUpdated = scheduledJobsApi.onUpdated(() => {
      void get().load()
    })
    offRunUpdated = scheduledJobsApi.onRunUpdated(() => {
      // Um run mudou: recarrega a lista (lastRunAt/nextRunAt podem ter mudado) e,
      // se houver job aberto, o histórico dele.
      void get().load()
      const id = get().selectedJobId
      if (id) void get().loadRuns(id)
    })
  },

  stopWatch: () => {
    if (offUpdated) {
      offUpdated()
      offUpdated = null
    }
    if (offRunUpdated) {
      offRunUpdated()
      offRunUpdated = null
    }
    watchStarted = false
  },
}))
