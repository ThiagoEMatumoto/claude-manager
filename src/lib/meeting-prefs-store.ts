import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'

// Preferências da extração de reunião, persistidas em app_prefs. Espelha o
// padrão de terminal-prefs-store. As keys são as MESMAS lidas pelo handler
// `meetings:extract` no main (meeting-extraction): não mexer nos nomes.
const PRIVATE_MODE_KEY = 'meeting_private_mode'

interface MeetingPrefsState {
  // Modo privado (local): força o provedor Ollama, zero saída de processo claude.
  privateMode: boolean
  loaded: boolean
  load: () => Promise<void>
  setPrivateMode: (v: boolean) => Promise<void>
}

export const useMeetingPrefsStore = create<MeetingPrefsState>((set, get) => ({
  privateMode: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const stored = await prefsApi.get<boolean>(PRIVATE_MODE_KEY)
    set({ privateMode: stored === true, loaded: true })
  },

  setPrivateMode: async (v) => {
    set({ privateMode: v })
    await prefsApi.set(PRIVATE_MODE_KEY, v)
  },
}))
