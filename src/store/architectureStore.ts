import { create } from 'zustand'
import { architectureApi, projectsApi } from '@/lib/ipc'
import { useAppStore } from '@/store/appStore'
import type {
  CreateRepoDependencyInput,
  Repo,
  RepoDependency,
  UpdateRepoDependencyInput,
} from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe),
// mesmo padrão do objectivesStore.
let offUpdated: (() => void) | null = null
let updatedStarted = false

interface ArchitectureState {
  repos: Repo[]
  deps: RepoDependency[]
  loading: boolean
  error: string | null

  load: (projectId: string) => Promise<void>
  refresh: () => Promise<void>

  createDep: (input: CreateRepoDependencyInput) => Promise<RepoDependency | null>
  updateDep: (input: UpdateRepoDependencyInput) => Promise<void>
  deleteDep: (id: string) => Promise<void>
  setRepoPosition: (input: { repoId: string; x: number; y: number }) => Promise<void>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

// Projeto ativo, fonte de verdade compartilhada com o appStore (as ações do
// repoDeps são escopadas por projeto).
function activeProjectId(): string | null {
  return useAppStore.getState().activeProjectId
}

export const useArchitectureStore = create<ArchitectureState>((set, get) => ({
  repos: [],
  deps: [],
  loading: false,
  error: null,

  load: async (projectId) => {
    set({ loading: true, error: null })
    try {
      const [repos, deps] = await Promise.all([
        projectsApi.listRepos(projectId),
        architectureApi.list(projectId),
      ])
      // Só aplica se o projeto ativo ainda é o que pedimos (evita resultado obsoleto).
      if (activeProjectId() !== projectId) return
      set({ repos, deps, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    const projectId = activeProjectId()
    if (!projectId) {
      set({ repos: [], deps: [] })
      return
    }
    await get().load(projectId)
  },

  createDep: async (input) => {
    const created = await architectureApi.create(input)
    await get().refresh()
    return created
  },

  updateDep: async (input) => {
    await architectureApi.update(input)
    await get().refresh()
  },

  deleteDep: async (id) => {
    const projectId = activeProjectId()
    if (!projectId) return
    await architectureApi.delete({ id, projectId })
    await get().refresh()
  },

  setRepoPosition: async ({ repoId, x, y }) => {
    const projectId = activeProjectId()
    if (!projectId) return
    // Otimista: reflete a posição local pra o drag não "pular" antes do refresh.
    set((s) => ({
      repos: s.repos.map((r) => (r.id === repoId ? { ...r, canvasX: x, canvasY: y } : r)),
    }))
    await architectureApi.setRepoPosition({ repoId, x, y, projectId })
  },

  startUpdatedWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = architectureApi.onUpdated((event) => {
      // Só recarrega se o evento é do projeto ativo (ou sem projeto = recarga genérica).
      const current = activeProjectId()
      if (event.projectId && event.projectId !== current) return
      void get().refresh()
    })
  },

  stopUpdatedWatch: () => {
    if (offUpdated) {
      offUpdated()
      offUpdated = null
    }
    updatedStarted = false
  },
}))
