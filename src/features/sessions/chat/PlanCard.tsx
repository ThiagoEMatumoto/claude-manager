import { useState } from 'react'
import { CheckCircle2, ChevronRight, Clock, ClipboardList, XCircle } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'

interface Props {
  plan: string
  // undefined = aguardando aprovação; true = aprovado; false = rejeitado/feedback.
  decision?: boolean
}

// Planos longos começam colapsados pra não tomar a conversa inteira.
const COLLAPSE_THRESHOLD = 1200

// Render dedicado de um ExitPlanMode (substitui o tool card genérico). Mostra o
// plano em markdown (colapsável) + o estado de aprovação derivado do tool_result.
export function PlanCard({ plan, decision }: Props) {
  const [open, setOpen] = useState(plan.length <= COLLAPSE_THRESHOLD)

  const status =
    decision === true
      ? { icon: CheckCircle2, label: 'Aprovado', cls: 'text-[var(--color-success)]' }
      : decision === false
        ? { icon: XCircle, label: 'Rejeitado', cls: 'text-[var(--color-danger)]' }
        : { icon: Clock, label: 'Aguardando aprovação', cls: 'text-[var(--color-text-dim)]' }

  return (
    <div className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-surface)]/60 text-sm">
      <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon
            as={ChevronRight}
            size={12}
            className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
          />
          <Icon as={ClipboardList} size={14} className="shrink-0 text-[var(--color-accent)]" />
          <span className="font-medium text-[var(--color-text)]">Revisão de plano</span>
        </button>
        <span className={`flex shrink-0 items-center gap-1 text-xs ${status.cls}`}>
          <Icon as={status.icon} size={13} />
          {status.label}
        </span>
      </div>
      {open ? (
        <div className="px-3 py-2.5">
          <MarkdownViewer content={plan} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-3 py-2 text-left text-xs text-[var(--color-text-dim)]"
        >
          Plano longo — clique para expandir.
        </button>
      )}
    </div>
  )
}
