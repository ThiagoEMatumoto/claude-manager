import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Mic, Square, Sparkles, AlertTriangle, Search, X } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Lock } from 'lucide-react'
import { Button } from '@/features/brand'
import { useMeetingsStore } from '@/store/meetingsStore'
import { useMeetingPrefsStore } from '@/lib/meeting-prefs-store'
import { objectivesApi, featuresApi, meetingsApi } from '@/lib/ipc'
import type {
  Feature,
  Meeting,
  MeetingActivationDraft,
  ObjectiveWithProgress,
} from '../../../shared/types/ipc'
import { MeetingList } from './MeetingList'
import { MeetingSearchResults } from './MeetingSearchResults'
import { LiveTranscriptPanel } from './LiveTranscriptPanel'
import { ExtractionReview } from './ExtractionReview'
import { SidecarInstaller } from './SidecarInstaller'
import { useMeetings } from './useMeetings'

// status >= ready significa que há transcript fechado pronto pra enriquecer.
const ENRICHABLE: ReadonlySet<Meeting['status']> = new Set(['ready', 'extracted'])

// Estados em que a captura está em curso e o botão "Encerrar" deve aparecer.
const LIVE: ReadonlySet<Meeting['status']> = new Set(['capturing', 'recording'])

const NOTES_SAVE_DEBOUNCE_MS = 600

// Notas iniciais de uma reunião nascida do Google Calendar: link do Meet +
// participantes viram cabeçalho pré-preenchido (o usuário continua editando).
function composeDraftNotes(draft: MeetingActivationDraft): string {
  const lines: string[] = []
  if (draft.meetUrl) lines.push(`Google Meet: ${draft.meetUrl}`)
  if (draft.attendees.length > 0) lines.push(`Participantes: ${draft.attendees.join(', ')}`)
  return lines.join('\n')
}

export function MeetingsArea() {
  useMeetings()
  const meetings = useMeetingsStore((s) => s.meetings)
  const loading = useMeetingsStore((s) => s.loading)
  const createMeeting = useMeetingsStore((s) => s.createMeeting)
  const updateMeeting = useMeetingsStore((s) => s.updateMeeting)
  const deleteMeeting = useMeetingsStore((s) => s.deleteMeeting)
  const startCapture = useMeetingsStore((s) => s.startCapture)
  const stopCapture = useMeetingsStore((s) => s.stopCapture)
  const extract = useMeetingsStore((s) => s.extract)
  const extraction = useMeetingsStore((s) => s.extraction)
  const extractingId = useMeetingsStore((s) => s.extractingId)
  const extractError = useMeetingsStore((s) => s.extractError)
  const clearExtraction = useMeetingsStore((s) => s.clearExtraction)
  const materializeTask = useMeetingsStore((s) => s.materializeTask)
  const sidecarConfigured = useMeetingsStore((s) => s.sidecarConfigured)
  const checkSidecarConfigured = useMeetingsStore((s) => s.checkSidecarConfigured)
  const activationDraft = useMeetingsStore((s) => s.activationDraft)
  const clearActivationDraft = useMeetingsStore((s) => s.clearActivationDraft)
  const searchQuery = useMeetingsStore((s) => s.searchQuery)
  const searchResults = useMeetingsStore((s) => s.searchResults)
  const searching = useMeetingsStore((s) => s.searching)
  const setSearchQuery = useMeetingsStore((s) => s.setSearchQuery)

  const isSearching = searchQuery.trim().length > 0

  const privateMode = useMeetingPrefsStore((s) => s.privateMode)
  const setPrivateMode = useMeetingPrefsStore((s) => s.setPrivateMode)
  const loadMeetingPrefs = useMeetingPrefsStore((s) => s.load)
  useEffect(() => {
    void loadMeetingPrefs()
  }, [loadMeetingPrefs])

  const [objectives, setObjectives] = useState<ObjectiveWithProgress[]>([])
  const [features, setFeatures] = useState<Feature[]>([])

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

  // Contagem de segments da reunião selecionada: usada pra desabilitar "Enriquecer"
  // quando o transcript está vazio (evita o erro genérico "não tem transcript").
  // Carrega ao trocar de reunião e incrementa com os segments que chegam ao vivo.
  const [segmentCount, setSegmentCount] = useState(0)
  useEffect(() => {
    if (!selected) {
      setSegmentCount(0)
      return
    }
    let alive = true
    void meetingsApi.listSegments(selected.id).then((segs) => {
      if (alive) setSegmentCount(segs.length)
    })
    const off = meetingsApi.onTranscriptSegment((segment) => {
      if (segment.meetingId === selected.id) setSegmentCount((n) => n + 1)
    })
    return () => {
      alive = false
      off()
    }
  }, [selected])

  // Objetivos/features pros selects de vínculo da ExtractionReview (mesmo
  // fan-out leve de TasksArea — app pessoal).
  useEffect(() => {
    let alive = true
    void Promise.all([objectivesApi.list(), featuresApi.list()]).then(([objs, feats]) => {
      if (!alive) return
      setObjectives(objs)
      setFeatures(feats)
    })
    return () => {
      alive = false
    }
  }, [])

  // Troca de reunião limpa a revisão da anterior (a extração é por reunião).
  useEffect(() => {
    clearExtraction()
  }, [selectedId, clearExtraction])

  // Consome o draft de ativação por Google Calendar: cria a reunião pré-preenchida
  // (título do evento, participantes + link do Meet nas notas) e a seleciona. O
  // draft é limpo ANTES do await pra que o duplo-mount do StrictMode e o set de
  // `area` não criem 2 reuniões. Botão "Nova" manual segue intacto.
  const consumingDraft = useRef(false)
  useEffect(() => {
    if (!activationDraft || consumingDraft.current) return
    consumingDraft.current = true
    const draft = activationDraft
    clearActivationDraft()
    void (async () => {
      try {
        const created = await createMeeting({
          title: draft.title,
          source: 'calendar',
          rawNotes: composeDraftNotes(draft),
        })
        setSelectedId(created.id)
      } finally {
        consumingDraft.current = false
      }
    })()
  }, [activationDraft, clearActivationDraft, createMeeting])

  const reviewForSelected =
    selected && extraction && extractingId !== selected.id ? extraction : null

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

  async function handleEnrich(meeting: Meeting) {
    await extract(meeting.id)
  }

  return (
    <>
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--color-text)]">Reuniões</span>
          <Button variant="primary" size="sm" onClick={() => void handleNew()} title="Nova reunião">
            <Icon as={Plus} size={13} />
            Nova
          </Button>
        </div>
        <div className="border-b border-[var(--color-border)] px-3 py-2.5">
          <div className="relative">
            <Icon
              as={Search}
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)]"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar nas reuniões…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] py-1.5 pl-8 pr-7 text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-accent)]"
            />
            {isSearching && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Limpar busca"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
              >
                <Icon as={X} size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {isSearching ? (
            <MeetingSearchResults
              matches={searchResults}
              selectedId={selectedId}
              loading={searching}
              onSelect={(id) => setSelectedId(id)}
            />
          ) : loading && meetings.length === 0 ? (
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

      <main className="flex flex-1 flex-col overflow-hidden">
        {sidecarConfigured === false && (
          <div className="flex items-start gap-2 border-b border-[var(--color-warning,#b8860b)]/40 bg-[var(--color-warning,#b8860b)]/10 px-5 py-2.5 text-xs text-[var(--color-text)]">
            <Icon as={AlertTriangle} size={14} className="mt-0.5 shrink-0 text-[var(--color-warning,#b8860b)]" />
            <div className="min-w-0">
              <strong>Sidecar de transcrição não configurado.</strong> A captura usa
              um stub de desenvolvimento (transcript falso). Para transcrição real
              em pt-BR, instale o sidecar com um clique abaixo. Notas e extração
              seguem funcionando normalmente.
              <SidecarInstaller onInstalled={() => void checkSidecarConfigured()} />
            </div>
          </div>
        )}
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
              <h2 className="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">
                {selected.title}
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                {selected.extractor && (
                  <span
                    className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-dim)]"
                    title="Provedor usado na última extração"
                  >
                    {selected.extractor}
                  </span>
                )}
                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
                  title="Modo privado: extrai 100% local via Ollama, sem chamar o processo claude"
                >
                  <input
                    type="checkbox"
                    checked={privateMode}
                    onChange={(e) => void setPrivateMode(e.target.checked)}
                  />
                  <Icon as={Lock} size={12} />
                  Modo privado (local)
                </label>
                {reviewForSelected ? (
                  <Button variant="secondary" size="sm" onClick={clearExtraction}>
                    Voltar às notas
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleEnrich(selected)}
                    disabled={
                      !ENRICHABLE.has(selected.status) ||
                      segmentCount === 0 ||
                      extractingId === selected.id
                    }
                    title={
                      !ENRICHABLE.has(selected.status)
                        ? 'Disponível quando a reunião estiver pronta (transcrita)'
                        : segmentCount === 0
                          ? 'Sem transcript: grave ou importe áudio antes de enriquecer'
                          : 'Enriquecer notas e extrair itens'
                    }
                  >
                    <Icon as={Sparkles} size={12} />
                    {extractingId === selected.id ? 'Enriquecendo…' : 'Enriquecer'}
                  </Button>
                )}
                {LIVE.has(selected.status) ? (
                  <Button
                    variant="danger"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void stopCapture(selected.id)}
                  >
                    <Icon as={Square} size={12} />
                    Encerrar
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void startCapture(selected.id)}
                    disabled={selected.status !== 'idle'}
                  >
                    <Icon as={Mic} size={12} />
                    Iniciar
                  </Button>
                )}
              </div>
            </div>

            {extractError && extractingId !== selected.id && !reviewForSelected && (
              <div className="border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-5 py-2 text-xs text-[var(--color-danger)]">
                Falha ao enriquecer: {extractError}
              </div>
            )}

            {reviewForSelected ? (
              <div className="min-h-0 flex-1">
                <ExtractionReview
                  meetingId={selected.id}
                  result={reviewForSelected}
                  objectives={objectives}
                  features={features}
                  onMaterialize={materializeTask}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <section className="flex min-w-0 flex-1 flex-col border-r border-[var(--color-border)]">
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
              </div>
            )}
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
