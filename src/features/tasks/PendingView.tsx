import { useMemo, useState } from 'react'
import { selectStoppedAutoTasks } from '../../../shared/pending'
import type { Task, TaskLink, TaskPriority } from '../../../shared/types/ipc'
import { TaskRow } from './TaskList'

interface Props {
  tasks: Task[]
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onNavigateLink?: (link: TaskLink) => void
  // Bulk-cancel do nudge "N auto paradas → arquivar" (Onda 3): recebe as tasks
  // paradas e cabe à área persistir (loop de tasks:update pro status cancelled).
  onArchiveStopped?: (stopped: Task[]) => void | Promise<void>
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

// Lista flat (não agrupada): a ordenação prioridade → prazo é o ponto da view,
// e agrupar por status quebraria essa ordem global. O badge de status em cada
// linha supre a informação.
export function PendingView({
  tasks,
  resolveLinkLabel,
  onEdit,
  onDelete,
  onNavigateLink,
  onArchiveStopped,
}: Props) {
  const [now] = useState(() => Date.now())
  const [archiving, setArchiving] = useState(false)

  // Nudge de higiene (Onda 3): auto-tasks paradas há >3d viram ruído (achado-
  // raiz da curadoria — 53 de 130 auto-tasks eram exatamente isso). Sinaliza
  // em vez de arquivar sozinho — decay automático é Onda 4, deferida.
  const stopped = useMemo(() => selectStoppedAutoTasks(tasks, now), [tasks, now])

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

  async function handleArchiveStopped() {
    if (!onArchiveStopped || stopped.length === 0) return
    setArchiving(true)
    try {
      await onArchiveStopped(stopped)
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {onArchiveStopped && stopped.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
          <span>
            <span className="font-semibold tabular-nums">{stopped.length}</span>{' '}
            tarefa{stopped.length === 1 ? '' : 's'} automática{stopped.length === 1 ? '' : 's'}{' '}
            parada{stopped.length === 1 ? '' : 's'} há mais de 3 dias
          </span>
          <button
            type="button"
            onClick={() => void handleArchiveStopped()}
            disabled={archiving}
            className="shrink-0 rounded-md border border-[var(--color-warning)]/60 px-2 py-1 font-medium transition hover:bg-[var(--color-warning)]/20 disabled:opacity-50"
          >
            {archiving ? 'Arquivando…' : `Arquivar ${stopped.length}`}
          </button>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
          Nenhuma pendência.
        </div>
      ) : (
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
      )}
    </div>
  )
}
