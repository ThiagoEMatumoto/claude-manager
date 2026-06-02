import { create } from 'zustand'
import { metricsApi } from '@/lib/ipc'
import type {
  MetricsScanProgress,
  MetricsSnapshot,
  MetricsWindow,
} from '../../shared/types/ipc'

// Dono único da assinatura de progresso — assinada uma vez (StrictMode-safe).
let offProgress: (() => void) | null = null
let progressStarted = false

interface MetricsState {
  snapshot: MetricsSnapshot | null
  window: MetricsWindow
  loading: boolean
  progress: MetricsScanProgress | null
  error: string | null

  load: (window: MetricsWindow) => Promise<void>
  refresh: () => Promise<void>
  startProgressWatch: () => void
  stopProgressWatch: () => void
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  snapshot: null,
  window: '7d',
  loading: false,
  progress: null,
  error: null,

  load: async (window) => {
    set({ window, loading: true, error: null })
    try {
      const snapshot = await metricsApi.get(window)
      set({ snapshot, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    set({ loading: true, error: null, progress: null })
    try {
      // refresh() força rescan no main e devolve o snapshot da janela corrente.
      await metricsApi.refresh()
      const snapshot = await metricsApi.get(get().window)
      set({ snapshot, loading: false, progress: null })
    } catch (err) {
      set({
        loading: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  startProgressWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (progressStarted) return
    progressStarted = true
    offProgress = metricsApi.onProgress((p) => {
      set({ progress: p.done ? null : p })
    })
  },

  stopProgressWatch: () => {
    if (offProgress) {
      offProgress()
      offProgress = null
    }
    progressStarted = false
    set({ progress: null })
  },
}))
