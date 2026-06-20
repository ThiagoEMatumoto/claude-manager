import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  AddEvidenceInput,
  AddSourceInput,
  CreateDossierInput,
  CreateDossierRunInput,
  Dossier,
  DossierRun,
  DossierRunStatus,
  DossierStatus,
  EvidenceRecord,
  EvidenceState,
  Source,
  SourceClass,
  SourceStatus,
  TrustTier,
} from '../../../shared/types/ipc'

// ---- Dossiers ----

interface DossierRow {
  id: string
  title: string
  question: string
  source_classes: string
  budget_tokens: number | null
  status: string
  created_at: number
  updated_at: number
}

function toDossier(row: DossierRow): Dossier {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    sourceClasses: JSON.parse(row.source_classes) as SourceClass[],
    budgetTokens: row.budget_tokens,
    status: row.status as DossierStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getDossierRow(id: string): DossierRow | undefined {
  return getDb().prepare('SELECT * FROM dossiers WHERE id = ?').get(id) as DossierRow | undefined
}

function freshDossier(id: string): Dossier {
  const row = getDossierRow(id)
  if (!row) throw new Error(`dossier not found: ${id}`)
  return toDossier(row)
}

export function createDossier(input: CreateDossierInput): Dossier {
  const now = Date.now()
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO dossiers
         (id, title, question, source_classes, budget_tokens, status, created_at, updated_at)
       VALUES (@id, @title, @question, @source_classes, @budget_tokens, @status, @created_at, @updated_at)`,
    )
    .run({
      id,
      title: input.title,
      question: input.question,
      source_classes: JSON.stringify(input.sourceClasses),
      budget_tokens: input.budgetTokens ?? null,
      status: input.status ?? 'active',
      created_at: now,
      updated_at: now,
    })
  return freshDossier(id)
}

export function getDossier(id: string): Dossier | null {
  const row = getDossierRow(id)
  return row ? toDossier(row) : null
}

export function listDossiers(opts?: { status?: DossierStatus }): Dossier[] {
  const db = getDb()
  // rowid DESC desempata criações no mesmo ms (ordem de inserção = mais recente).
  const rows = (
    opts?.status !== undefined
      ? db
          .prepare('SELECT * FROM dossiers WHERE status = ? ORDER BY created_at DESC, rowid DESC')
          .all(opts.status)
      : db.prepare('SELECT * FROM dossiers ORDER BY created_at DESC, rowid DESC').all()
  ) as DossierRow[]
  return rows.map(toDossier)
}

// Patch parcial dos campos mutáveis. Campos omitidos preservam o valor atual.
export function updateDossier(
  id: string,
  patch: {
    title?: string
    question?: string
    sourceClasses?: SourceClass[]
    budgetTokens?: number | null
    status?: DossierStatus
  },
): Dossier {
  const sets: string[] = []
  const params: Record<string, unknown> = { id, updated_at: Date.now() }
  if (patch.title !== undefined) {
    sets.push('title = @title')
    params.title = patch.title
  }
  if (patch.question !== undefined) {
    sets.push('question = @question')
    params.question = patch.question
  }
  if (patch.sourceClasses !== undefined) {
    sets.push('source_classes = @source_classes')
    params.source_classes = JSON.stringify(patch.sourceClasses)
  }
  if (patch.budgetTokens !== undefined) {
    sets.push('budget_tokens = @budget_tokens')
    params.budget_tokens = patch.budgetTokens
  }
  if (patch.status !== undefined) {
    sets.push('status = @status')
    params.status = patch.status
  }
  sets.push('updated_at = @updated_at')
  getDb()
    .prepare(`UPDATE dossiers SET ${sets.join(', ')} WHERE id = @id`)
    .run(params)
  return freshDossier(id)
}

export function archiveDossier(id: string): Dossier {
  getDb()
    .prepare('UPDATE dossiers SET status = ?, updated_at = ? WHERE id = ?')
    .run('archived', Date.now(), id)
  return freshDossier(id)
}

// ---- Dossier runs ----

interface DossierRunRow {
  id: string
  dossier_id: string
  status: string
  stage: string | null
  plan_json: string | null
  checkpoint_json: string | null
  cost_tokens: number
  summary: string | null
  error: string | null
  started_at: number
  updated_at: number
  finished_at: number | null
}

const TERMINAL_RUN_STATUSES: ReadonlySet<DossierRunStatus> = new Set(['done', 'failed'])

function toRun(row: DossierRunRow): DossierRun {
  return {
    id: row.id,
    dossierId: row.dossier_id,
    status: row.status as DossierRunStatus,
    stage: row.stage,
    planJson: row.plan_json,
    checkpointJson: row.checkpoint_json,
    costTokens: row.cost_tokens,
    summary: row.summary,
    error: row.error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  }
}

function getRunRow(id: string): DossierRunRow | undefined {
  return getDb().prepare('SELECT * FROM dossier_runs WHERE id = ?').get(id) as
    | DossierRunRow
    | undefined
}

function freshRun(id: string): DossierRun {
  const row = getRunRow(id)
  if (!row) throw new Error(`dossier run not found: ${id}`)
  return toRun(row)
}

export function createRun(input: CreateDossierRunInput): DossierRun {
  const now = Date.now()
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO dossier_runs
         (id, dossier_id, status, stage, plan_json, checkpoint_json, cost_tokens,
          summary, error, started_at, updated_at, finished_at)
       VALUES (@id, @dossier_id, @status, @stage, @plan_json, @checkpoint_json, @cost_tokens,
               @summary, @error, @started_at, @updated_at, @finished_at)`,
    )
    .run({
      id,
      dossier_id: input.dossierId,
      status: input.status ?? 'planning',
      stage: input.stage ?? null,
      plan_json: input.planJson ?? null,
      checkpoint_json: input.checkpointJson ?? null,
      cost_tokens: 0,
      summary: null,
      error: null,
      started_at: now,
      updated_at: now,
      finished_at: null,
    })
  return freshRun(id)
}

export function getRun(id: string): DossierRun | null {
  const row = getRunRow(id)
  return row ? toRun(row) : null
}

export function listRuns(dossierId: string): DossierRun[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM dossier_runs WHERE dossier_id = ? ORDER BY started_at DESC, rowid DESC',
    )
    .all(dossierId) as DossierRunRow[]
  return rows.map(toRun)
}

// Patch dos campos mutáveis da run. Ao entrar num estado terminal (done/failed),
// carimba finished_at automaticamente (a menos que o caller passe um valor).
export function updateRun(
  id: string,
  patch: {
    status?: DossierRunStatus
    stage?: string | null
    planJson?: string | null
    summary?: string | null
    error?: string | null
    costTokens?: number
    finishedAt?: number | null
  },
): DossierRun {
  const now = Date.now()
  const sets: string[] = []
  const params: Record<string, unknown> = { id, updated_at: now }
  if (patch.status !== undefined) {
    sets.push('status = @status')
    params.status = patch.status
  }
  if (patch.stage !== undefined) {
    sets.push('stage = @stage')
    params.stage = patch.stage
  }
  if (patch.planJson !== undefined) {
    sets.push('plan_json = @plan_json')
    params.plan_json = patch.planJson
  }
  if (patch.summary !== undefined) {
    sets.push('summary = @summary')
    params.summary = patch.summary
  }
  if (patch.error !== undefined) {
    sets.push('error = @error')
    params.error = patch.error
  }
  if (patch.costTokens !== undefined) {
    sets.push('cost_tokens = @cost_tokens')
    params.cost_tokens = patch.costTokens
  }
  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = @finished_at')
    params.finished_at = patch.finishedAt
  } else if (patch.status !== undefined && TERMINAL_RUN_STATUSES.has(patch.status)) {
    sets.push('finished_at = @finished_at')
    params.finished_at = now
  }
  sets.push('updated_at = @updated_at')
  getDb()
    .prepare(`UPDATE dossier_runs SET ${sets.join(', ')} WHERE id = @id`)
    .run(params)
  return freshRun(id)
}

// Grava o checkpoint serializado após um estágio, opcionalmente avançando o
// status/stage. Permite retomar a run após um throttle (não re-paga fetch).
export function checkpointRun(
  id: string,
  checkpointJson: string,
  opts?: { status?: DossierRunStatus; stage?: string | null; costTokens?: number },
): DossierRun {
  const now = Date.now()
  const sets = ['checkpoint_json = @checkpoint_json', 'updated_at = @updated_at']
  const params: Record<string, unknown> = {
    id,
    checkpoint_json: checkpointJson,
    updated_at: now,
  }
  if (opts?.status !== undefined) {
    sets.push('status = @status')
    params.status = opts.status
  }
  if (opts?.stage !== undefined) {
    sets.push('stage = @stage')
    params.stage = opts.stage
  }
  if (opts?.costTokens !== undefined) {
    sets.push('cost_tokens = @cost_tokens')
    params.cost_tokens = opts.costTokens
  }
  getDb()
    .prepare(`UPDATE dossier_runs SET ${sets.join(', ')} WHERE id = @id`)
    .run(params)
  return freshRun(id)
}

// ---- Sources ----

interface SourceRow {
  id: string
  dossier_run_id: string
  url: string
  title: string | null
  publisher: string | null
  source_class: string
  trust_tier: string
  retrieved_at: number | null
  content_ref: string | null
  status: string
  created_at: number
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    dossierRunId: row.dossier_run_id,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    sourceClass: row.source_class as SourceClass,
    trustTier: row.trust_tier as TrustTier,
    retrievedAt: row.retrieved_at,
    contentRef: row.content_ref,
    status: row.status as SourceStatus,
    createdAt: row.created_at,
  }
}

export function addSource(input: AddSourceInput): Source {
  const now = Date.now()
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO sources
         (id, dossier_run_id, url, title, publisher, source_class, trust_tier,
          retrieved_at, content_ref, status, created_at)
       VALUES (@id, @dossier_run_id, @url, @title, @publisher, @source_class, @trust_tier,
               @retrieved_at, @content_ref, @status, @created_at)`,
    )
    .run({
      id,
      dossier_run_id: input.dossierRunId,
      url: input.url,
      title: input.title ?? null,
      publisher: input.publisher ?? null,
      source_class: input.sourceClass,
      trust_tier: input.trustTier,
      retrieved_at: input.retrievedAt ?? null,
      content_ref: input.contentRef ?? null,
      status: input.status ?? 'snippet',
      created_at: now,
    })
  const row = getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow
  return toSource(row)
}

export function getSource(id: string): Source | null {
  const row = getDb().prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
  return row ? toSource(row) : null
}

export function listSources(dossierRunId: string): Source[] {
  const rows = getDb()
    .prepare('SELECT * FROM sources WHERE dossier_run_id = ? ORDER BY created_at ASC')
    .all(dossierRunId) as SourceRow[]
  return rows.map(toSource)
}

// Promove uma source de 'snippet' para 'fetched' (ou 'failed') após a ingestão.
// Carimba retrieved_at/content_ref quando a página/transcrição foi baixada.
// Campos omitidos preservam o valor atual.
export function updateSource(
  id: string,
  patch: {
    title?: string | null
    status?: SourceStatus
    retrievedAt?: number | null
    contentRef?: string | null
  },
): Source {
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  if (patch.title !== undefined) {
    sets.push('title = @title')
    params.title = patch.title
  }
  if (patch.status !== undefined) {
    sets.push('status = @status')
    params.status = patch.status
  }
  if (patch.retrievedAt !== undefined) {
    sets.push('retrieved_at = @retrieved_at')
    params.retrieved_at = patch.retrievedAt
  }
  if (patch.contentRef !== undefined) {
    sets.push('content_ref = @content_ref')
    params.content_ref = patch.contentRef
  }
  if (sets.length === 0) {
    const current = getSource(id)
    if (!current) throw new Error(`source not found: ${id}`)
    return current
  }
  getDb()
    .prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = @id`)
    .run(params)
  const updated = getSource(id)
  if (!updated) throw new Error(`source not found: ${id}`)
  return updated
}

// ---- Evidence records ----

interface EvidenceRow {
  id: string
  dossier_run_id: string
  source_id: string
  claim: string
  verbatim_quote: string
  anchor: string | null
  state: string
  importance: number
  corroborated_by_json: string | null
  contradicted_by_json: string | null
  created_at: number
}

function toEvidence(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    dossierRunId: row.dossier_run_id,
    sourceId: row.source_id,
    claim: row.claim,
    verbatimQuote: row.verbatim_quote,
    anchor: row.anchor,
    state: row.state as EvidenceState,
    importance: row.importance,
    corroboratedByJson: row.corroborated_by_json,
    contradictedByJson: row.contradicted_by_json,
    createdAt: row.created_at,
  }
}

export function addEvidence(input: AddEvidenceInput): EvidenceRecord {
  const now = Date.now()
  const id = input.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO evidence_records
         (id, dossier_run_id, source_id, claim, verbatim_quote, anchor, state,
          importance, corroborated_by_json, contradicted_by_json, created_at)
       VALUES (@id, @dossier_run_id, @source_id, @claim, @verbatim_quote, @anchor, @state,
               @importance, @corroborated_by_json, @contradicted_by_json, @created_at)`,
    )
    .run({
      id,
      dossier_run_id: input.dossierRunId,
      source_id: input.sourceId,
      claim: input.claim,
      verbatim_quote: input.verbatimQuote,
      anchor: input.anchor ?? null,
      state: input.state,
      importance: input.importance ?? 0,
      corroborated_by_json:
        input.corroboratedBy != null ? JSON.stringify(input.corroboratedBy) : null,
      contradicted_by_json:
        input.contradictedBy != null ? JSON.stringify(input.contradictedBy) : null,
      created_at: now,
    })
  const row = getDb().prepare('SELECT * FROM evidence_records WHERE id = ?').get(id) as EvidenceRow
  return toEvidence(row)
}

export function getEvidence(id: string): EvidenceRecord | null {
  const row = getDb().prepare('SELECT * FROM evidence_records WHERE id = ?').get(id) as
    | EvidenceRow
    | undefined
  return row ? toEvidence(row) : null
}

export function listEvidence(dossierRunId: string): EvidenceRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM evidence_records WHERE dossier_run_id = ? ORDER BY created_at ASC')
    .all(dossierRunId) as EvidenceRow[]
  return rows.map(toEvidence)
}

// Atualiza só o state de verificação de um record (estágio 4 do funil). Não toca
// na proveniência (claim/quote/anchor permanecem imutáveis após a extração).
export function updateEvidenceState(id: string, state: EvidenceState): EvidenceRecord {
  getDb().prepare('UPDATE evidence_records SET state = ? WHERE id = ?').run(state, id)
  const record = getEvidence(id)
  if (!record) throw new Error(`evidence record not found: ${id}`)
  return record
}

// Remove um record (poda no Gate B). Hard delete: o usuário decidiu que não entra
// na síntese.
export function deleteEvidence(id: string): void {
  getDb().prepare('DELETE FROM evidence_records WHERE id = ?').run(id)
}
