import { navigateToObjective } from '@/lib/nav'
import { selectActiveObjectives } from '../../../shared/home-selectors'
import type { OverviewObjectiveNode } from '../../../shared/types/ipc'
import { CardDot, CardEmpty, HomeCard } from './HomeGrid'

// Card "Objetivos ativos": raízes active com a barra de progresso do rollup
// (gradiente da marca, design Pitwall). Clique = mesma navegação do TreeNode.
export function ObjectivesCard({ nodes }: { nodes: OverviewObjectiveNode[] }) {
  const active = selectActiveObjectives(nodes)

  return (
    <HomeCard title="Objetivos ativos" count={active.length} dot={<CardDot color="var(--color-accent)" />}>
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

function ObjectiveRow({ node }: { node: OverviewObjectiveNode }) {
  const pct = node.progress === null ? null : Math.min(100, Math.max(0, node.progress))
  return (
    <li>
      <button
        type="button"
        onClick={() => navigateToObjective(node.objective.id)}
        className="flex w-full items-center gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2.5 text-left transition hover:bg-[var(--color-surface-2)]/60"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]">
          {node.objective.title}
        </span>
        <span className="h-[5px] w-[110px] shrink-0 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${pct ?? 0}%`,
              background: 'linear-gradient(90deg, var(--color-accent2), var(--color-accent))',
            }}
          />
        </span>
        <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--color-text-dim)]">
          {pct === null ? '—' : `${Math.round(pct)}%`}
        </span>
      </button>
    </li>
  )
}
