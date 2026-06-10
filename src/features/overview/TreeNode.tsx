import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useAppStore } from '@/store/appStore'
import { useObjectivesStore } from '@/store/objectivesStore'
import type {
  OverviewFeatureSummary,
  OverviewKeyResultNode,
  OverviewObjectiveNode,
  OverviewTaskSummary,
} from '../../../shared/types/ipc'
import { ProgressBar } from '@/features/objectives/ProgressBar'
import { KIND_META, STATUS_META } from '@/features/objectives/status'
import { STATUS_META as FEATURE_STATUS_META } from '@/features/features/status'
import { PriorityBadge, TaskStatusBadge } from '@/features/tasks/TaskList'

// Clicar no título de um objetivo leva pra área de Objetivos com ele
// selecionado (select carrega o detail; setArea troca a view).
function navigateToObjective(id: string): void {
  void useObjectivesStore.getState().select(id)
  useAppStore.getState().setArea('objectives')
}

function fmtProgress(progress: number | null): string {
  return progress === null ? '—' : `${Math.round(progress)}%`
}

function TaskLine({ task }: { task: OverviewTaskSummary }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <TaskStatusBadge status={task.status} />
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">{task.title}</span>
      {task.priority && <PriorityBadge priority={task.priority} />}
      {task.dueDate !== null && (
        <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-dim)]">
          {new Date(task.dueDate).toLocaleDateString('pt-BR')}
        </span>
      )}
    </div>
  )
}

function FeatureLine({ feature }: { feature: OverviewFeatureSummary }) {
  const meta = FEATURE_STATUS_META[feature.status]
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium"
        style={{ color: meta.color }}
        title={meta.label}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
        feature
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">
        {feature.title}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-dim)]">
        {fmtProgress(feature.progress)}
      </span>
    </div>
  )
}

function KrNode({ node }: { node: OverviewKeyResultNode }) {
  const { keyResult } = node
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
          KR
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text)]">
          {keyResult.title}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-text-dim)]">
          peso {keyResult.weight ?? 1}
        </span>
        <ProgressBar value={node.progress} className="w-36 shrink-0" />
      </div>
      {(node.tasks.length > 0 || node.linkedFeatures.length > 0) && (
        <div className="ml-1 mt-1.5 flex flex-col border-l border-[var(--color-border)] pl-3">
          {node.tasks.map((t) => (
            <TaskLine key={t.id} task={t} />
          ))}
          {node.linkedFeatures.map((f) => (
            <FeatureLine key={f.id} feature={f} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  node: OverviewObjectiveNode
  // Raízes vêm expandidas por default; sub-objetivos começam recolhidos.
  defaultExpanded?: boolean
}

export function TreeNode({ node, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { objective } = node
  const statusMeta = STATUS_META[objective.status]
  const kindMeta = KIND_META[objective.kind]
  const hasChildren =
    node.keyResults.length > 0 ||
    node.directTasks.length > 0 ||
    node.linkedFeatures.length > 0 ||
    node.children.length > 0

  return (
    <li className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Recolher' : 'Expandir'}
          disabled={!hasChildren}
          className={`shrink-0 rounded p-0.5 text-[var(--color-text-dim)] transition ${
            hasChildren ? 'hover:text-[var(--color-text)]' : 'opacity-30'
          }`}
        >
          <Icon
            as={ChevronRight}
            size={14}
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        <span
          className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium"
          style={{ color: kindMeta.color }}
        >
          {kindMeta.label}
        </span>
        <button
          type="button"
          onClick={() => navigateToObjective(objective.id)}
          title="Abrir em Objetivos"
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--color-text)] transition hover:text-[var(--color-accent)]"
        >
          {objective.title}
        </button>
        <span className="shrink-0 text-[10px]" style={{ color: statusMeta.color }}>
          {statusMeta.label}
        </span>
        <ProgressBar value={node.progress} className="w-36 shrink-0" />
      </div>

      {expanded && hasChildren && (
        <div className="ml-1.5 mt-2 flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-4">
          {node.keyResults.map((kr) => (
            <KrNode key={kr.keyResult.id} node={kr} />
          ))}
          {node.directTasks.map((t) => (
            <TaskLine key={t.id} task={t} />
          ))}
          {node.linkedFeatures.map((f) => (
            <FeatureLine key={f.id} feature={f} />
          ))}
          {node.children.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {node.children.map((c) => (
                <TreeNode key={c.objective.id} node={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
