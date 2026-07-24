import { useMemo } from 'react'
import type { FeatureWithStats, Repo } from '../../../shared/types/ipc'
import { FeatureCard } from './FeatureList'

interface Props {
  features: FeatureWithStats[]
  reposById: Map<string, Repo>
  sessionCounts: Map<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
}

// Colunas do board. "archived" não é um status (vive em archivedAt) — é uma
// coluna derivada. As demais agrupam por status real.
type ColumnId = 'in-progress' | 'done' | 'archived'

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'in-progress', label: 'Em andamento' },
  { id: 'done', label: 'Concluídas' },
  { id: 'archived', label: 'Arquivadas' },
]

function columnOf(f: FeatureWithStats): ColumnId | null {
  if (f.archivedAt != null) return 'archived'
  if (f.status === 'done') return 'done'
  // pending/in-progress/blocked/paused (não-arquivadas e não-concluídas) caem em andamento.
  return 'in-progress'
}

export function FeatureBoard({
  features,
  reposById,
  sessionCounts,
  selectedId,
  onSelect,
}: Props) {
  const grouped = useMemo(() => {
    const by: Record<ColumnId, FeatureWithStats[]> = {
      'in-progress': [],
      done: [],
      archived: [],
    }
    for (const f of features) {
      const col = columnOf(f)
      if (col) by[col].push(f)
    }
    return by
  }, [features])

  return (
    <div className="flex h-full gap-4 overflow-x-auto">
      {COLUMNS.map((col) => {
        const items = grouped[col.id]
        return (
          <section
            key={col.id}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40"
          >
            <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-text)]">{col.label}</span>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--color-text-dim)]">
                {items.length}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-text-dim)]">
                  Nenhuma feature.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((f) => (
                    <FeatureCard
                      key={f.id}
                      feature={f}
                      reposById={reposById}
                      sessions={sessionCounts.get(f.id) ?? f.sessionCount}
                      active={f.id === selectedId}
                      onSelect={() => onSelect(f.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
