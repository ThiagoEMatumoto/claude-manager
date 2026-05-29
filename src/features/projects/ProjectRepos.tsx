import { useCallback, useEffect, useState } from 'react'
import { useRepos } from './useProjects'
import { AddRepoDialog } from './AddRepoDialog'
import { sessionsApi } from '@/lib/ipc'
import { relativeTime } from '@/lib/time'
import type { LinkKind, Project, Repo, SessionSummary } from '../../../shared/types/ipc'

interface Props {
  project: Project
  onSpawnSession: (repoId: string) => Promise<void>
  onResumeSession: (repoId: string, ccSessionId: string) => Promise<void>
}

const LINK_BADGE: Record<LinkKind, { icon: string; title: string }> = {
  inside: { icon: '📁', title: 'Dentro do vault' },
  symlink: { icon: '🔗', title: 'Symlink para fora do vault' },
  external: { icon: '↗', title: 'Referência externa' },
}

const STATUS_DOT: Record<SessionSummary['status'], string> = {
  working: 'bg-green-400',
  waiting: 'bg-yellow-400',
  idle: 'bg-[var(--color-accent)]',
  ended: 'bg-[var(--color-text-dim)]',
}

export function ProjectRepos({ project, onSpawnSession, onResumeSession }: Props) {
  const { repos, create, remove } = useRepos(project.id)
  const [adding, setAdding] = useState(false)

  return (
    <div className="border-l border-[var(--color-border)]/50 bg-[var(--color-bg)]/40 pl-4">
      <ul className="flex flex-col gap-px py-1">
        {repos.map((r) => (
          <RepoRow
            key={r.id}
            repo={r}
            onSpawnSession={onSpawnSession}
            onResumeSession={onResumeSession}
            onRemove={remove}
          />
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
  onSpawnSession: (repoId: string) => Promise<void>
  onResumeSession: (repoId: string, ccSessionId: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

function RepoRow({ repo, onSpawnSession, onResumeSession, onRemove }: RepoRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)

  const refetch = useCallback(() => {
    void sessionsApi.listByRepo(repo.id).then(setSessions)
  }, [repo.id])

  useEffect(() => {
    if (expanded) refetch()
  }, [expanded, refetch])

  return (
    <li className="text-xs">
      <div className="group flex items-center justify-between px-1 py-1.5">
        <div className="flex flex-1 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-4 shrink-0 text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            title={expanded ? 'Recolher sessões' : 'Ver sessões'}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <button
            type="button"
            onClick={() => onSpawnSession(repo.id)}
            className="flex flex-1 items-center gap-1.5 text-left text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            title={repo.path}
          >
            <span className="text-[10px]" title={LINK_BADGE[repo.linkKind].title}>
              {LINK_BADGE[repo.linkKind].icon}
            </span>
            <span>{repo.label}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Apagar repo "${repo.label}"?`)) void onRemove(repo.id)
          }}
          className="hidden text-[var(--color-text-dim)] hover:text-red-400 group-hover:inline"
        >
          ×
        </button>
      </div>

      {expanded && (
        <ul className="flex flex-col gap-px pb-1 pl-5">
          {sessions === null && (
            <li className="px-2 py-1 text-[10px] text-[var(--color-text-dim)]">carregando…</li>
          )}
          {sessions !== null && sessions.length === 0 && (
            <li className="px-2 py-1 text-[10px] text-[var(--color-text-dim)]">sem sessões</li>
          )}
          {sessions?.map((s) => (
            <li
              key={s.ccSessionId}
              className="group/sess flex items-center justify-between gap-2 px-2 py-1"
            >
              <button
                type="button"
                onClick={() => void onResumeSession(repo.id, s.ccSessionId)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title="Retomar sessão"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s.status]} ${
                    s.isLive ? '' : 'opacity-50'
                  }`}
                />
                <span className="truncate text-[var(--color-text-dim)] group-hover/sess:text-[var(--color-text)]">
                  {s.name || '(sem nome)'}
                </span>
              </button>
              <span className="shrink-0 text-[10px] text-[var(--color-text-dim)] opacity-70">
                {s.isLive ? 'ao vivo' : relativeTime(s.lastActivityAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
