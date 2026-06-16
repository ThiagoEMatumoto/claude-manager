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

// Vista do canvas: um projectId específico ou 'global' (todos os projetos).
export type ArchitectureViewMode = 'global' | string

interface ArchitectureState {
  repos: Repo[]
  deps: RepoDependency[]
  loading: boolean
  error: string | null
  // Escopo corrente do canvas. Default sincronizado com o projeto ativo via
  // useArchitecture; 'global' agrega todos os projetos.
  viewMode: ArchitectureViewMode | null

  setViewMode: (v: ArchitectureViewMode) => void
  load: (view: ArchitectureViewMode) => Promise<void>
  refresh: () => Promise<void>

  createDep: (input: CreateRepoDependencyInput) => Promise<RepoDependency | null>
  updateDep: (input: UpdateRepoDependencyInput) => Promise<void>
  deleteDep: (id: string) => Promise<void>
  setRepoPosition: (input: { repoId: string; x: number; y: number }) => Promise<void>
  setRepoHub: (repoId: string, isHub: boolean) => Promise<void>
  connectHubToAll: (hubRepoId: string) => Promise<void>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

// Projeto ativo, fonte de verdade compartilhada com o appStore (as ações do
// repoDeps são escopadas por projeto).
function activeProjectId(): string | null {
  return useAppStore.getState().activeProjectId
}

// Resolve o projectId pra mutações escopadas por projeto. Em vista de projeto é o
// próprio viewMode; em 'global' caímos no projeto ativo do appStore (escopo
// natural pra ações como "conectar a todos" quando há projeto ativo).
function scopeProjectId(view: ArchitectureViewMode | null): string | null {
  if (!view) return activeProjectId()
  if (view === 'global') return activeProjectId()
  return view
}

// projectId do repo (necessário pra delete/position quando a vista é global e o
// repo pode pertencer a qualquer projeto).
function repoProjectId(repos: Repo[], repoId: string): string | null {
  return repos.find((r) => r.id === repoId)?.projectId ?? null
}

export const useArchitectureStore = create<ArchitectureState>((set, get) => ({
  repos: [],
  deps: [],
  loading: false,
  error: null,
  viewMode: null,

  setViewMode: (v) => {
    set({ viewMode: v })
    void get().load(v)
  },

  load: async (view) => {
    set({ loading: true, error: null, viewMode: view })
    try {
      const [repos, deps] =
        view === 'global'
          ? await Promise.all([projectsApi.listAllRepos(), architectureApi.listAll()])
          : await Promise.all([projectsApi.listRepos(view), architectureApi.list(view)])
      // Só aplica se a vista ainda é a que pedimos (evita resultado obsoleto).
      if (get().viewMode !== view) return
      set({ repos, deps, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  refresh: async () => {
    const view = get().viewMode
    if (!view) {
      set({ repos: [], deps: [] })
      return
    }
    await get().load(view)
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
    // A aresta pode ser cross-projeto na vista global; o backend só precisa de um
    // projectId válido pra emitir o evento de update.
    const projectId = scopeProjectId(get().viewMode)
    if (!projectId) return
    await architectureApi.delete({ id, projectId })
    await get().refresh()
  },

  setRepoPosition: async ({ repoId, x, y }) => {
    const projectId = repoProjectId(get().repos, repoId) ?? scopeProjectId(get().viewMode)
    if (!projectId) return
    // Otimista: reflete a posição local pra o drag não "pular" antes do refresh.
    set((s) => ({
      repos: s.repos.map((r) => (r.id === repoId ? { ...r, canvasX: x, canvasY: y } : r)),
    }))
    await architectureApi.setRepoPosition({ repoId, x, y, projectId })
  },

  setRepoHub: async (repoId, isHub) => {
    await architectureApi.setRepoHub({ repoId, isHub })
    await get().refresh()
  },

  connectHubToAll: async (hubRepoId) => {
    const view = get().viewMode
    await architectureApi.connectHubToAll({
      hubRepoId,
      kind: 'work-hub',
      // Em global não passamos projectId → backend conecta a todos os repos.
      projectId: view && view !== 'global' ? view : undefined,
    })
    await get().refresh()
  },

  startUpdatedWatch: () => {
    // StrictMode monta o effect 2x; só uma assinatura real.
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = architectureApi.onUpdated((event) => {
      const view = get().viewMode
      // Em global, qualquer mudança importa. Em vista de projeto, só a do projeto.
      if (view !== 'global' && event.projectId && event.projectId !== view) return
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
