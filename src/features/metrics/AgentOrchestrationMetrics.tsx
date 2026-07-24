import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricsTotals } from '../../../shared/types/ipc'
import { ORCH_KPI } from '../../../shared/metrics-targets'
import { bandFor, computeDelta, formatDelta, formatPct, kpiStatus } from './orchestration-kpi'
import type { BandTone } from './orchestration-kpi'

const AXIS_COLOR = 'var(--color-text-dim)'

const BAND_COLOR: Record<BandTone, string> = {
  good: 'var(--color-success)',
  watch: 'var(--color-warning)',
  bad: 'var(--color-danger)',
}

function KpiCard({
  label,
  value,
  target,
  baseline,
  previous,
  banded,
}: {
  label: string
  value: number
  target: number
  baseline: number
  previous?: number
  // Quando true, a cor do valor vem das health bands (good/watch/bad) em vez
  // do binário above/below de kpiStatus.
  banded?: boolean
}) {
  const status = kpiStatus(value, target)
  const valueColor = banded
    ? BAND_COLOR[bandFor(value).tone]
    : status === 'above'
      ? 'var(--color-success)'
      : 'var(--color-danger)'
  const delta = computeDelta(value, previous)

  const deltaColor =
    delta == null
      ? undefined
      : delta.dir === 'up'
        ? 'var(--color-success)'
        : delta.dir === 'down'
          ? 'var(--color-danger)'
          : 'var(--color-text-dim)'
  const deltaArrow = delta == null ? '' : delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '—'

  const scale = Math.max(target * 1.5, value, 0.001)
  const fillPct = Math.min(value / scale, 1) * 100
  const targetPct = Math.min(target / scale, 1) * 100
  const baselinePct = Math.min(baseline / scale, 1) * 100

  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] border p-4"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-dim)' }}>
        {label}
      </span>

      <div className="flex items-baseline gap-2">
        <span
          data-testid="kpi-value"
          className="font-mono text-2xl font-semibold tabular-nums"
          style={{ color: valueColor }}
        >
          {formatPct(value)}
        </span>
        {delta && (
          <span
            data-testid="kpi-delta"
            className="font-mono text-[11px] font-medium tabular-nums"
            style={{ color: deltaColor }}
          >
            {deltaArrow} {formatDelta(delta)}
          </span>
        )}
      </div>

      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--color-surface-2)' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${fillPct}%`, background: valueColor }}
        />
        <div
          data-testid="kpi-baseline-marker"
          className="absolute inset-y-0 w-px"
          style={{ left: `${baselinePct}%`, background: 'var(--color-text-dim)' }}
        />
        <div
          data-testid="kpi-target-marker"
          className="absolute inset-y-0 w-px"
          style={{ left: `${targetPct}%`, background: 'var(--color-text)' }}
        />
      </div>

      <span data-testid="kpi-target" className="text-[11px]" style={{ color: 'var(--color-text-dim)' }}>
        Meta &gt; {formatPct(target)}
      </span>
    </div>
  )
}

export function AgentOrchestrationMetrics({
  totals,
  previousTotals,
  subagentTypeDistribution,
}: {
  totals: MetricsTotals
  previousTotals?: MetricsTotals
  subagentTypeDistribution: { type: string; count: number }[]
}) {
  const hasData = subagentTypeDistribution.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label={ORCH_KPI.parallelization.label}
          value={totals.parallelizationRatio}
          target={ORCH_KPI.parallelization.target}
          baseline={ORCH_KPI.parallelization.baseline}
          previous={previousTotals?.parallelizationRatio}
        />
        <KpiCard
          label={ORCH_KPI.delegation.label}
          value={totals.inlineDelegationRatio}
          target={ORCH_KPI.delegation.target}
          baseline={ORCH_KPI.delegation.baseline}
          previous={previousTotals?.inlineDelegationRatio}
        />
        <KpiCard
          label={ORCH_KPI.managerMode.label}
          value={totals.managerModeScore}
          target={ORCH_KPI.managerMode.target}
          baseline={ORCH_KPI.managerMode.baseline}
          previous={previousTotals?.managerModeScore}
          banded
        />
      </div>

      {hasData ? (
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart
              data={subagentTypeDistribution}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="type"
                tick={{ fontSize: 11, fill: AXIS_COLOR }}
                stroke="var(--color-border)"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: AXIS_COLOR }}
                stroke="var(--color-border)"
              />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-2)', opacity: 0.4 }}
                contentStyle={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--color-text)',
                }}
                itemStyle={{ color: 'var(--color-text)' }}
                labelStyle={{ color: 'var(--color-text-dim)' }}
                formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Invocações']}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="var(--color-accent)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
          Sem invocações de subagente na janela.
        </p>
      )}
    </div>
  )
}
