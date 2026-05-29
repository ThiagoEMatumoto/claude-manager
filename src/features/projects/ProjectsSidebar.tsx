import { useState } from 'react'
import { useProjects } from './useProjects'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectRepos } from './ProjectRepos'
import { useAppStore } from '@/store/appStore'

export function ProjectsSidebar() {
  const { projects, create, remove } = useProjects()
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="text-sm font-semibold tracking-tight">Projetos</div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded-md bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-black transition hover:opacity-90"
        >
          + Novo
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projects.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--color-text-dim)]">
            Nenhum projeto. Crie o primeiro.
          </div>
        )}

        <ul className="flex flex-col gap-px py-2">
          {projects.map((p) => {
            const active = p.id === activeProjectId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActiveProject(p.id)}
                  className={`group flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                    active
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {p.icon ? (
                      <span className="text-sm leading-none">{p.icon}</span>
                    ) : (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: p.color ?? '#5c5c70' }}
                      />
                    )}
                    {p.name}
                    {!p.vaultPath && (
                      <span
                        className="text-[10px] text-[var(--color-text-dim)] opacity-60"
                        title="Este projeto não tem um vault definido"
                      >
                        sem vault
                      </span>
                    )}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Apagar projeto "${p.name}"?`)) void remove(p.id)
                    }}
                    className="hidden text-xs text-[var(--color-text-dim)] hover:text-red-400 group-hover:inline"
                  >
                    ×
                  </span>
                </button>

                {active && <ProjectRepos project={p} />}
              </li>
            )
          })}
        </ul>
      </div>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={async (input) => {
          await create(input)
          setDialogOpen(false)
        }}
      />
    </aside>
  )
}
