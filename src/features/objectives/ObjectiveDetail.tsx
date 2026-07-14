import { useEffect, useState } from 'react'
import { Archive, ArrowLeft, Pencil, Plus } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { KeyResult, ObjectiveDetail as ObjectiveDetailType } from '../../../shared/types/ipc'
import { DIRECTION_LABEL, PRIORITY_LABEL, PROGRESS_MODE_LABEL } from './status'
import { KindBadge, StatusBadge } from './ObjectiveList'
import { StatusBadge as FeatureStatusBadge } from '../features/FeatureList'
import { KeyResultRow } from './KeyResultRow'
import { ProgressBar } from './ProgressBar'

type KrWithProgress = KeyResult & { progress: number | null }

interface Props {
  detail: ObjectiveDetailType | null
  loading: boolean
  onBack: () => void
  onEdit: () => void
  onArchive: () => void
  onNewKr: () => void
  onEditKr: (kr: KrWithProgress) => void
  onDeleteKr: (id: string) => void
  onManualProgress: (value: number) => void
}

function fmtDate(ts: number | null): string | null {
  if (!ts) return null
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// Slider de progresso manual: estado local durante o drag, commit no release —
// evita uma mutação IPC (+ broadcast) por tick de arraste.
function ManualProgress({
  value,
  onCommit,
}: {
  value: number | null
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(value ?? 0)
  useEffect(() => {
    setDraft(value ?? 0)
  }, [value])

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => onCommit(draft)}
        onKeyUp={() => onCommit(draft)}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-[var(--color-text)]">
        {Math.round(draft)}%
      </span>
    </div>
  )
}

// Legenda do rollup automático: com KRs o progresso vem SÓ deles — features
// linkadas direto ficam fora do número mesmo existindo (achado-raiz da
// curadoria: linkar features a um objetivo com KRs não move o %). Sem KRs, o
// progresso vem das features vinculadas + tarefas diretas (espelha
// objectiveProgress no main).
function rollupLegend(detail: ObjectiveDetailType): string {
  if (detail.keyResults.length > 0 && detail.linkedFeatures.length > 0) {
    return `Progresso vem só dos ${detail.keyResults.length} key result(s) — as ${detail.linkedFeatures.length} feature(s) abaixo não entram neste número.`
  }
  if (detail.keyResults.length > 0) {
    return `Média ponderada de ${detail.keyResults.length} key result(s).`
  }
  if (detail.linkedFeatures.length > 0) {
    return `Rollup de ${detail.linkedFeatures.length} feature(s) vinculada(s) e tarefas diretas.`
  }
  return 'Sem key results — progresso indeterminado.'
}

function MetricField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--color-bg)] px-3 py-2">
      <div className="text-[10px] text-[var(--color-text-dim)]">{label}</div>
      <div className="text-sm tabular-nums text-[var(--color-text)]">{value}</div>
    </div>
  )
}

export function ObjectiveDetail({
  detail,
  loading,
  onBack,
  onEdit,
  onArchive,
  onNewKr,
  onEditKr,
  onDeleteKr,
  onManualProgress,
}: Props) {
  if (!detail) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-sm text-[var(--color-text-dim)]">
        {loading ? 'Carregando…' : 'Selecione um objetivo para ver os detalhes.'}
      </div>
    )
  }

  const start = fmtDate(detail.startDate)
  const end = fmtDate(detail.endDate)
  const completed = fmtDate(detail.completedAt)
  const fmtNum = (n: number | null) =>
    n === null ? '—' : `${n}${detail.unit ? ` ${detail.unit}` : ''}`

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <button
              type="button"
              onClick={onBack}
              title="Voltar para a lista"
              className="mt-0.5 shrink-0 rounded-md p-1 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <Icon as={ArrowLeft} size={15} />
            </button>
            <h1 className="text-lg font-semibold text-[var(--color-text)]">{detail.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              title="Editar objetivo"
              className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
            >
              <Icon as={Pencil} size={13} />
              Editar
            </button>
            {detail.status !== 'archived' && (
              <button
                type="button"
                onClick={onArchive}
                title="Arquivar objetivo"
                className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                <Icon as={Archive} size={13} />
                Arquivar
              </button>
            )}
          </div>
        </div>

        {detail.description && (
          <p className="mt-2 text-sm text-[var(--color-text-dim)]">{detail.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <KindBadge kind={detail.kind} />
          <StatusBadge status={detail.status} />
          {detail.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
            >
              #{tag}
            </span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-dim)]">
          {detail.period && <span>período: {detail.period}</span>}
          {start && <span>início: {start}</span>}
          {end && <span>fim: {end}</span>}
          {detail.priority && <span>prioridade: {PRIORITY_LABEL[detail.priority]}</span>}
          {detail.owner && <span>owner: {detail.owner}</span>}
          {completed && <span>concluído: {completed}</span>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Progresso</h2>
            <span className="text-[10px] text-[var(--color-text-dim)]">
              {PROGRESS_MODE_LABEL[detail.progressMode]}
            </span>
          </div>

          <ProgressBar value={detail.progress} />

          {detail.progressMode === 'metric' && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricField label="baseline" value={fmtNum(detail.baseline)} />
              <MetricField label="atual" value={fmtNum(detail.current)} />
              <MetricField label="alvo" value={fmtNum(detail.target)} />
              <MetricField
                label="direção"
                value={detail.direction ? DIRECTION_LABEL[detail.direction] : '—'}
              />
            </div>
          )}

          {detail.progressMode === 'manual' && (
            <div className="mt-3">
              <ManualProgress value={detail.progressManual} onCommit={onManualProgress} />
            </div>
          )}

          {detail.progressMode === 'auto_rollup' && (
            <p className="mt-2 text-[10px] text-[var(--color-text-dim)]">{rollupLegend(detail)}</p>
          )}
        </section>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Key Results</h2>
            <button
              type="button"
              onClick={onNewKr}
              className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-black transition hover:opacity-90"
            >
              <Icon as={Plus} size={13} />
              Novo KR
            </button>
          </div>
          {detail.keyResults.length === 0 ? (
            <p className="text-xs text-[var(--color-text-dim)]">Nenhum key result.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.keyResults.map((kr) => (
                <KeyResultRow
                  key={kr.id}
                  kr={kr}
                  linkedFeatures={kr.linkedFeatures}
                  onEdit={() => onEditKr(kr)}
                  onDelete={() => onDeleteKr(kr.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {detail.linkedFeatures.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
              Features{detail.keyResults.length > 0 ? ' (fora do rollup)' : ''}
            </h2>
            <ul className="flex flex-col gap-2">
              {detail.linkedFeatures.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
                      {f.title}
                    </span>
                    <FeatureStatusBadge status={f.status} />
                  </div>
                  <ProgressBar value={f.progress} className="mt-2" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
