import type { TaskOrigin, TaskPriority, TaskStatus } from './types/ipc'

// Funções puras de tarefas pendentes do dashboard (Fase 4) — importáveis por
// main e renderer (precedente: shared/progress.ts). "Pendente" = tarefa que
// ainda pede ação: todo | in_progress | blocked (done/cancelled ficam fora).

export const PENDING_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked']

export function isPendingStatus(status: TaskStatus): boolean {
  return PENDING_STATUSES.includes(status)
}

// Campos mínimos pra ordenar pendências (Task satisfaz estruturalmente).
export interface PendingOrderInput {
  priority: TaskPriority | null
  dueDate: number | null
  position: number
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

function priorityRank(priority: TaskPriority | null): number {
  return priority === null ? 3 : PRIORITY_RANK[priority]
}

// Ordenação canônica das pendências: prioridade (high>medium>low>null) →
// dueDate asc (null por último) → position asc.
export function comparePendingTasks(a: PendingOrderInput, b: PendingOrderInput): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
  if (byPriority !== 0) return byPriority
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate - b.dueDate
  }
  return a.position - b.position
}

export function sortPendingTasks<T extends PendingOrderInput>(tasks: T[]): T[] {
  return [...tasks].sort(comparePendingTasks)
}

// ---- Classificação por due date (dia LOCAL corrente) ----

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'none'

// Começo do dia LOCAL que contém `at`.
export function startOfLocalDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// overdue = antes do começo do dia local corrente; today = dentro do dia local
// corrente (fronteira do dia seguinte calculada via setDate — DST-safe).
export function classifyDue(dueDate: number | null, now: number): DueBucket {
  if (dueDate === null) return 'none'
  const dayStart = startOfLocalDay(now)
  if (dueDate < dayStart) return 'overdue'
  const nextDay = new Date(dayStart)
  nextDay.setDate(nextDay.getDate() + 1)
  return dueDate < nextDay.getTime() ? 'today' : 'upcoming'
}

// ---- Auto-tasks paradas (nudge de higiene, Onda 3) ----

// Mesmo threshold de "parada" usado pra features (home-selectors.ts,
// STALLED_FEATURE_MS) — convenção de UX compartilhada, não uma dependência
// estrutural entre os dois módulos.
export const STOPPED_AUTO_TASK_MS = 3 * 24 * 60 * 60 * 1000

export interface StoppedAutoTaskInput {
  origin: TaskOrigin
  status: TaskStatus
  updatedAt: number
}

// Tarefas auto-criadas (origin='auto'), ainda pendentes, sem toque há mais de
// 3 dias — candidatas ao nudge "N auto paradas → arquivar" (bulk-cancel
// manual; decay automático via cron é Onda 4, deferida).
export function selectStoppedAutoTasks<T extends StoppedAutoTaskInput>(
  tasks: T[],
  now: number,
): T[] {
  return tasks.filter(
    (t) =>
      t.origin === 'auto' &&
      isPendingStatus(t.status) &&
      now - t.updatedAt > STOPPED_AUTO_TASK_MS,
  )
}
