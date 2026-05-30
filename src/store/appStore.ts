import { create } from 'zustand'
import { sessionsApi, workspaceApi } from '@/lib/ipc'
import type { PaneSnapshot, Repo, Session } from '../../shared/types/ipc'

export type Area = 'projects' | 'cc-configs'

export interface ActivePane {
  paneId: string
  session: Session
  repo: Repo
  projectName: string
  projectIcon: string | null
  projectColor: string | null
}

let savePanesTimer: ReturnType<typeof setTimeout> | null = null

// Guarda o auto-restore contra a dupla montagem do StrictMode (rodaria 2x).
let restoreStarted = false
// Reserva síncrona de ccSessionIds em resume — fecha a corrida entre o check de
// duplicata e o `await` do spawn (duas chamadas concorrentes passariam o check).
const resuming = new Set<string>()

// Persiste um snapshot enxuto (suficiente pra resume sem lookups), com debounce
// pra não gravar a cada teclada de spawn/close em sequência.
function schedulePersist(panes: ActivePane[]): void {
  if (savePanesTimer) clearTimeout(savePanesTimer)
  savePanesTimer = setTimeout(() => {
    const snapshots: PaneSnapshot[] = panes
      .filter((p) => p.session.ccSessionId)
      .map((p) => ({
        ccSessionId: p.session.ccSessionId as string,
        repo: p.repo,
        projectName: p.projectName,
        projectIcon: p.projectIcon,
        projectColor: p.projectColor,
        paneId: p.paneId,
      }))
    void workspaceApi.savePanes(snapshots)
  }, 500)
}

// Resume com paralelismo limitado: no máximo `limit` chamadas claude --resume
// simultâneas, pra não disparar dezenas de PTYs de uma vez. A falha de um resume
// (transcript sumiu) não aborta os demais — o erro aparece no terminal da pane.
async function restoreFromSnapshots(
  snapshots: PaneSnapshot[],
  resume: AppState['resumeSession'],
  limit = 4,
): Promise<void> {
  const queue = [...snapshots]
  async function worker(): Promise<void> {
    let snap = queue.shift()
    while (snap) {
      const current = snap
      try {
        await resume(
          current.repo,
          current.projectName,
          current.projectIcon,
          current.projectColor ?? null,
          current.ccSessionId,
        )
      } catch {
        // Sessão individual não retomável — segue restaurando as outras.
      }
      snap = queue.shift()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, snapshots.length) }, worker))
}

interface AppState {
  area: Area
  activeProjectId: string | null
  panes: ActivePane[]
  restoreBlocked: boolean

  setArea: (area: Area) => void
  initActiveProject: () => Promise<void>
  restoreWorkspace: () => Promise<void>
  retryRestore: () => Promise<void>
  setActiveProject: (id: string | null) => void
  openSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
    projectColor: string | null,
  ) => Promise<void>
  resumeSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
    projectColor: string | null,
    ccSessionId: string,
  ) => Promise<void>
  closePane: (paneId: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  area: 'projects',
  activeProjectId: null,
  panes: [],
  restoreBlocked: false,

  setArea: (area) => set({ area }),

  initActiveProject: async () => {
    const id = await workspaceApi.getActive()
    set({ activeProjectId: id })
  },

  restoreWorkspace: async () => {
    if (restoreStarted) return
    restoreStarted = true
    const { openPanes, cleanShutdown, restoreAttempts } = await workspaceApi.getBootState()
    if (openPanes.length === 0) return

    // Shutdown gracioso: confiamos no estado salvo e restauramos direto.
    // Crash com >=2 tentativas seguidas: provável crash-loop — não auto-restaura,
    // expõe banner pra o usuário decidir.
    const manualOnly = !cleanShutdown && restoreAttempts >= 2
    if (manualOnly) {
      set({ restoreBlocked: true })
      return
    }

    if (!cleanShutdown) await workspaceApi.bumpRestoreAttempts()
    await restoreFromSnapshots(openPanes, get().resumeSession)
    await workspaceApi.resetRestoreAttempts()
  },

  retryRestore: async () => {
    const { openPanes } = await workspaceApi.getBootState()
    set({ restoreBlocked: false })
    await restoreFromSnapshots(openPanes, get().resumeSession)
    await workspaceApi.resetRestoreAttempts()
  },

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    void workspaceApi.setActive(id)
  },

  openSession: async (repo, projectName, projectIcon, projectColor) => {
    // O spawn do processo acontece aqui, no clique — não no mount do Terminal.
    // Assim StrictMode (mount duplo do effect) não dispara dois processos claude.
    const session = await sessionsApi.spawn({ repoId: repo.id })
    set((s) => ({
      panes: [
        ...s.panes,
        { paneId: `pane-${Date.now()}`, session, repo, projectName, projectIcon, projectColor },
      ],
    }))
    schedulePersist(get().panes)
  },

  resumeSession: async (repo, projectName, projectIcon, projectColor, ccSessionId) => {
    // Já há uma pane com essa sessão aberta (ou um resume em voo)? Não duplicar.
    // `resuming` é reservado de forma síncrona antes do await pra fechar a corrida.
    if (get().panes.some((p) => p.session.ccSessionId === ccSessionId) || resuming.has(ccSessionId))
      return
    resuming.add(ccSessionId)
    try {
      const session = await sessionsApi.resume({ repoId: repo.id, ccSessionId })
      set((s) => ({
        panes: [
          ...s.panes,
          { paneId: `pane-${Date.now()}`, session, repo, projectName, projectIcon, projectColor },
        ],
      }))
      schedulePersist(get().panes)
    } finally {
      resuming.delete(ccSessionId)
    }
  },

  closePane: (paneId) => {
    const pane = get().panes.find((p) => p.paneId === paneId)
    if (pane) void sessionsApi.kill(pane.session.id)
    set((s) => ({ panes: s.panes.filter((p) => p.paneId !== paneId) }))
    schedulePersist(get().panes)
  },
}))
