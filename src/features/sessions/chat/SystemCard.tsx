import { useState } from 'react'
import { AlertTriangle, ChevronRight, Settings } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  label: string
  detail: string
  level: 'info' | 'warning' | 'error'
}

const LEVEL_COLOR: Record<Props['level'], string> = {
  info: 'text-[var(--color-text-dim)]',
  warning: 'text-[var(--color-warning,var(--color-accent))]',
  error: 'text-[var(--color-danger)]',
}

// Contexto de sistema CURADO: chip discreto e colapsado, centralizado entre as
// mensagens. Só expande o detalhe sob demanda — nunca despeja conteúdo cru inline.
export function SystemCard({ label, detail, level }: Props) {
  const [open, setOpen] = useState(false)
  const color = LEVEL_COLOR[level]
  const showsMore = detail.trim() !== '' && detail.trim() !== label.trim()
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/40 text-xs">
        <button
          type="button"
          onClick={() => showsMore && setOpen((o) => !o)}
          className={`flex w-full items-center gap-1.5 px-2 py-1 text-left ${color} ${
            showsMore ? '' : 'cursor-default'
          }`}
        >
          {showsMore && (
            <Icon
              as={ChevronRight}
              size={11}
              className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
            />
          )}
          <Icon as={level === 'error' ? AlertTriangle : Settings} size={11} className="shrink-0" />
          <span className="font-medium">{label}</span>
        </button>
        {open && showsMore && (
          <div className="whitespace-pre-wrap break-words border-t border-[var(--color-border)] px-2 py-1.5 text-[var(--color-text-dim)]">
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}
