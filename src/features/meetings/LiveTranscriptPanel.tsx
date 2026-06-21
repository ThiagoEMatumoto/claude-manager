import { useEffect, useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { meetingsApi } from '@/lib/ipc'
import type {
  MeetingPartialEvent,
  MeetingSegment,
  MeetingSpeaker,
} from '../../../shared/types/ipc'

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

// Linha renderizável: une o segment persistido (final) e o partial (provisório
// das janelas ao vivo). `key` é estável p/ o React; `partial` muda o estilo.
// `editable` só nos finais: o speaker dos partials ainda não foi diarizado (a
// diarização roda no fechamento, sobre a passada final).
interface Line {
  key: string
  startMs: number | null
  speakerLabel: string | null
  text: string
  partial: boolean
  editable: boolean
}

interface Props {
  meetingId: string
}

// Transcript ao vivo: combina os segmentos PERSISTIDOS (finais, via
// onTranscriptSegment) com os PROVISÓRIOS das janelas ao vivo (onTranscriptPartial,
// efêmeros — sem id de banco, reconciliados por idx). Os partials aparecem em
// itálico/dim enquanto a captura roda; ao chegar o transcript final (status
// ready/done) eles são descartados — os finais persistidos os substituem.
// Os finais resolvem label→pessoa via meeting_speakers (diarização do fechamento):
// mostram o display_name no lugar do SPEAKER_0X, marcam "(você)" pro is_local_user
// e permitem renomear inline (persistido em display_name).
export function LiveTranscriptPanel({ meetingId }: Props) {
  const [segments, setSegments] = useState<MeetingSegment[]>([])
  const [speakers, setSpeakers] = useState<MeetingSpeaker[]>([])
  const [partials, setPartials] = useState<Map<number, MeetingPartialEvent>>(new Map())
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
    setPartials(new Map())
    void (async () => {
      const [loadedSegs, loadedSpeakers] = await Promise.all([
        meetingsApi.listSegments(meetingId),
        meetingsApi.listSpeakers(meetingId),
      ])
      if (!alive) return
      setSegments(loadedSegs)
      setSpeakers(loadedSpeakers)
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

    // Diarização (fechamento) + rename: upsert do speaker no mapa local.
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
      offSpeaker()
      offPartial()
      offStatus()
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

  const lines = useMemo<Line[]>(() => {
    // Finais (persistidos): já diarizados → speaker editável (rename inline).
    const finalLines: Line[] = segments.map((s) => ({
      key: s.id,
      startMs: s.startMs,
      speakerLabel: s.speakerLabel,
      text: s.text,
      partial: s.isPartial,
      editable: true,
    }))
    // Partials (janelas ao vivo): ainda sem speaker diarizado → não editáveis.
    const partialLines: Line[] = Array.from(partials.values()).map((p) => ({
      key: `partial-${p.idx}`,
      startMs: p.startMs,
      speakerLabel: p.speakerLabel,
      text: p.text,
      partial: true,
      editable: false,
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
      {lines.map((line) => {
        const label = line.speakerLabel
        const speaker = label ? speakerByLabel.get(label) : undefined
        const isEditing = label != null && line.editable && editingLabel === label
        return (
          <li key={line.key} className="text-sm">
            <span className="mr-2 font-mono text-xs text-[var(--color-text-dim)]">
              {formatMs(line.startMs)}
            </span>
            {label &&
              (line.editable ? (
                isEditing ? (
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
                )
              ) : (
                // Partial ao vivo: label cru, sem rename (ainda não diarizado).
                <span className="mr-2 font-medium text-[var(--color-accent)]">{label}</span>
              ))}
            <span
              className={
                line.partial ? 'text-[var(--color-text-dim)] italic' : 'text-[var(--color-text)]'
              }
            >
              {line.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
