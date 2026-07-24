import { Pencil, Trash2 } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { Task, TaskLink, TaskPriority, TaskStatus } from '../../../shared/types/ipc'
import { PARENT_TYPE_META, PRIORITY_META, TASK_STATUS_META } from './status'

// Vencida = tem due date no passado e ainda não foi finalizada.
export function isOverdue(task: Task): boolean {
  return (
    task.dueDate != null &&
    task.dueDate < Date.now() &&
    task.status !== 'done' &&
    task.status !== 'cancelled'
  )
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR')
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        color: meta.color,
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = PRIORITY_META[priority]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        color: meta.color,
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  )
}

export function DueDateBadge({ task }: { task: Task }) {
  if (task.dueDate == null) return null
  const overdue = isOverdue(task)
  const color = overdue ? 'var(--color-danger)' : 'var(--color-text-dim)'
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] tabular-nums"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
      title={overdue ? 'Vencida' : 'Prazo'}
    >
      {overdue ? '⚠ ' : ''}
      {formatDate(task.dueDate)}
    </span>
  )
}

// Chips dos vínculos da tarefa (pai: objetivo/KR/feature). onNavigate é
// opcional: quando ausente (ex. dentro de um dialog de edição), o chip fica
// só informativo — evita navegar pra longe no meio de um fluxo de edição.
export function LinkChips({
  links,
  resolveLinkLabel,
  onNavigate,
}: {
  links: TaskLink[]
  resolveLinkLabel: (link: TaskLink) => string
  onNavigate?: (link: TaskLink) => void
}) {
  if (links.length === 0) return null
  return (
    <>
      {links.map((link) => {
        const label = `${PARENT_TYPE_META[link.parentType].label}: ${resolveLinkLabel(link)}`
        const chipClass =
          'inline-flex max-w-48 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]'
        if (!onNavigate) {
          return (
            <span key={`${link.parentType}:${link.parentId}`} className={chipClass} title={label}>
              <span className="shrink-0 font-medium text-[var(--color-accent)]">
                {PARENT_TYPE_META[link.parentType].label}
              </span>
              <span className="truncate">{resolveLinkLabel(link)}</span>
            </span>
          )
        }
        return (
          <button
            key={`${link.parentType}:${link.parentId}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(link)
            }}
            className={`${chipClass} transition hover:text-[var(--color-text)]`}
            title={label}
          >
            <span className="shrink-0 font-medium text-[var(--color-accent)]">
              {PARENT_TYPE_META[link.parentType].label}
            </span>
            <span className="truncate">{resolveLinkLabel(link)}</span>
          </button>
        )
      })}
    </>
  )
}

interface RowProps {
  task: Task
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onNavigateLink?: (link: TaskLink) => void
  // Pendências mostra o status como badge na linha; a lista padrão também.
  showStatus?: boolean
}

export function TaskRow({
  task,
  resolveLinkLabel,
  onEdit,
  onDelete,
  onNavigateLink,
  showStatus = true,
}: RowProps) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEdit(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEdit(task)
        }}
        className="group w-full cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition hover:bg-[var(--color-surface-2)]/60"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--color-text)]">
              {task.title}
            </div>
            {task.description && (
              <div className="mt-0.5 line-clamp-2 text-xs text-[var(--color-text-dim)]">
                {task.description}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {task.priority && <PriorityBadge priority={task.priority} />}
            {showStatus && <TaskStatusBadge status={task.status} />}
            <button
              type="button"
              title="Editar tarefa"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(task)
              }}
              className="rounded p-1 text-[var(--color-text-dim)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-text)]"
            >
              <Icon as={Pencil} size={13} />
            </button>
            <button
              type="button"
              title="Excluir tarefa"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(task)
              }}
              className="rounded p-1 text-[var(--color-text-dim)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-danger)]"
            >
              <Icon as={Trash2} size={13} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DueDateBadge task={task} />
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
            >
              #{tag}
            </span>
          ))}
          <LinkChips links={task.links} resolveLinkLabel={resolveLinkLabel} onNavigate={onNavigateLink} />
        </div>
      </div>
    </li>
  )
}

interface Props {
  tasks: Task[]
  resolveLinkLabel: (link: TaskLink) => string
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onNavigateLink?: (link: TaskLink) => void
}

export function TaskList({ tasks, resolveLinkLabel, onEdit, onDelete, onNavigateLink }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">
        Nenhuma tarefa corresponde ao filtro.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => (
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
