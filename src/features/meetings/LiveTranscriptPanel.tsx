import { useEffect, useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { meetingsApi } from '@/lib/ipc'
import type { MeetingSegment, MeetingSpeaker } from '../../../shared/types/ipc'

function formatMs(ms: number | null): string {
  if (ms == null) return '--:--'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Nome a exibir pro label: display_name renomeado > label cru (SPEAKER_0X). O
// "(você)" do is_local_user é renderizado à parte (não polui o nome editável).
function speakerName(speaker: MeetingSpeaker | undefined, label: string): string {
  return speaker?.displayName?.trim() || label
}

interface Props {
  meetingId: string
}

// Transcript ao vivo: carrega os segmentos persistidos e faz merge incremental
// dos que chegam pelo stream do sidecar. Resolve label→pessoa via meeting_speakers
// (diarização): mostra o display_name no lugar do SPEAKER_0X, marca "(você)" pro
// is_local_user, e permite renomear inline (persistido em display_name).
export function LiveTranscriptPanel({ meetingId }: Props) {
  const [segments, setSegments] = useState<MeetingSegment[]>([])
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([])
  // Label em edição (rename inline) + valor do input.
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  // Mapa label→speaker pra lookup O(1) na renderização dos segments.
  const speakerByLabel = useMemo(() => {
    const map = new Map<string, MeetingSpeaker>()
    for (const sp of speakers) map.set(sp.label, sp)
    return map
  }, [speakers])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [loadedSegs, loadedSpeakers] = await Promise.all([
        meetingsApi.listSegments(meetingId),
        meetingsApi.listSpeakers(meetingId),
      ])
      if (!alive) return
      setSegments(loadedSegs)
      setSpeakers(loadedSpeakers)
    })()

    const offSeg = meetingsApi.onTranscriptSegment((segment) => {
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

    // Diarização ao vivo + rename: upsert do speaker no mapa local.
    const offSpeaker = meetingsApi.onSpeaker((speaker) => {
      if (speaker.meetingId !== meetingId) return
      setSpeakers((prev) => {
        const idx = prev.findIndex((s) => s.label === speaker.label)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = speaker
          return next
        }
        return [...prev, speaker]
      })
    })

    return () => {
      alive = false
      offSeg()
      offSpeaker()
    }
  }, [meetingId])

  // Sair do modo de edição quando troca de reunião.
  useEffect(() => {
    setEditingLabel(null)
    setDraftName('')
  }, [meetingId])

  function startEdit(label: string) {
    const current = speakerByLabel.get(label)
    setEditingLabel(label)
    setDraftName(current?.displayName ?? '')
  }

  async function commitEdit() {
    const label = editingLabel
    if (!label) return
    const name = draftName.trim()
    setEditingLabel(null)
    setDraftName('')
    if (!name) return
    // Otimismo leve: o onSpeaker do broadcast reconcilia o estado real.
    await meetingsApi.setSpeakerName({ meetingId, label, displayName: name })
  }

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--color-text-dim)]">
        O transcript ao vivo aparece aqui durante a gravação.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {segments.map((segment) => {
        const label = segment.speakerLabel
        const speaker = label ? speakerByLabel.get(label) : undefined
        const isEditing = label != null && editingLabel === label
        return (
          <li key={segment.id} className="text-sm">
            <span className="mr-2 font-mono text-xs text-[var(--color-text-dim)]">
              {formatMs(segment.startMs)}
            </span>
            {label &&
              (isEditing ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => void commitEdit()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitEdit()
                    if (e.key === 'Escape') {
                      setEditingLabel(null)
                      setDraftName('')
                    }
                  }}
                  placeholder={label}
                  className="mr-2 w-32 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 text-xs text-[var(--color-text)] outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(label)}
                  title="Renomear speaker"
                  className="group mr-2 inline-flex items-center gap-1 font-medium text-[var(--color-accent)] hover:underline"
                >
                  {speakerName(speaker, label)}
                  {speaker?.isLocalUser && (
                    <span className="text-[var(--color-text-dim)]">(você)</span>
                  )}
                  <Icon
                    as={Pencil}
                    size={10}
                    className="opacity-0 transition group-hover:opacity-60"
                  />
                </button>
              ))}
            <span
              className={
                segment.isPartial ? 'text-[var(--color-text-dim)] italic' : 'text-[var(--color-text)]'
              }
            >
              {segment.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
