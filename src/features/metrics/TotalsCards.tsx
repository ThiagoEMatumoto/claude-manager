import type { MetricsTotals } from '../../../shared/types/ipc'

function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border p-4"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-dim)' }}>
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
        {value}
      </span>
      {hint && (
        <span className="text-[11px]" style={{ color: 'var(--color-text-dim)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

export function TotalsCards({ totals }: { totals: MetricsTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Card label="Sessões" value={fmtInt(totals.sessions)} />
      <Card label="Turns" value={fmtInt(totals.turns)} />
      <Card label="Custo" value={fmtUsd(totals.costUsd)} hint="USD estimado" />
      <Card
        label="Cache hit"
        value={`${(totals.cacheHitRate * 100).toFixed(1)}%`}
        hint={`${fmtInt(totals.cacheReadTokens)} cache read`}
      />
      <Card
        label="Agent calls"
        value={fmtInt(totals.agentCalls)}
        hint={`${fmtInt(totals.skillCalls)} skill calls`}
      />
    </div>
  )
}
