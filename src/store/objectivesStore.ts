import { create } from 'zustand'
import { objectivesApi } from '@/lib/ipc'
import type {
  CreateKeyResultInput,
  CreateObjectiveInput,
  KeyResult,
  Objective,
  ObjectiveDetail,
  ObjectiveListFilter,
  ObjectiveWithProgress,
  UpdateKeyResultInput,
  UpdateObjectiveInput,
} from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe),
// mesmo padrão do featuresStore.
let offUpdated: (() => void) | null = null
let updatedStarted = false

interface ObjectivesState {
  // Índice (progresso já calculado no main). Fonte da sidebar/lista.
  objectives: ObjectiveWithProgress[]
  // Objetivo aberto no painel de detalhe, COM key results (via get).
  selectedId: string | null
  selectedDetail: ObjectiveDetail | null
  filter: ObjectiveListFilter
  loading: boolean
  detailLoading: boolean
  error: string | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  select: (id: string | null) => Promise<void>
  setFilter: (filter: ObjectiveListFilter) => Promise<void>

  createObjective: (input: CreateObjectiveInput) => Promise<Objective>
  updateObjective: (input: UpdateObjectiveInput) => Promise<Objective>
  archiveObjective: (id: string) => Promise<void>
  createKr: (input: CreateKeyResultInput) => Promise<KeyResult>
  updateKr: (input: UpdateKeyResultInput) => Promise<KeyResult>
  deleteKr: (id: string) => Promise<void>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useObjectivesStore = create<ObjectivesState>((set, get) => ({
  objectives: [],
  selectedId: null,
  selectedDetail: null,
  filter: {},
  loading: false,
  detailLoading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const objectives = await objectivesApi.list(get().filter)
      set({ objectives, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    await get().load()
  },

  select: async (id) => {
    if (!id) {
      set({ selectedId: null, selectedDetail: null, detailLoading: false })
      return
    }
    set({ selectedId: id, detailLoading: true })
    try {
      const detail = await objectivesApi.get(id)
      // Ignora resultado obsoleto se o usuário já selecionou outro objetivo.
      if (get().selectedId !== id) return
      set({ selectedDetail: detail, detailLoading: false })
    } catch {
      if (get().selectedId !== id) return
      set({ selectedDetail: null, detailLoading: false })
    }
  },

  setFilter: async (filter) => {
    set({ filter })
    await get().load()
  },

  createObjective: async (input) => {
    const created = await objectivesApi.create(input)
    await get().refresh()
    return created
  },

  updateObjective: async (input) => {
    const updated = await objectivesApi.update(input)
    await get().refresh()
    if (get().selectedId === updated.id) void get().select(updated.id)
    return updated
  },

  archiveObjective: async (id) => {
    await objectivesApi.archive(id)
    // Objetivo arquivado sai da seleção (a lista default não o mostra mais).
    if (get().selectedId === id) {
      set({ selectedId: null, selectedDetail: null })
    }
    await get().refresh()
  },

  createKr: async (input) => {
    const created = await objectivesApi.createKeyResult(input)
    await get().refresh()
    if (get().selectedId === input.objectiveId) void get().select(input.objectiveId)
    return created
  },

  updateKr: async (input) => {
    const updated = await objectivesApi.updateKeyResult(input)
    await get().refresh()
    const selectedId = get().selectedId
    if (selectedId) void get().select(selectedId)
    return updated
  },

  deleteKr: async (id) => {
    await objectivesApi.deleteKeyResult(id)
    await get().refresh()
    const selectedId = get().selectedId
    if (selectedId) void get().select(selectedId)
  },

  startUpdatedWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = objectivesApi.onUpdated(() => {
      // O payload do canal `objective:updated` varia por mutação (Objective
      // completo ou marcadores {id, archived} / {keyResultId, ...}) — tratamos
      // sempre como sinal de recarga: índice + detalhe aberto.
      void get().refresh()
      const selectedId = get().selectedId
      if (selectedId) void get().select(selectedId)
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
