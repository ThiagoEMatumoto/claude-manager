import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MetricsDayPoint, MetricsSnapshot } from '../../../shared/types/ipc'
import { fmtTokens, fmtUsd } from './usage-format'

// Tendência de uso dos últimos 30 dias (custo/dia em área com gradiente do
// accent; tooltip mostra custo + tokens do dia). Padrão do TrendChart, mas
// single-series e com a estética da Home.
export function UsageChartCard({
  snapshot,
  loading,
}: {
  snapshot: MetricsSnapshot | null
  loading: boolean
}) {
  return (
    <section className="glass-card flex flex-col px-5 py-4 lg:col-span-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
          Uso · últimos 30 dias
        </h2>
        {snapshot && (
          <span className="text-xs tabular-nums text-[var(--color-text-dim)]">
            {fmtUsd(snapshot.totals.costUsd)} · {fmtTokens(totalTokens(snapshot))} tokens
          </span>
        )}
      </header>

      <div className="mt-3 flex-1" style={{ minHeight: 220 }}>
        {loading && !snapshot && (
          <div className="h-full w-full animate-pulse rounded-lg bg-[var(--color-surface-2)]/60" />
        )}
        {!loading && (!snapshot || snapshot.perDay.length === 0) && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">
            Sem dados de uso na janela.
          </div>
        )}
        {snapshot && snapshot.perDay.length > 0 && <UsageChart perDay={snapshot.perDay} />}
      </div>
    </section>
  )
}

function totalTokens(s: MetricsSnapshot): number {
  const t = s.totals
  return t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
}

function fmtDay(day: string): string {
  const parts = day.split('-')
  if (parts.length !== 3) return day
  return `${parts[2]}/${parts[1]}`
}

function UsageChart({ perDay }: { perDay: MetricsDayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={perDay} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="home-usage-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={fmtDay}
          tick={{ fontSize: 10, fill: 'var(--color-text-dim)' }}
          stroke="var(--color-border)"
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          tick={{ fontSize: 10, fill: 'var(--color-text-dim)' }}
          stroke="var(--color-border)"
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-border)' }}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null
            const point = payload[0].payload as MetricsDayPoint
            return (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs shadow-lg">
                <div className="text-[var(--color-text-dim)]">{fmtDay(point.day)}</div>
                <div className="mt-1 font-semibold tabular-nums text-[var(--color-text)]">
                  {fmtUsd(point.costUsd)}
                </div>
                <div className="tabular-nums text-[var(--color-text-dim)]">
                  {fmtTokens(point.tokens)} tokens · {point.turns} turnos
                </div>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke="var(--color-accent)"
          strokeWidth={2}
          fill="url(#home-usage-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
