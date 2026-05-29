import { ipcMain } from 'electron'
import { getDb } from '../services/db'

interface ActiveRow {
  active_project_id: string | null
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:get-active', () => {
    const row = getDb()
      .prepare('SELECT active_project_id FROM workspace_state WHERE id = 1')
      .get() as ActiveRow | undefined
    return row?.active_project_id ?? null
  })

  ipcMain.handle('workspace:set-active', (_e, { projectId }: { projectId: string | null }) => {
    getDb()
      .prepare(
        `INSERT INTO workspace_state (id, active_project_id, last_opened_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET active_project_id = excluded.active_project_id`,
      )
      .run(projectId, Date.now())
  })
}
