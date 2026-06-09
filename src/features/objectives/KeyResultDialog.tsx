import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import type {
  CreateKeyResultInput,
  KeyResult,
  KeyResultStatus,
  ProgressDirection,
  ProgressMode,
  UpdateKeyResultInput,
} from '../../../shared/types/ipc'
import { KR_STATUS_META, KR_STATUS_ORDER, PROGRESS_MODE_LABEL } from './status'
import { numOrNull, ProgressModeFields, Select } from './ObjectiveDialog'

interface Props {
  open: boolean
  onClose: () => void
  objectiveId: string
  // Presente = edição; ausente = criação.
  kr?: KeyResult | null
  onCreate: (input: CreateKeyResultInput) => Promise<void>
  onUpdate: (input: UpdateKeyResultInput) => Promise<void>
}

export function KeyResultDialog({ open, onClose, objectiveId, kr, onCreate, onUpdate }: Props) {
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('')
  const [status, setStatus] = useState<KeyResultStatus>('active')
  const [weight, setWeight] = useState('')
  const [progressMode, setProgressMode] = useState<ProgressMode>('manual')
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
    setTitle(kr?.title ?? '')
    setOwner(kr?.owner ?? '')
    setStatus(kr?.status ?? 'active')
    setWeight(kr?.weight != null ? String(kr.weight) : '')
    setProgressMode(kr?.progressMode ?? 'manual')
    setProgressManual(kr?.progressManual != null ? String(kr.progressManual) : '')
    setBaseline(kr?.baseline != null ? String(kr.baseline) : '')
    setCurrent(kr?.current != null ? String(kr.current) : '')
    setTarget(kr?.target != null ? String(kr.target) : '')
    setUnit(kr?.unit ?? '')
    setDirection(kr?.direction ?? '')
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, kr])

  async function handleSubmit() {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      const fields = {
        title: title.trim(),
        owner: owner.trim() || null,
        status,
        weight: numOrNull(weight),
        progressMode,
        progressManual: numOrNull(progressManual),
        baseline: numOrNull(baseline),
        current: numOrNull(current),
        target: numOrNull(target),
        unit: unit.trim() || null,
        direction: direction || null,
      }
      if (kr) {
        await onUpdate({ id: kr.id, ...fields })
      } else {
        await onCreate({ objectiveId, ...fields })
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
      title={kr ? 'Editar key result' : 'Novo key result'}
      widthClassName="w-[30rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()} loading={submitting}>
            {kr ? 'Salvar' : 'Criar'}
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
          placeholder="Ex: reduzir custo mensal para R$ X"
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as KeyResultStatus)}
          >
            {KR_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {KR_STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <Input
            label="Peso (default 1)"
            type="number"
            min={0}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="1"
          />
        </div>

        <Input
          label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Ex: Thiago"
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
