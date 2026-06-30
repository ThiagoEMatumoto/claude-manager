import { useState } from 'react'
import { Bot, Check, ChevronRight, X } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  name: string
  description: string
  turnCount: number
  // Resumos dos turnos (assistant) do subagente, pra expandir sob demanda.
  turns: string[]
  // Status final, derivado do is_error do tool_result do Task. undefined = ainda
  // em andamento (sem tool_result no transcript) → sem badge.
  status?: 'ok' | 'error'
}

// Card de um subagente disparado (Task/Agent), no lugar do tool_use genérico.
// Fechado: nome + descrição + status + contagem de turnos. Aberto: os resumos.
export function SubagentCard({ name, description, turnCount, turns, status }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-surface)]/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <Icon
          as={ChevronRight}
          size={12}
          className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
        />
        <Icon as={Bot} size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="shrink-0 font-medium text-[var(--color-text)]">{name}</span>
        {status === 'ok' && (
          <Icon as={Check} size={12} className="shrink-0 text-[var(--color-success,#22c55e)]" />
        )}
        {status === 'error' && (
          <Icon as={X} size={12} className="shrink-0 text-[var(--color-danger)]" />
        )}
        {description && <span className="truncate text-[var(--color-text-dim)]">{description}</span>}
        <span className="ml-auto shrink-0 whitespace-nowrap text-[var(--color-text-dim)]">
          {turnCount} {turnCount === 1 ? 'turno' : 'turnos'}
        </span>
      </button>
      {open && (
        <div className="max-h-72 space-y-1.5 overflow-auto border-t border-[var(--color-border)] px-2 py-1.5">
          {turns.length === 0 ? (
            <div className="text-[var(--color-text-dim)]">
              Sem texto nos turnos (só chamadas de ferramenta).
            </div>
          ) : (
            turns.map((t, i) => (
              <div
                key={i}
                className="whitespace-pre-wrap break-words border-l-2 border-[var(--color-border)] pl-2 text-[var(--color-text-dim)]"
              >
                {t}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
