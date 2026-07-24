import { prefsApi } from '@/lib/ipc'
import { resolveTokens, type ThemePref, type ThemeTokens } from '@/lib/themes'

const THEME_PREF_KEY = 'theme'

// Sinal de mudança de tema: consumidores que não leem CSS vars (ex: o tema do
// xterm) assinam aqui e recebem os tokens a cada applyTheme. Module-level
// porque o tema é global e aplicado fora do React (boot + settings).
type ThemeListener = (tokens: ThemeTokens) => void
const listeners = new Set<ThemeListener>()
let currentTokens: ThemeTokens = resolveTokens(null)

export function getCurrentThemeTokens(): ThemeTokens {
  return currentTokens
}

export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function applyTheme(tokens: ThemeTokens) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--color-${key}`, value)
  }
  // Gradiente da marca Pitwall (accent → accent2). Derivado das vars já setadas
  // acima para que troque junto com o tema sem recalcular aqui.
  root.style.setProperty(
    '--gradient-brand',
    'linear-gradient(135deg, var(--color-accent), var(--color-accent2))',
  )
  currentTokens = tokens
  for (const fn of listeners) fn(tokens)
}

export function applyThemePref(pref: ThemePref | null | undefined) {
  applyTheme(resolveTokens(pref))
}

export async function loadThemePref(): Promise<ThemePref | null> {
  return prefsApi.get<ThemePref>(THEME_PREF_KEY)
}

export async function saveThemePref(pref: ThemePref) {
  await prefsApi.set(THEME_PREF_KEY, pref)
}

export async function loadAndApplyTheme() {
  const pref = await loadThemePref()
  applyThemePref(pref)
}
