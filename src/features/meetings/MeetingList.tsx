import { Trash2 } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { activeMarker } from '@/features/brand'
import type { Meeting, MeetingStatus } from '../../../shared/types/ipc'
import { MEETING_STATUS_META } from './status'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR')
}

function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const meta = MEETING_STATUS_META[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        color: meta.color,
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

interface Props {
  meetings: Meeting[]
  selectedId: string | null
  onSelect: (meeting: Meeting) => void
  onDelete: (meeting: Meeting) => void
}

export function MeetingList({ meetings, selectedId, onSelect, onDelete }: Props) {
  if (meetings.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhuma reunião ainda.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {meetings.map((meeting) => {
        const active = meeting.id === selectedId
        return (
          <li key={meeting.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(meeting)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(meeting)
              }}
              className={`group w-full cursor-pointer rounded-[14px] border px-4 py-3 text-left transition ${
                active
                  ? `border-[var(--color-accent)] bg-[var(--color-surface-2)]/60 ${activeMarker}`
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]/60'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--color-text)]">
                    {meeting.title}
                  </div>
                  <div className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-text-dim)]">
                    {formatDate(meeting.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <MeetingStatusBadge status={meeting.status} />
                  <button
                    type="button"
                    title="Excluir reunião"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(meeting)
                    }}
                    className="rounded p-1 text-[var(--color-text-dim)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-danger)]"
                  >
                    <Icon as={Trash2} size={13} />
                  </button>
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
