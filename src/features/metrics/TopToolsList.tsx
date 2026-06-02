import type { MetricsToolRow } from '../../../shared/types/ipc'

export function TopToolsList({ tools }: { tools: MetricsToolRow[] }) {
  if (tools.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
        Nenhuma ferramenta registrada na janela.
      </p>
    )
  }

  const max = Math.max(...tools.map((t) => t.count), 1)

  return (
    <ul className="flex flex-col gap-2">
      {tools.map((tool) => {
        const pct = (tool.count / max) * 100
        return (
          <li key={tool.name} className="flex items-center gap-3">
            <span
              className="w-32 shrink-0 truncate text-sm"
              style={{ color: 'var(--color-text)' }}
              title={tool.name}
            >
              {tool.name}
            </span>
            <span
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--color-surface-2)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${pct}%`, background: 'var(--color-accent)' }}
              />
            </span>
            <span
              className="w-12 shrink-0 text-right text-sm tabular-nums"
              style={{ color: 'var(--color-text-dim)' }}
            >
              {tool.count.toLocaleString('pt-BR')}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
