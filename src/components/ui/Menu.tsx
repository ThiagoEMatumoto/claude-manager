import { useEffect, useRef, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  items: MenuItem[]
  /** Botão âncora que abre o menu. */
  children: ReactNode
}

export function Menu({ open, onClose, items, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <div ref={ref} className="relative inline-flex">
      {children}
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-40 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                onClose()
                item.onClick()
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-[var(--color-surface-2)] ${
                item.danger
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
