import { Clock, Loader, OctagonX } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/features/brand'
import type { PermissionMode, SessionActivity } from '../../../shared/types/ipc'
import { ModelPill, type EffortLevel, type ModelAlias } from './ModelPill'
import { EffortPill } from './EffortPill'
import { PermissionPill } from './PermissionPill'
import { isPendingEmpty, type PendingSelection } from './model-queue'
import { usePanelTier } from './use-panel-tier'

interface Props {
  activity: SessionActivity | null
  /** Sessão ociosa — único estado em que é seguro injetar /model | /effort. */
  canSwitch: boolean
  /** Troca enfileirada enquanto a sessão está ocupada. */
  pending: PendingSelection
  /** Nível de esforço ATIVO da sessão (rastreado pelo que foi injetado). */
  activeEffort: EffortLevel | null
  /** Modelo ativo suporta xhigh → habilita 'ultracode' no menu do EffortPill. */
  xhighCapable: boolean
  /** `/effort ultracode` ativo nesta sessão (sobrepõe o nível exibido). */
  ultracodeActive: boolean
  /** Modo de permissão ATIVO, refletido do rodapé da TUI. null = padrão seguro. */
  currentMode: PermissionMode | null
  onSelectModel: (alias: ModelAlias) => void
  onSelectEffort: (level: EffortLevel | 'ultracode') => void
  /** Avança um passo do ciclo de permissão (envia Shift+Tab ao PTY). Ausente = sem o ciclo. */
  onCyclePermission?: () => void
  /** Seleção direta de modo: "pula" até o alvo ciclando Shift+Tab até o modo parseado bater. */
  onSelectPermission?: (mode: PermissionMode) => void
  /** Interrompe o claude (envia Ctrl+C ao PTY). Ausente = sem o botão. */
  onInterrupt?: () => void
}

function pendingLabel(pending: PendingSelection): string {
  const parts: string[] = []
  if (pending.model) parts.push(pending.model)
  if (pending.effort) parts.push(pending.effort)
  if (pending.ultracode) parts.push('ultracode')
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
  activeEffort,
  xhighCapable,
  ultracodeActive,
  currentMode,
  onSelectModel,
  onSelectEffort,
  onCyclePermission,
  onSelectPermission,
  onInterrupt,
}: Props) {
  const hasPending = !isPendingEmpty(pending)
  // Mede a própria largura (escopado ao rodapé, independente do tier do header) —
  // mesmo hook de ResizeObserver usado no SessionHeader.
  const { ref, tier } = usePanelTier<HTMLDivElement>()
  const compact = tier !== 'wide'

  return (
    <div ref={ref} className="flex items-center gap-2 px-1 pb-1">
      <ModelPill
        activity={activity}
        canSwitch={canSwitch}
        pending={pending}
        onSelectModel={onSelectModel}
        compact={compact}
      />
      <EffortPill
        effort={activeEffort}
        pending={pending.effort}
        xhighCapable={xhighCapable}
        ultracodeActive={ultracodeActive}
        onSelect={onSelectEffort}
        canSwitch={canSwitch}
        compact={compact}
      />
      <PermissionPill
        currentMode={currentMode}
        onCycle={onCyclePermission}
        onSelect={onSelectPermission}
        compact={compact}
      />
      {onInterrupt && (
        <Button
          variant="danger"
          size="sm"
          onClick={onInterrupt}
          title="Interromper o claude — envia Ctrl+C ao PTY (o mesmo que digitar Ctrl+C no terminal)."
          className="gap-1 px-2 py-0.5 text-[10px]"
        >
          <Icon as={OctagonX} size={11} />
          <span className="whitespace-nowrap">Interromper</span>
        </Button>
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
