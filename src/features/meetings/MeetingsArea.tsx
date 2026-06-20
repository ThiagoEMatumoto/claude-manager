import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Mic, Square } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useMeetingsStore } from '@/store/meetingsStore'
import type { Meeting } from '../../../shared/types/ipc'
import { MeetingList } from './MeetingList'
import { LiveTranscriptPanel } from './LiveTranscriptPanel'
import { useMeetings } from './useMeetings'

const NOTES_SAVE_DEBOUNCE_MS = 600

export function MeetingsArea() {
  useMeetings()
  const meetings = useMeetingsStore((s) => s.meetings)
  const loading = useMeetingsStore((s) => s.loading)
  const createMeeting = useMeetingsStore((s) => s.createMeeting)
  const updateMeeting = useMeetingsStore((s) => s.updateMeeting)
  const deleteMeeting = useMeetingsStore((s) => s.deleteMeeting)
  const startCapture = useMeetingsStore((s) => s.startCapture)
  const stopCapture = useMeetingsStore((s) => s.stopCapture)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  // Guarda o id cujas notas estão no textarea, pra distinguir troca de seleção
  // (recarrega) de edição (auto-save). Evita salvar as notas de A na reunião B.
  const notesMeetingId = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = useMemo(
    () => meetings.find((m) => m.id === selectedId) ?? null,
    [meetings, selectedId],
  )

  // Seleção inicial/auto: se nada selecionado, pega a primeira; se a selecionada
  // sumiu (delete), limpa.
  useEffect(() => {
    if (selectedId && !meetings.some((m) => m.id === selectedId)) {
      setSelectedId(meetings[0]?.id ?? null)
    } else if (!selectedId && meetings.length > 0) {
      setSelectedId(meetings[0].id)
    }
  }, [meetings, selectedId])

  // Recarrega o textarea quando a reunião selecionada muda (não a cada refresh do
  // store, pra não pisar no que o usuário está digitando).
  useEffect(() => {
    if (selected && selected.id !== notesMeetingId.current) {
      notesMeetingId.current = selected.id
      setNotes(selected.rawNotes ?? '')
    } else if (!selected) {
      notesMeetingId.current = null
      setNotes('')
    }
  }, [selected])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  function onNotesChange(value: string) {
    setNotes(value)
    const id = notesMeetingId.current
    if (!id) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void updateMeeting({ id, rawNotes: value })
    }, NOTES_SAVE_DEBOUNCE_MS)
  }

  async function handleNew() {
    const created = await createMeeting({ title: `Reunião ${new Date().toLocaleString('pt-BR')}` })
    setSelectedId(created.id)
  }

  async function handleDelete(meeting: Meeting) {
    if (!window.confirm(`Excluir "${meeting.title}"?`)) return
    await deleteMeeting(meeting.id)
  }

  return (
    <>
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--color-text)]">Reuniões</span>
          <button
            type="button"
            onClick={() => void handleNew()}
            title="Nova reunião"
            className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs text-[var(--color-bg)] transition hover:opacity-90"
          >
            <Icon as={Plus} size={13} />
            Nova
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading && meetings.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
              Carregando…
            </div>
          ) : (
            <MeetingList
              meetings={meetings}
              selectedId={selectedId}
              onSelect={(m) => setSelectedId(m.id)}
              onDelete={(m) => void handleDelete(m)}
            />
          )}
        </div>
      </aside>

      <main className="flex flex-1 overflow-hidden">
        {selected ? (
          <>
            <section className="flex min-w-0 flex-1 flex-col border-r border-[var(--color-border)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
                <h2 className="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">
                  {selected.title}
                </h2>
                {selected.status === 'capturing' ? (
                  <button
                    type="button"
                    onClick={() => void stopCapture(selected.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-danger)] px-2.5 py-1 text-xs text-[var(--color-danger)] transition hover:bg-[var(--color-danger)]/10"
                  >
                    <Icon as={Square} size={12} />
                    Encerrar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startCapture(selected.id)}
                    disabled={selected.status !== 'idle'}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs text-[var(--color-bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Icon as={Mic} size={12} />
                    Iniciar
                  </button>
                )}
              </div>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Suas notas da reunião…"
                className="flex-1 resize-none bg-transparent px-5 py-4 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
              />
            </section>
            <section className="flex w-96 shrink-0 flex-col">
              <div className="border-b border-[var(--color-border)] px-5 py-3">
                <h3 className="text-sm font-medium text-[var(--color-text)]">Transcript</h3>
              </div>
              <div className="min-h-0 flex-1">
                <LiveTranscriptPanel meetingId={selected.id} />
              </div>
            </section>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-dim)]">
            Crie uma reunião pra começar.
          </div>
        )}
      </main>
    </>
  )
}
