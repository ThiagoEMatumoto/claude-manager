import { useCallback, useEffect, useState } from 'react'
import { projectsApi } from '@/lib/ipc'
import type {
  CreateProjectInput,
  CreateRepoInput,
  Project,
  Repo,
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

  return { projects, loading, refresh, create, update, remove }
}

export function useRepos(projectId: string | null) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRepos([])
      return
    }
    setLoading(true)
    setRepos(await projectsApi.listRepos(projectId))
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

  return { repos, loading, refresh, create, update, remove }
}
