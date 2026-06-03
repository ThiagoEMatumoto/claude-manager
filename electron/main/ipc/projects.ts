import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, lstatSync, unlinkSync } from 'node:fs'
import { z } from 'zod'
import { getDb } from '../services/db'
import type {
  Project,
  Repo,
  CreateProjectInput,
  CreateRepoInput,
  LinkKind,
} from '../../../shared/types/ipc'

const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  vaultPath: z.string().nullable().optional(),
})

const updateRepoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  role: z.string().nullable().optional(),
})

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
      vault_path: input.vaultPath ?? null,
      created_at: now,
      updated_at: now,
    }
    if (row.vault_path) {
      mkdirSync(row.vault_path, { recursive: true })
    }
    getDb()
      .prepare(
        'INSERT INTO projects (id, name, color, icon, vault_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.name, row.color, row.icon, row.vault_path, row.created_at, row.updated_at)
    return toProject(row)
  })

  ipcMain.handle('projects:update', (_e, raw: unknown) => {
    const input = updateProjectSchema.parse(raw)
    const db = getDb()

    const sets: string[] = []
    const values: unknown[] = []
    if (input.name !== undefined) {
      sets.push('name = ?')
      values.push(input.name)
    }
    if (input.color !== undefined) {
      sets.push('color = ?')
      values.push(input.color)
    }
    if (input.icon !== undefined) {
      sets.push('icon = ?')
      values.push(input.icon)
    }
    if (input.vaultPath !== undefined) {
      sets.push('vault_path = ?')
      values.push(input.vaultPath)
      if (input.vaultPath) mkdirSync(input.vaultPath, { recursive: true })
    }
    sets.push('updated_at = ?')
    values.push(Date.now())

    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values, input.id)
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(input.id) as ProjectRow
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
      link_kind: input.linkKind ?? 'external',
      source: input.source ?? null,
      position: maxPos.max + 1,
      created_at: Date.now(),
    }
    db.prepare(
      'INSERT INTO repos (id, project_id, label, path, role, link_kind, source, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.project_id,
      row.label,
      row.path,
      row.role,
      row.link_kind,
      row.source,
      row.position,
      row.created_at,
    )
    return toRepo(row)
  })

  ipcMain.handle('projects:repos:update', (_e, raw: unknown) => {
    const input = updateRepoSchema.parse(raw)
    const db = getDb()

    const sets: string[] = []
    const values: unknown[] = []
    if (input.label !== undefined) {
      sets.push('label = ?')
      values.push(input.label)
    }
    if (input.role !== undefined) {
      sets.push('role = ?')
      values.push(input.role)
    }

    if (sets.length > 0) {
      db.prepare(`UPDATE repos SET ${sets.join(', ')} WHERE id = ?`).run(...values, input.id)
    }
    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(input.id) as RepoRow
    return toRepo(row)
  })

  ipcMain.handle('projects:repos:delete', (_e, id: string) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined

    // Limpeza de disco antes de remover do DB:
    // - symlink: remove o link do vault (alvo intacto).
    // - inside: NUNCA apaga o diretório real (é dado do usuário) — só sai do DB.
    // - external: nada no disco.
    if (row?.link_kind === 'symlink' && row.path) {
      try {
        // Defensivo: só removemos se de fato for um symlink no disco.
        if (lstatSync(row.path).isSymbolicLink()) {
          unlinkSync(row.path)
        }
      } catch {
        // Symlink já ausente / inacessível — não bloqueia a remoção do registro.
      }
    }

    db.prepare('DELETE FROM repos WHERE id = ?').run(id)
  })
}
