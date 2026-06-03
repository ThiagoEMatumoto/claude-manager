import { BrowserWindow } from 'electron'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { getDb } from './db'
import { PROJECTS_ROOT } from './session-activity'
import { resolvePrice } from './metrics-pricing'
import type {
  MetricsDayPoint,
  MetricsProjectRow,
  MetricsScanProgress,
  MetricsSessionRow,
  MetricsSnapshot,
  MetricsToolRow,
  MetricsTotals,
  MetricsTypeBucket,
  MetricsWindow,
  SessionType,
} from '../../../shared/types/ipc'

const PROGRESS_EVERY = 25
const NO_PROJECT_NAME = 'Sem projeto'

// Modelo sintético do Claude Code: linhas locais sem chamada de API real (0 usage).
// Não é um modelo cobrável — fica fora de unknownModels pra não poluir o aviso.
const SYNTHETIC_MODEL = '<synthetic>'

interface PerDayBucket {
  tokens: number
  cost: number
  turns: number
}

// Agregado em memória de uma sessão durante o scan; espelha o schema da row.
interface SessionAgg {
  ccSessionId: string
  cwd: string | null
  firstTs: number | null
  lastTs: number | null
  turns: number
  agentCalls: number
  skillCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  models: Set<string>
  tools: Record<string, number>
  perDay: Record<string, PerDayBucket>
  unknownModels: Set<string>
  agentRounds: number
  parallelRounds: number
  inlineExploreCalls: number
  subagentTypeCounts: Record<string, number>
}

// Ferramentas inline de exploração (denominador do inline-delegation ratio).
const INLINE_EXPLORE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash']

interface ContentItem {
  type?: string
  name?: string
  input?: {
    subagent_type?: string
  }
}

interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface TranscriptLine {
  type?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  message?: {
    role?: string
    model?: string
    content?: ContentItem[]
    usage?: Usage
  }
}

// Linha do cache persistido (metrics_session_cache).
interface CacheRow {
  transcript_path: string
  cc_session_id: string
  cwd: string | null
  mtime_ms: number
  size_bytes: number
  first_ts: number | null
  last_ts: number | null
  turns: number
  agent_calls: number
  skill_calls: number
  session_type: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
  models_json: string
  tools_json: string
  per_day_json: string
  scanned_at: number
  agent_rounds: number
  parallel_rounds: number
  inline_explore_calls: number
  subagent_type_counts_json: string
}

// Precedência exata (espelha ops-hub):
// agent_calls >= 5 → agent_orchestration; turns >= 50 → deep_solo;
// turns >= 10 → iteration; senão quick_chat.
function classify(turns: number, agentCalls: number): SessionType {
  if (agentCalls >= 5) return 'agent_orchestration'
  if (turns >= 50) return 'deep_solo'
  if (turns >= 10) return 'iteration'
  return 'quick_chat'
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// Lista todos os transcripts (todos subdirs × todos os *.jsonl), não só por id.
function listTranscripts(): string[] {
  if (!existsSync(PROJECTS_ROOT)) return []
  const out: string[] = []
  let dirs: string[]
  try {
    dirs = readdirSync(PROJECTS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return out
  }
  for (const dir of dirs) {
    const dirPath = join(PROJECTS_ROOT, dir)
    let files: string[]
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) out.push(join(dirPath, file))
  }
  return out
}

// Parse incremental linha-a-linha via stream; tolerante (try/catch por linha).
async function parseTranscript(path: string): Promise<SessionAgg> {
  const agg: SessionAgg = {
    ccSessionId: '',
    cwd: null,
    firstTs: null,
    lastTs: null,
    turns: 0,
    agentCalls: 0,
    skillCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    models: new Set(),
    tools: {},
    perDay: {},
    unknownModels: new Set(),
    agentRounds: 0,
    parallelRounds: 0,
    inlineExploreCalls: 0,
    subagentTypeCounts: {},
  }

  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const raw of rl) {
    const line = raw.trim()
    if (!line) continue
    let obj: TranscriptLine
    try {
      obj = JSON.parse(line) as TranscriptLine
    } catch {
      continue // linha inválida ou em escrita parcial — ignorar.
    }

    if (obj.sessionId && !agg.ccSessionId) agg.ccSessionId = obj.sessionId
    if (obj.cwd && !agg.cwd) agg.cwd = obj.cwd

    let lineMs: number | null = null
    if (obj.timestamp) {
      const parsed = Date.parse(obj.timestamp)
      if (!Number.isNaN(parsed)) {
        lineMs = parsed
        if (agg.firstTs === null || parsed < agg.firstTs) agg.firstTs = parsed
        if (agg.lastTs === null || parsed > agg.lastTs) agg.lastTs = parsed
      }
    }

    if (obj.type !== 'assistant') continue

    agg.turns += 1
    const msg = obj.message
    if (!msg) continue

    const model = typeof msg.model === 'string' ? msg.model : null
    if (model && model !== SYNTHETIC_MODEL) agg.models.add(model)

    // Tools + agent/skill calls a partir de content[].
    if (Array.isArray(msg.content)) {
      // Agent tool_use desta message (para agentRounds/parallelRounds).
      let agentInMessage = 0
      for (const item of msg.content) {
        if (item?.type !== 'tool_use' || typeof item.name !== 'string') continue
        const toolName = item.name
        agg.tools[toolName] = (agg.tools[toolName] ?? 0) + 1
        if (toolName === 'Agent') {
          agg.agentCalls += 1
          agentInMessage += 1
          const subagentType =
            typeof item.input?.subagent_type === 'string' ? item.input.subagent_type : 'unknown'
          agg.subagentTypeCounts[subagentType] =
            (agg.subagentTypeCounts[subagentType] ?? 0) + 1
        } else if (toolName === 'Skill') agg.skillCalls += 1
      }
      if (agentInMessage >= 1) agg.agentRounds += 1
      if (agentInMessage >= 2) agg.parallelRounds += 1
    }

    // Tokens + custo a partir de usage × price table.
    const usage = msg.usage
    if (!usage) continue
    const input = usage.input_tokens ?? 0
    const output = usage.output_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const cacheWrite = usage.cache_creation_input_tokens ?? 0
    agg.inputTokens += input
    agg.outputTokens += output
    agg.cacheReadTokens += cacheRead
    agg.cacheWriteTokens += cacheWrite

    let lineCost = 0
    if (model && model !== SYNTHETIC_MODEL) {
      const price = resolvePrice(model)
      if (price) {
        lineCost =
          input * price.input +
          output * price.output +
          cacheRead * price.cacheRead +
          cacheWrite * price.cacheWrite
      } else {
        agg.unknownModels.add(model)
      }
    }
    agg.costUsd += lineCost

    // per_day bucket pelo timestamp da linha (tokens = input+output+cache).
    if (lineMs !== null) {
      const key = dayKey(lineMs)
      const bucket = agg.perDay[key] ?? { tokens: 0, cost: 0, turns: 0 }
      bucket.tokens += input + output + cacheRead + cacheWrite
      bucket.cost += lineCost
      bucket.turns += 1
      agg.perDay[key] = bucket
    }
  }

  // Deriva inlineExploreCalls do dict de tools já acumulado.
  for (const tool of INLINE_EXPLORE_TOOLS) {
    agg.inlineExploreCalls += agg.tools[tool] ?? 0
  }

  return agg
}

// ===== Scan incremental: statSync guard + INSERT OR REPLACE =====

export async function scan(): Promise<void> {
  const db = getDb()
  const transcripts = listTranscripts()
  const total = transcripts.length

  const existing = db
    .prepare('SELECT transcript_path, mtime_ms, size_bytes FROM metrics_session_cache')
    .all() as Array<{ transcript_path: string; mtime_ms: number; size_bytes: number }>
  const guard = new Map<string, { mtime: number; size: number }>()
  for (const r of existing) guard.set(r.transcript_path, { mtime: r.mtime_ms, size: r.size_bytes })

  const upsert = db.prepare(
    `INSERT OR REPLACE INTO metrics_session_cache
       (transcript_path, cc_session_id, cwd, mtime_ms, size_bytes, first_ts, last_ts,
        turns, agent_calls, skill_calls, session_type,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
        models_json, tools_json, per_day_json, scanned_at,
        agent_rounds, parallel_rounds, inline_explore_calls, subagent_type_counts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  let processed = 0
  for (const path of transcripts) {
    let mtimeMs: number
    let sizeBytes: number
    try {
      const st = statSync(path)
      mtimeMs = st.mtimeMs
      sizeBytes = st.size
    } catch {
      processed += 1
      continue
    }

    const prev = guard.get(path)
    const unchanged = prev && prev.mtime === mtimeMs && prev.size === sizeBytes
    if (!unchanged) {
      try {
        const agg = await parseTranscript(path)
        const sessionType = classify(agg.turns, agg.agentCalls)
        upsert.run(
          path,
          agg.ccSessionId,
          agg.cwd,
          mtimeMs,
          sizeBytes,
          agg.firstTs,
          agg.lastTs,
          agg.turns,
          agg.agentCalls,
          agg.skillCalls,
          sessionType,
          agg.inputTokens,
          agg.outputTokens,
          agg.cacheReadTokens,
          agg.cacheWriteTokens,
          agg.costUsd,
          JSON.stringify([...agg.models]),
          JSON.stringify(agg.tools),
          JSON.stringify(agg.perDay),
          Date.now(),
          agg.agentRounds,
          agg.parallelRounds,
          agg.inlineExploreCalls,
          JSON.stringify(agg.subagentTypeCounts),
        )
      } catch {
        // arquivo ilegível — pula sem derrubar o scan inteiro.
      }
    }

    processed += 1
    if (processed % PROGRESS_EVERY === 0 || processed === total) {
      emitProgress({ processed, total, done: false })
    }
  }

  emitProgress({ processed, total, done: true })
}

function emitProgress(p: MetricsScanProgress): void {
  broadcast('metrics:progress', p)
}

// ===== Agregador: cache rows → snapshot, filtra por janela, JOIN de projeto =====

function windowCutoff(window: MetricsWindow): number {
  if (window === 'all') return 0
  const days = window === '7d' ? 7 : 30
  return Date.now() - days * 24 * 60 * 60 * 1000
}

// Índice de repos cadastrados, ordenado por comprimento de path DESC para
// longest-prefix-wins (um path mais específico vence o pai). Path normalizado
// (sem barra final). Não persistido (estado mutável) — resolvido em runtime.
interface RepoEntry {
  path: string
  projectId: string
  projectName: string
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, '')
}

function buildRepoIndex(): RepoEntry[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT r.path AS path, p.id AS pid, p.name AS pname
       FROM repos r
       JOIN projects p ON p.id = r.project_id
       WHERE r.path IS NOT NULL AND r.path <> ''`,
    )
    .all() as Array<{ path: string; pid: string; pname: string }>
  const entries: RepoEntry[] = rows.map((r) => ({
    path: normalizePath(r.path),
    projectId: r.pid,
    projectName: r.pname,
  }))
  entries.sort((a, b) => b.path.length - a.path.length)
  return entries
}

// Deriva o label de fallback (sem repo cadastrado): worktrees agrupam no repo
// (basename antes de /.worktrees/); senão basename do cwd.
function folderLabel(cwd: string): string {
  const wtIdx = cwd.indexOf('/.worktrees/')
  const base = wtIdx >= 0 ? cwd.slice(0, wtIdx) : normalizePath(cwd)
  const parts = base.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : base
}

// cwd → { projectId, projectName }. Match com repo cadastrado (longest-prefix)
// → projeto real; senão bucket por pasta (projectId null).
function attribute(
  cwd: string | null,
  repoIndex: RepoEntry[],
): { projectId: string | null; projectName: string } {
  if (!cwd) return { projectId: null, projectName: NO_PROJECT_NAME }
  const normalized = normalizePath(cwd)
  for (const repo of repoIndex) {
    if (normalized === repo.path || normalized.startsWith(repo.path + '/')) {
      return { projectId: repo.projectId, projectName: repo.projectName }
    }
  }
  return { projectId: null, projectName: folderLabel(cwd) }
}

export function aggregate(window: MetricsWindow, scanned: boolean): MetricsSnapshot {
  const db = getDb()
  const cutoff = windowCutoff(window)
  const repoIndex = buildRepoIndex()

  const rows = db
    .prepare('SELECT * FROM metrics_session_cache WHERE last_ts IS NULL OR last_ts >= ?')
    .all(window === 'all' ? -1 : cutoff) as CacheRow[]

  const totals: MetricsTotals = {
    sessions: 0,
    turns: 0,
    agentCalls: 0,
    skillCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    cacheHitRate: 0,
    parallelizationRatio: 0,
    inlineDelegationRatio: 0,
  }
  // Acumuladores das métricas de orquestração (somados sobre as sessões da janela).
  let totalAgentRounds = 0
  let totalParallelRounds = 0
  let totalInlineExploreCalls = 0
  const subagentTypeMap = new Map<string, number>()
  const perDayMap = new Map<string, MetricsDayPoint>()
  const perSession: MetricsSessionRow[] = []
  const perProjectMap = new Map<string, MetricsProjectRow>()
  const typeMap = new Map<SessionType, MetricsTypeBucket>()
  const toolMap = new Map<string, number>()
  const unknownModels = new Set<string>()

  for (const row of rows) {
    totals.sessions += 1
    totals.turns += row.turns
    totals.agentCalls += row.agent_calls
    totals.skillCalls += row.skill_calls
    totals.inputTokens += row.input_tokens
    totals.outputTokens += row.output_tokens
    totals.cacheReadTokens += row.cache_read_tokens
    totals.cacheWriteTokens += row.cache_write_tokens
    totals.costUsd += row.cost_usd

    const sessionType = row.session_type as SessionType
    const tokens =
      row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens

    // Atribuição de projeto por cwd.
    const attr = attribute(row.cwd, repoIndex)
    const projectId = attr.projectId
    const projectName = attr.projectName

    perSession.push({
      ccSessionId: row.cc_session_id,
      title: null,
      sessionType,
      turns: row.turns,
      agentCalls: row.agent_calls,
      costUsd: row.cost_usd,
      lastTs: row.last_ts,
      projectId,
      projectName,
    })

    // per_project. Buckets de pasta (projectId null) precisam ser separados por
    // nome — senão todos os fallbacks se fundiriam numa chave só.
    const projKey = projectId ?? 'folder:' + projectName
    const proj =
      perProjectMap.get(projKey) ??
      ({ projectId, projectName, sessions: 0, turns: 0, costUsd: 0, tokens: 0 } as MetricsProjectRow)
    proj.sessions += 1
    proj.turns += row.turns
    proj.costUsd += row.cost_usd
    proj.tokens += tokens
    perProjectMap.set(projKey, proj)

    // distribuição por tipo.
    const bucket =
      typeMap.get(sessionType) ??
      ({ type: sessionType, sessions: 0, turns: 0, costUsd: 0 } as MetricsTypeBucket)
    bucket.sessions += 1
    bucket.turns += row.turns
    bucket.costUsd += row.cost_usd
    typeMap.set(sessionType, bucket)

    // modelos sem preço → custo parcial (deriva de models_json, sem schema novo).
    try {
      const models = JSON.parse(row.models_json) as string[]
      for (const m of models) {
        if (!resolvePrice(m)) unknownModels.add(m)
      }
    } catch {
      // models_json corrompido — ignora.
    }

    // tools.
    try {
      const tools = JSON.parse(row.tools_json) as Record<string, number>
      for (const [name, count] of Object.entries(tools)) {
        toolMap.set(name, (toolMap.get(name) ?? 0) + count)
      }
    } catch {
      // tools_json corrompido — ignora.
    }

    // orquestração: rounds + inline explore + distribuição de subagent_type.
    totalAgentRounds += row.agent_rounds
    totalParallelRounds += row.parallel_rounds
    totalInlineExploreCalls += row.inline_explore_calls
    try {
      const counts = JSON.parse(row.subagent_type_counts_json) as Record<string, number>
      for (const [type, count] of Object.entries(counts)) {
        subagentTypeMap.set(type, (subagentTypeMap.get(type) ?? 0) + count)
      }
    } catch {
      // subagent_type_counts_json corrompido — ignora.
    }

    // per_day.
    try {
      const perDay = JSON.parse(row.per_day_json) as Record<string, PerDayBucket>
      for (const [day, b] of Object.entries(perDay)) {
        const point =
          perDayMap.get(day) ??
          ({ day, tokens: 0, costUsd: 0, turns: 0, sessions: 0 } as MetricsDayPoint)
        point.tokens += b.tokens
        point.costUsd += b.cost
        point.turns += b.turns
        point.sessions += 1
        perDayMap.set(day, point)
      }
    } catch {
      // per_day_json corrompido — ignora.
    }
  }

  const cacheBase = totals.cacheReadTokens + totals.inputTokens
  totals.cacheHitRate = cacheBase > 0 ? totals.cacheReadTokens / cacheBase : 0

  totals.parallelizationRatio =
    totalAgentRounds > 0 ? totalParallelRounds / totalAgentRounds : 0
  const delegationBase = totals.agentCalls + totalInlineExploreCalls
  totals.inlineDelegationRatio = delegationBase > 0 ? totals.agentCalls / delegationBase : 0

  const subagentTypeDistribution = [...subagentTypeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  const perDay = [...perDayMap.values()].sort((a, b) => a.day.localeCompare(b.day))
  const perProject = [...perProjectMap.values()].sort((a, b) => b.costUsd - a.costUsd)
  const sessionTypeDistribution = [...typeMap.values()]
  const topTools: MetricsToolRow[] = [...toolMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
  perSession.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0))

  return {
    window,
    generatedAt: Date.now(),
    scanned,
    totals,
    perDay,
    perSession,
    perProject,
    sessionTypeDistribution,
    subagentTypeDistribution,
    topTools,
    unknownModels: [...unknownModels],
  }
}

// get(window): agrega sem rescan, exceto quando o cache está vazio (ex: logo
// após a migration 006 limpar) — aí faz um scan pra repopular com cwd.
export async function getMetrics(window: MetricsWindow): Promise<MetricsSnapshot> {
  const db = getDb()
  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM metrics_session_cache').get() as { n: number }
  ).n
  if (count === 0) {
    await scan()
    return aggregate(window, true)
  }
  return aggregate(window, false)
}

export async function refreshMetrics(window: MetricsWindow = 'all'): Promise<MetricsSnapshot> {
  await scan()
  return aggregate(window, true)
}
