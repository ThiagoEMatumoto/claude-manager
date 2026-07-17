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

// --- Encaminhamento de teclas pro PTY (modelo Warp: composer é o input único) ---
// O xterm vira display-only; teclas de controle/navegação digitadas no composer são
// repassadas como sequências ANSI pro PTV vivo, pra dirigir a TUI do claude (menus,
// y/n, Shift+Tab de permissão, interrupção). Texto imprimível ACUMULA no textarea e
// só vai no Enter (via sendPrompt/bracketed-paste).

export interface ForwardKeyEvent {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

// `seq`: sequência ANSI a escrever no PTY (com preventDefault no caller).
// `handleInTextarea`: a tecla é edição normal do draft — deixa o textarea tratar.
export type ForwardKeyResult = { seq: string } | { handleInTextarea: true }

const HANDLE_IN_TEXTAREA: ForwardKeyResult = { handleInTextarea: true }

// Navegação só é encaminhada com o textarea VAZIO; com texto, as setas/Home/End
// editam o draft (cursor). Vazio = "modo de controle da TUI"; com texto = "edição".
// Exportado: respond-keys (cliques nos cards do chat) reusa as mesmas sequências.
export const NAV_SEQ: Record<string, string> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
}

// Decide se uma tecla do composer vira sequência pro PTY ou edição local do textarea.
// `textareaEmpty` resolve os conflitos com a edição: navegação e Enter-cru só viram
// controle quando não há rascunho; Ctrl+C só interrompe com o composer vazio (com
// texto, Ctrl+C copia nativamente). As setas ↑/↓ PURAS vão pros menus do claude;
// Ctrl/Alt+↑/↓ são reservadas pro histórico de prompts (tratado no Composer, antes
// deste forward) — por isso a navegação aqui exige ausência de ctrl/alt/meta.
export function resolveForwardKey(e: ForwardKeyEvent, textareaEmpty: boolean): ForwardKeyResult {
  const { key } = e

  // Ctrl+C → SIGINT, mas só com o composer vazio (com texto, preserva o copiar nativo;
  // a interrupção sempre disponível fica no botão Interromper da toolbar).
  if (e.ctrl && !e.meta && !e.shift && (key === 'c' || key === 'C')) {
    return textareaEmpty ? { seq: '\x03' } : HANDLE_IN_TEXTAREA
  }
  // Ctrl+D → EOF.
  if (e.ctrl && !e.meta && !e.shift && (key === 'd' || key === 'D')) return { seq: '\x04' }

  // Esc → cancela prompts/menus do claude.
  if (key === 'Escape') return { seq: '\x1b' }

  // Tab → autocomplete/accept; Shift+Tab → cicla o modo de permissão (CSI Z).
  if (key === 'Tab') return { seq: e.shift ? '\x1b[Z' : '\t' }

  // Enter cru com textarea VAZIO → \r (confirma y/n e seleções de menu). Com texto,
  // deixa o composer-keys decidir (send/newline conforme o keyboardMode).
  if (key === 'Enter' && !e.shift && !e.meta && !e.ctrl) {
    return textareaEmpty ? { seq: '\r' } : HANDLE_IN_TEXTAREA
  }

  // Navegação: só encaminha com o textarea vazio (senão é movimentação do cursor) e
  // sem ctrl/alt/meta (esses combos ficam pro histórico/edição, não pro TUI).
  if (textareaEmpty && !e.ctrl && !e.alt && !e.meta && key in NAV_SEQ) {
    return { seq: NAV_SEQ[key] }
  }

  return HANDLE_IN_TEXTAREA
}

export interface HistoryNav {
  value: string
  index: number
}

// Navega o histórico de prompts enviados (estilo shell). `history` em ordem
// cronológica (mais antigo primeiro); o índice vai de 0 a history.length, onde
// `index === history.length` é a posição "rascunho atual" (fora do histórico).
// 'prev' recua rumo ao prompt mais recente; 'next' avança de volta ao rascunho
// (devolve '' nessa borda — o caller restaura o rascunho salvo). Pura/testável.
export function navigateHistory(
  history: string[],
  index: number,
  dir: 'prev' | 'next',
): HistoryNav {
  if (history.length === 0) return { value: '', index: 0 }
  if (dir === 'prev') {
    const next = Math.max(0, index - 1)
    return { value: history[next] ?? '', index: next }
  }
  const next = Math.min(history.length, index + 1)
  return { value: next < history.length ? history[next] : '', index: next }
}
