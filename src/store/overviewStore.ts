import { create } from 'zustand'
import { featuresApi, objectivesApi, tasksApi } from '@/lib/ipc'
import type { OverviewData } from '../../shared/types/ipc'

// Dono único das assinaturas dos 3 canais de broadcast — assinadas uma vez
// (StrictMode-safe), mesmo padrão do objectivesStore. Mutações emitem rajadas
// (ex.: tarefa com parent emite task:updated + objective:updated), então os
// sinais são coalescidos por debounce antes do refresh.
let offs: Array<() => void> = []
let watchStarted = false
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const REFRESH_DEBOUNCE_MS = 150

interface OverviewState {
  data: OverviewData | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  startWatch: () => void
  stopWatch: () => void
}

export const useOverviewStore = create<OverviewState>((set, get) => ({
  data: null,
  loading: false,
  error: null,

  // Carga inicial (mostra loading; usada pela montagem da view).
  load: async () => {
    set({ loading: true, error: null })
    try {
      const data = await objectivesApi.overview()
      set({ data, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  // Recarga silenciosa (sem flag de loading) — usada pelos broadcasts pra não
  // piscar a UI a cada mutação.
  refresh: async () => {
    try {
      const data = await objectivesApi.overview()
      set({ data, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  startWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (watchStarted) return
    watchStarted = true
    const schedule = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void get().refresh()
      }, REFRESH_DEBOUNCE_MS)
    }
    // Qualquer mutação de objetivo/KR, tarefa ou feature pode mover progresso,
    // pendências ou contadores → recarrega o agregado inteiro (payloads dos
    // canais variam; tratamos todos como sinal de recarga).
    offs = [
      objectivesApi.onUpdated(schedule),
      tasksApi.onUpdated(schedule),
      featuresApi.onUpdated(schedule),
    ]
  },

  stopWatch: () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
    for (const off of offs) off()
    offs = []
    watchStarted = false
  },
}))
