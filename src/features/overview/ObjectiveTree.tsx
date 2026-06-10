import type { OverviewObjectiveNode } from '../../../shared/types/ipc'
import { TreeNode } from './TreeNode'

// Árvore hierárquica do dashboard: raízes (objetivos sem pai) expandidas por
// default; cada nó expande KRs → tarefas/features, tarefas diretas, features
// vinculadas e sub-objetivos recursivos.
export function ObjectiveTree({ nodes }: { nodes: OverviewObjectiveNode[] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
        Objetivos
      </h2>
      {nodes.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-8 text-center text-sm text-[var(--color-text-dim)]">
          Nenhum objetivo por aqui ainda.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {nodes.map((n) => (
            <TreeNode key={n.objective.id} node={n} defaultExpanded />
          ))}
        </ul>
      )}
    </section>
  )
}
