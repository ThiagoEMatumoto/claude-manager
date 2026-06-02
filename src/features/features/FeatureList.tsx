import { GitBranch } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { relativeTime } from '@/lib/time'
import type { Feature, Repo } from '../../../shared/types/ipc'
import { STATUS_META } from './status'

interface Props {
  features: Feature[]
  reposById: Map<string, Repo>
  sessionCounts: Map<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
}

export function FeatureList({
  features,
  reposById,
  sessionCounts,
  selectedId,
  onSelect,
}: Props) {
  if (features.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhuma feature corresponde ao filtro.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {features.map((f) => (
        <FeatureCard
          key={f.id}
          feature={f}
          reposById={reposById}
          sessions={sessionCounts.get(f.id) ?? 0}
          active={f.id === selectedId}
          onSelect={() => onSelect(f.id)}
        />
      ))}
    </ul>
  )
}

function FeatureCard({
  feature,
  reposById,
  sessions,
  active,
  onSelect,
}: {
  feature: Feature
  reposById: Map<string, Repo>
  sessions: number
  active: boolean
  onSelect: () => void
}) {
  const meta = STATUS_META[feature.status]
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
              {feature.title}
            </div>
            {feature.objective && (
              <div className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-dim)]">
                {feature.objective}
              </div>
            )}
          </div>
          <StatusBadge status={feature.status} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {feature.repos.map((link) => (
            <span
              key={link.repoId}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
              title={link.branch ? `branch: ${link.branch}` : undefined}
            >
              <Icon as={GitBranch} size={10} />
              {reposById.get(link.repoId)?.label ?? link.repoId}
            </span>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-dim)]">
          <span title={meta.label}>{relativeTime(feature.updatedAt)}</span>
          {sessions > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                {sessions} {sessions === 1 ? 'sessão' : 'sessões'}
              </span>
            </>
          )}
        </div>
      </button>
    </li>
  )
}

export function StatusBadge({ status }: { status: Feature['status'] }) {
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
