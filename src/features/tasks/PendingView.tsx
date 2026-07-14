import { useMemo } from 'react'
import type { Task, TaskLink, TaskPriority } from '../../../shared/types/ipc'
import { TaskRow } from './TaskList'

interface Props {
  tasks: Task[]
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onNavigateLink?: (link: TaskLink) => void
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

// Lista flat (não agrupada): a ordenação prioridade → prazo é o ponto da view,
// e agrupar por status quebraria essa ordem global. O badge de status em cada
// linha supre a informação.
export function PendingView({ tasks, resolveLinkLabel, onEdit, onDelete, onNavigateLink }: Props) {
  const pending = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'todo' || t.status === 'in_progress' || t.status === 'blocked')
      .slice()
      .sort((a, b) => {
        // Prioridade: high > medium > low > null.
        const pa = a.priority ? PRIORITY_RANK[a.priority] : 3
        const pb = b.priority ? PRIORITY_RANK[b.priority] : 3
        if (pa !== pb) return pa - pb
        // Due date asc; null por último.
        const da = a.dueDate ?? Number.POSITIVE_INFINITY
        const db = b.dueDate ?? Number.POSITIVE_INFINITY
        if (da !== db) return da - db
        return a.position - b.position
      })
  }, [tasks])

  if (pending.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhuma pendência.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {pending.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          resolveLinkLabel={resolveLinkLabel}
          onEdit={onEdit}
          onDelete={onDelete}
          onNavigateLink={onNavigateLink}
        />
      ))}
    </ul>
  )
}
