import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { runClaudeJson, type RunOpts, type RunResult } from './claude-cli'
import * as jobStore from './scheduled-job-store'
import { composeJobKickoff } from './job-kickoff'
import { getDb } from './db'
import {
  resolvePermissionMode,
  resolveJobDisallowedTools,
  resolveModel,
  resolveEffort,
  resolveAdvisor,
  isObserveOnlyMode,
} from './spawn-flags'
import type {
  AdvisorModel,
  CaptureQuality,
  EffortLevel,
  JobRun,
  PermissionMode,
} from '../../../shared/types/ipc'

// Runner de Scheduled Jobs (Fase 2, HEADLESS). Antes o job subia num PTY interativo
// (`claude` sem -p): o processo NUNCA saía após o turno e a captura no evento 'exit'
// jamais disparava → a run ficava presa em 'running' (em plan mode ainda travava no
// ExitPlanMode). Migramos para `claude -p` via execFile: processa, sai com exit code,
// stdout = JSON com o relatório final em `.result`. O runner finaliza a JobRun DIRETO
// (sem depender de PTY nem do MCP job_report — a captura por stdout funciona mesmo
// com o app real do usuário aberto). Reusa a resolução de path/env de claude-cli.ts.

// Timeout generoso: um job pode fazer trabalho real (auditar extrações etc). Estouro
// vira 'failed' — a run NUNCA fica presa em 'running' (o bug que esta migração corrige).
const JOB_TIMEOUT_MS = 10 * 60 * 1000

// Observe-only via `default` + read-only lockdown: o job roda em `default` (a crítica
// vai DIRETO pro stdout/.result; `plan` desviaria pro ExitPlanMode, indisponível em
// headless) mas o denylist bloqueia TODA escrita de arquivo (Write/Edit/MultiEdit/
// NotebookEdit) + as ops destrutivas de Bash — ver resolveJobDisallowedTools. Só cobre
// o caso permissionMode=null (jobs reais trazem o modo da row); modo autônomo exige
// opt-in explícito e é barrado pelo guard fail-closed.
const DEFAULT_PERMISSION_MODE: PermissionMode = 'default'
const SCRATCH_DIR_KEY = 'scratch_dir'

// Snapshot self-contained dos params resolvidos do job (nada de lookup de preset
// aqui): o scheduler passa exatamente o que foi gravado na row + o ccSessionId
// (== --session-id) que ele já gravou na run ao transicionar pra 'running'.
export interface JobRunParams {
  repoId: string | null
  name?: string | null
  prompt: string
  systemPrompt?: string | null
  model?: string | null
  effort?: EffortLevel | null
  // Observe-only por padrão: sem opt-in explícito, o job sobe read-only (plan).
  permissionMode?: PermissionMode | null
  advisorModel?: AdvisorModel | null
  disallowedTools?: string[] | null
  // id da JobRun desta execução — o runner finaliza ESTA run ao sair.
  runId?: string | null
  // report_text da execução anterior — injeta o delta no kickoff quando presente.
  previousReport?: string | null
  // --session-id do `claude -p`; gravado como cc_session_id da run pelo scheduler.
  ccSessionId: string
}

// Shape mínimo do JSON de `claude -p --output-format json` que consumimos: `.result`
// é o texto final do assistant; `usage` traz os tokens; `is_error` sinaliza falha
// lógica (raro num exit 0). Campos extras (session_id, cost, etc) são ignorados.
export interface ClaudeHeadlessResult {
  result?: unknown
  is_error?: boolean
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface JobRunnerDeps {
  // Assinatura concreta (não-genérica) do runClaudeJson — o runner sempre consome
  // o shape ClaudeHeadlessResult. Facilita injetar um stub no teste sem generics.
  runJson?: (
    args: string[],
    opts?: RunOpts,
  ) => Promise<{ data: ClaudeHeadlessResult | null; result: RunResult }>
  updateRun?: (input: Parameters<typeof jobStore.updateRun>[0]) => JobRun
  resolveCwd?: (repoId: string | null) => string
  now?: () => number
}

// cwd do processo claude: path do repo, ou a pasta scratch da sessão avulsa (mesma
// resolução do spawn interativo — default ~/ClaudeManager/scratch, sem electron).
function defaultResolveCwd(repoId: string | null): string {
  const db = getDb()
  if (repoId) {
    const row = db.prepare('SELECT path FROM repos WHERE id = ?').get(repoId) as
      | { path: string }
      | undefined
    if (!row) throw new Error(`repo not found: ${repoId}`)
    return row.path
  }
  const row = db.prepare('SELECT value FROM app_prefs WHERE key = ?').get(SCRATCH_DIR_KEY) as
    | { value: string }
    | undefined
  const dir = row?.value?.trim() || join(homedir(), 'ClaudeManager', 'scratch')
  mkdirSync(dir, { recursive: true })
  return dir
}

// Monta os args do `claude -p` headless (array pra execFile — sem shell/quoting).
// Ordem imita buildSpawnInnerCmd e re-valida cada flag contra a whitelist (o main é
// a autoridade; nada fora da whitelist chega à CLI). O kickoff (prompt + delta +
// instrução job_report) é o valor POSICIONAL do -p.
export function buildHeadlessArgs(params: JobRunParams): string[] {
  const mode = resolvePermissionMode(params.permissionMode) ?? DEFAULT_PERMISSION_MODE
  const args = [
    '-p',
    composeJobKickoff(params),
    '--session-id',
    params.ccSessionId,
    '--output-format',
    'json',
    '--permission-mode',
    mode,
  ]
  const model = resolveModel(params.model)
  if (model) args.push('--model', model)
  const effort = resolveEffort(params.effort)
  if (effort) args.push('--effort', effort)
  const advisor = resolveAdvisor(params.advisorModel)
  if (advisor) args.push('--advisor', advisor)
  // Job HEADLESS recebe SEMPRE o denylist destrutivo — inclusive default/plan (roda
  // sem supervisão, nenhum modo fica sem o guard-rail). Ver resolveJobDisallowedTools.
  const deny = resolveJobDisallowedTools(params.disallowedTools)
  if (deny.length > 0) args.push('--disallowedTools', ...deny)
  const systemPrompt = params.systemPrompt?.trim()
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
  return args
}

// full se veio texto; none se a sessão saiu sem relatório (evita marcar success
// silencioso sem conteúdo). Headless entrega o stdout íntegro, então 'partial'
// (truncamento) não ocorre aqui — o enum mantém a paridade com a captura antiga.
function classifyCapture(text: string | null): CaptureQuality {
  return text && text.trim().length > 0 ? 'full' : 'none'
}

// tokens single-number: input + output do turno headless (snapshot, não cumulativo
// — sem consumidor até a Fase 3). null se o usage não veio.
function tokensOf(data: ClaudeHeadlessResult | null): number | null {
  const u = data?.usage
  if (!u) return null
  const total = (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
  return total > 0 ? total : null
}

// Executa o job em HEADLESS (`claude -p`), processa até o exit code e finaliza a
// JobRun DIRETO: success no exit 0 com relatório, senão failed. Async e
// fire-and-forget — o scheduler já transicionou a run pra 'running'. INVARIANTE:
// NUNCA lança. Todo caminho (cwd inexistente, spawn, timeout, exit≠0, parse) cai
// num updateRun('failed'), pra a run jamais ficar presa em 'running' (o bug que
// motivou a migração). O try/catch envolve o corpo inteiro (inclui resolveCwd).
export async function runJob(params: JobRunParams, deps: JobRunnerDeps = {}): Promise<void> {
  const runJson = deps.runJson ?? runClaudeJson
  const updateRun = deps.updateRun ?? jobStore.updateRun
  const resolveCwd = deps.resolveCwd ?? defaultResolveCwd
  const now = deps.now ?? (() => Date.now())

  const runId = params.runId
  if (!runId) return // sem run pra finalizar — não ocorre no fluxo do scheduler.

  // Guard fail-closed (defense-in-depth p/ o HIGH latente): jobs são MVP observe-only.
  // Se a row resolver para um modo NÃO-observe-only (autônomo), finaliza failed SEM
  // spawnar. As fronteiras MCP/UI já barram a criação; esta é a última linha — o
  // runner nunca confia cegamente na row.
  const mode = resolvePermissionMode(params.permissionMode) ?? DEFAULT_PERMISSION_MODE
  if (!isObserveOnlyMode(mode)) {
    updateRun({
      id: runId,
      status: 'failed',
      finishedAt: now(),
      error: `permissionMode autônomo (${mode}) não permitido em job agendado (MVP observe-only).`,
    })
    return
  }

  try {
    const cwd = resolveCwd(params.repoId)
    const args = buildHeadlessArgs(params)
    const { data, result } = await runJson(args, { cwd, timeoutMs: JOB_TIMEOUT_MS })

    const text = typeof data?.result === 'string' ? data.result : null
    const failed = result.code !== 0 || !data || data.is_error === true

    updateRun({
      id: runId,
      status: failed ? 'failed' : 'success',
      reportText: text,
      captureQuality: classifyCapture(text),
      tokens: tokensOf(data),
      finishedAt: now(),
      error: failed
        ? (result.stderr || '').trim() || `claude -p encerrou com exit code ${result.code}.`
        : null,
    })
  } catch (err) {
    updateRun({
      id: runId,
      status: 'failed',
      finishedAt: now(),
      error: String((err as Error)?.message ?? err),
    })
  }
}
