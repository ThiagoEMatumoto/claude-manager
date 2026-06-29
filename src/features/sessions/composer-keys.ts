import type { KeyboardSendMode } from '@/lib/session-prefs-store'

// Subconjunto de KeyboardEvent que o handler precisa — mantém a função pura e
// testável sem um DOM (vitest puro).
export interface ComposerKeyEvent {
  key: string
  shift?: boolean
  meta?: boolean
  ctrl?: boolean
}

export type ComposerKeyAction = 'send' | 'newline' | 'noop'

// Decide o que uma tecla faz no composer, dado o modo de teclado:
// - 'enter-sends' (default): Enter envia, Shift+Enter quebra linha.
// - 'enter-newline': Enter quebra linha, Cmd/Ctrl+Enter envia.
// Cmd/Ctrl+Enter sempre envia (atalho universal), independente do modo.
export function resolveComposerKey(
  e: ComposerKeyEvent,
  mode: KeyboardSendMode,
): ComposerKeyAction {
  if (e.key !== 'Enter') return 'noop'

  const withMeta = Boolean(e.meta) || Boolean(e.ctrl)
  if (withMeta) return 'send'

  if (mode === 'enter-newline') return 'newline'

  // enter-sends
  return e.shift ? 'newline' : 'send'
}
