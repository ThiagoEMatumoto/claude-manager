import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CornerDownLeft } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useSessionPrefsStore } from '@/lib/session-prefs-store'
import { resolveComposerKey } from './composer-keys'

export interface ComposerHandle {
  focus: () => void
}

interface Props {
  sessionId: string
  // Injeta o texto no input do claude E submete (Enter).
  onSend: (text: string) => void
  // Injeta o texto SEM submeter (usuário revisa antes do Enter).
  onInsert: (text: string) => void
  // Barra de controles acima do textarea (switcher de modelo, anexar, etc).
  // Slot agnóstico: o pai compõe o conteúdo (compartilhado entre terminal e chat).
  toolbar?: ReactNode
}

// Drafts em memória por sessão — princípio "nunca perder input". Sobrevive ao
// remount do dock (toggle de aba, reopen de pane) enquanto o app vive; não
// persiste em disco. O Composer é montado uma vez por sessão, então a chave é
// estável durante o ciclo de vida da instância.
const drafts = new Map<string, string>()

const MAX_HEIGHT = 192

// Dock de composição sempre visível abaixo do terminal. Um <textarea> de verdade
// (setas, clique, seleção, multiline) que injeta no PTY vivo via bracketed-paste,
// resolvendo a dor do Enter/Shift+Enter do input nativo do claude no xterm. É
// aditivo: o input direto na TUI continua funcionando.
export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { sessionId, onSend, onInsert, toolbar },
  ref,
) {
  const [text, setText] = useState(() => drafts.get(sessionId) ?? '')
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const keyboardMode = useSessionPrefsStore((s) => s.keyboardMode)
  const loadPrefs = useSessionPrefsStore((s) => s.load)

  useImperativeHandle(ref, () => ({ focus: () => innerRef.current?.focus() }), [])

  useEffect(() => {
    void loadPrefs()
  }, [loadPrefs])

  // Persiste o draft em memória a cada mudança.
  useEffect(() => {
    if (text) drafts.set(sessionId, text)
    else drafts.delete(sessionId)
  }, [sessionId, text])

  // Auto-grow do textarea até um teto; depois disso, scroll interno.
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [text])

  function refocus() {
    // onSend/onInsert focam o xterm; devolvemos o foco ao composer no próximo tick.
    requestAnimationFrame(() => innerRef.current?.focus())
  }

  function submit() {
    const value = text
    if (value.trim().length === 0) return
    onSend(value)
    setText('')
    drafts.delete(sessionId)
    refocus()
  }

  function insertOnly() {
    const value = text
    if (value.trim().length === 0) return
    onInsert(value)
    setText('')
    drafts.delete(sessionId)
    refocus()
  }

  const hint =
    keyboardMode === 'enter-newline'
      ? 'Enter quebra linha · Cmd/Ctrl+Enter envia'
      : 'Enter envia · Shift+Enter quebra linha'

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-2 pb-1 pt-2">
      {toolbar}
      <div className="flex items-end gap-2">
        <textarea
          ref={innerRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Escreva um prompt — vai pro mesmo claude. Setas, clique e seleção funcionam."
          className="max-h-48 min-h-[2.5rem] flex-1 resize-none overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent)]"
          onKeyDown={(e) => {
            // Não deixa atalhos globais/terminal interceptarem enquanto compõe.
            e.stopPropagation()
            const action = resolveComposerKey(
              { key: e.key, shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey },
              keyboardMode,
            )
            if (action === 'send') {
              e.preventDefault()
              submit()
            }
            // 'newline' e 'noop': comportamento nativo do textarea (quebra/edição).
          }}
        />
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={submit}
            title={hint}
            className="flex items-center gap-1 rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[var(--color-bg)] hover:opacity-90"
          >
            <Icon as={CornerDownLeft} size={13} />
            Enviar
          </button>
          <button
            type="button"
            onClick={insertOnly}
            title="Insere o texto no prompt do claude sem enviar — você revisa e aperta Enter"
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
          >
            Inserir
          </button>
        </div>
      </div>
      <div className="mt-1 px-1 text-[10px] text-[var(--color-text-dim)]">{hint}</div>
    </div>
  )
})
