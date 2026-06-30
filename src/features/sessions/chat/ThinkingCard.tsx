import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'

interface Props {
  text: string
}

// Bloco de raciocínio (extended thinking). Colapsado por padrão — o raciocínio é
// longo e secundário à conversa; o usuário expande sob demanda.
export function ThinkingCard({ text }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[var(--color-text-dim)]"
      >
        <Icon
          as={ChevronRight}
          size={12}
          className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
        />
        <Icon as={Brain} size={12} className="shrink-0" />
        <span className="font-medium">Pensando…</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 italic text-[var(--color-text-dim)]">
          <MarkdownViewer content={text} />
        </div>
      )}
    </div>
  )
}
