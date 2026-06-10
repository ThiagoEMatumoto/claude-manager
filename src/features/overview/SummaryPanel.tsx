import type { OverviewCounts } from '../../../shared/types/ipc'

// Linha compacta de contadores da Home (os 4 cards grandes viraram chips —
// a lista "Pendências do dia" foi absorvida pelo card de tasks urgentes).
export function SummaryPanel({ counts }: { counts: OverviewCounts }) {
  return (
    <section className="flex flex-wrap items-center gap-2">
      <Stat label="objetivos ativos" value={counts.activeObjectives} />
      <Stat label="pendências" value={counts.pendingTasks} />
      <Stat label="vencem hoje" value={counts.dueToday} />
      <Stat label="atrasadas" value={counts.overdue} danger={counts.overdue > 0} />
    </section>
  )
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--color-surface)] px-3 py-1 text-xs"
      style={{ borderColor: danger ? 'var(--color-danger)' : 'var(--color-border)' }}
    >
      <span
        className="font-semibold tabular-nums"
        style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
      >
        {value}
      </span>
      <span className="text-[var(--color-text-dim)]">{label}</span>
    </span>
  )
}
