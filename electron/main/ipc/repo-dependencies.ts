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

// Exportado pra teste de contrato (garante que os kinds novos são aceitos).
export const repoDependencyKind = z.enum([
  'calls-api',
  'shares-types',
  'depends-on',
  'deploys-to',
  'work-hub',
  'infra',
  'monorepo',
  'documents',
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

const setHubSchema = z.object({
  repoId: z.string().min(1),
  isHub: z.boolean(),
})

const connectHubToAllSchema = z.object({
  hubRepoId: z.string().min(1),
  kind: repoDependencyKind,
  projectId: z.string().min(1).optional(),
})

export function registerRepoDependenciesIpc(): void {
  ipcMain.handle('repo-deps:list', (_e, projectId: string): RepoDependency[] => {
    return store.listByProject(projectId)
  })

  ipcMain.handle('repo-deps:list-all', (): RepoDependency[] => {
    return store.listAll()
  })

  ipcMain.handle('repo-deps:connect-hub-to-all', (_e, raw: unknown): RepoDependency[] => {
    const { hubRepoId, kind, projectId } = connectHubToAllSchema.parse(raw)
    const created = store.connectHubToAll(hubRepoId, kind, projectId)
    broadcast('repo-deps:updated', { projectId: projectId ?? null })
    pingSyncMutation()
    return created
  })

  // Marca/desmarca um repo como hub. Resolve o projeto do repo p/ o broadcast.
  ipcMain.handle('repos:set-hub', (_e, raw: unknown): void => {
    const { repoId, isHub } = setHubSchema.parse(raw)
    getDb()
      .prepare('UPDATE repos SET is_hub = ? WHERE id = ?')
      .run(isHub ? 1 : 0, repoId)
    broadcast('repo-deps:updated', { projectId: projectIdForRepo(repoId) })
    pingSyncMutation()
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
