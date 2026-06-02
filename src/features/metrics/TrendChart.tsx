import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricsDayPoint } from '../../../shared/types/ipc'

const AXIS_COLOR = 'var(--color-text-dim)'

function fmtDay(day: string): string {
  // day = 'YYYY-MM-DD' → 'DD/MM'
  const parts = day.split('-')
  if (parts.length !== 3) return day
  return `${parts[2]}/${parts[1]}`
}

export function TrendChart({ perDay }: { perDay: MetricsDayPoint[] }) {
  if (perDay.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
        Sem dados de tendência na janela.
      </p>
    )
  }

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={perDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            tickFormatter={fmtDay}
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            stroke="var(--color-border)"
          />
          <YAxis
            yAxisId="tokens"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            stroke="var(--color-border)"
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fontSize: 11, fill: AXIS_COLOR }}
            stroke="var(--color-border)"
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--color-text)',
            }}
            itemStyle={{ color: 'var(--color-text)' }}
            labelStyle={{ color: 'var(--color-text-dim)' }}
            labelFormatter={(label) => fmtDay(String(label))}
            formatter={(value, name) =>
              name === 'Custo (USD)'
                ? [`$${Number(value).toFixed(2)}`, name]
                : [Number(value).toLocaleString('pt-BR'), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="tokens"
            type="monotone"
            dataKey="tokens"
            name="Tokens"
            stroke="var(--color-info)"
            fill="var(--color-info)"
            fillOpacity={0.18}
          />
          <Line
            yAxisId="cost"
            type="monotone"
            dataKey="costUsd"
            name="Custo (USD)"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
