import { useEffect, useRef, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  /** Item atualmente selecionado (mostra um ✓ e destaca o texto). */
  active?: boolean
}

export interface MenuSection {
  title: string
  items: MenuItem[]
}

interface Props {
  open: boolean
  onClose: () => void
  /** Lista plana de itens (modo clássico). Ignorada se `sections` for passado. */
  items?: MenuItem[]
  /** Itens agrupados sob títulos (ex: Modelo / Esforço). */
  sections?: MenuSection[]
  /** Botão âncora que abre o menu. */
  children: ReactNode
}

function MenuButton({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onClose()
        item.onClick()
      }}
      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-[var(--color-surface-2)] ${
        item.danger
          ? 'text-[var(--color-danger)] hover:text-[var(--color-danger)]'
          : item.active
            ? 'text-[var(--color-text)]'
            : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
      }`}
    >
      <span>{item.label}</span>
      {item.active && <span className="text-[var(--color-accent)]">✓</span>}
    </button>
  )
}

export function Menu({ open, onClose, items, sections, children }: Props) {
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
          {sections
            ? sections.map((section, i) => (
                <div key={section.title}>
                  {i > 0 && <div className="my-1 border-t border-[var(--color-border)]" />}
                  <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-dim)]">
                    {section.title}
                  </div>
                  {section.items.map((item) => (
                    <MenuButton key={item.label} item={item} onClose={onClose} />
                  ))}
                </div>
              ))
            : items?.map((item) => <MenuButton key={item.label} item={item} onClose={onClose} />)}
        </div>
      )}
    </div>
  )
}
