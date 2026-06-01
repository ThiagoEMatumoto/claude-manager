export type ThemeTokenKey =
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'border'
  | 'text'
  | 'text-dim'
  | 'accent'
  | 'accent-dim'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export type ThemeTokens = Record<ThemeTokenKey, string>

export interface ThemePreset {
  id: string
  label: string
  tokens: ThemeTokens
}

export const DEFAULT_PRESET_ID = 'ember'

const ember: ThemeTokens = {
  bg: '#0b0b0f',
  surface: '#14141b',
  'surface-2': '#1c1c25',
  border: '#2a2a35',
  text: '#e8e8ef',
  'text-dim': '#9c9cae',
  accent: '#ff7a45',
  'accent-dim': '#c95f33',
  success: '#5a9e6f',
  warning: '#c79a4a',
  danger: '#c0584f',
  info: '#5a85b0',
}

const slate: ThemeTokens = {
  bg: '#0c0e12',
  surface: '#151820',
  'surface-2': '#1d2129',
  border: '#2c313c',
  text: '#e6e9f0',
  'text-dim': '#969cab',
  accent: '#7c93c0',
  'accent-dim': '#5d709a',
  success: '#5a9e6f',
  warning: '#c79a4a',
  danger: '#c0584f',
  info: '#5a85b0',
}

const ocean: ThemeTokens = {
  bg: '#0a0e14',
  surface: '#111722',
  'surface-2': '#18202e',
  border: '#283342',
  text: '#e4ecf2',
  'text-dim': '#8fa0b2',
  accent: '#3ea6c9',
  'accent-dim': '#2d7e9b',
  success: '#5a9e6f',
  warning: '#c79a4a',
  danger: '#c0584f',
  info: '#5a85b0',
}

const forest: ThemeTokens = {
  bg: '#0a0f0c',
  surface: '#121a14',
  'surface-2': '#19241c',
  border: '#293a2d',
  text: '#e6efe8',
  'text-dim': '#93a698',
  accent: '#56b07a',
  'accent-dim': '#3f8a5d',
  success: '#5a9e6f',
  warning: '#c79a4a',
  danger: '#c0584f',
  info: '#5a85b0',
}

export const PRESETS: ThemePreset[] = [
  { id: 'ember', label: 'Ember', tokens: ember },
  { id: 'slate', label: 'Slate', tokens: slate },
  { id: 'ocean', label: 'Ocean', tokens: ocean },
  { id: 'forest', label: 'Forest', tokens: forest },
]

export function getPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

export interface ThemePref {
  presetId: string
  accent?: string
}

// Darkens a hex color by mixing toward black, used to derive accent-dim
// from a custom accent so hover/secondary states stay coherent.
export function darken(hex: string, amount = 0.22): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const f = (c: number) => Math.round(c * (1 - amount))
  const out = (f(r) << 16) | (f(g) << 8) | f(b)
  return `#${out.toString(16).padStart(6, '0')}`
}

export function resolveTokens(pref: ThemePref | null | undefined): ThemeTokens {
  const preset = getPreset(pref?.presetId ?? DEFAULT_PRESET_ID)
  if (!pref?.accent) return preset.tokens
  return {
    ...preset.tokens,
    accent: pref.accent,
    'accent-dim': darken(pref.accent),
  }
}
