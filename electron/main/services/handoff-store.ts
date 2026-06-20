import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  CreateHandoffInput,
  Handoff,
  HandoffMode,
  HandoffStatus,
} from '../../../shared/types/ipc'

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
  mode: string
  current_step: string | null
  step_updated_at: number | null
  pending_question: string | null
  question_asked_at: number | null
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
    mode: row.mode as HandoffMode,
    currentStep: row.current_step,
    stepUpdatedAt: row.step_updated_at,
    pendingQuestion: row.pending_question,
    questionAskedAt: row.question_asked_at,
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
          context_json, composed_prompt, status, mode, current_step, step_updated_at,
          summary, error, created_at, updated_at)
       VALUES (@id, @mother_session_id, @target_repo_id, @child_session_id, @feature_id, @task,
               @context_json, @composed_prompt, @status, @mode, @current_step, @step_updated_at,
               @summary, @error, @created_at, @updated_at)`,
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
      mode: input.mode ?? 'interactive',
      current_step: null,
      step_updated_at: null,
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

// Progresso NÃO-terminal: a filha reporta o passo atual sem virar done. Grava se
// estiver em estado VIVO (running OU needs_input) — reportar progresso após uma
// pergunta significa que a filha retomou o trabalho, então needs_input volta a
// running e a pergunta pendente é limpa (o ato de progredir = "retomei"). done
// segue exclusivo de report.
export function progress(id: string, step: string): Handoff {
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE handoffs
         SET current_step = ?, step_updated_at = ?, updated_at = ?,
             status = 'running', pending_question = NULL, question_asked_at = NULL
       WHERE id = ? AND status IN ('running','needs_input')`,
    )
    .run(step, now, now, id)
  return fresh(id)
}

// A filha levanta uma pergunta (handoff_ask) e passa pra needs_input, gravando a
// pergunta + timestamp. Só transiciona se estava running — não pergunta de novo
// por cima de uma needs_input já aberta nem fora do estado vivo (pending/done/...).
export function ask(id: string, question: string): Handoff {
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE handoffs
         SET status = 'needs_input', pending_question = ?, question_asked_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(question, now, now, id)
  return fresh(id)
}

// A mãe respondeu (handoff_message) e a filha deve retomar: needs_input → running,
// limpa a pergunta pendente. Só age se estava needs_input (idempotente fora dele).
export function resume(id: string): Handoff {
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE handoffs
         SET status = 'running', pending_question = NULL, question_asked_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'needs_input'`,
    )
    .run(now, id)
  return fresh(id)
}

export function fail(id: string, error: string): Handoff {
  getDb()
    .prepare('UPDATE handoffs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
    .run('failed', error, Date.now(), id)
  return fresh(id)
}

// Reconciliação: a sessão-filha morreu (PTY exit/crash). Só transiciona para
// failed se ainda estava VIVA (running OU needs_input) — NÃO sobrescreve um
// done/rejected já gravado. Uma filha que perguntou (needs_input) e cuja PTY
// morreu de fato também precisa falhar (senão trava o teto pra sempre).
// Retorna o handoff atualizado, ou null se nada foi alterado (não estava vivo).
export function failIfRunning(id: string, error: string): Handoff | null {
  const res = getDb()
    .prepare(
      "UPDATE handoffs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status IN ('running','needs_input')",
    )
    .run(error, Date.now(), id)
  return res.changes > 0 ? fresh(id) : null
}

// Reconciliação em runtime, independente do evento PTY exit: pega filhas
// fechadas/crashadas (ou nunca atreladas) sem esperar o exit. SEGURA por design —
// só falha handoffs cuja session-filha NÃO está 'running' na tabela sessions. Um
// filho VIVO em trabalho longo OU aguardando a mãe (needs_input) NÃO pode ser
// morto enquanto a session-filha segue 'running'. Cobre tanto running quanto
// needs_input (ambos in-flight). Retorna o nº de handoffs reconciliados.
export function reconcileStuck(): number {
  const res = getDb()
    .prepare(
      `UPDATE handoffs SET status = 'failed', error = ?, updated_at = ?
       WHERE status IN ('running','needs_input')
         AND (child_session_id IS NULL
              OR child_session_id NOT IN (SELECT id FROM sessions WHERE status = 'running'))`,
    )
    .run('Sessão-filha encerrada sem reportar conclusão', Date.now())
  return res.changes
}

// Busca o handoff cuja filha é esta sessão (pra reconciliar no PTY exit). NULL se
// a sessão não veio de um handoff.
export function getByChildSession(childSessionId: string): Handoff | null {
  const row = getDb()
    .prepare(`${SELECT_HANDOFF} WHERE h.child_session_id = ?`)
    .get(childSessionId) as HandoffRow | undefined
  return row ? toEntity(row) : null
}

// Dedup por alvo: handoff ativo (pending/approved/running/needs_input) pro mesmo
// repo-alvo. Usado pra evitar dois agentes mutando o mesmo repo em paralelo.
export function findActiveByTarget(targetRepoId: string): Handoff | null {
  const row = getDb()
    .prepare(
      `${SELECT_HANDOFF} WHERE h.target_repo_id = ? AND h.status IN ('pending','approved','running','needs_input') ORDER BY h.created_at DESC LIMIT 1`,
    )
    .get(targetRepoId) as HandoffRow | undefined
  return row ? toEntity(row) : null
}
