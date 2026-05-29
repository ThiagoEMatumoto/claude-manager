import { useState } from 'react'
import { IconRail } from './IconRail'
import { ProjectsSidebar } from '@/features/projects/ProjectsSidebar'
import { Terminal } from '@/features/sessions/Terminal'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { useAppStore } from '@/store/appStore'

export function AppShell() {
  const area = useAppStore((s) => s.area)
  const panes = useAppStore((s) => s.panes)
  const closePane = useAppStore((s) => s.closePane)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex h-full w-full overflow-hidden">
      <IconRail onOpenSettings={() => setSettingsOpen(true)} />

      {area === 'projects' && <ProjectsSidebar />}

      <main className="flex flex-1 flex-col overflow-hidden">
        {panes.length === 0 ? (
          <EmptyMain />
        ) : (
          <div
            className="grid h-full auto-rows-fr gap-px bg-[var(--color-border)]"
            style={{ gridTemplateColumns: `repeat(${Math.min(panes.length, 3)}, minmax(0, 1fr))` }}
          >
            {panes.map((p) => (
              <div key={p.paneId} className="flex flex-col bg-[var(--color-bg)]">
                <Terminal
                  session={p.session}
                  repoLabel={p.repo.label}
                  repoPath={p.repo.path}
                  projectName={p.projectName}
                  projectIcon={p.projectIcon}
                  onClose={() => closePane(p.paneId)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function EmptyMain() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center text-[var(--color-text-dim)]">
        <div className="mb-2 text-lg font-medium text-[var(--color-text)]">
          Nenhuma sessão aberta
        </div>
        <div>Selecione um repo na barra lateral pra abrir uma sessão.</div>
      </div>
    </div>
  )
}
