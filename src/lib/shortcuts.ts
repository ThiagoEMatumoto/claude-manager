export type ShortcutContext = 'Global' | 'Workspace' | 'Terminal'

export interface Shortcut {
  combo: string
  label: string
  context: ShortcutContext
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

export const SHORTCUTS: Shortcut[] = [
  { combo: `${mod}+K`, label: 'Abrir paleta de comandos', context: 'Global' },

  { combo: `${mod}+T`, label: 'Nova sessão', context: 'Workspace' },
  { combo: `${mod}+W`, label: 'Fechar painel', context: 'Workspace' },
  { combo: `${mod}+\\`, label: 'Dividir painel na vertical', context: 'Workspace' },
  { combo: `${mod}+Shift+\\`, label: 'Dividir painel na horizontal', context: 'Workspace' },

  { combo: isMac ? '⌘+C' : 'Ctrl+Shift+C', label: 'Copiar', context: 'Terminal' },
  { combo: isMac ? '⌘+V' : 'Ctrl+Shift+V', label: 'Colar', context: 'Terminal' },
]
