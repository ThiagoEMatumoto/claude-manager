import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import type { EffortLevel } from '../../shared/types/ipc'

const DEFAULT_MODEL_KEY = 'session.defaultModel'
const DEFAULT_EFFORT_KEY = 'session.defaultEffort'
const KEYBOARD_MODE_KEY = 'session.keyboardMode'

// Preferência de teclado do composer (consumida pela Fase 2). 'enter-sends' =
// Enter envia / Shift+Enter quebra; 'enter-newline' inverte (Enter quebra /
// Cmd+Enter envia). Default conservador: Enter envia.
export type KeyboardSendMode = 'enter-sends' | 'enter-newline'
export const DEFAULT_KEYBOARD_MODE: KeyboardSendMode = 'enter-sends'

const MODEL_WHITELIST = new Set(['opus', 'sonnet', 'haiku'])
const EFFORT_WHITELIST = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

// '' = sem default (spawn usa o default do claude, sem flag).
type ModelDefault = '' | 'opus' | 'sonnet' | 'haiku'
type EffortDefault = '' | EffortLevel

interface SessionPrefsState {
  defaultModel: ModelDefault
  defaultEffort: EffortDefault
  keyboardMode: KeyboardSendMode
  loaded: boolean
  load: () => Promise<void>
  setDefaultModel: (m: ModelDefault) => Promise<void>
  setDefaultEffort: (e: EffortDefault) => Promise<void>
  setKeyboardMode: (k: KeyboardSendMode) => Promise<void>
}

// Defaults de criação de sessão (modelo + effort) e preferência de teclado do
// chat, persistidos em app_prefs. SpawnSessionDialog lê os defaults ao abrir; o
// Composer (Fase 2) lê keyboardMode.
export const useSessionPrefsStore = create<SessionPrefsState>((set, get) => ({
  defaultModel: '',
  defaultEffort: '',
  keyboardMode: DEFAULT_KEYBOARD_MODE,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const [model, effort, keyboard] = await Promise.all([
      prefsApi.get<string>(DEFAULT_MODEL_KEY),
      prefsApi.get<string>(DEFAULT_EFFORT_KEY),
      prefsApi.get<string>(KEYBOARD_MODE_KEY),
    ])
    set({
      defaultModel: model && MODEL_WHITELIST.has(model) ? (model as ModelDefault) : '',
      defaultEffort: effort && EFFORT_WHITELIST.has(effort) ? (effort as EffortLevel) : '',
      keyboardMode: keyboard === 'enter-newline' ? 'enter-newline' : DEFAULT_KEYBOARD_MODE,
      loaded: true,
    })
  },

  setDefaultModel: async (m) => {
    set({ defaultModel: m })
    await prefsApi.set(DEFAULT_MODEL_KEY, m)
  },

  setDefaultEffort: async (e) => {
    set({ defaultEffort: e })
    await prefsApi.set(DEFAULT_EFFORT_KEY, e)
  },

  setKeyboardMode: async (k) => {
    set({ keyboardMode: k })
    await prefsApi.set(KEYBOARD_MODE_KEY, k)
  },
}))
