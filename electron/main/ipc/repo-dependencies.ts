import { ipcMain } from 'electron'
import { z } from 'zod'
import * as store from '../services/repo-dependency-store'
import { getDb } from '../services/db'
import { broadcast, pingSyncMutation } from '../services/notify'
import type {
  CreateRepoDependencyInput,
  RepoDependency,
  UpdateRepoDependencyInput,
} from '../../../shared/types/ipc'

const repoDependencyKind = z.enum([
  'calls-api',
  'shares-types',
  'depends-on',
  'deploys-to',
  'custom',
])

const createSchema = z.object({
  fromRepoId: z.string().min(1),
  toRepoId: z.string().min(1),
  kind: repoDependencyKind,
  label: z.string().nullable().optional(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  kind: repoDependencyKind.optional(),
  label: z.string().nullable().optional(),
})

const deleteSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
})

const setPositionSchema = z.object({
  repoId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  projectId: z.string().min(1),
})

export function registerRepoDependenciesIpc(): void {
  ipcMain.handle('repo-deps:list', (_e, projectId: string): RepoDependency[] => {
    return store.listByProject(projectId)
  })

  ipcMain.handle('repo-deps:create', (_e, raw: unknown): RepoDependency => {
    const input = createSchema.parse(raw) as CreateRepoDependencyInput
    const dep = store.create(input)
    // O projeto da aresta é derivado do repo de origem (mesmo critério do
    // listByProject); o renderer recarrega a lista do projeto afetado.
    const projectId = projectIdForRepo(dep.fromRepoId)
    broadcast('repo-deps:updated', { projectId })
    pingSyncMutation()
    return dep
  })

  ipcMain.handle('repo-deps:update', (_e, raw: unknown): RepoDependency => {
    const input = updateSchema.parse(raw) as UpdateRepoDependencyInput
    const dep = store.update(input)
    broadcast('repo-deps:updated', { projectId: projectIdForRepo(dep.fromRepoId) })
    pingSyncMutation()
    return dep
  })

  ipcMain.handle('repo-deps:delete', (_e, raw: unknown): void => {
    const { id, projectId } = deleteSchema.parse(raw)
    store.remove(id)
    broadcast('repo-deps:updated', { projectId })
    pingSyncMutation()
  })

  ipcMain.handle('repos:set-position', (_e, raw: unknown): void => {
    const { repoId, x, y, projectId } = setPositionSchema.parse(raw)
    store.setRepoPosition(repoId, x, y)
    // Debounce é responsabilidade do frontend; aqui só persiste e notifica.
    broadcast('repo-deps:updated', { projectId })
    pingSyncMutation()
  })
}

// Resolve o project_id a partir do repo (para o payload do broadcast nas
// mutações que só têm o id da aresta/repo).
function projectIdForRepo(repoId: string): string | null {
  const row = getDb().prepare('SELECT project_id FROM repos WHERE id = ?').get(repoId) as
    | { project_id: string }
    | undefined
  return row?.project_id ?? null
}
