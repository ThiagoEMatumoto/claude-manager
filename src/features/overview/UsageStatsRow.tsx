import type { CSSProperties, ReactNode } from 'react'
import { selectRecentUsage, selectTodayUsage } from '../../../shared/home-selectors'
import type { MetricsSnapshot } from '../../../shared/types/ipc'
import { fmtInt, fmtTokens, fmtUsd } from './usage-format'

// Faixa de 4 tiles de uso do Claude: custo hoje · custo 7d (delta vs 7d
// anteriores) · tokens 7d · sessões/turnos 7d. Skeleton no loading inicial.
export function UsageStatsRow({
  snapshot,
  loading,
}: {
  snapshot: MetricsSnapshot | null
  loading: boolean
}) {
  if (loading && !snapshot) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass-card animate-pulse px-5 py-4">
            <div className="h-3 w-20 rounded bg-[var(--color-surface-2)]" />
            <div className="mt-3 h-8 w-24 rounded bg-[var(--color-surface-2)]" />
          </div>
        ))}
      </div>
    )
  }
  if (!snapshot) return null

  const now = Date.now()
  const today = selectTodayUsage(snapshot.perDay, now)
  const { current, costDeltaPct } = selectRecentUsage(snapshot.perDay, now)

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile index={1} label="Custo hoje" value={fmtUsd(today.costUsd)} sub={`${fmtTokens(today.tokens)} tokens`} />
      <StatTile
        index={2}
        label="Custo 7d"
        value={fmtUsd(current.costUsd)}
        chip={costDeltaPct !== null ? <DeltaChip pct={costDeltaPct} /> : undefined}
      />
      <StatTile index={3} label="Tokens 7d" value={fmtTokens(current.tokens)} />
      <StatTile
        index={4}
        label="Sessões 7d"
        value={fmtInt(current.sessions)}
        sub={`${fmtInt(current.turns)} turnos`}
      />
    </div>
  )
}

function StatTile({
  index,
  label,
  value,
  sub,
  chip,
}: {
  index: number
  label: string
  value: string
  sub?: string
  chip?: ReactNode
}) {
  return (
    <div
      className="glass-card home-rise px-5 py-4 transition hover:-translate-y-px hover:border-[var(--color-accent-dim)]/40"
      style={{ '--i': index } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
          {label}
        </span>
        {chip}
      </div>
      <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--color-text-dim)]">{sub}</div>}
    </div>
  )
}

// Custo subindo = vermelho, caindo = verde.
function DeltaChip({ pct }: { pct: number }) {
  const up = pct >= 0
  const color = up ? 'var(--color-danger)' : 'var(--color-success)'
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {up ? '+' : ''}
      {pct.toFixed(0)}%
    </span>
  )
}
