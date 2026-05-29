import { useState } from 'react'
import { useRepos } from './useProjects'
import { AddRepoDialog } from './AddRepoDialog'
import { EditRepoDialog } from './EditRepoDialog'
import { Menu } from '@/components/ui/Menu'
import { SessionsModal } from '@/features/sessions/SessionsModal'
import { useAppStore } from '@/store/appStore'
import type { LinkKind, Project, Repo, UpdateRepoInput } from '../../../shared/types/ipc'

interface Props {
  project: Project
}

const LINK_BADGE: Record<LinkKind, { icon: string; title: string }> = {
  inside: { icon: '📁', title: 'Dentro do vault' },
  symlink: { icon: '🔗', title: 'Symlink para fora do vault' },
  external: { icon: '↗', title: 'Referência externa' },
}

export function ProjectRepos({ project }: Props) {
  const { repos, create, update, remove } = useRepos(project.id)
  const [adding, setAdding] = useState(false)

  return (
    <div className="border-l border-[var(--color-border)]/50 bg-[var(--color-bg)]/40 pl-4">
      <ul className="flex flex-col gap-px py-1">
        {repos.map((r) => (
          <RepoRow key={r.id} repo={r} project={project} onUpdate={update} onRemove={remove} />
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="block w-full px-4 py-1.5 text-left text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
      >
        + repo
      </button>

      <AddRepoDialog
        open={adding}
        onClose={() => setAdding(false)}
        project={project}
        onCreate={create}
      />
    </div>
  )
}

interface RepoRowProps {
  repo: Repo
  project: Project
  onUpdate: (input: UpdateRepoInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

function RepoRow({ repo, project, onUpdate, onRemove }: RepoRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const openSession = useAppStore((s) => s.openSession)

  return (
    <li className="text-xs">
      <div className="group flex items-center justify-between gap-1 px-1 py-1.5">
        <button
          type="button"
          onClick={() => void openSession(repo, project.name, project.icon)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          title={`Nova sessão · ${repo.path}`}
        >
          <span className="text-[10px]" title={LINK_BADGE[repo.linkKind].title}>
            {LINK_BADGE[repo.linkKind].icon}
          </span>
          <span className="truncate">{repo.label}</span>
        </button>

        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              label: 'Nova sessão',
              onClick: () => void openSession(repo, project.name, project.icon),
            },
            { label: 'Ver sessões…', onClick: () => setSessionsOpen(true) },
            { label: 'Editar', onClick: () => setEditOpen(true) },
            {
              label: 'Remover repo',
              danger: true,
              onClick: () => {
                if (confirm(`Apagar repo "${repo.label}"?`)) void onRemove(repo.id)
              },
            },
          ]}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="shrink-0 rounded px-1 leading-none text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-text)] group-hover:opacity-100"
            title="Ações do repo"
          >
            ⋯
          </button>
        </Menu>
      </div>

      <SessionsModal
        repo={repo}
        projectName={project.name}
        projectIcon={project.icon}
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
      />

      {editOpen && (
        <EditRepoDialog
          open
          repo={repo}
          onClose={() => setEditOpen(false)}
          onSave={async (input) => {
            await onUpdate(input)
            setEditOpen(false)
          }}
        />
      )}
    </li>
  )
}
