import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

export interface RepoNodeData {
  label: string
  role: string | null
  [key: string]: unknown
}

// Card de repo no canvas de arquitetura. Handles source+target nas laterais
// (esquerda = target, direita = source) pra conexões fluírem da esquerda p/ a
// direita. Só tokens CSS-var — nada hardcoded.
function RepoNodeImpl({ data, selected }: NodeProps) {
  const { label, role } = data as RepoNodeData
  return (
    <div
      className={`flex min-w-[160px] items-center gap-2 rounded-md border px-3 py-2 transition ${
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
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-[var(--color-border)] !bg-[var(--color-accent)]"
      />
    </div>
  )
}

export const RepoNode = memo(RepoNodeImpl)
