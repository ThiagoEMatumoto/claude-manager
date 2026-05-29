import { useCallback, useEffect, useState } from 'react'
import { projectsApi } from '@/lib/ipc'
import type { Project, Repo } from '../../../shared/types/ipc'

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
    async (name: string, color: string | null = null) => {
      await projectsApi.create({ name, color })
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

  return { projects, loading, refresh, create, remove }
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
    async (label: string, path: string, role: string | null = null) => {
      if (!projectId) return
      await projectsApi.createRepo({ projectId, label, path, role })
      await refresh()
    },
    [projectId, refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await projectsApi.deleteRepo(id)
      await refresh()
    },
    [refresh],
  )

  return { repos, loading, refresh, create, remove }
}
