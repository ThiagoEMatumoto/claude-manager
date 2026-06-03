import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  // Insere o texto no input do claude e submete (Enter).
  onSend: (text: string) => void
  // Insere o texto no input do claude SEM submeter (usuário revisa antes do Enter).
  onInsert: (text: string) => void
}

// Editor de prompt: um textarea de verdade onde compor com navegação completa
// (setas, clique, seleção) — o input nativo do claude no xterm não oferece isso
// para uma linha lógica longa que só quebrou visualmente. Ao confirmar, o texto é
// injetado no claude via paste (bracketed), opcionalmente seguido de Enter.
export function PromptComposer({ open, onClose, onSend, onInsert }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  // Zera e foca a cada abertura.
  useEffect(() => {
    if (open) {
      setText('')
      // Foco no próximo tick, depois do overlay montar.
      const id = setTimeout(() => ref.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open])

  if (!open) return null

  function send() {
    const value = text
    if (value.length === 0) return onClose()
    onSend(value)
    onClose()
  }

  function insert() {
    const value = text
    if (value.length === 0) return onClose()
    onInsert(value)
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={(e) => {
        // Clique no backdrop fecha; cliques internos não propagam.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-[var(--color-text)]">Compor prompt</div>
          <div className="text-[10px] text-[var(--color-text-dim)]">
            Ctrl+Enter envia · Esc cancela
          </div>
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva seu prompt aqui — setas, clique e seleção funcionam como num editor. (começa vazio)"
          rows={10}
          className="w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent)]"
          onKeyDown={(e) => {
            // Não deixa os atalhos globais/terminal interceptarem enquanto compõe.
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="flex justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={insert}
            title="Insere o texto no prompt do claude sem enviar — você revisa e aperta Enter"
            className="rounded border border-[var(--color-border)] px-3 py-1 text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
          >
            Inserir sem enviar
          </button>
          <button
            type="button"
            onClick={send}
            className="rounded border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1 font-medium text-[var(--color-bg)] hover:opacity-90"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
