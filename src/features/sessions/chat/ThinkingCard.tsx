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
    <div className="rounded-lg font-mono text-[11px] transition-colors hover:bg-[var(--color-surface-2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-1.5 py-1 text-left text-[var(--color-text-dim)]"
      >
        <Icon
          as={ChevronRight}
          size={11}
          className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
        />
        <Icon as={Brain} size={11} className="shrink-0" />
        <span>pensou</span>
      </button>
      {open && (
        <div className="px-3 py-2 font-sans italic text-[var(--color-text-dim)]">
          <MarkdownViewer content={text} />
        </div>
      )}
    </div>
  )
}
