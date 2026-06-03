import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import type { Combo } from '@/lib/keybindings'

const PREFS_KEY = 'keybindings'

interface KeybindingsState {
  overrides: Record<string, Combo>
  loaded: boolean
  load: () => Promise<void>
  setOverride: (id: string, combo: Combo) => Promise<void>
  reset: (id: string) => Promise<void>
}

export const useKeybindingsStore = create<KeybindingsState>((set, get) => ({
  overrides: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const stored = await prefsApi.get<Record<string, Combo>>(PREFS_KEY)
    set({ overrides: stored ?? {}, loaded: true })
  },

  setOverride: async (id, combo) => {
    const next = { ...get().overrides, [id]: combo }
    set({ overrides: next })
    await prefsApi.set(PREFS_KEY, next)
  },

  reset: async (id) => {
    const next = { ...get().overrides }
    delete next[id]
    set({ overrides: next })
    await prefsApi.set(PREFS_KEY, next)
  },
}))
