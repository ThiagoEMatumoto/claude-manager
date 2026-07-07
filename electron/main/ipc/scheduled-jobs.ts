import { ipcMain } from 'electron'
import * as jobStore from '../services/scheduled-job-store'
import { runJobNow } from '../services/job-run-now'
import { broadcast } from '../services/notify'
import type {
  CreateScheduledJobInput,
  JobRun,
  JobRunListFilter,
  JobSchedule,
  ScheduledJob,
  ScheduledJobListFilter,
  UpdateScheduledJobInput,
} from '../../../shared/types/ipc'

// IPC de Scheduled Jobs (Fase 1). Molde de ipc/tasks: cada mutação chama o store
// e faz broadcast do sinal de recarga pro renderer. Os canais 'scheduledJob:*' e
// 'jobRun:*' não são entidades sincronizadas (sync cobre objectives/tasks/
// features), então broadcast() não pinga o coordinator de sync — só atualiza a UI.
export function registerScheduledJobsIpc(): void {
  ipcMain.handle('scheduledJobs:list', (_e, filter?: ScheduledJobListFilter): ScheduledJob[] => {
    return jobStore.list(filter)
  })

  ipcMain.handle('scheduledJobs:get', (_e, id: string): ScheduledJob | null => {
    return jobStore.get(id)
  })

  ipcMain.handle('scheduledJobs:create', (_e, input: CreateScheduledJobInput): ScheduledJob => {
    const job = jobStore.create(input)
    broadcast('scheduledJob:updated', job)
    return job
  })

  ipcMain.handle('scheduledJobs:update', (_e, input: UpdateScheduledJobInput): ScheduledJob => {
    const job = jobStore.update(input)
    broadcast('scheduledJob:updated', job)
    return job
  })

  ipcMain.handle('scheduledJobs:delete', (_e, id: string): void => {
    jobStore.remove(id)
    broadcast('scheduledJob:updated', { id, deleted: true })
  })

  ipcMain.handle('scheduledJobs:list-runs', (_e, filter?: JobRunListFilter): JobRun[] => {
    return jobStore.listRuns(filter)
  })

  // Run now: dispara um run ad-hoc pelo seam leaf (job-run-now → scheduler), fora
  // do schedule. Usa o seam em vez de importar o scheduler direto pra não arrastar
  // a cadeia job-runner → ipc/sessions pra este módulo. Broadcast pra recarregar o
  // histórico no renderer (runJobNow não emite sinal).
  ipcMain.handle('scheduledJobs:run-now', (_e, jobId: string): JobRun => {
    const run = runJobNow(jobId)
    broadcast('jobRun:updated', run)
    return run
  })

  // Preview de próximos disparos: encadeia computeNextRunAt `count` vezes a partir
  // de agora. Puro (só leitura de schedule), sem tocar o DB nem broadcast — a UI
  // usa pra mostrar os N próximos horários ao configurar/editar um job.
  ipcMain.handle('scheduledJobs:preview-runs', (_e, schedule: JobSchedule, count: number): number[] => {
    const n = Math.max(0, Math.floor(count))
    const runs: number[] = []
    let from = Date.now()
    for (let i = 0; i < n; i++) {
      from = jobStore.computeNextRunAt(schedule, from)
      runs.push(from)
    }
    return runs
  })
}
