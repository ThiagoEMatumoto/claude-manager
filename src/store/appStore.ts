import { create } from 'zustand'
import { sessionsApi, workspaceApi } from '@/lib/ipc'
import type { LiveSessionInfo, PaneSnapshot, Repo, Session } from '../../shared/types/ipc'

export type Area = 'projects' | 'cc-configs' | 'metrics' | 'features'

// Persistência leve do estado colapsado da sidebar (mesmo padrão do
// keybindings-store: localStorage no renderer, sem IPC/DB).
const SIDEBAR_COLLAPSED_KEY = 'cm:sidebar-collapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // localStorage indisponível — estado segue só em memória.
  }
}

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

// Dono único da assinatura do stream global de atividade (strip + overlay leem o
// mesmo `liveSessions`). `offGlobalActivity` guarda o unsubscribe do onGlobalActivity;
// `liveWatchStarted` guarda contra o duplo-mount do StrictMode.
let offGlobalActivity: (() => void) | null = null
let liveWatchStarted = false

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

// Restaura com paralelismo limitado: no máximo `limit` spawns de claude
// simultâneos, pra não disparar dezenas de PTYs de uma vez. A falha de um
// individual não aborta os demais — o erro aparece no terminal da pane.
// Sessões com transcript retomam (--resume); as sem (spawn que nunca conversou)
// viram sessão NOVA no mesmo repo, mantendo o paneId pra o layout do dockview bater.
async function restoreFromSnapshots(
  snapshots: PaneSnapshot[],
  resume: AppState['resumeSession'],
  open: AppState['openSession'],
  limit = 4,
): Promise<void> {
  const queue = [...snapshots]
  async function worker(): Promise<void> {
    let snap = queue.shift()
    while (snap) {
      const current = snap
      try {
        const resumable = await sessionsApi.isResumable(current.ccSessionId)
        if (resumable) {
          await resume(
            current.repo,
            current.projectName,
            current.projectIcon,
            current.projectColor ?? null,
            current.ccSessionId,
            current.paneId,
          )
        } else {
          await open(
            current.repo,
            current.projectName,
            current.projectIcon,
            current.projectColor ?? null,
            current.paneId,
          )
        }
      } catch {
        // Pane individual não restaurável — segue restaurando as outras.
      }
      snap = queue.shift()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, snapshots.length) }, worker))
}

// Reconstrói uma ActivePane a partir de uma sessão LIVE da lista global. Como o
// item vem de runningIds() (PTY viva no main), abrir = RE-ATTACH: criamos a pane
// apontando pro session.id existente e o Terminal replica o backlog. NÃO fazemos
// spawn/resume — isso criaria um segundo processo claude pra mesma conversa.
function paneFromLiveSession(item: LiveSessionInfo, paneId: string): ActivePane {
  return {
    paneId,
    session: {
      id: item.id,
      repoId: item.repo.id,
      ccSessionId: item.ccSessionId,
      title: item.title ?? item.name,
      paneId,
      status: 'running',
      startedAt: item.lastActivityAt ?? Date.now(),
      endedAt: null,
    },
    repo: item.repo,
    projectName: item.projectName,
    projectIcon: item.projectIcon,
    projectColor: item.projectColor,
  }
}

interface AppState {
  area: Area
  activeProjectId: string | null
  sidebarCollapsed: boolean
  panes: ActivePane[]
  // Todas as sessões vivas (PTYs no main), atualizadas pelo stream global. Dono
  // único da assinatura — strip e overlay só leem. Snapshot via listLiveGlobal,
  // merge incremental via onGlobalActivity, refetch nas mutações de pane.
  liveSessions: LiveSessionInfo[]
  restoreBlocked: boolean
  // Layout do dockview a aplicar (api.fromJSON) UMA vez, após as panes do restore
  // existirem no store. O AppShell consome e chama clearPendingLayout.
  pendingLayout: string | null
  // Pedido de foco num painel existente (clique simples na lista de sessões). O
  // AppShell consome (api.getPanel(id)?.focus()) e chama clearFocusPane.
  focusPaneId: string | null
  // Pedido de montagem de grade imperativa (multi-seleção "abrir N em grade"). O
  // AppShell consome quando todas as panes listadas existem, monta linhas×colunas
  // via addPanel e chama clearGridRequest. paneIds na ordem desejada da grade.
  gridRequest: string[] | null

  setArea: (area: Area) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  initActiveProject: () => Promise<void>
  restoreWorkspace: () => Promise<void>
  retryRestore: () => Promise<void>
  clearPendingLayout: () => void
  clearFocusPane: () => void
  clearGridRequest: () => void
  setActiveProject: (id: string | null) => void
  openSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
    projectColor: string | null,
    paneId?: string,
    featureId?: string,
    name?: string,
  ) => Promise<void>
  resumeSession: (
    repo: Repo,
    projectName: string,
    projectIcon: string | null,
    projectColor: string | null,
    ccSessionId: string,
    paneId?: string,
  ) => Promise<void>
  closePane: (paneId: string) => void
  // Kill EXPLÍCITO: mata a PTY e remove a pane correspondente da view (se houver).
  endSession: (sessionId: string) => void
  // Clique simples na lista: foca a pane se já exibida; senão resume/abre (sem
  // destruir as panes existentes) e vai pra área de projetos.
  focusOrOpenSession: (item: LiveSessionInfo) => Promise<void>
  // Multi-seleção: garante as N selecionadas em panes, substitui a view por
  // exatamente essas N e monta a grade (via gridRequest), indo pra projetos.
  openSessionsInGrid: (items: LiveSessionInfo[]) => Promise<void>
  // Assina (snapshot + stream) e desassina o conjunto de sessões vivas. Chamados
  // uma vez no mount/unmount do AppShell.
  startLiveWatch: () => Promise<void>
  stopLiveWatch: () => void
  // Re-busca o snapshot de sessões vivas (entrada/saída de sessão). Preserva o
  // status mais fresco já recebido pelo stream pra entradas que persistem.
  refreshLiveSessions: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  area: 'projects',
  activeProjectId: null,
  sidebarCollapsed: readSidebarCollapsed(),
  panes: [],
  liveSessions: [],
  restoreBlocked: false,
  pendingLayout: null,
  focusPaneId: null,
  gridRequest: null,

  setArea: (area) => set({ area }),

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    writeSidebarCollapsed(next)
    set({ sidebarCollapsed: next })
  },

  setSidebarCollapsed: (collapsed) => {
    writeSidebarCollapsed(collapsed)
    set({ sidebarCollapsed: collapsed })
  },

  initActiveProject: async () => {
    const id = await workspaceApi.getActive()
    set({ activeProjectId: id })
  },

  restoreWorkspace: async () => {
    if (restoreStarted) return
    restoreStarted = true
    const { openPanes, cleanShutdown, restoreAttempts, dockLayout } =
      await workspaceApi.getBootState()
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
    // pendingLayout só faz sentido se todos os snapshots têm paneId (gravados após
    // esta feature). Snapshots antigos caem no addPanel padrão.
    if (dockLayout && openPanes.every((p) => p.paneId)) set({ pendingLayout: dockLayout })
    await restoreFromSnapshots(openPanes, get().resumeSession, get().openSession)
    await workspaceApi.resetRestoreAttempts()
  },

  retryRestore: async () => {
    const { openPanes, dockLayout } = await workspaceApi.getBootState()
    set({ restoreBlocked: false })
    if (dockLayout && openPanes.every((p) => p.paneId)) set({ pendingLayout: dockLayout })
    await restoreFromSnapshots(openPanes, get().resumeSession, get().openSession)
    await workspaceApi.resetRestoreAttempts()
  },

  clearPendingLayout: () => set({ pendingLayout: null }),
  clearFocusPane: () => set({ focusPaneId: null }),
  clearGridRequest: () => set({ gridRequest: null }),

  setActiveProject: (id) => {
    set({ activeProjectId: id })
    void workspaceApi.setActive(id)
  },

  openSession: async (repo, projectName, projectIcon, projectColor, paneId, featureId, name) => {
    // O spawn do processo acontece aqui, no clique — não no mount do Terminal.
    // Assim StrictMode (mount duplo do effect) não dispara dois processos claude.
    const session = await sessionsApi.spawn({ repoId: repo.id, featureId, name })
    set((s) => ({
      panes: [
        ...s.panes,
        {
          paneId: paneId ?? `pane-${Date.now()}`,
          session,
          repo,
          projectName,
          projectIcon,
          projectColor,
        },
      ],
    }))
    schedulePersist(get().panes)
    void get().refreshLiveSessions()
  },

  resumeSession: async (repo, projectName, projectIcon, projectColor, ccSessionId, paneId) => {
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
          {
            paneId: paneId ?? `pane-${Date.now()}`,
            session,
            repo,
            projectName,
            projectIcon,
            projectColor,
          },
        ],
      }))
      schedulePersist(get().panes)
      void get().refreshLiveSessions()
    } finally {
      resuming.delete(ccSessionId)
    }
  },

  // Detach, NÃO mata: só tira da view + persiste. A PTY sobrevive no main
  // (background). Kill explícito é endSession.
  closePane: (paneId) => {
    set((s) => ({ panes: s.panes.filter((p) => p.paneId !== paneId) }))
    schedulePersist(get().panes)
    void get().refreshLiveSessions()
  },

  endSession: (sessionId) => {
    void sessionsApi.kill(sessionId)
    // Remoção otimista da sessão viva também: o kill é assíncrono, então o
    // refreshLiveSessions abaixo pegaria a PTY ainda na corrida e a reintroduziria
    // como 'ended'. Tirar de liveSessions aqui faz o chip do strip sumir junto com
    // a pane — Encerrar fecha sessão e aba de uma vez.
    set((s) => ({
      panes: s.panes.filter((p) => p.session.id !== sessionId),
      liveSessions: s.liveSessions.filter((x) => x.id !== sessionId),
    }))
    schedulePersist(get().panes)
    void get().refreshLiveSessions()
  },

  focusOrOpenSession: async (item) => {
    const existing = get().panes.find((p) => p.session.ccSessionId === item.ccSessionId)
    if (existing) {
      set({ focusPaneId: existing.paneId, area: 'projects' })
      return
    }
    // Item da lista é sempre LIVE — re-attacha à PTY existente (sem segundo claude).
    const paneId = `pane-${Date.now()}`
    const pane = paneFromLiveSession(item, paneId)
    set((s) => ({ panes: [...s.panes, pane], area: 'projects', focusPaneId: paneId }))
    schedulePersist(get().panes)
    void get().refreshLiveSessions()
  },

  openSessionsInGrid: async (items) => {
    // Items são sempre LIVE (runningIds). Reusa a pane se já exibida; senão
    // re-attacha à PTY viva. Substitui a view por exatamente as N selecionadas
    // (as não-selecionadas saem da view; PTY segue viva no main). gridRequest
    // dispara o arranjo em grade no AppShell. Date.now() é fixo no tick, então
    // desambiguamos o paneId com item.id (UUID único da sessão).
    const current = get().panes
    const wanted: ActivePane[] = items.map(
      (item) =>
        current.find((p) => p.session.ccSessionId === item.ccSessionId) ??
        paneFromLiveSession(item, `pane-${Date.now()}-${item.id}`),
    )
    set({
      panes: wanted,
      area: 'projects',
      gridRequest: wanted.map((p) => p.paneId),
    })
    schedulePersist(get().panes)
    void get().refreshLiveSessions()
  },

  startLiveWatch: async () => {
    // StrictMode monta o effect 2x; só uma assinatura real (a outra é no-op).
    if (liveWatchStarted) return
    liveWatchStarted = true
    const list = await sessionsApi.listLiveGlobal()
    set({ liveSessions: list })
    sessionsApi.watchGlobalActivity()
    offGlobalActivity = sessionsApi.onGlobalActivity((batch) => {
      // Merge incremental por ccSessionId: atualiza só entradas existentes,
      // ignora ids desconhecidos (o snapshot/refetch é quem adiciona/remove).
      const byId = new Map(batch.map((b) => [b.ccSessionId, b]))
      set((s) => ({
        liveSessions: s.liveSessions.map((sess) => {
          const u = byId.get(sess.ccSessionId)
          if (!u) return sess
          return {
            ...sess,
            status: u.status,
            lastActivityAt: u.lastActivityAt,
            lastText: u.lastText !== undefined ? u.lastText : sess.lastText,
            tokens: u.tokens ?? sess.tokens,
          }
        }),
      }))
    })
  },

  stopLiveWatch: () => {
    if (offGlobalActivity) {
      offGlobalActivity()
      offGlobalActivity = null
    }
    sessionsApi.unwatchGlobalActivity()
    liveWatchStarted = false
    set({ liveSessions: [] })
  },

  refreshLiveSessions: async () => {
    // Só refetcha se o watch está ativo (evita popular fora do ciclo de vida).
    if (!liveWatchStarted) return
    const list = await sessionsApi.listLiveGlobal()
    // Preserva o status/atividade mais fresco do stream pras entradas que já
    // existiam — o snapshot pode estar atrás de um broadcast recente.
    const prev = new Map(get().liveSessions.map((s) => [s.ccSessionId, s]))
    set({
      liveSessions: list.map((sess) => {
        const p = prev.get(sess.ccSessionId)
        if (!p) return sess
        return {
          ...sess,
          status: p.status,
          lastActivityAt: p.lastActivityAt ?? sess.lastActivityAt,
          lastText: p.lastText ?? sess.lastText,
          tokens: p.tokens ?? sess.tokens,
        }
      }),
    })
  },
}))
