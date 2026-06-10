import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { tasksApi } from '@/lib/ipc'
import { useFeaturesStore } from '@/store/featuresStore'
import type { ObjectiveWithProgress, Task, TaskLink } from '../../../shared/types/ipc'
import { TaskDialog } from '../tasks/TaskDialog'
import { DueDateBadge, PriorityBadge, TaskStatusBadge } from '../tasks/TaskList'
import { PARENT_TYPE_META } from '../tasks/status'

// Mesma comparação de TasksArea (module-private lá de propósito): evita um
// setLinks (IPC + broadcast) quando a edição não mexeu nos vínculos.
function sameLinks(a: TaskLink[], b: TaskLink[]): boolean {
  if (a.length !== b.length) return false
  const key = (l: TaskLink) => `${l.parentType}:${l.parentId}`
  const as = a.map(key).sort()
  const bs = b.map(key).sort()
  return as.every((v, i) => v === bs[i])
}

interface Props {
  featureId: string
  objectives: ObjectiveWithProgress[]
  krTitles: Map<string, string>
}

// Seção "Tarefas" do FeatureDoc: tarefas vinculadas à feature + criação/edição
// via TaskDialog já pré-vinculado à feature.
export function FeatureTasksSection({ featureId, objectives, krTitles }: Props) {
  // Lista de features pro select de vínculo do dialog — a store já está
  // carregada (FeaturesArea monta useFeatures antes do doc abrir).
  const features = useFeaturesStore((s) => s.features)
  const [tasks, setTasks] = useState<Task[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const load = useCallback(async () => {
    setTasks(await tasksApi.listByParent('feature', featureId))
  }, [featureId])

  // Carrega no mount/troca de feature e recarrega em qualquer task:updated —
  // o payload do canal varia por mutação, então é tratado como sinal de
  // recarga (mesmo padrão do tasksStore).
  useEffect(() => {
    void load()
    return tasksApi.onUpdated(() => void load())
  }, [load])

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

  const initialLinks = useMemo<TaskLink[]>(
    () => [{ parentType: 'feature', parentId: featureId }],
    [featureId],
  )

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Tarefas</h2>
        <button
          type="button"
          onClick={() => {
            setEditingTask(null)
            setDialogOpen(true)
          }}
          className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-black transition hover:opacity-90"
        >
          <Icon as={Plus} size={13} />
          Nova tarefa
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-[var(--color-text-dim)]">Nenhuma tarefa vinculada.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                title="Editar tarefa"
                onClick={() => {
                  setEditingTask(task)
                  setDialogOpen(true)
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left transition hover:bg-[var(--color-surface-2)]/60"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">
                  {task.title}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {task.priority && <PriorityBadge priority={task.priority} />}
                  <DueDateBadge task={task} />
                  <TaskStatusBadge status={task.status} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <TaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={editingTask}
        initialLinks={initialLinks}
        objectives={objectives}
        features={features}
        resolveLinkLabel={resolveLinkLabel}
        onCreate={async (input) => {
          // O broadcast task:updated recarrega a lista via assinatura acima.
          await tasksApi.create(input)
        }}
        onUpdate={async (input, links) => {
          await tasksApi.update(input)
          if (editingTask && !sameLinks(editingTask.links, links)) {
            await tasksApi.setLinks(input.id, links)
          }
        }}
      />
    </section>
  )
}
