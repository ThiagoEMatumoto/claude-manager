import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'

const PREFS_KEY = 'terminal.fontSize'
export const DEFAULT_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 28

const clamp = (n: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)))

interface TerminalPrefsState {
  fontSize: number
  loaded: boolean
  load: () => Promise<void>
  setFontSize: (n: number) => Promise<void>
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  resetZoom: () => Promise<void>
}

// Tamanho da fonte do terminal, compartilhado entre todos os panes e persistido em
// app_prefs. Os Terminal assinam `fontSize` e atualizam o xterm ao vivo.
export const useTerminalPrefsStore = create<TerminalPrefsState>((set, get) => ({
  fontSize: DEFAULT_FONT_SIZE,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const stored = await prefsApi.get<number>(PREFS_KEY)
    set({ fontSize: typeof stored === 'number' ? clamp(stored) : DEFAULT_FONT_SIZE, loaded: true })
  },

  setFontSize: async (n) => {
    const fontSize = clamp(n)
    set({ fontSize })
    await prefsApi.set(PREFS_KEY, fontSize)
  },

  zoomIn: () => get().setFontSize(get().fontSize + 1),
  zoomOut: () => get().setFontSize(get().fontSize - 1),
  resetZoom: () => get().setFontSize(DEFAULT_FONT_SIZE),
}))
