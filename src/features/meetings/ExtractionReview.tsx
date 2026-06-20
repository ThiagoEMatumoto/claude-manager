import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/features/objectives/ObjectiveDialog'
import { PRIORITY_META, PRIORITY_ORDER } from '@/features/tasks/status'
import type {
  Feature,
  MaterializeMeetingTaskInput,
  MeetingExtraction,
  MeetingExtractResult,
  ObjectiveWithProgress,
  TaskLink,
  TaskPriority,
} from '../../../shared/types/ipc'
import { EXTRACTION_KIND_META } from './status'

// Estado editável por item (a extração crua é imutável; isto guarda as edições
// do usuário antes de materializar).
interface ItemDraft {
  include: boolean
  text: string
  priority: '' | TaskPriority
  linkKey: string // 'objective:<id>' | 'feature:<id>' | ''
}

function ts(startMs: number | null): string {
  if (startMs == null || startMs < 0) return ''
  const total = Math.floor(startMs / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function parseLinkKey(key: string): TaskLink | null {
  if (!key) return null
  const [type, id] = key.split(':')
  if ((type === 'objective' || type === 'feature') && id) {
    return { parentType: type, parentId: id }
  }
  return null
}

interface Props {
  meetingId: string
  result: MeetingExtractResult
  objectives: ObjectiveWithProgress[]
  features: Feature[]
  onMaterialize: (input: MaterializeMeetingTaskInput) => Promise<unknown>
}

export function ExtractionReview({
  meetingId,
  result,
  objectives,
  features,
  onMaterialize,
}: Props) {
  const [summary, setSummary] = useState('')
  const [augmentedNotes, setAugmentedNotes] = useState('')
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({})
  const [materializing, setMaterializing] = useState(false)

  // Itens já materializados (via materializedTaskId) somem do fluxo de seleção.
  const pending = useMemo(
    () => result.extractions.filter((e) => !e.materializedTaskId),
    [result.extractions],
  )

  useEffect(() => {
    setSummary(result.summary ?? '')
    setAugmentedNotes(result.augmentedNotes ?? '')
    const next: Record<string, ItemDraft> = {}
    for (const ex of result.extractions) {
      next[ex.id] = {
        // Itens não-grounded (suspeitos) NÃO vêm pré-selecionados.
        include: ex.grounded,
        text: ex.text,
        priority: '',
        linkKey: '',
      }
    }
    setDrafts(next)
  }, [result])

  function patch(id: string, p: Partial<ItemDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }

  async function materializeOne(ex: MeetingExtraction, draft: ItemDraft) {
    await onMaterialize({
      extractionId: ex.id,
      title: draft.text.trim() || ex.text,
      priority: draft.priority || null,
      link: parseLinkKey(draft.linkKey),
      quote: ex.quote,
      speakerLabel: ex.speakerLabel,
      startMs: ex.startMs,
    })
  }

  async function handleMaterializeSelected() {
    if (materializing) return
    const selected = pending.filter((ex) => drafts[ex.id]?.include)
    if (selected.length === 0) return
    setMaterializing(true)
    try {
      for (const ex of selected) {
        const draft = drafts[ex.id]
        if (draft) await materializeOne(ex, draft)
      }
    } finally {
      setMaterializing(false)
    }
  }

  const selectedCount = pending.filter((ex) => drafts[ex.id]?.include).length

  return (
    <div className="flex h-full min-h-0 flex-col" data-meeting-id={meetingId}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Esquerda: notas aumentadas + resumo (editáveis) */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-r border-[var(--color-border)] p-5">
          <Textarea
            label="Resumo"
            value={summary}
            onChange={setSummary}
            placeholder="Resumo da reunião…"
          />
          <div className="w-full">
            <label className="mb-1 block text-xs text-[var(--color-text-dim)]">
              Notas aumentadas
            </label>
            <textarea
              value={augmentedNotes}
              onChange={(e) => setAugmentedNotes(e.target.value)}
              placeholder="Notas enriquecidas…"
              className="h-72 w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* Direita: cards de itens */}
        <div className="flex w-[26rem] shrink-0 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <span className="text-sm font-medium text-[var(--color-text)]">
              Itens ({pending.length})
            </span>
            <Button
              onClick={() => void handleMaterializeSelected()}
              disabled={selectedCount === 0}
              loading={materializing}
            >
              Materializar ({selectedCount})
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {result.extractions.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-dim)]">
                Nenhum item extraído.
              </div>
            ) : (
              result.extractions.map((ex) => {
                const draft = drafts[ex.id]
                if (!draft) return null
                const kind = EXTRACTION_KIND_META[ex.type]
                const materialized = Boolean(ex.materializedTaskId)
                return (
                  <div
                    key={ex.id}
                    className={`rounded-lg border p-3 ${
                      ex.grounded
                        ? 'border-[var(--color-border)]'
                        : 'border-[var(--color-warning)]/60 bg-[var(--color-warning)]/5'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ color: kind.color, border: `1px solid ${kind.color}` }}
                      >
                        {kind.label}
                      </span>
                      {materialized ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">
                          <Icon as={Check} size={12} /> virou task
                        </span>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)]">
                          <input
                            type="checkbox"
                            checked={draft.include}
                            onChange={(e) => patch(ex.id, { include: e.target.checked })}
                          />
                          incluir
                        </label>
                      )}
                    </div>

                    <textarea
                      value={draft.text}
                      onChange={(e) => patch(ex.id, { text: e.target.value })}
                      disabled={materialized}
                      rows={2}
                      className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
                    />

                    {ex.quote && (
                      <div className="mt-2 border-l-2 border-[var(--color-border)] pl-2 text-[11px] italic text-[var(--color-text-dim)]">
                        “{ex.quote}”
                        <div className="mt-0.5 not-italic">
                          {[ex.speakerLabel, ts(ex.startMs)].filter(Boolean).join(' @ ')}
                        </div>
                      </div>
                    )}

                    {!ex.grounded && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--color-warning)]">
                        <Icon as={AlertTriangle} size={12} /> citação não encontrada no transcript —
                        revise
                      </div>
                    )}

                    {!materialized && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Select
                          label="Prioridade"
                          value={draft.priority}
                          onChange={(v) => patch(ex.id, { priority: v as '' | TaskPriority })}
                        >
                          <option value="">—</option>
                          {PRIORITY_ORDER.map((p) => (
                            <option key={p} value={p}>
                              {PRIORITY_META[p].label}
                            </option>
                          ))}
                        </Select>
                        <Select
                          label="Vínculo"
                          value={draft.linkKey}
                          onChange={(v) => patch(ex.id, { linkKey: v })}
                        >
                          <option value="">— sem vínculo</option>
                          <optgroup label="Objetivos">
                            {objectives.map((o) => (
                              <option key={o.id} value={`objective:${o.id}`}>
                                {o.title}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Features">
                            {features.map((f) => (
                              <option key={f.id} value={`feature:${f.id}`}>
                                {f.title}
                              </option>
                            ))}
                          </optgroup>
                        </Select>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
