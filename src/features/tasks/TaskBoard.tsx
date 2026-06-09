import { useMemo } from 'react'
import type { Task, TaskLink } from '../../../shared/types/ipc'
import { DueDateBadge, LinkChips, PriorityBadge, TaskStatusBadge } from './TaskList'

interface Props {
  tasks: Task[]
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
}

// Colunas do board (modelo: FeatureBoard, estático sem drag&drop). Canceladas
// caem na coluna "Finalizadas" junto de concluídas — o badge de status no card
// distingue as duas, sem uma coluna extra quase sempre vazia.
type ColumnId = 'todo' | 'in_progress' | 'blocked' | 'finished'

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'todo', label: 'A fazer' },
  { id: 'in_progress', label: 'Em andamento' },
  { id: 'blocked', label: 'Bloqueadas' },
  { id: 'finished', label: 'Finalizadas' },
]

function columnOf(task: Task): ColumnId {
  if (task.status === 'done' || task.status === 'cancelled') return 'finished'
  return task.status
}

function TaskCard({
  task,
  resolveLinkLabel,
  onEdit,
}: {
  task: Task
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(task)}
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left transition hover:bg-[var(--color-surface-2)]/60"
      >
        <div className="truncate text-sm font-medium text-[var(--color-text)]">{task.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.priority && <PriorityBadge priority={task.priority} />}
          <TaskStatusBadge status={task.status} />
          <DueDateBadge task={task} />
        </div>
        {(task.tags.length > 0 || task.links.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
              >
                #{tag}
              </span>
            ))}
            <LinkChips links={task.links} resolveLinkLabel={resolveLinkLabel} />
          </div>
        )}
      </button>
    </li>
  )
}

export function TaskBoard({ tasks, resolveLinkLabel, onEdit }: Props) {
  const grouped = useMemo(() => {
    const by: Record<ColumnId, Task[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      finished: [],
    }
    for (const task of tasks) by[columnOf(task)].push(task)
    return by
  }, [tasks])

  return (
    <div className="flex h-full gap-4 overflow-x-auto">
      {COLUMNS.map((col) => {
        const items = grouped[col.id]
        return (
          <section
            key={col.id}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40"
          >
            <header className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-text)]">{col.label}</span>
              <span className="rounded-full bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-dim)]">
                {items.length}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-text-dim)]">
                  Nenhuma tarefa.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      resolveLinkLabel={resolveLinkLabel}
                      onEdit={onEdit}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
