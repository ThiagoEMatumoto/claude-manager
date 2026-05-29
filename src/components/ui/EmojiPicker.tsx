import { useEffect, useRef, useState } from 'react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'

interface Props {
  value: string
  onChange: (emoji: string) => void
}

interface EmojiSelectEvent {
  native: string
}

export function EmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Escolher ícone"
        className="flex h-[38px] w-16 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-lg outline-none transition hover:border-[var(--color-accent)] focus:border-[var(--color-accent)]"
      >
        {value || <span className="text-[var(--color-text-dim)]">🙂</span>}
      </button>

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpar ícone"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[10px] leading-none text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-[60] mt-1">
          <Picker
            data={data}
            theme="dark"
            previewPosition="none"
            onEmojiSelect={(e: EmojiSelectEvent) => {
              onChange(e.native)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
