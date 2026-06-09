import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type {
  CreateObjectiveInput,
  Objective,
  ObjectiveKind,
  ObjectiveStatus,
  ProgressDirection,
  ProgressMode,
  UpdateObjectiveInput,
} from '../../../shared/types/ipc'
import {
  DIRECTION_LABEL,
  KIND_META,
  KIND_ORDER,
  PRIORITY_LABEL,
  PROGRESS_MODE_LABEL,
  STATUS_META,
  STATUS_ORDER,
} from './status'

// ---- helpers de formulário compartilhados com KeyResultDialog ----

export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="w-full">
      <label className="mb-1 block text-xs text-[var(--color-text-dim)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      >
        {children}
      </select>
    </div>
  )
}

export function Textarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="w-full">
      <label className="mb-1 block text-xs text-[var(--color-text-dim)]">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </div>
  )
}

export function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// <input type="date"> trabalha com 'YYYY-MM-DD' local; persistimos epoch ms.
function tsToDateInput(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function dateInputToTs(s: string): number | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

// Campos condicionais ao progress_mode — usados também pelo KeyResultDialog.
export function ProgressModeFields({
  mode,
  progressManual,
  baseline,
  current,
  target,
  unit,
  direction,
  onProgressManual,
  onBaseline,
  onCurrent,
  onTarget,
  onUnit,
  onDirection,
}: {
  mode: ProgressMode
  progressManual: string
  baseline: string
  current: string
  target: string
  unit: string
  direction: '' | ProgressDirection
  onProgressManual: (v: string) => void
  onBaseline: (v: string) => void
  onCurrent: (v: string) => void
  onTarget: (v: string) => void
  onUnit: (v: string) => void
  onDirection: (v: '' | ProgressDirection) => void
}) {
  if (mode === 'manual') {
    return (
      <Input
        label="Progresso manual (0–100)"
        type="number"
        min={0}
        max={100}
        value={progressManual}
        onChange={(e) => onProgressManual(e.target.value)}
        placeholder="Ex: 40"
      />
    )
  }
  if (mode === 'metric') {
    return (
      <>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Baseline"
            type="number"
            value={baseline}
            onChange={(e) => onBaseline(e.target.value)}
          />
          <Input
            label="Atual"
            type="number"
            value={current}
            onChange={(e) => onCurrent(e.target.value)}
          />
          <Input
            label="Alvo"
            type="number"
            value={target}
            onChange={(e) => onTarget(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Unidade"
            value={unit}
            onChange={(e) => onUnit(e.target.value)}
            placeholder="Ex: kg, R$, %"
          />
          <Select
            label="Direção"
            value={direction}
            onChange={(v) => onDirection(v as '' | ProgressDirection)}
          >
            <option value="">—</option>
            {(Object.keys(DIRECTION_LABEL) as ProgressDirection[]).map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABEL[d]}
              </option>
            ))}
          </Select>
        </div>
      </>
    )
  }
  return null
}

// ---- diálogo ----

interface Props {
  open: boolean
  onClose: () => void
  // Presente = edição; ausente = criação.
  objective?: Objective | null
  onCreate: (input: CreateObjectiveInput) => Promise<void>
  onUpdate: (input: UpdateObjectiveInput) => Promise<void>
}

type Priority = 'low' | 'medium' | 'high'

export function ObjectiveDialog({ open, onClose, objective, onCreate, onUpdate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<ObjectiveKind>('okr')
  const [status, setStatus] = useState<ObjectiveStatus>('active')
  const [period, setPeriod] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [priority, setPriority] = useState<'' | Priority>('')
  const [owner, setOwner] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [progressMode, setProgressMode] = useState<ProgressMode>('auto_rollup')
  const [progressManual, setProgressManual] = useState('')
  const [baseline, setBaseline] = useState('')
  const [current, setCurrent] = useState('')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [direction, setDirection] = useState<'' | ProgressDirection>('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle(objective?.title ?? '')
    setDescription(objective?.description ?? '')
    setKind(objective?.kind ?? 'okr')
    setStatus(objective?.status ?? 'active')
    setPeriod(objective?.period ?? '')
    setStartDate(tsToDateInput(objective?.startDate ?? null))
    setEndDate(tsToDateInput(objective?.endDate ?? null))
    setPriority(objective?.priority ?? '')
    setOwner(objective?.owner ?? '')
    setTagsText(objective?.tags.join(', ') ?? '')
    setProgressMode(objective?.progressMode ?? 'auto_rollup')
    setProgressManual(objective?.progressManual != null ? String(objective.progressManual) : '')
    setBaseline(objective?.baseline != null ? String(objective.baseline) : '')
    setCurrent(objective?.current != null ? String(objective.current) : '')
    setTarget(objective?.target != null ? String(objective.target) : '')
    setUnit(objective?.unit ?? '')
    setDirection(objective?.direction ?? '')
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, objective])

  async function handleSubmit() {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        kind,
        status,
        period: period.trim() || null,
        startDate: dateInputToTs(startDate),
        endDate: dateInputToTs(endDate),
        priority: priority || null,
        owner: owner.trim() || null,
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        progressMode,
        progressManual: numOrNull(progressManual),
        baseline: numOrNull(baseline),
        current: numOrNull(current),
        target: numOrNull(target),
        unit: unit.trim() || null,
        direction: direction || null,
      }
      if (objective) {
        await onUpdate({ id: objective.id, ...fields })
      } else {
        await onCreate(fields)
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={objective ? 'Editar objetivo' : 'Novo objetivo'}
      widthClassName="w-[34rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()} loading={submitting}>
            {objective ? 'Salvar' : 'Criar'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input
          ref={titleRef}
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: aumentar autonomia financeira"
        />
        <Textarea
          label="Descrição"
          value={description}
          onChange={setDescription}
          placeholder="Contexto e definição de sucesso…"
        />

        <div className="grid grid-cols-2 gap-3">
          <Select label="Tipo" value={kind} onChange={(v) => setKind(v as ObjectiveKind)}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(v) => setStatus(v as ObjectiveStatus)}>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Período"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="Ex: 2026-Q3"
          />
          <Input
            label="Início"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Fim"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Prioridade"
            value={priority}
            onChange={(v) => setPriority(v as '' | Priority)}
          >
            <option value="">—</option>
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Input
            label="Owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Ex: Thiago"
          />
        </div>

        <Input
          label="Tags (separadas por vírgula)"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Ex: trabalho, saúde"
        />

        <Select
          label="Modo de progresso"
          value={progressMode}
          onChange={(v) => setProgressMode(v as ProgressMode)}
        >
          {(Object.keys(PROGRESS_MODE_LABEL) as ProgressMode[]).map((m) => (
            <option key={m} value={m}>
              {PROGRESS_MODE_LABEL[m]}
            </option>
          ))}
        </Select>

        <ProgressModeFields
          mode={progressMode}
          progressManual={progressManual}
          baseline={baseline}
          current={current}
          target={target}
          unit={unit}
          direction={direction}
          onProgressManual={setProgressManual}
          onBaseline={setBaseline}
          onCurrent={setCurrent}
          onTarget={setTarget}
          onUnit={setUnit}
          onDirection={setDirection}
        />
      </div>
    </Dialog>
  )
}
