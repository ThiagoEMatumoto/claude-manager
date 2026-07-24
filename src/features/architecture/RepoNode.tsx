import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box, MoreVertical, Hexagon } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { useAppStore } from '@/store/appStore'
import { useArchitectureStore } from '@/store/architectureStore'
import type { HandoffStatus } from '../../../shared/types/ipc'

export interface RepoNodeData {
  id: string
  label: string
  role: string | null
  // Repo "hub": coordena os demais (estilo distinto + ações de hub).
  isHub: boolean
  // Em vista global, identifica o projeto de origem (badge). Ausente em vista
  // de projeto único.
  projectName?: string
  projectColor?: string | null
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
  const {
    id,
    label,
    role,
    isHub,
    projectName,
    projectColor,
    handoffCount,
    handoffLatestStatus,
  } = data as RepoNodeData
  const [menuOpen, setMenuOpen] = useState(false)
  const setRepoHub = useArchitectureStore((s) => s.setRepoHub)
  const connectHubToAll = useArchitectureStore((s) => s.connectHubToAll)

  const hasHandoffs = (handoffCount ?? 0) > 0
  const badgeColor =
    (handoffLatestStatus && HANDOFF_STATUS_COLOR[handoffLatestStatus]) ?? 'var(--color-text-dim)'

  const actions: MenuItem[] = [
    {
      label: isHub ? 'Desmarcar como hub' : 'Marcar como hub',
      onClick: () => void setRepoHub(id, !isHub),
    },
    ...(isHub
      ? [{ label: 'Conectar a todos', onClick: () => void connectHubToAll(id) }]
      : []),
  ]

  // Hub destaca com anel accent; senão segue a borda padrão/seleção.
  const ringClass = isHub
    ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)] bg-[var(--color-surface)]'
    : selected
      ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface)]'

  return (
    <div
      className={`relative flex min-w-[160px] items-center gap-2 rounded-md border px-3 py-2 transition ${ringClass}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-[var(--color-border)] !bg-[var(--color-surface-2)]"
      />
      <span className={isHub ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'}>
        <Icon as={isHub ? Hexagon : Box} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-[var(--color-text)]">{label}</span>
        <div className="mt-0.5 flex items-center gap-1">
          {projectName && (
            <span
              className="inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-[var(--color-text)]"
              style={{
                backgroundColor: projectColor ?? 'var(--color-surface-2)',
                color: projectColor ? 'var(--color-bg)' : 'var(--color-text-dim)',
              }}
              title={`Projeto: ${projectName}`}
            >
              {projectName}
            </span>
          )}
          {role && (
            <span className="inline-flex w-fit rounded-sm bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
              {role}
            </span>
          )}
        </div>
      </div>

      {/* Menu de ações do nó (hub toggle / conectar a todos). nodrag/nopan +
          stopPropagation pra não brigar com o drag/seleção do react-flow. */}
      <div className="nodrag nopan ml-auto" onClick={(e) => e.stopPropagation()}>
        <Menu open={menuOpen} onClose={() => setMenuOpen(false)} items={actions} portal>
          <button
            type="button"
            title="Ações do repo"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <Icon as={MoreVertical} />
          </button>
        </Menu>
      </div>

      {hasHandoffs && (
        <button
          type="button"
          title={`${handoffCount} handoff(s) — abrir inbox`}
          // nodrag/nopan + stopPropagation: o clique navega ao inbox sem
          // interferir no drag/seleção do react-flow.
          className="nodrag nopan absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border px-1 font-mono text-[9px] font-semibold leading-none tabular-nums text-[var(--color-bg)] transition hover:brightness-110"
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
