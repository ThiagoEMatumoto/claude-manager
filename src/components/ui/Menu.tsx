import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
  /**
   * Renderiza o painel via portal em document.body (position:fixed), ancorado
   * ao trigger. Necessário quando o Menu vive dentro de um stacking context que
   * recorta/sobrepõe o painel (ex: a camada de labels do react-flow, abaixo dos
   * nós). Default false → comportamento absolute clássico, inalterado.
   */
  portal?: boolean
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

function MenuPanel({
  items,
  sections,
  onClose,
}: Pick<Props, 'items' | 'sections' | 'onClose'>) {
  return (
    <>
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
    </>
  )
}

export function Menu({ open, onClose, items, sections, children, portal }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

  // Posiciona o painel portalizado abaixo/à direita do trigger (alinhado pela
  // borda direita, espelhando o `right-0 top-full` do modo absolute).
  useLayoutEffect(() => {
    if (!open || !portal || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setCoords({ left: rect.right, top: rect.bottom + 4 })
  }, [open, portal])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      onClose()
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

  if (portal) {
    return (
      <div ref={ref} className="relative inline-flex">
        {children}
        {open &&
          coords &&
          createPortal(
            <div
              ref={panelRef}
              // z-[1000] (padrão Dialog) escapa qualquer stacking context dos
              // ancestrais (camada de edges do react-flow fica abaixo dos nós).
              className="fixed z-[1000] min-w-40 -translate-x-full overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl"
              style={{ left: coords.left, top: coords.top }}
            >
              <MenuPanel items={items} sections={sections} onClose={onClose} />
            </div>,
            document.body,
          )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative inline-flex">
      {children}
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-40 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-xl">
          <MenuPanel items={items} sections={sections} onClose={onClose} />
        </div>
      )}
    </div>
  )
}
