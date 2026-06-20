import { create } from 'zustand'
import { meetingsApi } from '@/lib/ipc'
import type {
  CreateMeetingInput,
  MaterializeMeetingTaskInput,
  Meeting,
  MeetingExtractResult,
  MeetingExtraction,
  MeetingListFilter,
  Task,
  UpdateMeetingInput,
} from '../../shared/types/ipc'

// Dono único das assinaturas de onUpdated/onStatus — assinadas uma vez
// (StrictMode-safe), mesmo padrão do tasksStore.
let offUpdated: (() => void) | null = null
let offStatus: (() => void) | null = null
let updatedStarted = false

interface MeetingsState {
  meetings: Meeting[]
  filter: MeetingListFilter
  loading: boolean
  error: string | null
  // Resultado da última extração por reunião (efêmero — alimenta a
  // ExtractionReview). null = ainda não extraída nesta sessão.
  extraction: MeetingExtractResult | null
  extractingId: string | null
  extractError: string | null

  // Sidecar REAL de transcrição configurado? null = ainda não checado. false =
  // app cai no fake (dev) e a UI mostra o aviso de 1ª classe.
  sidecarConfigured: boolean | null
  checkSidecarConfigured: () => Promise<void>

  load: () => Promise<void>
  refresh: () => Promise<void>
  setFilter: (filter: MeetingListFilter) => Promise<void>

  createMeeting: (input: CreateMeetingInput) => Promise<Meeting>
  updateMeeting: (input: UpdateMeetingInput) => Promise<Meeting>
  deleteMeeting: (id: string) => Promise<void>

  startCapture: (meetingId: string) => Promise<void>
  stopCapture: (meetingId: string) => Promise<void>

  extract: (meetingId: string) => Promise<MeetingExtractResult | null>
  clearExtraction: () => void
  materializeTask: (input: MaterializeMeetingTaskInput) => Promise<Task>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useMeetingsStore = create<MeetingsState>((set, get) => ({
  meetings: [],
  filter: {},
  loading: false,
  error: null,
  extraction: null,
  extractingId: null,
  extractError: null,
  sidecarConfigured: null,

  checkSidecarConfigured: async () => {
    try {
      const configured = await meetingsApi.sidecarConfigured()
      set({ sidecarConfigured: configured })
    } catch {
      set({ sidecarConfigured: false })
    }
  },

  load: async () => {
    set({ loading: true, error: null })
    try {
      const meetings = await meetingsApi.list(get().filter)
      set({ meetings, loading: false })
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

  createMeeting: async (input) => {
    const created = await meetingsApi.create(input)
    await get().refresh()
    return created
  },

  updateMeeting: async (input) => {
    const updated = await meetingsApi.update(input)
    await get().refresh()
    return updated
  },

  deleteMeeting: async (id) => {
    await meetingsApi.delete(id)
    await get().refresh()
  },

  startCapture: async (meetingId) => {
    await meetingsApi.startCapture(meetingId)
  },

  stopCapture: async (meetingId) => {
    await meetingsApi.stopCapture(meetingId)
  },

  extract: async (meetingId) => {
    set({ extractingId: meetingId, extractError: null })
    try {
      const result = await meetingsApi.extract(meetingId)
      set({ extraction: result, extractingId: null })
      await get().refresh()
      return result
    } catch (err) {
      set({
        extractingId: null,
        extractError: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },

  clearExtraction: () => set({ extraction: null, extractError: null }),

  materializeTask: async (input) => {
    const task = await meetingsApi.materializeTask(input)
    // Atualiza o item local pra refletir que virou task (some do "pendente").
    if (input.extractionId) {
      set((state) => ({
        extraction: state.extraction
          ? {
              ...state.extraction,
              extractions: state.extraction.extractions.map((e): MeetingExtraction =>
                e.id === input.extractionId ? { ...e, materializedTaskId: task.id } : e,
              ),
            }
          : null,
      }))
    }
    return task
  },

  startUpdatedWatch: () => {
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = meetingsApi.onUpdated(() => {
      // Payload varia (Meeting completa ou {id, deleted}) — tratamos como recarga.
      void get().refresh()
    })
    // O sidecar emite status ao vivo (capturing→ready/failed); refletir na lista
    // sem esperar um meeting:updated. Patch local evita um round-trip ao DB.
    offStatus = meetingsApi.onStatus(({ id, status }) => {
      set((state) => ({
        meetings: state.meetings.map((m) => (m.id === id ? { ...m, status } : m)),
      }))
    })
  },

  stopUpdatedWatch: () => {
    if (offUpdated) {
      offUpdated()
      offUpdated = null
    }
    if (offStatus) {
      offStatus()
      offStatus = null
    }
    updatedStarted = false
  },
}))
