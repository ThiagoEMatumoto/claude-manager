import { create } from 'zustand'
import { meetingsApi } from '@/lib/ipc'
import type {
  CreateMeetingInput,
  Meeting,
  MeetingListFilter,
  UpdateMeetingInput,
} from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe),
// mesmo padrão do tasksStore.
let offUpdated: (() => void) | null = null
let updatedStarted = false

interface MeetingsState {
  meetings: Meeting[]
  filter: MeetingListFilter
  loading: boolean
  error: string | null

  load: () => Promise<void>
  refresh: () => Promise<void>
  setFilter: (filter: MeetingListFilter) => Promise<void>

  createMeeting: (input: CreateMeetingInput) => Promise<Meeting>
  updateMeeting: (input: UpdateMeetingInput) => Promise<Meeting>
  deleteMeeting: (id: string) => Promise<void>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useMeetingsStore = create<MeetingsState>((set, get) => ({
  meetings: [],
  filter: {},
  loading: false,
  error: null,

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

  startUpdatedWatch: () => {
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = meetingsApi.onUpdated(() => {
      // Payload varia (Meeting completa ou {id, deleted}) — tratamos como recarga.
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
