import { useMemo } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Input'
import type {
  Feature,
  ObjectiveWithProgress,
  Task,
  TaskPriority,
  TaskStatus,
} from '../../../shared/types/ipc'
import { PRIORITY_META, PRIORITY_ORDER, TASK_STATUS_META, TASK_STATUS_ORDER } from './status'

export type StatusFilter = 'all' | TaskStatus
export type PriorityFilter = 'all' | TaskPriority

interface Props {
  // Já filtradas por status/prioridade (filtro do store); query/tags são
  // aplicados na área (em memória) — aqui só derivamos as tags disponíveis.
  tasks: Task[]
  loading: boolean
  query: string
  statusFilter: StatusFilter
  priorityFilter: PriorityFilter
  selectedTags: string[]
  // Objetivo/feature pra popular o select de vínculo; '' = todos (Onda 2).
  objectives: ObjectiveWithProgress[]
  features: Feature[]
  linkFilter: string
  onQuery: (q: string) => void
  onStatusFilter: (s: StatusFilter) => void
  onPriorityFilter: (p: PriorityFilter) => void
  onLinkFilter: (id: string) => void
  onToggleTag: (tag: string) => void
  onReload: () => void
  onNew: () => void
}

function Pill({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] transition ${
        active
          ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
          : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
      }`}
    >
      {label}
    </button>
  )
}

export function TasksSidebar({
  tasks,
  loading,
  query,
  statusFilter,
  priorityFilter,
  selectedTags,
  objectives,
  features,
  linkFilter,
  onQuery,
  onStatusFilter,
  onPriorityFilter,
  onLinkFilter,
  onToggleTag,
  onReload,
  onNew,
}: Props) {
  // Tags disponíveis derivam da lista corrente (status/prioridade já aplicados).
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) for (const tag of t.tags) set.add(tag)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [tasks])

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="text-sm font-semibold tracking-tight">Tarefas</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNew}
            title="Nova tarefa"
            className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-black transition hover:opacity-90"
          >
            <Icon as={Plus} size={13} />
            Nova
          </button>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            title="Atualizar"
            className="flex items-center justify-center rounded-md bg-[var(--color-surface-2)] p-1.5 text-[var(--color-text)] transition hover:opacity-90 disabled:opacity-50"
          >
            <Icon as={RefreshCw} size={13} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2.5">
        <Input
          placeholder="Buscar por título…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <Pill
            active={statusFilter === 'all'}
            label="Todas"
            onClick={() => onStatusFilter('all')}
          />
          {TASK_STATUS_ORDER.map((s) => (
            <Pill
              key={s}
              active={statusFilter === s}
              label={TASK_STATUS_META[s].label}
              onClick={() => onStatusFilter(s)}
            />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Pill
            active={priorityFilter === 'all'}
            label="Qualquer prioridade"
            onClick={() => onPriorityFilter('all')}
          />
          {PRIORITY_ORDER.map((p) => (
            <Pill
              key={p}
              active={priorityFilter === p}
              label={PRIORITY_META[p].label}
              onClick={() => onPriorityFilter(p)}
            />
          ))}
        </div>
        {(objectives.length > 0 || features.length > 0) && (
          <select
            value={linkFilter}
            onChange={(e) => onLinkFilter(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">Objetivo/Feature — todos</option>
            {objectives.length > 0 && (
              <optgroup label="Objetivos">
                {objectives.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </optgroup>
            )}
            {features.length > 0 && (
              <optgroup label="Features">
                {features.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        {allTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const on = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                  }`}
                >
                  #{tag}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-[var(--color-text-dim)]">
        {tasks.length === 0
          ? 'Nenhuma tarefa.'
          : `${tasks.length} tarefa${tasks.length === 1 ? '' : 's'} no filtro atual.`}
      </div>
    </aside>
  )
}
