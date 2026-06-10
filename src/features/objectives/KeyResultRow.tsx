import { Pencil, Trash2 } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { KeyResult, LinkedFeatureSummary } from '../../../shared/types/ipc'
import { KR_STATUS_META } from './status'
import { ProgressBar } from './ProgressBar'

interface Props {
  kr: KeyResult & { progress: number | null }
  // Features vinculadas ao KR (Fase 3) — chips compactos com % abaixo da barra.
  linkedFeatures?: LinkedFeatureSummary[]
  onEdit: () => void
  onDelete: () => void
}

function fmtProgress(progress: number | null): string {
  return progress === null ? '—' : `${Math.round(progress)}%`
}

export function KeyResultRow({ kr, linkedFeatures, onEdit, onDelete }: Props) {
  const meta = KR_STATUS_META[kr.status]
  return (
    <li className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: meta.color }}
              title={meta.label}
            />
            <span className="truncate text-sm text-[var(--color-text)]">{kr.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-dim)]">
            <span style={{ color: meta.color }}>{meta.label}</span>
            <span>peso: {kr.weight ?? 1}</span>
            {kr.owner && <span>owner: {kr.owner}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Editar KR"
            className="rounded-md p-1.5 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <Icon as={Pencil} size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Excluir KR"
            className="rounded-md p-1.5 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
          >
            <Icon as={Trash2} size={13} />
          </button>
        </div>
      </div>
      <ProgressBar value={kr.progress} className="mt-2" />
      {linkedFeatures && linkedFeatures.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {linkedFeatures.map((f) => (
            <li
              key={f.id}
              className="inline-flex max-w-48 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
              title={`feature: ${f.title}`}
            >
              <span className="shrink-0 font-medium text-[var(--color-accent)]">feature</span>
              <span className="truncate">{f.title}</span>
              <span className="shrink-0 tabular-nums">{fmtProgress(f.progress)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
