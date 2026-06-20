import { useEffect, useMemo, useState } from 'react'
import { meetingsApi } from '@/lib/ipc'
import type { MeetingPartialEvent, MeetingSegment } from '../../../shared/types/ipc'

function formatMs(ms: number | null): string {
  if (ms == null) return '--:--'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Linha renderizável: une o segment persistido (final) e o partial (provisório
// das janelas ao vivo). `key` é estável p/ o React; `partial` muda o estilo.
interface Line {
  key: string
  startMs: number | null
  speakerLabel: string | null
  text: string
  partial: boolean
}

interface Props {
  meetingId: string
}

// Transcript ao vivo: combina os segmentos PERSISTIDOS (finais, via
// onTranscriptSegment) com os PROVISÓRIOS das janelas ao vivo (onTranscriptPartial,
// efêmeros — sem id de banco, reconciliados por idx). Os partials aparecem em
// itálico/dim enquanto a captura roda; ao chegar o transcript final (status
// ready/done) eles são descartados — os finais persistidos os substituem.
export function LiveTranscriptPanel({ meetingId }: Props) {
  const [segments, setSegments] = useState<MeetingSegment[]>([])
  const [partials, setPartials] = useState<Map<number, MeetingPartialEvent>>(new Map())

  useEffect(() => {
    let alive = true
    setPartials(new Map())
    void (async () => {
      const loaded = await meetingsApi.listSegments(meetingId)
      if (alive) setSegments(loaded)
    })()

    const offSegment = meetingsApi.onTranscriptSegment((segment) => {
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

    const offPartial = meetingsApi.onTranscriptPartial((partial) => {
      if (partial.meetingId !== meetingId) return
      setPartials((prev) => {
        const next = new Map(prev)
        next.set(partial.idx, partial)
        return next
      })
    })

    // A passada final (status ready) torna os partials obsoletos: os `segment`
    // finais persistidos passam a ser a fonte de verdade. Limpa os provisórios.
    const offStatus = meetingsApi.onStatus(({ id, status }) => {
      if (id !== meetingId) return
      if (status === 'ready' || status === 'extracted') setPartials(new Map())
    })

    return () => {
      alive = false
      offSegment()
      offPartial()
      offStatus()
    }
  }, [meetingId])

  const lines = useMemo<Line[]>(() => {
    const finalLines: Line[] = segments.map((s) => ({
      key: s.id,
      startMs: s.startMs,
      speakerLabel: s.speakerLabel,
      text: s.text,
      partial: s.isPartial,
    }))
    const partialLines: Line[] = Array.from(partials.values()).map((p) => ({
      key: `partial-${p.idx}`,
      startMs: p.startMs,
      speakerLabel: p.speakerLabel,
      text: p.text,
      partial: true,
    }))
    return [...finalLines, ...partialLines].sort(
      (a, b) => (a.startMs ?? 0) - (b.startMs ?? 0),
    )
  }, [segments, partials])

  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--color-text-dim)]">
        O transcript ao vivo aparece aqui durante a gravação.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {lines.map((line) => (
        <li key={line.key} className="text-sm">
          <span className="mr-2 font-mono text-xs text-[var(--color-text-dim)]">
            {formatMs(line.startMs)}
          </span>
          {line.speakerLabel && (
            <span className="mr-2 font-medium text-[var(--color-accent)]">
              {line.speakerLabel}
            </span>
          )}
          <span
            className={
              line.partial ? 'text-[var(--color-text-dim)] italic' : 'text-[var(--color-text)]'
            }
          >
            {line.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
