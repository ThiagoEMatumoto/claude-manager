import { BrowserWindow, ipcMain } from 'electron'
import * as featureStore from '../services/feature-store'
import { getDb } from '../services/db'
import { featureMemory, type SessionExitInfo } from '../services/feature-memory'
import type {
  Feature,
  FeatureWithStats,
  CreateFeatureInput,
  UpdateFeatureInput,
  SetFeatureReposInput,
  FeatureBackfillResult,
} from '../../../shared/types/ipc'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerFeaturesIpc(): void {
  ipcMain.handle('features:list', (_e, projectId?: string): Feature[] => {
    return featureStore.list(projectId)
  })

  ipcMain.handle(
    'features:list-with-stats',
    (_e, opts?: { includeArchived?: boolean }): FeatureWithStats[] => {
      return featureStore.listWithStats(opts)
    },
  )

  ipcMain.handle('features:get', (_e, id: string): Feature | null => {
    return featureStore.get(id)
  })

  ipcMain.handle('features:create', (_e, input: CreateFeatureInput): Feature => {
    const feature = featureStore.create(input)
    broadcast('feature:updated', feature)
    return feature
  })

  ipcMain.handle('features:update', (_e, input: UpdateFeatureInput): Feature => {
    const feature = featureStore.update(input)
    broadcast('feature:updated', feature)
    return feature
  })

  ipcMain.handle('features:archive', (_e, id: string): void => {
    featureStore.archive(id)
    // Sinaliza o renderer pra recarregar a lista (a feature some dela).
    broadcast('feature:updated', { id, archived: true })
  })

  ipcMain.handle('features:set-repos', (_e, input: SetFeatureReposInput): Feature => {
    const feature = featureStore.setRepos(input.id, input.repos)
    broadcast('feature:updated', feature)
    return feature
  })

  // Backfill retroativo: reprocessa sessões já encerradas e ainda não vinculadas,
  // criando/linkando as features perdidas. A LINKAGEM é síncrona e rápida (sem LLM);
  // a geração de registros ricos (Stage 1) + síntese holística (Stage 2) roda numa
  // fila throttled em background, pra não travar a UI nem disparar rajada de LLM.
  // Em ordem cronológica pra que features criadas cedo capturem sessões posteriores.
  ipcMain.handle('features:backfill', (): FeatureBackfillResult => {
    const rows = getDb()
      .prepare(
        `SELECT id, cc_session_id, repo_id, feature_id FROM sessions
          WHERE status IN ('exited','closed_by_user')
            AND cc_session_id IS NOT NULL
            AND feature_id IS NULL
          ORDER BY started_at ASC`,
      )
      .all() as Array<{
      id: string
      cc_session_id: string
      repo_id: string
      feature_id: string | null
    }>

    let created = 0
    let linked = 0
    let skipped = 0
    const jobs: Array<{ info: SessionExitInfo; featureId: string }> = []
    for (const r of rows) {
      const info: SessionExitInfo = {
        sessionId: r.id,
        ccSessionId: r.cc_session_id,
        repoId: r.repo_id,
        featureId: r.feature_id,
      }
      const res = featureMemory.registerOnly(info)
      if (!res) {
        skipped++
        continue
      }
      if (res.kind === 'auto-created') created++
      else linked++
      jobs.push({ info, featureId: res.featureId })
    }
    // Background: gera os registros (throttled) e, ao terminar cada feature, a
    // síntese holística. Não bloqueia o retorno do backfill.
    featureMemory.enqueueRecords(jobs)
    broadcast('feature:updated', { backfill: true })
    return { created, linked, skipped }
  })
}
