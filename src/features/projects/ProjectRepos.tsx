import { useState } from 'react'
import { useRepos } from './useProjects'
import { AddRepoDialog } from './AddRepoDialog'
import type { LinkKind, Project } from '../../../shared/types/ipc'

interface Props {
  project: Project
  onSpawnSession: (repoId: string) => Promise<void>
}

const LINK_BADGE: Record<LinkKind, { icon: string; title: string }> = {
  inside: { icon: '📁', title: 'Dentro do vault' },
  symlink: { icon: '🔗', title: 'Symlink para fora do vault' },
  external: { icon: '↗', title: 'Referência externa' },
}

export function ProjectRepos({ project, onSpawnSession }: Props) {
  const { repos, create, remove } = useRepos(project.id)
  const [adding, setAdding] = useState(false)

  return (
    <div className="border-l border-[var(--color-border)]/50 bg-[var(--color-bg)]/40 pl-4">
      <ul className="flex flex-col gap-px py-1">
        {repos.map((r) => (
          <li
            key={r.id}
            className="group flex items-center justify-between px-4 py-1.5 text-xs"
          >
            <button
              type="button"
              onClick={() => onSpawnSession(r.id)}
              className="flex flex-1 items-center gap-1.5 text-left text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              title={r.path}
            >
              <span className="text-[10px]" title={LINK_BADGE[r.linkKind].title}>
                {LINK_BADGE[r.linkKind].icon}
              </span>
              <span>{r.label}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Apagar repo "${r.label}"?`)) void remove(r.id)
              }}
              className="hidden text-[var(--color-text-dim)] hover:text-red-400 group-hover:inline"
            >
              ×
            </button>
          </li>
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
