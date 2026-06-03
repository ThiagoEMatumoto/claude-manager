import { BrowserWindow, ipcMain } from 'electron'
import * as featureStore from '../services/feature-store'
import { getDb } from '../services/db'
import { featureMemory } from '../services/feature-memory'
import type {
  Feature,
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
  // criando/linkando as features perdidas (sem síntese LLM). Em ordem cronológica
  // pra que features criadas cedo capturem sessões posteriores (branch/fuzzy).
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
    for (const r of rows) {
      const res = featureMemory.registerOnly({
        sessionId: r.id,
        ccSessionId: r.cc_session_id,
        repoId: r.repo_id,
        featureId: r.feature_id,
      })
      if (!res) skipped++
      else if (res.kind === 'auto-created') created++
      else linked++
    }
    broadcast('feature:updated', { backfill: true })
    return { created, linked, skipped }
  })
}
