import { useState } from 'react'
import { useRepos } from './useProjects'

interface Props {
  projectId: string
  onSpawnSession: (repoId: string) => Promise<void>
}

export function ProjectRepos({ projectId, onSpawnSession }: Props) {
  const { repos, create, remove } = useRepos(projectId)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !path.trim()) return
    await create(label.trim(), path.trim())
    setLabel('')
    setPath('')
    setAdding(false)
  }

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
              className="flex-1 text-left text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              title={r.path}
            >
              ▸ {r.label}
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

      {adding ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-1 px-4 py-2">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (ex: front)"
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path absoluto"
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-black hover:opacity-90"
            >
              ok
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs hover:bg-[var(--color-surface-2)]"
            >
              cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="block w-full px-4 py-1.5 text-left text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
        >
          + repo
        </button>
      )}
    </div>
  )
}
