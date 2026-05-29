import { useEffect, useState } from 'react'
import { Sidebar } from '@/features/projects/Sidebar'
import { Terminal } from '@/features/sessions/Terminal'
import { useProjects } from '@/features/projects/useProjects'
import { WelcomeDialog } from '@/features/settings/WelcomeDialog'
import { projectsApi, sessionsApi, vaultApi, workspaceApi } from '@/lib/ipc'
import type { Repo, Session } from '../../shared/types/ipc'

interface ActiveSession {
  paneId: string
  session: Session
  repo: Repo
  projectName: string
  projectIcon: string | null
}

export default function App() {
  const { projects, loading, create, remove } = useProjects()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [vaultConfigured, setVaultConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    void vaultApi.isConfigured().then(setVaultConfigured)
  }, [])

  useEffect(() => {
    void workspaceApi.getActive().then((id) => {
      setActiveProjectId(id)
      setRestored(true)
    })
  }, [])

  useEffect(() => {
    if (!restored) return
    if (activeProjectId && !projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId(null)
      return
    }
    if (!activeProjectId && projects.length > 0) {
      setActiveProjectId(projects[0].id)
    }
  }, [projects, activeProjectId, restored])

  function selectProject(id: string) {
    setActiveProjectId(id)
    void workspaceApi.setActive(id)
  }

  async function handleSpawn(repoId: string) {
    const projectId = activeProjectId
    if (!projectId) return
    const repos = await projectsApi.listRepos(projectId)
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return
    const project = projects.find((p) => p.id === projectId)
    // O spawn do processo acontece aqui, no clique — não no mount do Terminal.
    // Assim StrictMode (mount duplo do effect) não dispara dois processos claude.
    const session = await sessionsApi.spawn({ repoId })
    setActiveSessions((prev) => [
      ...prev,
      {
        paneId: `pane-${Date.now()}`,
        session,
        repo,
        projectName: project?.name ?? '',
        projectIcon: project?.icon ?? null,
      },
    ])
  }

  async function handleResume(repoId: string, ccSessionId: string) {
    // Já há uma pane com essa sessão aberta? Não duplicar — o usuário deve focar a
    // existente (panes vivem lado a lado, então só evitamos o spawn redundante).
    if (activeSessions.some((s) => s.session.ccSessionId === ccSessionId)) return
    const projectId = activeProjectId
    if (!projectId) return
    const repos = await projectsApi.listRepos(projectId)
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return
    const project = projects.find((p) => p.id === projectId)
    const session = await sessionsApi.resume({ repoId, ccSessionId })
    setActiveSessions((prev) => [
      ...prev,
      {
        paneId: `pane-${Date.now()}`,
        session,
        repo,
        projectName: project?.name ?? '',
        projectIcon: project?.icon ?? null,
      },
    ])
  }

  function closePane(paneId: string) {
    setActiveSessions((prev) => {
      const pane = prev.find((p) => p.paneId === paneId)
      if (pane) void sessionsApi.kill(pane.session.id)
      return prev.filter((p) => p.paneId !== paneId)
    })
  }

  if (vaultConfigured === false) {
    return <WelcomeDialog onDone={() => setVaultConfigured(true)} />
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onCreateProject={create}
        onDeleteProject={remove}
        onSpawnSession={handleSpawn}
        onResumeSession={handleResume}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {activeSessions.length === 0 ? (
          <EmptyMain loading={loading} hasProjects={projects.length > 0} />
        ) : (
          <div className="grid h-full auto-rows-fr gap-px bg-[var(--color-border)]" style={{ gridTemplateColumns: `repeat(${Math.min(activeSessions.length, 3)}, minmax(0, 1fr))` }}>
            {activeSessions.map((s) => (
              <div key={s.paneId} className="flex flex-col bg-[var(--color-bg)]">
                <Terminal
                  session={s.session}
                  repoLabel={s.repo.label}
                  repoPath={s.repo.path}
                  projectName={s.projectName}
                  projectIcon={s.projectIcon}
                  onClose={() => closePane(s.paneId)}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function EmptyMain({ loading, hasProjects }: { loading: boolean; hasProjects: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center text-[var(--color-text-dim)]">
        {loading ? (
          <span>carregando…</span>
        ) : !hasProjects ? (
          <>
            <div className="mb-2 text-lg font-medium text-[var(--color-text)]">
              Sem projetos ainda
            </div>
            <div>Crie um projeto na barra lateral pra começar.</div>
          </>
        ) : (
          <>
            <div className="mb-2 text-lg font-medium text-[var(--color-text)]">
              Selecione um repo
            </div>
            <div>Clique em ▸ &lt;label&gt; na sidebar pra abrir uma sessão.</div>
          </>
        )}
      </div>
    </div>
  )
}
