import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricsTypeBucket, SessionType } from '../../../shared/types/ipc'

const TYPE_LABELS: Record<SessionType, string> = {
  quick_chat: 'Quick chat',
  iteration: 'Iteração',
  deep_solo: 'Deep solo',
  agent_orchestration: 'Agent orchestration',
}

// Ordem canônica (precedência do ops-hub).
const TYPE_ORDER: SessionType[] = ['quick_chat', 'iteration', 'deep_solo', 'agent_orchestration']

const AXIS_COLOR = 'var(--color-text-dim)'

export function SessionTypeHistogram({ buckets }: { buckets: MetricsTypeBucket[] }) {
  const byType = new Map(buckets.map((b) => [b.type, b]))
  const data = TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    sessions: byType.get(type)?.sessions ?? 0,
  }))

  const hasData = data.some((d) => d.sessions > 0)
  if (!hasData) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
        Sem sessões classificadas na janela.
      </p>
    )
  }

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} stroke="var(--color-border)" />
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
            formatter={(value) => [Number(value).toLocaleString('pt-BR'), 'Sessões']}
          />
          <Bar dataKey="sessions" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.type}
                fill={
                  d.type === 'agent_orchestration' ? 'var(--color-accent)' : 'var(--color-info)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
