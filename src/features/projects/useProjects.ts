import { useCallback, useEffect, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { projectsApi, vaultApi } from '@/lib/ipc'
import type {
  CreateProjectInput,
  CreateRepoInput,
  Project,
  Repo,
  UntrackedFolder,
  UpdateProjectInput,
  UpdateRepoInput,
} from '../../../shared/types/ipc'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setProjects(await projectsApi.list())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: CreateProjectInput) => {
      await projectsApi.create(input)
      await refresh()
    },
    [refresh],
  )

  const update = useCallback(
    async (input: UpdateProjectInput) => {
      await projectsApi.update(input)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await projectsApi.delete(id)
      await refresh()
    },
    [refresh],
  )

  // Reordena otimisticamente (sem flicker) e persiste; o DB é a fonte de verdade
  // no próximo refresh.
  const reorder = useCallback(async (activeId: string, overId: string) => {
    let nextIds: string[] = []
    setProjects((prev) => {
      const from = prev.findIndex((p) => p.id === activeId)
      const to = prev.findIndex((p) => p.id === overId)
      if (from < 0 || to < 0) return prev
      const next = arrayMove(prev, from, to)
      nextIds = next.map((p) => p.id)
      return next
    })
    if (nextIds.length > 0) await projectsApi.reorder(nextIds)
  }, [])

  return { projects, loading, refresh, create, update, remove, reorder }
}

export function useRepos(projectId: string | null) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [untracked, setUntracked] = useState<UntrackedFolder[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRepos([])
      setUntracked([])
      return
    }
    setLoading(true)
    setRepos(await projectsApi.listRepos(projectId))
    setUntracked(await vaultApi.listUntracked(projectId))
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (input: Omit<CreateRepoInput, 'projectId'>) => {
      if (!projectId) return
      await projectsApi.createRepo({ projectId, ...input })
      await refresh()
    },
    [projectId, refresh],
  )

  // Adota uma pasta já existente no vault: registra como repo 'inside' sem mover
  // nem clonar nada (o conteúdo já está no lugar certo).
  const adopt = useCallback(
    async (folder: UntrackedFolder) => {
      if (!projectId) return
      await projectsApi.createRepo({
        projectId,
        label: folder.name,
        path: folder.path,
        linkKind: 'inside',
        source: 'local',
      })
      await refresh()
    },
    [projectId, refresh],
  )

  const update = useCallback(
    async (input: UpdateRepoInput) => {
      await projectsApi.updateRepo(input)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await projectsApi.deleteRepo(id)
      await refresh()
    },
    [refresh],
  )

  const reorder = useCallback(
    async (activeId: string, overId: string) => {
      if (!projectId) return
      let nextIds: string[] = []
      setRepos((prev) => {
        const from = prev.findIndex((r) => r.id === activeId)
        const to = prev.findIndex((r) => r.id === overId)
        if (from < 0 || to < 0) return prev
        const next = arrayMove(prev, from, to)
        nextIds = next.map((r) => r.id)
        return next
      })
      if (nextIds.length > 0) await projectsApi.reorderRepos({ projectId, repoIds: nextIds })
    },
    [projectId],
  )

  return { repos, untracked, loading, refresh, create, adopt, update, remove, reorder }
}
