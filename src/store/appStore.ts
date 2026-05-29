import { create } from 'zustand'
import { sessionsApi, workspaceApi } from '@/lib/ipc'
import type { Repo, Session } from '../../shared/types/ipc'

export type Area = 'projects'

export interface ActivePane {
  paneId: string
  session: Session
  repo: Repo
  projectName: string
  projectIcon: string | null
}

interface AppState {
  area: Area
  activeProjectId: string | null
  panes: ActivePane[]

  setArea: (area: Area) => void
  initActiveProject: () => Promise<void>
  setActiveProject: (id: string | null) => void
  openSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
  ) => Promise<void>
  resumeSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
    ccSessionId: string,
  ) => Promise<void>
  closePane: (paneId: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  area: 'projects',
  activeProjectId: null,
  panes: [],

  setArea: (area) => set({ area }),

  initActiveProject: async () => {
    const id = await workspaceApi.getActive()
    set({ activeProjectId: id })
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    void workspaceApi.setActive(id)
  },

  openSession: async (repo, projectName, projectIcon) => {
    // O spawn do processo acontece aqui, no clique — não no mount do Terminal.
    // Assim StrictMode (mount duplo do effect) não dispara dois processos claude.
    const session = await sessionsApi.spawn({ repoId: repo.id })
    set((s) => ({
      panes: [
        ...s.panes,
        { paneId: `pane-${Date.now()}`, session, repo, projectName, projectIcon },
      ],
    }))
  },

  resumeSession: async (repo, projectName, projectIcon, ccSessionId) => {
    // Já há uma pane com essa sessão aberta? Não duplicar — o usuário deve focar a
    // existente (panes vivem lado a lado, então só evitamos o spawn redundante).
    if (get().panes.some((p) => p.session.ccSessionId === ccSessionId)) return
    const session = await sessionsApi.resume({ repoId: repo.id, ccSessionId })
    set((s) => ({
      panes: [
        ...s.panes,
        { paneId: `pane-${Date.now()}`, session, repo, projectName, projectIcon },
      ],
    }))
  },

  closePane: (paneId) => {
    const pane = get().panes.find((p) => p.paneId === paneId)
    if (pane) void sessionsApi.kill(pane.session.id)
    set((s) => ({ panes: s.panes.filter((p) => p.paneId !== paneId) }))
  },
}))
