import { useState } from 'react'
import { CheckCircle2, ChevronRight, Clock, ClipboardList, XCircle } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'

interface Props {
  plan: string
  // undefined = aguardando aprovação; true = aprovado; false = rejeitado/feedback.
  decision?: boolean
  // Clique-pra-decidir: presente = o ChatView liberou (card é o momento pendente +
  // sessão 'waiting'). O handler de lá re-checa os guards no clique.
  onDecide?: (d: 'approve' | 'reject') => void
  // Decisão já clicada, aguardando a decision real chegar no JSONL (forId).
  sent?: boolean
}

// Planos longos começam colapsados pra não tomar a conversa inteira.
const COLLAPSE_THRESHOLD = 1200

// Render dedicado de um ExitPlanMode (substitui o tool card genérico). Mostra o
// plano em markdown (colapsável) + o estado de aprovação derivado do tool_result.
// Com onDecide presente e decisão pendente, expõe botões de aprovar/rejeitar que
// enviam a decisão ao PTY; a decision real do JSONL substitui o estado otimista.
export function PlanCard({ plan, decision, onDecide, sent }: Props) {
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
      {/* Botões de decisão: só enquanto a decisão real não chegou. `sent` mantém os
          botões visíveis porém desabilitados até o JSONL confirmar. */}
      {decision === undefined && (onDecide != null || sent) && (
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <button
            type="button"
            disabled={sent || onDecide == null}
            onClick={() => onDecide?.('approve')}
            className="rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-text)] transition hover:bg-[var(--color-accent)]/25 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-[var(--color-accent)]/10"
          >
            Aprovar plano
          </button>
          <button
            type="button"
            disabled={sent || onDecide == null}
            onClick={() => onDecide?.('reject')}
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)]/90 transition hover:border-[var(--color-text-dim)] disabled:cursor-default disabled:opacity-50 disabled:hover:border-[var(--color-border)]"
          >
            Continuar planejando
          </button>
          {sent && (
            <span className="text-xs text-[var(--color-text-dim)]">Decisão enviada…</span>
          )}
        </div>
      )}
    </div>
  )
}
