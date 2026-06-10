import type { ReactNode } from 'react'
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
        className={`${widthClassName ?? 'w-[28rem]'} max-w-[90vw] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl`}
      >
        {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
