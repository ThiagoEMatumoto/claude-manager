import { useEffect, useState } from 'react'
import { meetingsApi } from '@/lib/ipc'
import type { MeetingSegment } from '../../../shared/types/ipc'

function formatMs(ms: number | null): string {
  if (ms == null) return '--:--'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface Props {
  meetingId: string
}

// Transcript ao vivo: carrega os segmentos persistidos e faz merge incremental
// dos que chegam pelo stream do sidecar. Nesta fatia (sem sidecar) a lista vem
// só do store e fica vazia até a captura existir.
export function LiveTranscriptPanel({ meetingId }: Props) {
  const [segments, setSegments] = useState<MeetingSegment[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await meetingsApi.listSegments(meetingId)
      if (alive) setSegments(loaded)
    })()

    const off = meetingsApi.onTranscriptSegment((segment) => {
      if (segment.meetingId !== meetingId) return
      setSegments((prev) => {
        const idx = prev.findIndex((s) => s.id === segment.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = segment
          return next
        }
        return [...prev, segment]
      })
    })

    return () => {
      alive = false
      off()
    }
  }, [meetingId])

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--color-text-dim)]">
        O transcript ao vivo aparece aqui durante a gravação.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {segments.map((segment) => (
        <li key={segment.id} className="text-sm">
          <span className="mr-2 font-mono text-xs text-[var(--color-text-dim)]">
            {formatMs(segment.startMs)}
          </span>
          {segment.speakerLabel && (
            <span className="mr-2 font-medium text-[var(--color-accent)]">
              {segment.speakerLabel}
            </span>
          )}
          <span
            className={
              segment.isPartial ? 'text-[var(--color-text-dim)] italic' : 'text-[var(--color-text)]'
            }
          >
            {segment.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
