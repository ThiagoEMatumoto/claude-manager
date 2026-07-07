import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  AdvisorModel,
  CaptureQuality,
  CreateJobRunInput,
  CreateScheduledJobInput,
  EffortLevel,
  JobRun,
  JobRunListFilter,
  JobRunStatus,
  JobSchedule,
  PermissionMode,
  ScheduledJob,
  ScheduledJobListFilter,
  UpdateJobRunInput,
  UpdateScheduledJobInput,
} from '../../../shared/types/ipc'

// Store de Scheduled Jobs (Fase 1). Molde de task-store: SQLite-only, rows
// snake_case ⇄ entidades camelCase, `db.transaction` nas mutações compostas.
// Sem lib de cron: `next_run_at` é derivado de `schedule` num único helper
// (computeNextRunAt) — fonte única do claim atômico. O claim
// (UPDATE ... WHERE next_run_at<=now AND enabled=1 + INSERT job_runs na MESMA
// transação) evita double-fire em double-tick.

const HOUR_MS = 3_600_000

// ---- rows <-> entidades ----

interface ScheduledJobRow {
  id: string
  name: string
  repo_id: string | null
  prompt: string
  system_prompt: string | null
  schedule: string
  next_run_at: number
  last_run_at: number | null
  enabled: number
  catch_up: number
  model: string | null
  effort: string | null
  permission_mode: string
  advisor_model: string | null
  disallowed_tools: string
  created_at: number
  updated_at: number
}

interface JobRunRow {
  id: string
  job_id: string
  status: string
  started_at: number | null
  finished_at: number | null
  session_id: string | null
  cc_session_id: string | null
  report_text: string | null
  capture_quality: string | null
  tokens: number | null
  model: string | null
  error: string | null
  created_at: number
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

// Schedule é dado nosso (JSON gravado por este store), mas ainda assim
// defendemos o JSON.parse. Se corromper, cai num intervalo diário seguro em vez
// de derrubar a leitura.
function parseSchedule(raw: string): JobSchedule {
  try {
    const parsed = JSON.parse(raw) as JobSchedule
    if (parsed && (parsed.type === 'interval' || parsed.type === 'daily' || parsed.type === 'weekly')) {
      return parsed
    }
  } catch {
    // cai no default
  }
  return { type: 'interval', hours: 24 }
}

function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    name: row.name,
    repoId: row.repo_id,
    prompt: row.prompt,
    systemPrompt: row.system_prompt,
    schedule: parseSchedule(row.schedule),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    enabled: row.enabled === 1,
    catchUp: row.catch_up === 1,
    model: row.model,
    effort: row.effort as EffortLevel | null,
    permissionMode: row.permission_mode as PermissionMode,
    advisorModel: row.advisor_model as AdvisorModel | null,
    disallowedTools: parseStringArray(row.disallowed_tools),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function jobToRowParams(job: ScheduledJob): Record<string, unknown> {
  return {
    id: job.id,
    name: job.name,
    repo_id: job.repoId,
    prompt: job.prompt,
    system_prompt: job.systemPrompt,
    schedule: JSON.stringify(job.schedule),
    next_run_at: job.nextRunAt,
    last_run_at: job.lastRunAt,
    enabled: job.enabled ? 1 : 0,
    catch_up: job.catchUp ? 1 : 0,
    model: job.model,
    effort: job.effort,
    permission_mode: job.permissionMode,
    advisor_model: job.advisorModel,
    disallowed_tools: JSON.stringify(job.disallowedTools),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  }
}

function rowToRun(row: JobRunRow): JobRun {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status as JobRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sessionId: row.session_id,
    ccSessionId: row.cc_session_id,
    reportText: row.report_text,
    captureQuality: row.capture_quality as CaptureQuality | null,
    tokens: row.tokens,
    model: row.model,
    error: row.error,
    createdAt: row.created_at,
  }
}

function runToRowParams(run: JobRun): Record<string, unknown> {
  return {
    id: run.id,
    job_id: run.jobId,
    status: run.status,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    session_id: run.sessionId,
    cc_session_id: run.ccSessionId,
    report_text: run.reportText,
    capture_quality: run.captureQuality,
    tokens: run.tokens,
    model: run.model,
    error: run.error,
    created_at: run.createdAt,
  }
}

// undefined = mantém o valor atual; null explícito limpa o campo.
function keep<T>(next: T | undefined, current: T): T {
  return next === undefined ? current : next
}

// ---- next_run_at: fonte única (single source of truth) ----

// Computa o PRÓXIMO timestamp de execução a partir de `from`. INVARIANTE: o
// retorno é SEMPRE estritamente > from — é o que garante que o claim atômico não
// re-dispare no mesmo tick (após o 1º claim, next_run_at > now → 2º claim falha).
export function computeNextRunAt(schedule: JobSchedule, from: number): number {
  if (schedule.type === 'interval') {
    const hours = Math.max(1, Math.floor(schedule.hours))
    return from + hours * HOUR_MS
  }

  const next = new Date(from)
  next.setHours(schedule.hour, schedule.minute, 0, 0)

  if (schedule.type === 'daily') {
    // Se o HH:MM de hoje já passou (ou é exatamente agora), rola pro dia seguinte.
    if (next.getTime() <= from) next.setDate(next.getDate() + 1)
    return next.getTime()
  }

  // weekly: avança até o dia da semana alvo; se cair hoje mas o horário já
  // passou, soma mais uma semana. setDate cuida do rollover de mês.
  const deltaDays = (schedule.dayOfWeek - next.getDay() + 7) % 7
  next.setDate(next.getDate() + deltaDays)
  if (next.getTime() <= from) next.setDate(next.getDate() + 7)
  return next.getTime()
}

// ---- API pública: scheduled_jobs ----

export function list(filter?: ScheduledJobListFilter): ScheduledJob[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.enabled !== undefined) {
    where.push('enabled = ?')
    params.push(filter.enabled ? 1 : 0)
  }
  if (filter?.repoId) {
    where.push('repo_id = ?')
    params.push(filter.repoId)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM scheduled_jobs ${clause} ORDER BY next_run_at ASC, created_at ASC`)
    .all(...params) as ScheduledJobRow[]
  return rows.map(rowToJob)
}

export function get(id: string): ScheduledJob | null {
  const row = getDb().prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as
    | ScheduledJobRow
    | undefined
  return row ? rowToJob(row) : null
}

const INSERT_JOB_SQL = `INSERT INTO scheduled_jobs
    (id, name, repo_id, prompt, system_prompt, schedule, next_run_at, last_run_at,
     enabled, catch_up, model, effort, permission_mode, advisor_model, disallowed_tools,
     created_at, updated_at)
   VALUES
    (@id, @name, @repo_id, @prompt, @system_prompt, @schedule, @next_run_at, @last_run_at,
     @enabled, @catch_up, @model, @effort, @permission_mode, @advisor_model, @disallowed_tools,
     @created_at, @updated_at)`

export function create(input: CreateScheduledJobInput): ScheduledJob {
  const now = Date.now()
  const job: ScheduledJob = {
    id: randomUUID(),
    name: input.name.trim(),
    repoId: input.repoId ?? null,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt?.trim() ? input.systemPrompt : null,
    schedule: input.schedule,
    nextRunAt: computeNextRunAt(input.schedule, now),
    lastRunAt: null,
    enabled: input.enabled ?? true,
    catchUp: input.catchUp ?? false,
    model: input.model ?? null,
    effort: input.effort ?? null,
    permissionMode: input.permissionMode ?? 'plan',
    advisorModel: input.advisorModel ?? null,
    disallowedTools: input.disallowedTools ?? [],
    createdAt: now,
    updatedAt: now,
  }
  getDb().prepare(INSERT_JOB_SQL).run(jobToRowParams(job))
  return job
}

export function update(input: UpdateScheduledJobInput): ScheduledJob {
  const current = get(input.id)
  if (!current) throw new Error(`scheduled job not found: ${input.id}`)

  const now = Date.now()
  const scheduleChanged = input.schedule !== undefined
  const schedule = input.schedule ?? current.schedule

  const next: ScheduledJob = {
    ...current,
    name: input.name?.trim() || current.name,
    repoId: keep(input.repoId, current.repoId),
    prompt: input.prompt ?? current.prompt,
    systemPrompt: keep(input.systemPrompt, current.systemPrompt),
    schedule,
    // Trocar o schedule reancora o next_run_at em "agora"; senão preserva o
    // agendamento vigente (não reinicia o relógio a cada edição de outro campo).
    nextRunAt: scheduleChanged ? computeNextRunAt(schedule, now) : current.nextRunAt,
    enabled: input.enabled ?? current.enabled,
    catchUp: input.catchUp ?? current.catchUp,
    model: keep(input.model, current.model),
    effort: keep(input.effort, current.effort),
    permissionMode: input.permissionMode ?? current.permissionMode,
    advisorModel: keep(input.advisorModel, current.advisorModel),
    disallowedTools: input.disallowedTools ?? current.disallowedTools,
    updatedAt: now,
  }

  getDb()
    .prepare(
      `UPDATE scheduled_jobs SET
         name = @name, repo_id = @repo_id, prompt = @prompt, system_prompt = @system_prompt,
         schedule = @schedule, next_run_at = @next_run_at, last_run_at = @last_run_at,
         enabled = @enabled, catch_up = @catch_up, model = @model, effort = @effort,
         permission_mode = @permission_mode, advisor_model = @advisor_model,
         disallowed_tools = @disallowed_tools, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run(jobToRowParams(next))
  return next
}

export function remove(id: string): void {
  // job_runs saem junto via ON DELETE CASCADE (foreign_keys = ON em db.ts).
  getDb().prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id)
}

const INSERT_RUN_SQL = `INSERT INTO job_runs
    (id, job_id, status, started_at, finished_at, session_id, cc_session_id,
     report_text, capture_quality, tokens, model, error, created_at)
   VALUES
    (@id, @job_id, @status, @started_at, @finished_at, @session_id, @cc_session_id,
     @report_text, @capture_quality, @tokens, @model, @error, @created_at)`

function newRun(jobId: string, now: number, status: JobRunStatus, model: string | null): JobRun {
  return {
    id: randomUUID(),
    jobId,
    status,
    startedAt: null,
    finishedAt: null,
    sessionId: null,
    ccSessionId: null,
    reportText: null,
    captureQuality: null,
    tokens: null,
    model,
    error: null,
    createdAt: now,
  }
}

// ---- Claim atômico ----

// Reivindica o job SE estiver vencido e habilitado, avançando next_run_at e
// registrando a row de job_runs na MESMA transação. Retorna a run criada, ou
// null se o job não estava elegível (já reivindicado neste tick, desabilitado,
// ainda não vencido, ou inexistente). O UPDATE guardado + a checagem changes===1
// é o que impede double-fire quando o poll dispara duas vezes no mesmo instante.
export function claimDueJob(jobId: string, now: number): JobRun | null {
  const db = getDb()
  let claimed: JobRun | null = null
  const tx = db.transaction(() => {
    const jobRow = db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(jobId) as
      | ScheduledJobRow
      | undefined
    if (!jobRow) return

    const schedule = parseSchedule(jobRow.schedule)
    const nextRunAt = computeNextRunAt(schedule, now)
    const res = db
      .prepare(
        `UPDATE scheduled_jobs SET next_run_at = ?, last_run_at = ?, updated_at = ?
         WHERE id = ? AND next_run_at <= ? AND enabled = 1`,
      )
      .run(nextRunAt, now, now, jobId, now)
    if (res.changes !== 1) return

    const run = newRun(jobId, now, 'scheduled', jobRow.model)
    db.prepare(INSERT_RUN_SQL).run(runToRowParams(run))
    claimed = run
  })
  tx()
  return claimed
}

// ---- API pública: job_runs ----

export function createRun(input: CreateJobRunInput): JobRun {
  const run = newRun(input.jobId, Date.now(), input.status ?? 'scheduled', input.model ?? null)
  getDb().prepare(INSERT_RUN_SQL).run(runToRowParams(run))
  return run
}

export function getRun(id: string): JobRun | null {
  const row = getDb().prepare('SELECT * FROM job_runs WHERE id = ?').get(id) as JobRunRow | undefined
  return row ? rowToRun(row) : null
}

export function updateRun(input: UpdateJobRunInput): JobRun {
  const current = getRun(input.id)
  if (!current) throw new Error(`job run not found: ${input.id}`)

  const next: JobRun = {
    ...current,
    status: input.status ?? current.status,
    startedAt: keep(input.startedAt, current.startedAt),
    finishedAt: keep(input.finishedAt, current.finishedAt),
    sessionId: keep(input.sessionId, current.sessionId),
    ccSessionId: keep(input.ccSessionId, current.ccSessionId),
    reportText: keep(input.reportText, current.reportText),
    captureQuality: keep(input.captureQuality, current.captureQuality),
    tokens: keep(input.tokens, current.tokens),
    model: keep(input.model, current.model),
    error: keep(input.error, current.error),
  }

  getDb()
    .prepare(
      `UPDATE job_runs SET
         status = @status, started_at = @started_at, finished_at = @finished_at,
         session_id = @session_id, cc_session_id = @cc_session_id, report_text = @report_text,
         capture_quality = @capture_quality, tokens = @tokens, model = @model, error = @error
       WHERE id = @id`,
    )
    .run(runToRowParams(next))
  return next
}

export function listRuns(filter?: JobRunListFilter): JobRun[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter?.jobId) {
    where.push('job_id = ?')
    params.push(filter.jobId)
  }
  if (filter?.status) {
    where.push('status = ?')
    params.push(filter.status)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = filter?.limit && filter.limit > 0 ? ` LIMIT ${Math.floor(filter.limit)}` : ''
  const rows = getDb()
    .prepare(`SELECT * FROM job_runs ${clause} ORDER BY created_at DESC${limit}`)
    .all(...params) as JobRunRow[]
  return rows.map(rowToRun)
}

export function getLastRun(jobId: string): JobRun | null {
  const row = getDb()
    .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(jobId) as JobRunRow | undefined
  return row ? rowToRun(row) : null
}

// report_text do run mais recente que TEM relatório — fonte do delta-via-prompt.
// Não pode ser getLastRun: num app desktop 'missed'/'failed' (sem report) no meio
// são comuns e suprimiriam o delta mesmo havendo um 'success' anterior. Prioriza
// success e, dentro disso, o mais recente; ignora report vazio.
export function getLastReport(jobId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT report_text FROM job_runs
       WHERE job_id = ? AND report_text IS NOT NULL AND TRIM(report_text) <> ''
       ORDER BY (status = 'success') DESC, created_at DESC
       LIMIT 1`,
    )
    .get(jobId) as { report_text: string } | undefined
  return row ? row.report_text : null
}

// ---- Scheduler (Fase 2): consultas de vencidos + reconcile de órfãos ----

// Jobs elegíveis para disparo AGORA: habilitados e vencidos. O scheduler itera
// este snapshot e reivindica cada um via claimDueJob (que re-checa atômico) —
// aqui não há claim, só a listagem. Ordena por next_run_at pra disparar o mais
// atrasado primeiro.
export function listDueJobs(now: number): ScheduledJob[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC')
    .all(now) as ScheduledJobRow[]
  return rows.map(rowToJob)
}

// A run 'running' associada a uma sessão (sessions.id interno). Usado na captura
// no evento 'exit' do PTY pra ligar sessão→run. Só há uma run viva por sessão
// (o scheduler grava session_id ao transicionar scheduled→running).
export function getRunningRunBySession(sessionId: string): JobRun | null {
  const row = getDb()
    .prepare("SELECT * FROM job_runs WHERE session_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as JobRunRow | undefined
  return row ? rowToRun(row) : null
}

// Reconcile de boot: num processo fresco NENHUMA PTY das runs anteriores está
// viva, então toda run ainda 'running' é órfã → 'interrupted'. Chamado no start()
// do scheduler ANTES do catch-up (senão marcaria as runs recém-criadas do boot).
// Retorna o nº de runs reconciliadas.
export function reconcileOrphanRuns(now: number): number {
  const res = getDb()
    .prepare(
      "UPDATE job_runs SET status = 'interrupted', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'",
    )
    .run(now)
  return res.changes
}
