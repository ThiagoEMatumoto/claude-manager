import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  widthClassName?: string
}

export function Dialog({ open, onClose, title, children, footer, widthClassName }: Props) {
  // Fecha com Escape (keyboard-first). Listener em fase bubble na window:
  // handlers internos que consomem Escape para outra função (ex.: captura de
  // keybinding no SettingsDialog, que faz preventDefault/stopPropagation em
  // capture) têm precedência — por isso ignoramos eventos já defaultPrevented.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      // z-[1000] keeps the dialog above dockview layers (.dv-sash z-index 99,
      // --dv-overlay-z-index 999); the portal escapes any stacking context
      // created by ancestors of the dialog's render site.
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`${widthClassName ?? 'w-[28rem]'} flex max-h-[85vh] max-w-[90vw] flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl`}
      >
        {title && <div className="mb-4 shrink-0 text-lg font-semibold">{title}</div>}
        <div className="min-h-0 overflow-y-auto pr-1">{children}</div>
        {footer && <div className="mt-6 flex shrink-0 justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
