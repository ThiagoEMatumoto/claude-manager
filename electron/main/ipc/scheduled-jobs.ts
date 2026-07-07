import { ipcMain } from 'electron'
import * as jobStore from '../services/scheduled-job-store'
import { broadcast } from '../services/notify'
import type {
  CreateScheduledJobInput,
  JobRun,
  JobRunListFilter,
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
}
