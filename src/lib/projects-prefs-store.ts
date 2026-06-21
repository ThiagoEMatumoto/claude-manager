import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'

const SHOW_HANDOFFS_INLINE_KEY = 'projects.showHandoffsInline'

interface ProjectsPrefsState {
  // Opt-in: mostra a seção "Delegações (N)" dentro de cada projeto na sidebar.
  // Default desligado — handoffs vivem na área dedicada; isto só os traz à vista
  // da tela de projetos. Persistido em app_prefs.
  showHandoffsInline: boolean
  loaded: boolean
  load: () => Promise<void>
  setShowHandoffsInline: (v: boolean) => Promise<void>
}

export const useProjectsPrefsStore = create<ProjectsPrefsState>((set, get) => ({
  showHandoffsInline: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const stored = await prefsApi.get<boolean>(SHOW_HANDOFFS_INLINE_KEY)
    set({ showHandoffsInline: stored === true, loaded: true })
  },

  setShowHandoffsInline: async (v) => {
    set({ showHandoffsInline: v })
    await prefsApi.set(SHOW_HANDOFFS_INLINE_KEY, v)
  },
}))
