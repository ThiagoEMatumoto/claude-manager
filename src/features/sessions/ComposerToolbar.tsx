import { Clock, Loader, OctagonX } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { SessionActivity } from '../../../shared/types/ipc'
import { ModelPill, type EffortLevel, type ModelAlias } from './ModelPill'
import { EffortPill } from './EffortPill'
import { PermissionPill } from './PermissionPill'
import { isPendingEmpty, type PendingSelection } from './model-queue'

interface Props {
  activity: SessionActivity | null
  /** Sessão ociosa — único estado em que é seguro injetar /model | /effort. */
  canSwitch: boolean
  /** Troca enfileirada enquanto a sessão está ocupada. */
  pending: PendingSelection
  onSelectModel: (alias: ModelAlias) => void
  onSelectEffort: (level: EffortLevel) => void
  /** Avança um passo do ciclo de permissão (envia Shift+Tab ao PTY). Ausente = sem o controle. */
  onCyclePermission?: () => void
  /** Interrompe o claude (envia Ctrl+C ao PTY). Ausente = sem o botão. */
  onInterrupt?: () => void
}

function pendingLabel(pending: PendingSelection): string {
  const parts: string[] = []
  if (pending.model) parts.push(pending.model)
  if (pending.effort) parts.push(pending.effort)
  return parts.join(' · ')
}

// Barra de controles do composer: dois controles distintos (Modelo · Esforço,
// estilo Claude Desktop) + affordance de fila. Os switchers ficam disponíveis
// mesmo com a sessão ocupada — a troca é enfileirada e aplicada no próximo idle
// (sem desabilitar o controle). Slot para o botão de anexar imagem virá à direita.
export function ComposerToolbar({
  activity,
  canSwitch,
  pending,
  onSelectModel,
  onSelectEffort,
  onCyclePermission,
  onInterrupt,
}: Props) {
  const hasPending = !isPendingEmpty(pending)

  return (
    <div className="flex items-center gap-2 px-1 pb-1">
      <ModelPill
        activity={activity}
        canSwitch={canSwitch}
        pending={pending}
        onSelectModel={onSelectModel}
      />
      <EffortPill canSwitch={canSwitch} pending={pending} onSelectEffort={onSelectEffort} />
      {onCyclePermission && <PermissionPill onCycle={onCyclePermission} />}
      {onInterrupt && (
        <button
          type="button"
          onClick={onInterrupt}
          title="Interromper o claude — envia Ctrl+C ao PTY (o mesmo que digitar Ctrl+C no terminal)."
          className="flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)] transition hover:border-[var(--color-danger)]/50 hover:text-[var(--color-danger)]"
        >
          <Icon as={OctagonX} size={11} className="text-[var(--color-danger)]" />
          <span className="whitespace-nowrap">Interromper</span>
        </button>
      )}
      {hasPending &&
        (canSwitch ? (
          // Sessão ficou ociosa com troca pendente: a injeção dispara agora —
          // feedback de "aplicando" em vez de a transição ser tácita.
          <span
            className="flex items-center gap-1 text-[10px] text-[var(--color-accent)]"
            title="A sessão ficou ociosa — aplicando a troca agora"
          >
            <Icon as={Loader} size={11} className="animate-spin" />
            aplicando {pendingLabel(pending)}…
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-dim)]"
            title="A sessão está ocupada — a troca será injetada assim que ela ficar ociosa"
          >
            <Icon as={Clock} size={11} className="text-[var(--color-accent)]" />
            {pendingLabel(pending)} será aplicado quando ociosa
          </span>
        ))}
    </div>
  )
}
