export type ThemeTokenKey =
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'border'
  | 'text'
  | 'text-dim'
  | 'accent'
  | 'accent-dim'
  | 'accent2'
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

// Vácuo é o default da marca Pitwall. As chaves internas (ember/slate/ocean/
// forest) são preservadas como IDs persistidos em prefs (ThemePref.presetId) —
// só valores e labels mudam, então preferências salvas não quebram:
// slate→Vácuo (default), forest→Sinal, ocean→Gelo, ember→Papaia (ex-laranja).
export const DEFAULT_PRESET_ID = 'slate'

// Texto e semânticas são idênticos nos 4 temas (marca fixa; só a família de
// accent muda por tema, estilo VS Code).
const TEXT = { text: '#F1F0F6', 'text-dim': '#A5A1BD' } as const
const SEMANTIC = {
  success: '#6FD695',
  warning: '#FFB057',
  danger: '#FF8D75',
  info: '#7FA7E8',
} as const

const vacuo: ThemeTokens = {
  bg: '#08080B',
  surface: '#0F0E15',
  'surface-2': '#16141F',
  border: '#282534',
  ...TEXT,
  accent: '#9D8CFF',
  'accent-dim': darken('#9D8CFF'),
  accent2: '#7FD6F2',
  ...SEMANTIC,
}

const sinal: ThemeTokens = {
  bg: '#0B0D0C',
  surface: '#121614',
  'surface-2': '#182019',
  border: '#232B26',
  ...TEXT,
  accent: '#35D07F',
  'accent-dim': darken('#35D07F'),
  accent2: '#7FE0A8',
  ...SEMANTIC,
}

const gelo: ThemeTokens = {
  bg: '#090D12',
  surface: '#101722',
  'surface-2': '#16202E',
  border: '#22303F',
  ...TEXT,
  accent: '#5FC9EA',
  'accent-dim': darken('#5FC9EA'),
  accent2: '#8FECD2',
  ...SEMANTIC,
}

const papaia: ThemeTokens = {
  bg: '#100D0A',
  surface: '#181310',
  'surface-2': '#201A14',
  border: '#33291F',
  ...TEXT,
  accent: '#FF8A50',
  'accent-dim': darken('#FF8A50'),
  accent2: '#FFC46B',
  ...SEMANTIC,
}

export const PRESETS: ThemePreset[] = [
  { id: 'slate', label: 'Vácuo', tokens: vacuo },
  { id: 'forest', label: 'Sinal', tokens: sinal },
  { id: 'ocean', label: 'Gelo', tokens: gelo },
  { id: 'ember', label: 'Papaia', tokens: papaia },
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

// Tema do xterm derivado dos tokens do app: mapeia bg/text/accent/border/
// surface/text-dim do tema ativo para os campos que o xterm entende, de modo
// que o terminal herda o accent da marca (roxo no Vácuo) sem cor hardcoded.
export function xtermTheme(tokens: ThemeTokens): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  brightBlack: string
} {
  return {
    background: tokens.bg,
    foreground: tokens.text,
    cursor: tokens.accent,
    cursorAccent: tokens.bg,
    selectionBackground: tokens.border,
    black: tokens.surface,
    brightBlack: tokens['text-dim'],
  }
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
