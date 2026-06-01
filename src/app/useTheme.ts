import { prefsApi } from '@/lib/ipc'
import { resolveTokens, type ThemePref, type ThemeTokens } from '@/lib/themes'

const THEME_PREF_KEY = 'theme'

export function applyTheme(tokens: ThemeTokens) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--color-${key}`, value)
  }
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
