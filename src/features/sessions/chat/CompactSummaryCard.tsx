import { useState } from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'

interface Props {
  text: string
}

// Resumo do /compact gravado pela CLI (isCompactSummary:true) — NUNCA o humano
// digitou isso. Sem este card, cairia como bolha de usuário gigante. Colapsado
// por padrão: o resumo é longo e secundário à conversa em curso.
export function CompactSummaryCard({ text }: Props) {
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
        <Icon as={FileText} size={12} className="shrink-0" />
        <span className="font-medium">Resumo da conversa anterior</span>
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-[var(--color-text-dim)]">
          <MarkdownViewer content={text} />
        </div>
      )}
    </div>
  )
}
