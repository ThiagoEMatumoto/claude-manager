import { useState } from 'react'
import { FolderOpen, MoreHorizontal } from 'lucide-react'
import { useProjects } from './useProjects'
import { NewProjectDialog } from './NewProjectDialog'
import { EditProjectDialog } from './EditProjectDialog'
import { ProjectRepos } from './ProjectRepos'
import { Menu } from '@/components/ui/Menu'
import { Icon } from '@/components/ui/Icon'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { useAppStore } from '@/store/appStore'
import type { Project, UpdateProjectInput } from '../../../shared/types/ipc'

export function ProjectsSidebar() {
  const { projects, create, update, remove } = useProjects()
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  // Expansão independente por projeto (vários abertos ao mesmo tempo). O header
  // só faz toggle; setActiveProject segue como "último usado"/hint, sem gatear
  // a visibilidade dos repos.
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())

  function toggleExpanded(id: string) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <Icon as={FolderOpen} size={28} className="text-[var(--color-text-dim)] opacity-60" />
            <div className="text-sm font-medium text-[var(--color-text)]">Nenhum projeto ainda</div>
            <div className="text-xs text-[var(--color-text-dim)]">
              Crie um projeto pra agrupar seus repositórios e sessões.
            </div>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black transition hover:opacity-90"
            >
              Criar projeto
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-px py-2">
          {projects.map((p) => {
            const active = p.id === activeProjectId
            const expanded = expandedProjectIds.has(p.id)
            return (
              <li key={p.id}>
                <div
                  className={`group flex items-center justify-between border-l-2 px-4 py-2 text-sm transition ${
                    active || expanded
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'border-transparent text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                  }`}
                  style={
                    active || expanded
                      ? { borderLeftColor: p.color ?? 'var(--color-accent)' }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProject(p.id)
                      toggleExpanded(p.id)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: p.color ?? 'var(--color-text-dim)' }}
                    />
                    <span className="shrink-0">{renderProjectIcon(p.icon)}</span>
                    <span className="truncate">{p.name}</span>
                    {!p.vaultPath && (
                      <span
                        className="shrink-0 text-[10px] text-[var(--color-text-dim)] opacity-60"
                        title="Este projeto não tem um vault definido"
                      >
                        sem vault
                      </span>
                    )}
                  </button>

                  <ProjectMenu
                    project={p}
                    onEdit={() => setEditing(p)}
                    onRemove={() => {
                      if (confirm(`Apagar projeto "${p.name}"?`)) void remove(p.id)
                    }}
                  />
                </div>

                {expanded && <ProjectRepos project={p} />}
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

      {editing && (
        <EditProjectDialog
          open
          project={editing}
          onClose={() => setEditing(null)}
          onSave={async (input: UpdateProjectInput) => {
            await update(input)
            setEditing(null)
          }}
        />
      )}
    </aside>
  )
}

function ProjectMenu({
  project,
  onEdit,
  onRemove,
}: {
  project: Project
  onEdit: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={[
        { label: 'Editar', onClick: onEdit },
        { label: 'Remover', danger: true, onClick: onRemove },
      ]}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="shrink-0 rounded px-1 leading-none text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100"
        title={`Ações de "${project.name}"`}
      >
        <Icon as={MoreHorizontal} />
      </button>
    </Menu>
  )
}
