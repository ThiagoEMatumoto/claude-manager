import { useMemo } from 'react'
import type { OverviewData, OverviewPendingTask } from '../../../shared/types/ipc'
import { classifyDue } from '../../../shared/pending'
import { DueDateBadge, PriorityBadge, TaskStatusBadge } from '@/features/tasks/TaskList'
import { PARENT_TYPE_META } from '@/features/tasks/status'

interface CountCardProps {
  label: string
  value: number
  danger?: boolean
}

function CountCard({ label, value, danger = false }: CountCardProps) {
  return (
    <div
      className="rounded-lg border bg-[var(--color-surface)] px-4 py-3"
      style={{ borderColor: danger ? 'var(--color-danger)' : 'var(--color-border)' }}
    >
      <div
        className="text-2xl font-semibold tabular-nums"
        style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-text-dim)]">{label}</div>
    </div>
  )
}

function PendingItem({ task }: { task: OverviewPendingTask }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <TaskStatusBadge status={task.status} />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">{task.title}</span>
      {task.priority && <PriorityBadge priority={task.priority} />}
      <DueDateBadge task={task} />
      {task.parents.map((p) => (
        <span
          key={`${p.type}:${p.id}`}
          className="inline-flex max-w-48 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
          title={`${PARENT_TYPE_META[p.type].label}: ${p.title}`}
        >
          <span className="shrink-0 font-medium text-[var(--color-accent)]">
            {PARENT_TYPE_META[p.type].label}
          </span>
          <span className="truncate">{p.title}</span>
        </span>
      ))}
    </li>
  )
}

// Painel-resumo do dashboard: 4 cards de contadores + as pendências que pedem
// ação HOJE (vencidas ou vencendo no dia local corrente). `pending` já chega
// ordenada do main (prioridade → due date → position).
export function SummaryPanel({ data }: { data: OverviewData }) {
  const { counts, pending } = data

  const dueNow = useMemo(() => {
    const now = Date.now()
    return pending.filter((t) => {
      const bucket = classifyDue(t.dueDate, now)
      return bucket === 'overdue' || bucket === 'today'
    })
  }, [pending])

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard label="Objetivos ativos" value={counts.activeObjectives} />
        <CountCard label="Pendências" value={counts.pendingTasks} />
        <CountCard label="Vencem hoje" value={counts.dueToday} />
        <CountCard label="Atrasadas" value={counts.overdue} danger={counts.overdue > 0} />
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
          Pendências do dia
        </h2>
        {dueNow.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-center text-sm text-[var(--color-text-dim)]">
            Nada vence hoje.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dueNow.map((task) => (
              <PendingItem key={task.id} task={task} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
