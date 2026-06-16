import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useAppStore } from '@/store/appStore'
import type { HandoffStatus } from '../../../shared/types/ipc'

export interface RepoNodeData {
  label: string
  role: string | null
  // Trilha de handoff: nº de handoffs em que este repo foi alvo + status do mais
  // recente. Ausente/0 = sem badge.
  handoffCount?: number
  handoffLatestStatus?: HandoffStatus
  [key: string]: unknown
}

// Cor do badge por status do handoff mais recente (só tokens). rejected/failed
// não destacam (sem cor de alerta forte — são finais "negativos" silenciosos).
const HANDOFF_STATUS_COLOR: Partial<Record<HandoffStatus, string>> = {
  pending: 'var(--color-warning)',
  approved: 'var(--color-info)',
  running: 'var(--color-info)',
  done: 'var(--color-success)',
  failed: 'var(--color-danger)',
}

// Card de repo no canvas de arquitetura. Handles source+target nas laterais
// (esquerda = target, direita = source) pra conexões fluírem da esquerda p/ a
// direita. Só tokens CSS-var — nada hardcoded.
function RepoNodeImpl({ data, selected }: NodeProps) {
  const { label, role, handoffCount, handoffLatestStatus } = data as RepoNodeData
  const hasHandoffs = (handoffCount ?? 0) > 0
  const badgeColor =
    (handoffLatestStatus && HANDOFF_STATUS_COLOR[handoffLatestStatus]) ?? 'var(--color-text-dim)'

  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2 rounded-md border px-3 py-2 transition ${
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-[var(--color-border)] !bg-[var(--color-surface-2)]"
      />
      <span className="text-[var(--color-text-dim)]">
        <Icon as={Box} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-[var(--color-text)]">{label}</span>
        {role && (
          <span className="mt-0.5 inline-flex w-fit rounded-sm bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
            {role}
          </span>
        )}
      </div>
      {hasHandoffs && (
        <button
          type="button"
          title={`${handoffCount} handoff(s) — abrir inbox`}
          // nodrag/nopan + stopPropagation: o clique navega ao inbox sem
          // interferir no drag/seleção do react-flow.
          className="nodrag nopan absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[9px] font-semibold leading-none text-[var(--color-bg)] transition hover:brightness-110"
          style={{ backgroundColor: badgeColor, borderColor: badgeColor }}
          onClick={(e) => {
            e.stopPropagation()
            useAppStore.getState().setArea('handoffs')
          }}
        >
          {handoffCount}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-[var(--color-border)] !bg-[var(--color-accent)]"
      />
    </div>
  )
}

export const RepoNode = memo(RepoNodeImpl)
