import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { getDb } from '../services/db'
import type {
  Project,
  Repo,
  CreateProjectInput,
  CreateRepoInput,
  LinkKind,
} from '../../../shared/types/ipc'

interface ProjectRow {
  id: string
  name: string
  color: string | null
  icon: string | null
  vault_path: string | null
  created_at: number
  updated_at: number
}

interface RepoRow {
  id: string
  project_id: string
  label: string
  path: string
  role: string | null
  link_kind: string
  source: string | null
  position: number
  created_at: number
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  color: row.color,
  icon: row.icon,
  vaultPath: row.vault_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toRepo = (row: RepoRow): Repo => ({
  id: row.id,
  projectId: row.project_id,
  label: row.label,
  path: row.path,
  role: row.role,
  linkKind: row.link_kind as LinkKind,
  source: row.source,
  position: row.position,
  createdAt: row.created_at,
})

export function registerProjectIpc(): void {
  ipcMain.handle('projects:list', () => {
    const rows = getDb()
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as ProjectRow[]
    return rows.map(toProject)
  })

  ipcMain.handle('projects:create', (_e, input: CreateProjectInput) => {
    const now = Date.now()
    const row: ProjectRow = {
      id: randomUUID(),
      name: input.name,
      color: input.color ?? null,
      icon: input.icon ?? null,
      vault_path: null,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        'INSERT INTO projects (id, name, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.name, row.color, row.icon, row.created_at, row.updated_at)
    return toProject(row)
  })

  ipcMain.handle('projects:delete', (_e, id: string) => {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  })

  ipcMain.handle('projects:repos:list', (_e, projectId: string) => {
    const rows = getDb()
      .prepare(
        'SELECT * FROM repos WHERE project_id = ? ORDER BY position ASC, created_at ASC',
      )
      .all(projectId) as RepoRow[]
    return rows.map(toRepo)
  })

  ipcMain.handle('projects:repos:create', (_e, input: CreateRepoInput) => {
    const db = getDb()
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) as max FROM repos WHERE project_id = ?')
      .get(input.projectId) as { max: number }
    const row: RepoRow = {
      id: randomUUID(),
      project_id: input.projectId,
      label: input.label,
      path: input.path,
      role: input.role ?? null,
      link_kind: 'external',
      source: null,
      position: maxPos.max + 1,
      created_at: Date.now(),
    }
    db.prepare(
      'INSERT INTO repos (id, project_id, label, path, role, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.project_id, row.label, row.path, row.role, row.position, row.created_at)
    return toRepo(row)
  })

  ipcMain.handle('projects:repos:delete', (_e, id: string) => {
    getDb().prepare('DELETE FROM repos WHERE id = ?').run(id)
  })
}
