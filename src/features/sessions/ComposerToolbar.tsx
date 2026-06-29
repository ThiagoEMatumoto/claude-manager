import { Clock, ShieldCheck } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { SessionActivity } from '../../../shared/types/ipc'
import { ModelPill, type EffortLevel, type ModelAlias } from './ModelPill'
import { EffortPill } from './EffortPill'
import { isPendingEmpty, type PendingSelection } from './model-queue'

interface Props {
  activity: SessionActivity | null
  /** Sessão ociosa — único estado em que é seguro injetar /model | /effort. */
  canSwitch: boolean
  /** Troca enfileirada enquanto a sessão está ocupada. */
  pending: PendingSelection
  onSelectModel: (alias: ModelAlias) => void
  onSelectEffort: (level: EffortLevel) => void
  /** Cicla o modo de permissão (envia Shift+Tab ao PTY). Ausente = sem o controle. */
  onCyclePermission?: () => void
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
      {onCyclePermission && (
        <button
          type="button"
          onClick={onCyclePermission}
          title="Ciclar o modo de permissão — envia Shift+Tab ao Claude (o mesmo atalho do TUI). A CLI não permite definir um modo exato em runtime: este botão só alterna entre os modos; o modo atual aparece no rodapé do Claude."
          className="flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)] transition hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
        >
          <Icon as={ShieldCheck} size={11} className="text-[var(--color-accent)]" />
          <span className="whitespace-nowrap">Permissão ⇧⇥</span>
        </button>
      )}
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
