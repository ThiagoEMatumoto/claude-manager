import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import type { AdvisorModel, EffortLevel, PermissionMode } from '../../shared/types/ipc'
import { SPAWNABLE_MODEL_ALIASES, type ModelAlias } from '../../shared/models'

const DEFAULT_MODEL_KEY = 'session.defaultModel'
const DEFAULT_EFFORT_KEY = 'session.defaultEffort'
const DEFAULT_PERMISSION_KEY = 'session.defaultPermission'
const DEFAULT_ADVISOR_KEY = 'session.defaultAdvisor'
const KEYBOARD_MODE_KEY = 'session.keyboardMode'

// Preferência de teclado do composer (consumida pela Fase 2). 'enter-sends' =
// Enter envia / Shift+Enter quebra; 'enter-newline' inverte (Enter quebra /
// Cmd+Enter envia). Default conservador: Enter envia.
export type KeyboardSendMode = 'enter-sends' | 'enter-newline'
export const DEFAULT_KEYBOARD_MODE: KeyboardSendMode = 'enter-sends'

// Deriva do registro canônico (shared/models.ts) — mesma fonte da whitelist do main.
const MODEL_WHITELIST = new Set<string>(SPAWNABLE_MODEL_ALIASES)
const EFFORT_WHITELIST = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const PERMISSION_WHITELIST = new Set<PermissionMode>([
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'dontAsk',
])
const ADVISOR_WHITELIST = new Set(['opus', 'sonnet', 'fable'])

// '' = sem default (spawn usa o default do claude, sem flag).
type ModelDefault = '' | ModelAlias
type EffortDefault = '' | EffortLevel
// '' = advisor desligado por default (sem --advisor no spawn).
type AdvisorDefault = '' | AdvisorModel
// Permissão sempre tem um valor concreto: 'default' é o próprio default da CLI.
const DEFAULT_PERMISSION: PermissionMode = 'default'

interface SessionPrefsState {
  defaultModel: ModelDefault
  defaultEffort: EffortDefault
  defaultPermission: PermissionMode
  defaultAdvisor: AdvisorDefault
  keyboardMode: KeyboardSendMode
  loaded: boolean
  load: () => Promise<void>
  setDefaultModel: (m: ModelDefault) => Promise<void>
  setDefaultEffort: (e: EffortDefault) => Promise<void>
  setDefaultPermission: (p: PermissionMode) => Promise<void>
  setDefaultAdvisor: (a: AdvisorDefault) => Promise<void>
  setKeyboardMode: (k: KeyboardSendMode) => Promise<void>
}

// Defaults de criação de sessão (modelo + effort) e preferência de teclado do
// chat, persistidos em app_prefs. SpawnSessionDialog lê os defaults ao abrir; o
// Composer (Fase 2) lê keyboardMode.
export const useSessionPrefsStore = create<SessionPrefsState>((set, get) => ({
  defaultModel: '',
  defaultEffort: '',
  defaultPermission: DEFAULT_PERMISSION,
  defaultAdvisor: '',
  keyboardMode: DEFAULT_KEYBOARD_MODE,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const [model, effort, permission, advisor, keyboard] = await Promise.all([
      prefsApi.get<string>(DEFAULT_MODEL_KEY),
      prefsApi.get<string>(DEFAULT_EFFORT_KEY),
      prefsApi.get<string>(DEFAULT_PERMISSION_KEY),
      prefsApi.get<string>(DEFAULT_ADVISOR_KEY),
      prefsApi.get<string>(KEYBOARD_MODE_KEY),
    ])
    set({
      defaultModel: model && MODEL_WHITELIST.has(model) ? (model as ModelDefault) : '',
      defaultEffort: effort && EFFORT_WHITELIST.has(effort) ? (effort as EffortLevel) : '',
      defaultPermission:
        permission && PERMISSION_WHITELIST.has(permission as PermissionMode)
          ? (permission as PermissionMode)
          : DEFAULT_PERMISSION,
      defaultAdvisor: advisor && ADVISOR_WHITELIST.has(advisor) ? (advisor as AdvisorDefault) : '',
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

  setDefaultPermission: async (p) => {
    set({ defaultPermission: p })
    await prefsApi.set(DEFAULT_PERMISSION_KEY, p)
  },

  setDefaultAdvisor: async (a) => {
    set({ defaultAdvisor: a })
    await prefsApi.set(DEFAULT_ADVISOR_KEY, a)
  },

  setKeyboardMode: async (k) => {
    set({ keyboardMode: k })
    await prefsApi.set(KEYBOARD_MODE_KEY, k)
  },
}))
