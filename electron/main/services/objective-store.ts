import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import {
  computeFeatureProgress,
  computeProgress,
  featureProgressChild,
  taskProgressChild,
  type ProgressChild,
} from '../../../shared/progress'
import type {
  FeatureLinkTargetType,
  FeatureStatus,
  LinkedFeatureSummary,
  TaskParentType,
  TaskStatus,
} from '../../../shared/types/ipc'
import type {
  CreateKeyResultInput,
  CreateObjectiveInput,
  KeyResult,
  KeyResultStatus,
  Objective,
  ObjectiveDetail,
  ObjectiveKind,
  ObjectiveListFilter,
  ObjectiveStatus,
  ObjectiveWithProgress,
  ProgressDirection,
  ProgressMode,
  UpdateKeyResultInput,
  UpdateObjectiveInput,
} from '../../../shared/types/ipc'

// Store de Objetivos/KRs (Fase 1). Persistência SQLite-only — sem espelho .md,
// sem watcher (diferente de feature-store). tags vivem como JSON TEXT na coluna
// e o filtro por tags/search é em memória. Progresso NUNCA é persistido: é
// calculado em list/get via computeProgress (shared/progress.ts).

// ---- rows <-> entidades ----

interface ObjectiveRow {
  id: string
  title: string
  description: string | null
  kind: string
  status: string
  period: string | null
  start_date: number | null
  end_date: number | null
  parent_objective_id: string | null
  priority: string | null
  owner: string | null
  tags: string
  progress_mode: string
  progress_manual: number | null
  baseline: number | null
  current: number | null
  target: number | null
  unit: string | null
  direction: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  archived_at: number | null
}

interface KeyResultRow {
  id: string
  objective_id: string
  title: string
  owner: string | null
  status: string
  weight: number | null
  progress_mode: string
  progress_manual: number | null
  baseline: number | null
  current: number | null
  target: number | null
  unit: string | null
  direction: string | null
  created_at: number
  updated_at: number
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function rowToObjective(row: ObjectiveRow): Objective {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind as ObjectiveKind,
    status: row.status as ObjectiveStatus,
    period: row.period,
    startDate: row.start_date,
    endDate: row.end_date,
    parentObjectiveId: row.parent_objective_id,
    priority: row.priority as Objective['priority'],
    owner: row.owner,
    tags: parseTags(row.tags),
    progressMode: row.progress_mode as ProgressMode,
    progressManual: row.progress_manual,
    baseline: row.baseline,
    current: row.current,
    target: row.target,
    unit: row.unit,
    direction: row.direction as ProgressDirection | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
  }
}

function rowToKeyResult(row: KeyResultRow): KeyResult {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    title: row.title,
    owner: row.owner,
    status: row.status as KeyResultStatus,
    weight: row.weight,
    progressMode: row.progress_mode as ProgressMode,
    progressManual: row.progress_manual,
    baseline: row.baseline,
    current: row.current,
    target: row.target,
    unit: row.unit,
    direction: row.direction as ProgressDirection | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- progresso ----

// Filhos de rollup vindos de tarefas vinculadas (Fase 2). Query direta em
// task_links/tasks — sem importar task-store (evita acoplamento circular).
function taskChildren(parentType: TaskParentType, parentId: string): ProgressChild[] {
  const rows = getDb()
    .prepare(
      `SELECT t.status FROM tasks t
       JOIN task_links l ON l.task_id = t.id
       WHERE l.parent_type = ? AND l.parent_id = ?`,
    )
    .all(parentType, parentId) as Array<{ status: TaskStatus }>
  return rows.map((r) => taskProgressChild(r.status))
}

// ---- Features vinculadas (Fase 3) ----

interface LinkedFeatureRow {
  id: string
  title: string
  status: string
  archived_at: number | null
}

// Features vinculadas a um objetivo/KR via feature_links — inclui as
// arquivadas (Onda 1: o alvo some do JOIN sozinho se a feature foi deletada
// de verdade; arquivada é vínculo que sobrevive e precisa sinalizar "órfã de
// contexto" em vez de sumir em silêncio da lista, mesmo saindo do rollup).
// Query direta (sem importar feature-store — evita acoplamento circular).
function linkedFeatureRows(targetType: FeatureLinkTargetType, targetId: string): LinkedFeatureRow[] {
  return getDb()
    .prepare(
      `SELECT f.id, f.title, f.status, f.archived_at FROM features f
       JOIN feature_links l ON l.feature_id = f.id
       WHERE l.target_type = ? AND l.target_id = ?
       ORDER BY f.updated_at DESC`,
    )
    .all(targetType, targetId) as LinkedFeatureRow[]
}

// Statuses das tarefas vinculadas a uma feature (entrada do progresso dela).
function featureTaskStatuses(featureId: string): TaskStatus[] {
  const rows = getDb()
    .prepare(
      `SELECT t.status FROM tasks t
       JOIN task_links l ON l.task_id = t.id
       WHERE l.parent_type = 'feature' AND l.parent_id = ?`,
    )
    .all(featureId) as Array<{ status: TaskStatus }>
  return rows.map((r) => r.status)
}

// Filhos de rollup vindos de features vinculadas (peso 1; indeterminadas e
// arquivadas ficam fora do denominador via featureProgressChild → null).
function featureChildren(targetType: FeatureLinkTargetType, targetId: string): ProgressChild[] {
  return linkedFeatureRows(targetType, targetId)
    .map((f) =>
      featureProgressChild(
        { status: f.status as FeatureStatus, archivedAt: f.archived_at },
        featureTaskStatuses(f.id),
      ),
    )
    .filter((c): c is ProgressChild => c !== null)
}

// Projeção pra UI de Objetivos: features vinculadas com progresso calculado
// (inclui as de progresso null — a UI mostra "—"; só o rollup as exclui).
// Exportada pro overview-store (Fase 4) reusar a mesma projeção.
export function linkedFeatureSummaries(
  targetType: FeatureLinkTargetType,
  targetId: string,
): LinkedFeatureSummary[] {
  return linkedFeatureRows(targetType, targetId).map((f) => ({
    id: f.id,
    title: f.title,
    status: f.status as FeatureStatus,
    progress: computeFeatureProgress(f.status as FeatureStatus, featureTaskStatuses(f.id)),
    archived: f.archived_at !== null,
  }))
}

// Exportada pro overview-store (Fase 4) — mesma regra de progresso de KR.
export function keyResultProgress(kr: KeyResult): number | null {
  // KR auto_rollup → rollup de tarefas vinculadas ao KR + features vinculadas
  // ao KR (peso 1 cada; sem filhos elegíveis → null).
  if (kr.progressMode === 'auto_rollup') {
    return computeProgress(kr, [
      ...taskChildren('key_result', kr.id),
      ...featureChildren('key_result', kr.id),
    ])
  }
  return computeProgress(kr)
}

function objectiveProgress(obj: Objective, keyResults: KeyResult[]): number | null {
  // Objetivo auto_rollup SEM KRs elegíveis (não-cancelled) cai pro rollup de
  // tarefas diretas + features vinculadas (sem filhos elegíveis → null).
  if (obj.progressMode === 'auto_rollup') {
    const eligible = keyResults.filter((kr) => kr.status !== 'cancelled')
    if (eligible.length === 0) {
      return computeProgress(obj, [
        ...taskChildren('objective', obj.id),
        ...featureChildren('objective', obj.id),
      ])
    }
  }
  const children: ProgressChild[] = keyResults.map((kr) => ({
    status: kr.status,
    weight: kr.weight,
    progress: keyResultProgress(kr),
  }))
  return computeProgress(obj, children)
}

// Exportada pro overview-store (Fase 4) montar os nós de KR da árvore.
export function loadKeyResults(objectiveId: string): KeyResult[] {
  const rows = getDb()
    .prepare('SELECT * FROM key_results WHERE objective_id = ? ORDER BY created_at ASC')
    .all(objectiveId) as KeyResultRow[]
  return rows.map(rowToKeyResult)
}

// ---- API pública ----

export function list(filter?: ObjectiveListFilter): ObjectiveWithProgress[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.kind) {
    where.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter?.status) {
    where.push('status = ?')
    params.push(filter.status)
  } else {
    // Default histórico do app (igual a features): arquivados ficam fora da
    // lista a menos que o filtro peça status = 'archived' explicitamente.
    where.push("status != 'archived'")
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM objectives ${clause} ORDER BY updated_at DESC`)
    .all(...params) as ObjectiveRow[]

  let objectives = rows.map(rowToObjective)

  // tags são strings opacas sem FK → filtro em memória (decisão do plano).
  if (filter?.tags?.length) {
    const wanted = filter.tags
    objectives = objectives.filter((o) => wanted.every((t) => o.tags.includes(t)))
  }
  if (filter?.search?.trim()) {
    const q = filter.search.trim().toLowerCase()
    objectives = objectives.filter(
      (o) => o.title.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q),
    )
  }

  return objectives.map((o) => ({ ...o, progress: objectiveProgress(o, loadKeyResults(o.id)) }))
}

export function get(id: string): ObjectiveDetail | null {
  const row = getDb().prepare('SELECT * FROM objectives WHERE id = ?').get(id) as
    | ObjectiveRow
    | undefined
  if (!row) return null
  const objective = rowToObjective(row)
  const keyResults = loadKeyResults(id)
  return {
    ...objective,
    progress: objectiveProgress(objective, keyResults),
    keyResults: keyResults.map((kr) => ({
      ...kr,
      progress: keyResultProgress(kr),
      linkedFeatures: linkedFeatureSummaries('key_result', kr.id),
    })),
    linkedFeatures: linkedFeatureSummaries('objective', id),
  }
}

function insertObjective(obj: Objective): void {
  getDb()
    .prepare(
      `INSERT INTO objectives
         (id, title, description, kind, status, period, start_date, end_date,
          parent_objective_id, priority, owner, tags, progress_mode, progress_manual,
          baseline, current, target, unit, direction,
          created_at, updated_at, completed_at, archived_at)
       VALUES (@id, @title, @description, @kind, @status, @period, @start_date, @end_date,
               @parent_objective_id, @priority, @owner, @tags, @progress_mode, @progress_manual,
               @baseline, @current, @target, @unit, @direction,
               @created_at, @updated_at, @completed_at, @archived_at)`,
    )
    .run(objectiveToRowParams(obj))
}

function objectiveToRowParams(obj: Objective): Record<string, unknown> {
  return {
    id: obj.id,
    title: obj.title,
    description: obj.description,
    kind: obj.kind,
    status: obj.status,
    period: obj.period,
    start_date: obj.startDate,
    end_date: obj.endDate,
    parent_objective_id: obj.parentObjectiveId,
    priority: obj.priority,
    owner: obj.owner,
    tags: JSON.stringify(obj.tags),
    progress_mode: obj.progressMode,
    progress_manual: obj.progressManual,
    baseline: obj.baseline,
    current: obj.current,
    target: obj.target,
    unit: obj.unit,
    direction: obj.direction,
    created_at: obj.createdAt,
    updated_at: obj.updatedAt,
    completed_at: obj.completedAt,
    archived_at: obj.archivedAt,
  }
}

export function create(input: CreateObjectiveInput): Objective {
  const now = Date.now()
  const status = input.status ?? 'active'
  const objective: Objective = {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    kind: input.kind,
    status,
    period: input.period ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    parentObjectiveId: input.parentObjectiveId ?? null,
    priority: input.priority ?? null,
    owner: input.owner ?? null,
    tags: input.tags ?? [],
    progressMode: input.progressMode ?? 'auto_rollup',
    progressManual: input.progressManual ?? null,
    baseline: input.baseline ?? null,
    current: input.current ?? null,
    target: input.target ?? null,
    unit: input.unit ?? null,
    direction: input.direction ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : null,
    archivedAt: null,
  }
  insertObjective(objective)
  return objective
}

// undefined = mantém o valor atual; null explícito limpa o campo.
function keep<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

export function update(input: UpdateObjectiveInput): Objective {
  const row = getDb().prepare('SELECT * FROM objectives WHERE id = ?').get(input.id) as
    | ObjectiveRow
    | undefined
  if (!row) throw new Error(`objective not found: ${input.id}`)
  const current = rowToObjective(row)

  const status = input.status ?? current.status
  const next: Objective = {
    ...current,
    title: input.title?.trim() || current.title,
    description: keep(input.description, current.description),
    kind: input.kind ?? current.kind,
    status,
    period: keep(input.period, current.period),
    startDate: keep(input.startDate, current.startDate),
    endDate: keep(input.endDate, current.endDate),
    parentObjectiveId: keep(input.parentObjectiveId, current.parentObjectiveId),
    priority: keep(input.priority, current.priority),
    owner: keep(input.owner, current.owner),
    tags: input.tags ?? current.tags,
    progressMode: input.progressMode ?? current.progressMode,
    progressManual: keep(input.progressManual, current.progressManual),
    baseline: keep(input.baseline, current.baseline),
    current: keep(input.current, current.current),
    target: keep(input.target, current.target),
    unit: keep(input.unit, current.unit),
    direction: keep(input.direction, current.direction),
    updatedAt: Date.now(),
    completedAt: status === 'done' ? (current.completedAt ?? Date.now()) : current.completedAt,
  }

  getDb()
    .prepare(
      `UPDATE objectives SET
         title = @title, description = @description, kind = @kind, status = @status,
         period = @period, start_date = @start_date, end_date = @end_date,
         parent_objective_id = @parent_objective_id, priority = @priority, owner = @owner,
         tags = @tags, progress_mode = @progress_mode, progress_manual = @progress_manual,
         baseline = @baseline, current = @current, target = @target,
         unit = @unit, direction = @direction,
         updated_at = @updated_at, completed_at = @completed_at, archived_at = @archived_at
       WHERE id = @id`,
    )
    .run(objectiveToRowParams(next))
  return next
}

export function archive(id: string): void {
  const now = Date.now()
  getDb()
    .prepare(
      "UPDATE objectives SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(now, now, id)
}

// ---- Key Results ----

function keyResultToRowParams(kr: KeyResult): Record<string, unknown> {
  return {
    id: kr.id,
    objective_id: kr.objectiveId,
    title: kr.title,
    owner: kr.owner,
    status: kr.status,
    weight: kr.weight,
    progress_mode: kr.progressMode,
    progress_manual: kr.progressManual,
    baseline: kr.baseline,
    current: kr.current,
    target: kr.target,
    unit: kr.unit,
    direction: kr.direction,
    created_at: kr.createdAt,
    updated_at: kr.updatedAt,
  }
}

export function createKeyResult(input: CreateKeyResultInput): KeyResult {
  const now = Date.now()
  const kr: KeyResult = {
    id: randomUUID(),
    objectiveId: input.objectiveId,
    title: input.title.trim(),
    owner: input.owner ?? null,
    status: input.status ?? 'active',
    weight: input.weight ?? null,
    progressMode: input.progressMode ?? 'manual',
    progressManual: input.progressManual ?? null,
    baseline: input.baseline ?? null,
    current: input.current ?? null,
    target: input.target ?? null,
    unit: input.unit ?? null,
    direction: input.direction ?? null,
    createdAt: now,
    updatedAt: now,
  }
  getDb()
    .prepare(
      `INSERT INTO key_results
         (id, objective_id, title, owner, status, weight, progress_mode, progress_manual,
          baseline, current, target, unit, direction, created_at, updated_at)
       VALUES (@id, @objective_id, @title, @owner, @status, @weight, @progress_mode, @progress_manual,
               @baseline, @current, @target, @unit, @direction, @created_at, @updated_at)`,
    )
    .run(keyResultToRowParams(kr))
  return kr
}

export function updateKeyResult(input: UpdateKeyResultInput): KeyResult {
  const row = getDb().prepare('SELECT * FROM key_results WHERE id = ?').get(input.id) as
    | KeyResultRow
    | undefined
  if (!row) throw new Error(`key result not found: ${input.id}`)
  const current = rowToKeyResult(row)

  const next: KeyResult = {
    ...current,
    title: input.title?.trim() || current.title,
    owner: keep(input.owner, current.owner),
    status: input.status ?? current.status,
    weight: keep(input.weight, current.weight),
    progressMode: input.progressMode ?? current.progressMode,
    progressManual: keep(input.progressManual, current.progressManual),
    baseline: keep(input.baseline, current.baseline),
    current: keep(input.current, current.current),
    target: keep(input.target, current.target),
    unit: keep(input.unit, current.unit),
    direction: keep(input.direction, current.direction),
    updatedAt: Date.now(),
  }

  getDb()
    .prepare(
      `UPDATE key_results SET
         title = @title, owner = @owner, status = @status, weight = @weight,
         progress_mode = @progress_mode, progress_manual = @progress_manual,
         baseline = @baseline, current = @current, target = @target,
         unit = @unit, direction = @direction, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(keyResultToRowParams(next))
  return next
}

export function deleteKeyResult(id: string): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM key_results WHERE id = ?').run(id)
    // task_links/feature_links são polimórficos (sem FK em parent/target_id)
    // → limpeza manual dos vínculos órfãos; tarefas e features sobrevivem.
    db.prepare("DELETE FROM task_links WHERE parent_type = 'key_result' AND parent_id = ?").run(id)
    db.prepare("DELETE FROM feature_links WHERE target_type = 'key_result' AND target_id = ?").run(
      id,
    )
  })
  tx()
}
