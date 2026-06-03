import type { MetricsProjectRow } from '../../../shared/types/ipc'
import { fmtInt, fmtUsd } from './format'

export function ProjectBreakdown({ rows }: { rows: MetricsProjectRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
        Nenhum projeto na janela.
      </p>
    )
  }

  const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd)

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ color: 'var(--color-text-dim)' }} className="text-left">
            <th className="px-3 py-2 font-medium">Projeto</th>
            <th className="px-3 py-2 text-right font-medium">Sessões</th>
            <th className="px-3 py-2 text-right font-medium">Turns</th>
            <th className="px-3 py-2 text-right font-medium">Tokens</th>
            <th className="px-3 py-2 text-right font-medium">Custo</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const unattributed = row.projectId === null
            return (
              <tr
                key={row.projectId ?? '__none__'}
                className="border-t"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td
                  className="px-3 py-2"
                  style={{
                    color: unattributed ? 'var(--color-text-dim)' : 'var(--color-text)',
                    fontStyle: unattributed ? 'italic' : 'normal',
                  }}
                >
                  {row.projectName}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>
                  {fmtInt(row.sessions)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>
                  {fmtInt(row.turns)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>
                  {fmtInt(row.tokens)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>
                  {fmtUsd(row.costUsd)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
