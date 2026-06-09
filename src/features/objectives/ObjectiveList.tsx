import type { ObjectiveStatus, ObjectiveWithProgress } from '../../../shared/types/ipc'
import { relativeTime } from '@/lib/time'
import { KIND_META, STATUS_META } from './status'
import { ProgressBar } from './ProgressBar'

interface Props {
  objectives: ObjectiveWithProgress[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ObjectiveList({ objectives, selectedId, onSelect }: Props) {
  if (objectives.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhum objetivo corresponde ao filtro.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {objectives.map((o) => (
        <ObjectiveCard
          key={o.id}
          objective={o}
          active={o.id === selectedId}
          onSelect={() => onSelect(o.id)}
        />
      ))}
    </ul>
  )
}

function ObjectiveCard({
  objective,
  active,
  onSelect,
}: {
  objective: ObjectiveWithProgress
  active: boolean
  onSelect: () => void
}) {
  const kind = KIND_META[objective.kind]
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full rounded-lg border px-4 py-3 text-left transition ${
          active
            ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]/60'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--color-text)]">
              {objective.title}
            </div>
            {objective.description && (
              <div className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-dim)]">
                {objective.description}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <KindBadge kind={objective.kind} />
            <StatusBadge status={objective.status} />
          </div>
        </div>

        <ProgressBar value={objective.progress} className="mt-2.5" />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {objective.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
            >
              #{tag}
            </span>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-dim)]">
          {objective.period && (
            <>
              <span>{objective.period}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span title={kind.label}>{relativeTime(objective.updatedAt)}</span>
        </div>
      </button>
    </li>
  )
}

export function StatusBadge({ status }: { status: ObjectiveStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ color: meta.color, background: 'var(--color-bg)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function KindBadge({ kind }: { kind: ObjectiveWithProgress['kind'] }) {
  const meta = KIND_META[kind]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ color: meta.color, background: 'var(--color-bg)' }}
    >
      {meta.label}
    </span>
  )
}
