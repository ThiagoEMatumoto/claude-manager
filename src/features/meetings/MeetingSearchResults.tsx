import { Fragment } from 'react'
import type { MeetingSearchMatch, MeetingSearchSource } from '../../../shared/types/ipc'

const SOURCE_LABEL: Record<MeetingSearchSource, string> = {
  segment: 'transcript',
  notes: 'notas',
  extraction: 'item',
}

// O snippet do FTS5 vem com <mark>…</mark> em volta dos termos. Renderizar via
// dangerouslySetInnerHTML seria XSS (o texto é transcript/notas do usuário).
// Parseamos manualmente os marcadores (que NÓS controlamos na query do snippet)
// e devolvemos nós React — o texto entre eles é escapado pelo React.
function renderSnippet(snippet: string) {
  const parts = snippet.split(/(<mark>|<\/mark>)/)
  let inMark = false
  return parts.map((part, i) => {
    if (part === '<mark>') {
      inMark = true
      return null
    }
    if (part === '</mark>') {
      inMark = false
      return null
    }
    if (part === '') return null
    return inMark ? (
      <mark
        key={i}
        className="rounded bg-[var(--color-accent)]/25 px-0.5 text-[var(--color-text)]"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  })
}

interface Props {
  matches: MeetingSearchMatch[]
  selectedId: string | null
  loading: boolean
  onSelect: (meetingId: string) => void
}

export function MeetingSearchResults({ matches, selectedId, loading, onSelect }: Props) {
  if (loading && matches.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">Buscando…</div>
    )
  }
  if (matches.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhum resultado.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {matches.map(({ meeting, snippet, source }) => {
        const active = meeting.id === selectedId
        return (
          <li key={meeting.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(meeting.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(meeting.id)
              }}
              className={`w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]/60'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium text-[var(--color-text)]">
                  {meeting.title}
                </div>
                <span className="shrink-0 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]">
                  {SOURCE_LABEL[source]}
                </span>
              </div>
              <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--color-text-dim)]">
                {renderSnippet(snippet)}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
