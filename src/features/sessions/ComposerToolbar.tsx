import { Clock } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { SessionActivity } from '../../../shared/types/ipc'
import { ModelPill, type EffortLevel, type ModelAlias } from './ModelPill'
import { isPendingEmpty, type PendingSelection } from './model-queue'

interface Props {
  activity: SessionActivity | null
  /** Sessão ociosa — único estado em que é seguro injetar /model | /effort. */
  canSwitch: boolean
  /** Troca enfileirada enquanto a sessão está ocupada. */
  pending: PendingSelection
  onSelectModel: (alias: ModelAlias) => void
  onSelectEffort: (level: EffortLevel) => void
}

function pendingLabel(pending: PendingSelection): string {
  const parts: string[] = []
  if (pending.model) parts.push(pending.model)
  if (pending.effort) parts.push(pending.effort)
  return parts.join(' · ')
}

// Barra de controles do composer: switcher de modelo/esforço (reusa ModelPill) +
// affordance de fila. O switcher fica disponível mesmo com a sessão ocupada — a
// troca é enfileirada e aplicada no próximo idle (sem desabilitar o controle).
// Slot para o botão de anexar imagem (Fase 4) virá à direita.
export function ComposerToolbar({
  activity,
  canSwitch,
  pending,
  onSelectModel,
  onSelectEffort,
}: Props) {
  const hasPending = !isPendingEmpty(pending)

  return (
    <div className="flex items-center gap-2 px-1 pb-1">
      <ModelPill
        activity={activity}
        canSwitch={canSwitch}
        pending={pending}
        onSelectModel={onSelectModel}
        onSelectEffort={onSelectEffort}
      />
      {hasPending && (
        <span
          className="flex items-center gap-1 text-[10px] text-[var(--color-text-dim)]"
          title="A sessão está ocupada — a troca será injetada assim que ela ficar ociosa"
        >
          <Icon as={Clock} size={11} className="text-[var(--color-accent)]" />
          {pendingLabel(pending)} será aplicado quando ociosa
        </span>
      )}
    </div>
  )
}
