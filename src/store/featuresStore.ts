import { create } from 'zustand'
import { featuresApi } from '@/lib/ipc'
import type { Feature } from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe).
let offUpdated: (() => void) | null = null
let updatedStarted = false

function groupByProject(features: Feature[]): Record<string, Feature[]> {
  const by: Record<string, Feature[]> = {}
  for (const f of features) {
    ;(by[f.projectId] ??= []).push(f)
  }
  return by
}

interface FeaturesState {
  // Índice (sem corpo). A fonte da lista da sidebar/cards.
  features: Feature[]
  byProject: Record<string, Feature[]>
  // Feature aberta no painel de doc, COM corpo (via get).
  selectedId: string | null
  selectedDoc: Feature | null
  loading: boolean
  docLoading: boolean
  error: string | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string | null) => Promise<void>
  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useFeaturesStore = create<FeaturesState>((set, get) => ({
  features: [],
  byProject: {},
  selectedId: null,
  selectedDoc: null,
  loading: false,
  docLoading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const features = await featuresApi.list()
      set({ features, byProject: groupByProject(features), loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    await get().load()
  },

  select: async (id) => {
    if (!id) {
      set({ selectedId: null, selectedDoc: null, docLoading: false })
      return
    }
    set({ selectedId: id, docLoading: true })
    try {
      const doc = await featuresApi.get(id)
      // Ignora resultado obsoleto se o usuário já selecionou outra feature.
      if (get().selectedId !== id) return
      set({ selectedDoc: doc, docLoading: false })
    } catch {
      if (get().selectedId !== id) return
      set({ selectedDoc: null, docLoading: false })
    }
  },

  startUpdatedWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = featuresApi.onUpdated((feature) => {
      // Atualiza/insere o item no índice (preservando ordem por updatedAt desc).
      set((s) => {
        const exists = s.features.some((f) => f.id === feature.id)
        const next = exists
          ? s.features.map((f) => (f.id === feature.id ? { ...feature, body: undefined } : f))
          : [...s.features, { ...feature, body: undefined }]
        return { features: next, byProject: groupByProject(next) }
      })
      // Recarrega o doc aberto se foi ele que mudou (pra refletir corpo/history).
      if (get().selectedId === feature.id) {
        void get().select(feature.id)
      }
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
