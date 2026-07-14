import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  CreateTaskInput,
  Task,
  TaskLink,
  TaskListFilter,
  TaskOrigin,
  TaskParentType,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from '../../../shared/types/ipc'

// Store de Tarefas (Fase 2). Mesmo padrão de objective-store: SQLite-only,
// tags em JSON TEXT com filtro tag/search em memória. task_links é polimórfico
// (sem FK em parent_id); o CASCADE de tasks→task_links cobre o delete da
// tarefa, e a limpeza de órfãos por parent é feita pelo dono do parent
// (ex.: deleteKeyResult em objective-store).

// ---- rows <-> entidades ----

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  priority: string | null
  due_date: number | null
  started_at: number | null
  completed_at: number | null
  tags: string
  notes: string | null
  position: number
  origin: string
  source_session_id: string | null
  created_at: number
  updated_at: number
}

interface TaskLinkRow {
  task_id: string
  parent_type: string
  parent_id: string
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function rowToTask(row: TaskRow, links: TaskLink[]): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority | null,
    dueDate: row.due_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    tags: parseTags(row.tags),
    notes: row.notes,
    position: row.position,
    links,
    origin: row.origin as TaskOrigin,
    sourceSessionId: row.source_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadLinks(taskId: string): TaskLink[] {
  const rows = getDb()
    .prepare('SELECT * FROM task_links WHERE task_id = ? ORDER BY parent_type ASC, parent_id ASC')
    .all(taskId) as TaskLinkRow[]
  return rows.map((r) => ({ parentType: r.parent_type as TaskParentType, parentId: r.parent_id }))
}

function loadTask(id: string): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  if (!row) return null
  return rowToTask(row, loadLinks(id))
}

// ---- API pública ----

export function list(filter?: TaskListFilter): Task[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.status) {
    where.push('t.status = ?')
    params.push(filter.status)
  }
  if (filter?.priority) {
    where.push('t.priority = ?')
    params.push(filter.priority)
  }
  let join = ''
  if (filter?.parentType && filter?.parentId) {
    join = 'JOIN task_links l ON l.task_id = t.id'
    where.push('l.parent_type = ? AND l.parent_id = ?')
    params.push(filter.parentType, filter.parentId)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT t.* FROM tasks t ${join} ${clause} ORDER BY t.position ASC, t.created_at ASC`)
    .all(...params) as TaskRow[]

  let tasks = rows.map((row) => rowToTask(row, loadLinks(row.id)))

  // tags são strings opacas sem FK → filtro em memória (igual a objectives).
  if (filter?.tag) {
    const wanted = filter.tag
    tasks = tasks.filter((t) => t.tags.includes(wanted))
  }
  if (filter?.search?.trim()) {
    const q = filter.search.trim().toLowerCase()
    tasks = tasks.filter(
      (t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
    )
  }
  return tasks
}

export function get(id: string): Task | null {
  return loadTask(id)
}

export function listByParent(parentType: TaskParentType, parentId: string): Task[] {
  return list({ parentType, parentId })
}

function taskToRowParams(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.dueDate,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    tags: JSON.stringify(task.tags),
    notes: task.notes,
    position: task.position,
    origin: task.origin,
    source_session_id: task.sourceSessionId,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function insertLinks(taskId: string, links: TaskLink[]): void {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO task_links (task_id, parent_type, parent_id) VALUES (?, ?, ?)',
  )
  for (const link of links) stmt.run(taskId, link.parentType, link.parentId)
}

function nextPosition(): number {
  const row = getDb().prepare('SELECT MAX(position) AS max FROM tasks').get() as {
    max: number | null
  }
  return (row.max ?? 0) + 1
}

export function create(input: CreateTaskInput): Task {
  const now = Date.now()
  const status = input.status ?? 'todo'
  const task: Task = {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    status,
    priority: input.priority ?? null,
    dueDate: input.dueDate ?? null,
    startedAt: status === 'in_progress' ? now : null,
    completedAt: status === 'done' ? now : null,
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    position: input.position ?? nextPosition(),
    links: input.links ?? [],
    origin: input.origin ?? 'manual',
    sourceSessionId: input.sourceSessionId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
         (id, title, description, status, priority, due_date, started_at, completed_at,
          tags, notes, position, origin, source_session_id, created_at, updated_at)
       VALUES (@id, @title, @description, @status, @priority, @due_date, @started_at, @completed_at,
               @tags, @notes, @position, @origin, @source_session_id, @created_at, @updated_at)`,
    ).run(taskToRowParams(task))
    insertLinks(task.id, task.links)
  })
  tx()
  return task
}

// undefined = mantém o valor atual; null explícito limpa o campo.
function keep<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

export function update(input: UpdateTaskInput): Task {
  const current = loadTask(input.id)
  if (!current) throw new Error(`task not found: ${input.id}`)

  const now = Date.now()
  const status = input.status ?? current.status
  // Transições mantêm started_at/completed_at coerentes: entrar em
  // in_progress/done marca started_at (se vazio); done marca completed_at
  // (se vazio); sair de done limpa completed_at.
  const startedAt =
    status === 'in_progress' || status === 'done'
      ? (current.startedAt ?? now)
      : current.startedAt
  const completedAt = status === 'done' ? (current.completedAt ?? now) : null

  const next: Task = {
    ...current,
    title: input.title?.trim() || current.title,
    description: keep(input.description, current.description),
    status,
    priority: keep(input.priority, current.priority),
    dueDate: keep(input.dueDate, current.dueDate),
    startedAt,
    completedAt,
    tags: input.tags ?? current.tags,
    notes: keep(input.notes, current.notes),
    position: input.position ?? current.position,
    updatedAt: now,
  }

  getDb()
    .prepare(
      `UPDATE tasks SET
         title = @title, description = @description, status = @status, priority = @priority,
         due_date = @due_date, started_at = @started_at, completed_at = @completed_at,
         tags = @tags, notes = @notes, position = @position, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(taskToRowParams(next))
  return next
}

// Retorna os links da tarefa removida (o IPC usa pra broadcast de progresso).
export function remove(id: string): TaskLink[] {
  const links = loadLinks(id)
  // task_links sai junto via ON DELETE CASCADE (foreign_keys = ON em db.ts).
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  return links
}

// Substitui o conjunto de vínculos; retorna os links anteriores (pra que o
// IPC notifique também os parents que perderam a tarefa).
export function setLinks(taskId: string, links: TaskLink[]): TaskLink[] {
  const previous = loadLinks(taskId)
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM task_links WHERE task_id = ?').run(taskId)
    insertLinks(taskId, links)
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId)
  })
  tx()
  return previous
}

export function reorder(taskId: string, position: number): Task {
  getDb()
    .prepare('UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?')
    .run(position, Date.now(), taskId)
  const task = loadTask(taskId)
  if (!task) throw new Error(`task not found: ${taskId}`)
  return task
}

// Resolve os objetivos afetados por um conjunto de vínculos: 'objective' usa o
// parentId direto; 'key_result' resolve o objective_id via key_results;
// 'feature' resolve via feature_links (a tarefa da feature muda o progresso da
// feature, que entra no rollup dos objetivos/KRs vinculados a ela — Fase 3).
export function affectedObjectiveIds(links: TaskLink[]): string[] {
  const db = getDb()
  const ids = new Set<string>()
  const addKeyResultObjective = (keyResultId: string): void => {
    const row = db
      .prepare('SELECT objective_id FROM key_results WHERE id = ?')
      .get(keyResultId) as { objective_id: string } | undefined
    if (row) ids.add(row.objective_id)
  }
  for (const link of links) {
    if (link.parentType === 'objective') {
      ids.add(link.parentId)
    } else if (link.parentType === 'key_result') {
      addKeyResultObjective(link.parentId)
    } else {
      const targets = db
        .prepare('SELECT target_type, target_id FROM feature_links WHERE feature_id = ?')
        .all(link.parentId) as Array<{ target_type: string; target_id: string }>
      for (const t of targets) {
        if (t.target_type === 'objective') ids.add(t.target_id)
        else addKeyResultObjective(t.target_id)
      }
    }
  }
  return [...ids]
}
