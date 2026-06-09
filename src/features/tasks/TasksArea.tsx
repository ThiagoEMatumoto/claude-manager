import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Columns3, LayoutList } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { featuresApi, objectivesApi } from '@/lib/ipc'
import { useTasksStore } from '@/store/tasksStore'
import type {
  Feature,
  ObjectiveWithProgress,
  Task,
  TaskLink,
} from '../../../shared/types/ipc'
import { TaskBoard } from './TaskBoard'
import { TaskDialog } from './TaskDialog'
import { TaskList } from './TaskList'
import { TasksSidebar, type PriorityFilter, type StatusFilter } from './TasksSidebar'
import { PendingView } from './PendingView'
import { PARENT_TYPE_META } from './status'
import { useTasks } from './useTasks'

type ViewMode = 'list' | 'board' | 'pending'

function sameLinks(a: TaskLink[], b: TaskLink[]): boolean {
  if (a.length !== b.length) return false
  const key = (l: TaskLink) => `${l.parentType}:${l.parentId}`
  const as = a.map(key).sort()
  const bs = b.map(key).sort()
  return as.every((v, i) => v === bs[i])
}

export function TasksArea() {
  useTasks()
  const tasks = useTasksStore((s) => s.tasks)
  const filter = useTasksStore((s) => s.filter)
  const loading = useTasksStore((s) => s.loading)
  const setFilter = useTasksStore((s) => s.setFilter)
  const refresh = useTasksStore((s) => s.refresh)
  const createTask = useTasksStore((s) => s.createTask)
  const updateTask = useTasksStore((s) => s.updateTask)
  const deleteTask = useTasksStore((s) => s.deleteTask)
  const setTaskLinks = useTasksStore((s) => s.setLinks)

  // query/tags filtram em memória; status/prioridade vão pro filtro do store
  // (mesmo padrão de ObjectivesArea).
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [view, setView] = useState<ViewMode>('list')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  // Lookups pra resolver labels dos vínculos (chips) e popular os selects do
  // dialog. KRs exigem o detail de cada objetivo — volume pequeno (app pessoal).
  const [objectives, setObjectives] = useState<ObjectiveWithProgress[]>([])
  const [features, setFeatures] = useState<Feature[]>([])
  const [krTitles, setKrTitles] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let alive = true
    void (async () => {
      const [objs, feats] = await Promise.all([objectivesApi.list(), featuresApi.list()])
      if (!alive) return
      setObjectives(objs)
      setFeatures(feats)
      const details = await Promise.all(objs.map((o) => objectivesApi.get(o.id)))
      if (!alive) return
      const titles = new Map<string, string>()
      for (const d of details) {
        if (!d) continue
        for (const kr of d.keyResults) titles.set(kr.id, kr.title)
      }
      setKrTitles(titles)
    })()
    return () => {
      alive = false
    }
  }, [])

  const objectivesById = useMemo(() => new Map(objectives.map((o) => [o.id, o])), [objectives])
  const featuresById = useMemo(() => new Map(features.map((f) => [f.id, f])), [features])

  const resolveLinkLabel = useCallback(
    (link: TaskLink): string => {
      if (link.parentType === 'objective') {
        return objectivesById.get(link.parentId)?.title ?? PARENT_TYPE_META.objective.label
      }
      if (link.parentType === 'key_result') {
        return krTitles.get(link.parentId) ?? PARENT_TYPE_META.key_result.label
      }
      return featuresById.get(link.parentId)?.title ?? PARENT_TYPE_META.feature.label
    },
    [objectivesById, krTitles, featuresById],
  )

  const statusFilter: StatusFilter = filter.status ?? 'all'
  const priorityFilter: PriorityFilter = filter.priority ?? 'all'

  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    return tasks.filter((t) => {
      if (
        q &&
        !t.title.toLowerCase().includes(q) &&
        !(t.description ?? '').toLowerCase().includes(q)
      ) {
        return false
      }
      if (selectedTags.length > 0 && !selectedTags.every((tag) => t.tags.includes(tag))) {
        return false
      }
      return true
    })
  }, [tasks, q, selectedTags])

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  function openCreate() {
    setEditingTask(null)
    setDialogOpen(true)
  }

  function openEdit(task: Task) {
    setEditingTask(task)
    setDialogOpen(true)
  }

  async function handleDelete(task: Task) {
    if (!window.confirm(`Excluir "${task.title}"?`)) return
    await deleteTask(task.id)
  }

  return (
    <>
      <TasksSidebar
        tasks={tasks}
        loading={loading}
        query={query}
        statusFilter={statusFilter}
        priorityFilter={priorityFilter}
        selectedTags={selectedTags}
        onQuery={setQuery}
        onStatusFilter={(s) => void setFilter({ ...filter, status: s === 'all' ? undefined : s })}
        onPriorityFilter={(p) =>
          void setFilter({ ...filter, priority: p === 'all' ? undefined : p })
        }
        onToggleTag={toggleTag}
        onReload={() => void refresh()}
        onNew={openCreate}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-end gap-1 border-b border-[var(--color-border)] px-4 py-2">
          <ViewToggle value={view} onChange={setView} />
        </div>
        {view === 'board' ? (
          <div className="flex-1 overflow-hidden p-5">
            <TaskBoard tasks={listed} resolveLinkLabel={resolveLinkLabel} onEdit={openEdit} />
          </div>
        ) : view === 'pending' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <PendingView
              tasks={listed}
              resolveLinkLabel={resolveLinkLabel}
              onEdit={openEdit}
              onDelete={(t) => void handleDelete(t)}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <TaskList
              tasks={listed}
              resolveLinkLabel={resolveLinkLabel}
              onEdit={openEdit}
              onDelete={(t) => void handleDelete(t)}
            />
          </div>
        )}
      </main>

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editingTask}
        objectives={objectives}
        features={features}
        resolveLinkLabel={resolveLinkLabel}
        onCreate={async (input) => {
          await createTask(input)
        }}
        onUpdate={async (input, links) => {
          await updateTask(input)
          if (editingTask && !sameLinks(editingTask.links, links)) {
            await setTaskLinks(input.id, links)
          }
        }}
      />
    </>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const options: { id: ViewMode; label: string; icon: typeof LayoutList }[] = [
    { id: 'list', label: 'Lista', icon: LayoutList },
    { id: 'board', label: 'Board', icon: Columns3 },
    { id: 'pending', label: 'Pendências', icon: CalendarClock },
  ]
  return (
    <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          title={opt.label}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
            value === opt.id
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
          }`}
        >
          <Icon as={opt.icon} size={13} />
          {opt.label}
        </button>
      ))}
    </div>
  )
}
