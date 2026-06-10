import { getDb } from './db'
import * as objectiveStore from './objective-store'
import * as taskStore from './task-store'
import { classifyDue, isPendingStatus, sortPendingTasks } from '../../../shared/pending'
import type {
  OverviewCounts,
  OverviewData,
  OverviewObjectiveNode,
  OverviewPendingTask,
  OverviewTaskParentRef,
  OverviewTaskSummary,
  TaskLink,
  TaskParentType,
  TaskPriority,
  TaskStatus,
} from '../../../shared/types/ipc'

// Agregado do dashboard (Fase 4): monta a árvore objetivos → KRs → tarefas/
// features numa única chamada IPC. Progresso vem dos MESMOS helpers do
// objective-store (list/keyResultProgress/linkedFeatureSummaries) — nada de
// lógica de rollup duplicada aqui.

// ---- Tarefas resumidas por parent ----

interface TaskSummaryRow {
  id: string
  title: string
  status: string
  priority: string | null
  due_date: number | null
}

// Projeção enxuta das tarefas vinculadas a um parent, na ordem canônica de
// task-store.list (position → created_at).
function taskSummaries(parentType: TaskParentType, parentId: string): OverviewTaskSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date FROM tasks t
       JOIN task_links l ON l.task_id = t.id
       WHERE l.parent_type = ? AND l.parent_id = ?
       ORDER BY t.position ASC, t.created_at ASC`,
    )
    .all(parentType, parentId) as TaskSummaryRow[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority | null,
    dueDate: r.due_date,
  }))
}

// ---- Resolução de parents das pendências ----

const PARENT_TABLE: Record<TaskParentType, string> = {
  objective: 'objectives',
  key_result: 'key_results',
  feature: 'features',
}

// Resolve o título do parent de um vínculo. Vínculo órfão (parent deletado
// fora do fluxo normal) → null, e some da lista de parents.
function resolveParent(link: TaskLink): OverviewTaskParentRef | null {
  const row = getDb()
    .prepare(`SELECT title FROM ${PARENT_TABLE[link.parentType]} WHERE id = ?`)
    .get(link.parentId) as { title: string } | undefined
  if (!row) return null
  return { type: link.parentType, id: link.parentId, title: row.title }
}

// ---- API pública ----

export function getOverview(): OverviewData {
  // list() default já exclui archived → sobram active|paused|done, com
  // progresso calculado pela mesma regra da tela de Objetivos.
  const objectives = objectiveStore.list()

  const nodes = new Map<string, OverviewObjectiveNode>()
  for (const obj of objectives) {
    const { progress, ...objective } = obj
    const keyResults = objectiveStore.loadKeyResults(obj.id)
    nodes.set(obj.id, {
      objective,
      progress,
      keyResults: keyResults.map((kr) => ({
        keyResult: kr,
        progress: objectiveStore.keyResultProgress(kr),
        tasks: taskSummaries('key_result', kr.id),
        linkedFeatures: objectiveStore.linkedFeatureSummaries('key_result', kr.id),
      })),
      directTasks: taskSummaries('objective', obj.id),
      linkedFeatures: objectiveStore.linkedFeatureSummaries('objective', obj.id),
      children: [],
    })
  }

  // Monta a árvore preservando a ordem do list() (updated_at DESC). Filho cujo
  // parent ficou fora do conjunto (ex.: parent arquivado) vira raiz — não some.
  const roots: OverviewObjectiveNode[] = []
  for (const obj of objectives) {
    const node = nodes.get(obj.id)
    if (!node) continue
    const parent = obj.parentObjectiveId ? nodes.get(obj.parentObjectiveId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const now = Date.now()
  const pendingTasks = sortPendingTasks(taskStore.list().filter((t) => isPendingStatus(t.status)))
  const pending: OverviewPendingTask[] = pendingTasks.map((t) => ({
    ...t,
    parents: t.links
      .map(resolveParent)
      .filter((p): p is OverviewTaskParentRef => p !== null),
  }))

  const counts: OverviewCounts = {
    activeObjectives: objectives.filter((o) => o.status === 'active').length,
    pendingTasks: pending.length,
    dueToday: pending.filter((t) => classifyDue(t.dueDate, now) === 'today').length,
    overdue: pending.filter((t) => classifyDue(t.dueDate, now) === 'overdue').length,
  }

  return { objectives: roots, pending, counts }
}
