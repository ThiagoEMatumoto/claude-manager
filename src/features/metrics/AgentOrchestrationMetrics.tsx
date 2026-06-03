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

const AXIS_COLOR = 'var(--color-text-dim)'

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

export function AgentOrchestrationMetrics({
  totals,
  subagentTypeDistribution,
}: {
  totals: MetricsTotals
  subagentTypeDistribution: { type: string; count: number }[]
}) {
  const hasData = subagentTypeDistribution.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Card
          label="Paralelização"
          value={`${(totals.parallelizationRatio * 100).toFixed(1)}%`}
          hint="rounds com 2+ agents / rounds com agent"
        />
        <Card
          label="Delegação"
          value={`${(totals.inlineDelegationRatio * 100).toFixed(1)}%`}
          hint="agent calls / (agent + explore inline)"
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
