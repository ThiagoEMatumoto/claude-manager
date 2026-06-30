import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import type { EffortLevel, PermissionMode } from '../../shared/types/ipc'

const DEFAULT_MODEL_KEY = 'session.defaultModel'
const DEFAULT_EFFORT_KEY = 'session.defaultEffort'
const DEFAULT_PERMISSION_KEY = 'session.defaultPermission'
const KEYBOARD_MODE_KEY = 'session.keyboardMode'
const COMPOSER_COLLAPSED_KEY = 'session.composerCollapsed'

// Preferência de teclado do composer (consumida pela Fase 2). 'enter-sends' =
// Enter envia / Shift+Enter quebra; 'enter-newline' inverte (Enter quebra /
// Cmd+Enter envia). Default conservador: Enter envia.
export type KeyboardSendMode = 'enter-sends' | 'enter-newline'
export const DEFAULT_KEYBOARD_MODE: KeyboardSendMode = 'enter-sends'

const MODEL_WHITELIST = new Set(['opus', 'sonnet', 'haiku'])
const EFFORT_WHITELIST = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const PERMISSION_WHITELIST = new Set<PermissionMode>([
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'dontAsk',
])

// '' = sem default (spawn usa o default do claude, sem flag).
type ModelDefault = '' | 'opus' | 'sonnet' | 'haiku'
type EffortDefault = '' | EffortLevel
// Permissão sempre tem um valor concreto: 'default' é o próprio default da CLI.
const DEFAULT_PERMISSION: PermissionMode = 'default'

interface SessionPrefsState {
  defaultModel: ModelDefault
  defaultEffort: EffortDefault
  defaultPermission: PermissionMode
  keyboardMode: KeyboardSendMode
  // Dock do composer recolhido (só usado no modo terminal). Preferência global,
  // persistida em app_prefs como 'true'/'false'.
  composerCollapsed: boolean
  loaded: boolean
  load: () => Promise<void>
  setDefaultModel: (m: ModelDefault) => Promise<void>
  setDefaultEffort: (e: EffortDefault) => Promise<void>
  setDefaultPermission: (p: PermissionMode) => Promise<void>
  setKeyboardMode: (k: KeyboardSendMode) => Promise<void>
  setComposerCollapsed: (v: boolean) => Promise<void>
}

// Defaults de criação de sessão (modelo + effort) e preferência de teclado do
// chat, persistidos em app_prefs. SpawnSessionDialog lê os defaults ao abrir; o
// Composer (Fase 2) lê keyboardMode.
export const useSessionPrefsStore = create<SessionPrefsState>((set, get) => ({
  defaultModel: '',
  defaultEffort: '',
  defaultPermission: DEFAULT_PERMISSION,
  keyboardMode: DEFAULT_KEYBOARD_MODE,
  composerCollapsed: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const [model, effort, permission, keyboard, collapsed] = await Promise.all([
      prefsApi.get<string>(DEFAULT_MODEL_KEY),
      prefsApi.get<string>(DEFAULT_EFFORT_KEY),
      prefsApi.get<string>(DEFAULT_PERMISSION_KEY),
      prefsApi.get<string>(KEYBOARD_MODE_KEY),
      prefsApi.get<string>(COMPOSER_COLLAPSED_KEY),
    ])
    set({
      defaultModel: model && MODEL_WHITELIST.has(model) ? (model as ModelDefault) : '',
      defaultEffort: effort && EFFORT_WHITELIST.has(effort) ? (effort as EffortLevel) : '',
      defaultPermission:
        permission && PERMISSION_WHITELIST.has(permission as PermissionMode)
          ? (permission as PermissionMode)
          : DEFAULT_PERMISSION,
      keyboardMode: keyboard === 'enter-newline' ? 'enter-newline' : DEFAULT_KEYBOARD_MODE,
      composerCollapsed: collapsed === 'true',
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

  setDefaultPermission: async (p) => {
    set({ defaultPermission: p })
    await prefsApi.set(DEFAULT_PERMISSION_KEY, p)
  },

  setKeyboardMode: async (k) => {
    set({ keyboardMode: k })
    await prefsApi.set(KEYBOARD_MODE_KEY, k)
  },

  setComposerCollapsed: async (v) => {
    set({ composerCollapsed: v })
    await prefsApi.set(COMPOSER_COLLAPSED_KEY, v ? 'true' : 'false')
  },
}))
