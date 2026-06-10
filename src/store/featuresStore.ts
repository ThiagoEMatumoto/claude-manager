import { create } from 'zustand'
import { featuresApi } from '@/lib/ipc'
import type { Feature, FeatureWithStats } from '../../shared/types/ipc'

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
  // Features com contagem de sessões (inclui arquivadas) — fonte do board.
  withStats: FeatureWithStats[]
  sessionCounts: Map<string, number>
  // Feature aberta no painel de doc, COM corpo (via get).
  selectedId: string | null
  selectedDoc: Feature | null
  loading: boolean
  docLoading: boolean
  error: string | null

  load: () => Promise<void>
  loadStats: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string | null) => Promise<void>
  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useFeaturesStore = create<FeaturesState>((set, get) => ({
  features: [],
  byProject: {},
  withStats: [],
  sessionCounts: new Map(),
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
      // Stats (com arquivadas) em paralelo — alimenta board e contagem de sessões.
      void get().loadStats()
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadStats: async () => {
    try {
      // includeDrafts: o filtro "Rascunhos" da sidebar deriva os drafts daqui
      // (origin='auto' + recordCount=0); board e lista os excluem no render.
      const withStats = await featuresApi.listWithStats({
        includeArchived: true,
        includeDrafts: true,
      })
      const sessionCounts = new Map(withStats.map((f) => [f.id, f.sessionCount]))
      set({ withStats, sessionCounts })
    } catch {
      // Stats são best-effort: a lista da sidebar continua funcionando sem eles.
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
    offUpdated = featuresApi.onUpdated((payload) => {
      // O canal `feature:updated` também carrega payloads de SINAL que não são uma
      // Feature completa (backfill `{backfill:true}`, archive `{id,archived}`,
      // watcher de arquivo inválido `{docPath}`). Tratá-los como Feature inseria
      // lixo na lista e quebrava o render (tela preta). Sem `id`+`projectId`
      // válidos => é sinal de reload, não um item: recarrega e sai.
      const feature = payload as Partial<Feature> | null | undefined
      if (!feature || typeof feature.id !== 'string' || typeof feature.projectId !== 'string') {
        void get().refresh()
        return
      }
      const valid = feature as Feature
      try {
        // Atualiza/insere o item no índice (preservando ordem por updatedAt desc).
        set((s) => {
          const exists = s.features.some((f) => f.id === valid.id)
          const next = exists
            ? s.features.map((f) => (f.id === valid.id ? { ...valid, body: undefined } : f))
            : [...s.features, { ...valid, body: undefined }]
          return { features: next, byProject: groupByProject(next) }
        })
        // Recarrega o doc aberto se foi ele que mudou (pra refletir corpo/history).
        if (get().selectedId === valid.id) {
          void get().select(valid.id)
        }
        // Recalcula stats (contagem de sessões / coluna archived do board).
        void get().loadStats()
      } catch (err) {
        // Defesa: um payload ruim nunca deve derrubar o app. Cai pro reload.
        console.error('[featuresStore] onUpdated falhou, recarregando:', err)
        void get().refresh()
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
