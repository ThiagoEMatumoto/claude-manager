import { useAppStore } from '@/store/appStore'
import { useObjectivesStore } from '@/store/objectivesStore'
import { ProgressBar } from '@/features/objectives/ProgressBar'
import { selectActiveObjectives } from '../../../shared/home-selectors'
import type { OverviewObjectiveNode } from '../../../shared/types/ipc'
import { CardEmpty, HomeCard } from './HomeGrid'

// Card "Objetivos ativos": raízes active com a barra de progresso do rollup.
// Clique = mesma navegação do TreeNode (seleciona e vai pra Objetivos).
export function ObjectivesCard({ nodes }: { nodes: OverviewObjectiveNode[] }) {
  const active = selectActiveObjectives(nodes)

  return (
    <HomeCard title="Objetivos ativos" count={active.length}>
      {active.length === 0 ? (
        <CardEmpty>Nenhum objetivo ativo.</CardEmpty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((node) => (
            <ObjectiveRow key={node.objective.id} node={node} />
          ))}
        </ul>
      )}
    </HomeCard>
  )
}

function navigateToObjective(id: string): void {
  void useObjectivesStore.getState().select(id)
  useAppStore.getState().setArea('objectives')
}

function ObjectiveRow({ node }: { node: OverviewObjectiveNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => navigateToObjective(node.objective.id)}
        className="flex w-full items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-2 text-left transition hover:bg-[var(--color-surface-2)]/60"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
          {node.objective.title}
        </span>
        <ProgressBar value={node.progress} className="w-36 shrink-0" />
      </button>
    </li>
  )
}
