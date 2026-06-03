import { Fragment, useState } from 'react'
import type { MetricsSessionRow } from '../../../shared/types/ipc'
import { fmtInt, fmtUsd, fmtDateTime } from './format'

type SortKey = 'sessionType' | 'turns' | 'costUsd' | 'projectName'
type SortDir = 'asc' | 'desc'

function compare(a: MetricsSessionRow, b: MetricsSessionRow, key: SortKey, dir: SortDir): number {
  let raw: number
  if (key === 'sessionType' || key === 'projectName') {
    raw = a[key].localeCompare(b[key])
  } else {
    raw = a[key] - b[key]
  }
  return dir === 'asc' ? raw : -raw
}

export function PerSessionTable({ rows }: { rows: MetricsSessionRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('costUsd')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
        Nenhuma sessão na janela.
      </p>
    )
  }

  const sorted = [...rows].sort((a, b) => compare(a, b, sortKey, sortDir))

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function indicator(key: SortKey): string {
    if (key !== sortKey) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const headerCls = 'px-2.5 py-1.5 font-medium cursor-pointer select-none whitespace-nowrap'
  const cellCls = 'px-2.5 py-1'

  return (
    <div className="overflow-auto" style={{ maxHeight: '20rem' }}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr
            className="text-left"
            style={{ color: 'var(--color-text-dim)', background: 'var(--color-surface)' }}
          >
            <th data-testid="th-type" role="button" onClick={() => toggleSort('sessionType')} className={headerCls}>
              Tipo{indicator('sessionType')}
            </th>
            <th className="px-2.5 py-1.5 font-medium">Título</th>
            <th
              data-testid="th-turns"
              role="button"
              onClick={() => toggleSort('turns')}
              className={`${headerCls} text-right`}
            >
              Turns{indicator('turns')}
            </th>
            <th
              data-testid="th-cost"
              role="button"
              onClick={() => toggleSort('costUsd')}
              className={`${headerCls} text-right`}
            >
              Custo{indicator('costUsd')}
            </th>
            <th data-testid="th-project" role="button" onClick={() => toggleSort('projectName')} className={headerCls}>
              Projeto{indicator('projectName')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const expanded = expandedId === row.ccSessionId
            return (
              <Fragment key={row.ccSessionId}>
                <tr
                  data-testid="session-row"
                  onClick={() => setExpandedId(expanded ? null : row.ccSessionId)}
                  className="border-t cursor-pointer"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className={cellCls} style={{ color: 'var(--color-text-dim)' }}>
                    {row.sessionType}
                  </td>
                  <td className={`${cellCls} max-w-0 truncate`} style={{ color: 'var(--color-text)' }}>
                    {row.title ?? row.ccSessionId.slice(0, 8)}
                  </td>
                  <td className={`${cellCls} text-right tabular-nums`} style={{ color: 'var(--color-text)' }}>
                    {fmtInt(row.turns)}
                  </td>
                  <td className={`${cellCls} text-right tabular-nums`} style={{ color: 'var(--color-text)' }}>
                    {fmtUsd(row.costUsd)}
                  </td>
                  <td className={`${cellCls} whitespace-nowrap`} style={{ color: 'var(--color-text)' }}>
                    {row.projectName}
                  </td>
                </tr>
                {expanded && (
                  <tr data-testid="session-detail" style={{ backgroundColor: 'var(--color-surface-2)' }}>
                    <td colSpan={5} className="px-2.5 py-1.5" style={{ color: 'var(--color-text-dim)' }}>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>Agent calls: {fmtInt(row.agentCalls)}</span>
                        <span>Última atividade: {fmtDateTime(row.lastTs)}</span>
                        <span>Projeto (id): {row.projectId ?? '—'}</span>
                        <span className="font-mono opacity-70">{row.ccSessionId}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
