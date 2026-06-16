import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { CreateHandoffInput, Handoff, HandoffStatus } from '../../../shared/types/ipc'

interface HandoffRow {
  id: string
  mother_session_id: string | null
  target_repo_id: string
  child_session_id: string | null
  feature_id: string | null
  task: string
  context_json: string | null
  composed_prompt: string
  status: string
  summary: string | null
  error: string | null
  created_at: number
  updated_at: number
  // Resolvido via LEFT JOIN repos (null se o repo-alvo foi removido).
  target_repo_label: string | null
}

// SELECT base com o label do repo-alvo resolvido. LEFT JOIN: handoff sobrevive à
// remoção do repo (label vira null), mas continua listável.
const SELECT_HANDOFF =
  'SELECT h.*, r.label AS target_repo_label FROM handoffs h LEFT JOIN repos r ON r.id = h.target_repo_id'

function toEntity(row: HandoffRow): Handoff {
  return {
    id: row.id,
    motherSessionId: row.mother_session_id,
    targetRepoId: row.target_repo_id,
    targetRepoLabel: row.target_repo_label,
    childSessionId: row.child_session_id,
    featureId: row.feature_id,
    task: row.task,
    contextJson: row.context_json,
    composedPrompt: row.composed_prompt,
    status: row.status as HandoffStatus,
    summary: row.summary,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getRow(id: string): HandoffRow | undefined {
  return getDb().prepare(`${SELECT_HANDOFF} WHERE h.id = ?`).get(id) as HandoffRow | undefined
}

// Carrega a entidade fresca pós-mutação; lança se sumiu (id inválido).
function fresh(id: string): Handoff {
  const row = getRow(id)
  if (!row) throw new Error(`handoff not found: ${id}`)
  return toEntity(row)
}

export function create(input: CreateHandoffInput): Handoff {
  const now = Date.now()
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO handoffs
         (id, mother_session_id, target_repo_id, child_session_id, feature_id, task,
          context_json, composed_prompt, status, summary, error, created_at, updated_at)
       VALUES (@id, @mother_session_id, @target_repo_id, @child_session_id, @feature_id, @task,
               @context_json, @composed_prompt, @status, @summary, @error, @created_at, @updated_at)`,
    )
    .run({
      id,
      mother_session_id: input.motherSessionId ?? null,
      target_repo_id: input.targetRepoId,
      child_session_id: null,
      feature_id: input.featureId ?? null,
      task: input.task,
      context_json: input.contextJson ?? null,
      composed_prompt: input.composedPrompt,
      status: 'pending',
      summary: null,
      error: null,
      created_at: now,
      updated_at: now,
    })
  // Re-lê via JOIN pra preencher target_repo_label.
  return fresh(id)
}

export function get(id: string): Handoff | null {
  const row = getRow(id)
  return row ? toEntity(row) : null
}

export function list(opts?: { status?: HandoffStatus | HandoffStatus[] }): Handoff[] {
  const db = getDb()
  let rows: HandoffRow[]
  if (opts?.status !== undefined) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status]
    const placeholders = statuses.map(() => '?').join(', ')
    rows = db
      .prepare(
        `${SELECT_HANDOFF} WHERE h.status IN (${placeholders}) ORDER BY h.created_at DESC`,
      )
      .all(...statuses) as HandoffRow[]
  } else {
    rows = db.prepare(`${SELECT_HANDOFF} ORDER BY h.created_at DESC`).all() as HandoffRow[]
  }
  return rows.map(toEntity)
}

// Marca approved. Permite sobrescrever o composed_prompt editado pelo humano no
// gate. A transição para running + child_session_id vem numa wave posterior.
export function approve(id: string, opts: { composedPrompt?: string }): Handoff {
  const db = getDb()
  if (opts.composedPrompt !== undefined) {
    db.prepare(
      'UPDATE handoffs SET status = ?, composed_prompt = ?, updated_at = ? WHERE id = ?',
    ).run('approved', opts.composedPrompt, Date.now(), id)
  } else {
    db.prepare('UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ?').run(
      'approved',
      Date.now(),
      id,
    )
  }
  return fresh(id)
}

export function reject(id: string): Handoff {
  getDb()
    .prepare('UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ?')
    .run('rejected', Date.now(), id)
  return fresh(id)
}

export function markRunning(id: string, childSessionId: string): Handoff {
  getDb()
    .prepare('UPDATE handoffs SET status = ?, child_session_id = ?, updated_at = ? WHERE id = ?')
    .run('running', childSessionId, Date.now(), id)
  return fresh(id)
}

export function report(id: string, summary: string): Handoff {
  getDb()
    .prepare('UPDATE handoffs SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
    .run('done', summary, Date.now(), id)
  return fresh(id)
}

export function fail(id: string, error: string): Handoff {
  getDb()
    .prepare('UPDATE handoffs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run('failed', error, Date.now(), id)
  return fresh(id)
}
