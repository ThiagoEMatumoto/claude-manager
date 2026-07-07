import * as jobStore from './scheduled-job-store'
import { spawnJobSession, type SpawnJobSessionParams, type SpawnJobSessionResult } from './job-runner'
import type { JobRun, ScheduledJob } from '../../../shared/types/ipc'

// Scheduler de Scheduled Jobs (Fase 2). Molde de calendar-watcher: um único timer
// de poll + flag anti-reentrância. Sem lib de cron — next_run_at é derivado do
// schedule num único helper (computeNextRunAt) no store, e o claim atômico
// (claimDueJob) evita double-fire quando o poll dispara duas vezes no mesmo tick.
//
// Boot (start): reconcileOrphanRuns (limpa runs 'running' do processo anterior)
// → catch-up dos vencidos (spawn se catch_up, senão marca 'missed') → agenda o
// poll. Nada de tick imediato: o catch-up já reivindicou tudo que estava vencido.

const POLL_INTERVAL_MS = 30 * 1000

export interface JobSchedulerDeps {
  // Relógio (default: Date.now). Injetável p/ teste determinístico.
  now?: () => number
  // Dispara a sessão do job (default: spawnJobSession). Injetável p/ teste — assim
  // o teste nunca toca o PTY/electron.
  spawn?: (params: SpawnJobSessionParams) => SpawnJobSessionResult
}

// Snapshot self-contained dos params de spawn a partir da row do job (imune a
// mudança de preset — o que foi gravado no job é o que roda).
function jobToSpawnParams(job: ScheduledJob): SpawnJobSessionParams {
  return {
    repoId: job.repoId,
    name: job.name,
    prompt: job.prompt,
    systemPrompt: job.systemPrompt,
    model: job.model,
    effort: job.effort,
    permissionMode: job.permissionMode,
    advisorModel: job.advisorModel,
    disallowedTools: job.disallowedTools,
  }
}

export class JobScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  // Anti-reentrância: se um tick ainda está em voo (spawn lento), o próximo é
  // ignorado. O claim atômico já protege o DB, mas isto evita trabalho redundante.
  private ticking = false
  private readonly deps: Required<JobSchedulerDeps>

  constructor(deps: JobSchedulerDeps = {}) {
    this.deps = {
      now: deps.now ?? (() => Date.now()),
      spawn: deps.spawn ?? spawnJobSession,
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }

  start(): void {
    if (this.timer) return
    // ORDEM crítica: reconcile PRIMEIRO (senão o catch-up abaixo cria runs
    // 'running' que o reconcile marcaria 'interrupted' na sequência).
    this.bootReconcileAndCatchUp()
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // Boot: limpa órfãos e resolve os vencidos com o app fechado. Para cada job
  // vencido: reivindica (avança next_run_at 1x → catch-up LIMITADO); se catch_up
  // opt-in, spawna 1 run, senão marca a run 'missed' (skip-with-marker).
  private bootReconcileAndCatchUp(): void {
    const now = this.deps.now()
    try {
      jobStore.reconcileOrphanRuns(now)
    } catch (err) {
      console.error('[job-scheduler] reconcile de órfãos no boot falhou:', err)
    }
    for (const job of jobStore.listDueJobs(now)) {
      const run = jobStore.claimDueJob(job.id, now)
      if (!run) continue
      if (job.catchUp) {
        this.spawnClaimedRun(job, run, now)
      } else {
        jobStore.updateRun({ id: run.id, status: 'missed', finishedAt: now })
      }
    }
  }

  // Poll de runtime: cada job vencido → claim atômico → spawn. O claim re-checa
  // enabled/next_run_at na transação, então double-tick no mesmo instante não
  // cria 2 runs (o 2º claim vê next_run_at já avançado e retorna null).
  tick(): void {
    if (this.ticking) return
    this.ticking = true
    try {
      const now = this.deps.now()
      for (const job of jobStore.listDueJobs(now)) {
        const run = jobStore.claimDueJob(job.id, now)
        if (!run) continue
        this.spawnClaimedRun(job, run, now)
      }
    } catch (err) {
      console.error('[job-scheduler] tick falhou (não-fatal):', err)
    } finally {
      this.ticking = false
    }
  }

  // Spawna a sessão da run reivindicada e transiciona scheduled→running gravando
  // session_id/cc_session_id (a captura no 'exit' liga sessão→run por session_id).
  // Falha de spawn não derruba o tick: marca a run 'failed' e segue.
  private spawnClaimedRun(job: ScheduledJob, run: JobRun, now: number): void {
    try {
      const { sessionId, ccSessionId } = this.deps.spawn(jobToSpawnParams(job))
      jobStore.updateRun({
        id: run.id,
        status: 'running',
        sessionId,
        ccSessionId,
        startedAt: now,
      })
    } catch (err) {
      console.error(`[job-scheduler] spawn do job ${job.id} falhou:`, err)
      jobStore.updateRun({
        id: run.id,
        status: 'failed',
        finishedAt: now,
        error: String((err as Error)?.message ?? err),
      })
    }
  }
}

export const jobScheduler = new JobScheduler()
