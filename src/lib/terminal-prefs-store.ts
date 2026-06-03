import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'

const PREFS_KEY = 'terminal.fontSize'
export const DEFAULT_FONT_SIZE = 13
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 28

const SCROLLBACK_KEY = 'terminal.scrollback'
export const DEFAULT_SCROLLBACK = 5000
const MIN_SCROLLBACK = 200
const MAX_SCROLLBACK = 50000

const VISUAL_LINE_NAV_KEY = 'terminal.visualLineNav'

const clamp = (n: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)))
const clampScrollback = (n: number) =>
  Math.min(MAX_SCROLLBACK, Math.max(MIN_SCROLLBACK, Math.round(n)))

interface TerminalPrefsState {
  fontSize: number
  scrollback: number
  // Modo opt-in: ↑/↓ navegam por linha VISUAL dentro do input do claude (em vez do
  // histórico). Heurístico — default desligado. Ver Terminal.tsx (key handler).
  visualLineNav: boolean
  loaded: boolean
  load: () => Promise<void>
  setFontSize: (n: number) => Promise<void>
  setScrollback: (n: number) => Promise<void>
  setVisualLineNav: (v: boolean) => Promise<void>
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  resetZoom: () => Promise<void>
}

// Tamanho da fonte do terminal, compartilhado entre todos os panes e persistido em
// app_prefs. Os Terminal assinam `fontSize` e atualizam o xterm ao vivo.
export const useTerminalPrefsStore = create<TerminalPrefsState>((set, get) => ({
  fontSize: DEFAULT_FONT_SIZE,
  scrollback: DEFAULT_SCROLLBACK,
  visualLineNav: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const [storedFont, storedScrollback, storedVisualNav] = await Promise.all([
      prefsApi.get<number>(PREFS_KEY),
      prefsApi.get<number>(SCROLLBACK_KEY),
      prefsApi.get<boolean>(VISUAL_LINE_NAV_KEY),
    ])
    set({
      fontSize: typeof storedFont === 'number' ? clamp(storedFont) : DEFAULT_FONT_SIZE,
      scrollback:
        typeof storedScrollback === 'number' ? clampScrollback(storedScrollback) : DEFAULT_SCROLLBACK,
      visualLineNav: storedVisualNav === true,
      loaded: true,
    })
  },

  setFontSize: async (n) => {
    const fontSize = clamp(n)
    set({ fontSize })
    await prefsApi.set(PREFS_KEY, fontSize)
  },

  setScrollback: async (n) => {
    const scrollback = clampScrollback(n)
    set({ scrollback })
    await prefsApi.set(SCROLLBACK_KEY, scrollback)
  },

  setVisualLineNav: async (v) => {
    set({ visualLineNav: v })
    await prefsApi.set(VISUAL_LINE_NAV_KEY, v)
  },

  zoomIn: () => get().setFontSize(get().fontSize + 1),
  zoomOut: () => get().setFontSize(get().fontSize - 1),
  resetZoom: () => get().setFontSize(DEFAULT_FONT_SIZE),
}))
