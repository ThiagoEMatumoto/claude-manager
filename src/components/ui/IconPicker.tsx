import { useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_ICON_NAMES, PROJECT_ICONS } from './projectIcon'
import { renderProjectIcon } from './projectIcon'
import { ICON_STROKE } from './Icon'

interface Props {
  value: string | null
  onChange: (name: string | null) => void
}

export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PROJECT_ICON_NAMES
    return PROJECT_ICON_NAMES.filter((n) => n.toLowerCase().includes(q))
  }, [query])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Escolher ícone"
        className="flex h-[38px] w-16 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] outline-none transition hover:border-[var(--color-accent)] focus:border-[var(--color-accent)]"
      >
        {renderProjectIcon(value, { size: 18 })}
      </button>

      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Limpar ícone"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[10px] leading-none text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
        >
          ×
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full z-[60] mt-1 w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ícone…"
            className="mb-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
            {filtered.map((name) => {
              const Component = PROJECT_ICONS[name]
              const selected = name === value
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)] ${
                    selected ? 'ring-1 ring-[var(--color-accent)]' : ''
                  }`}
                >
                  <Component size={18} strokeWidth={ICON_STROKE} />
                </button>
              )
            })}
            {filtered.length === 0 && (
              <div className="col-span-7 py-4 text-center text-xs text-[var(--color-text-dim)]">
                nada encontrado
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
