import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/appStore'
import { projectsApi } from '@/lib/ipc'
import type { Project, Repo } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
}

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}

// Substring match case/acento-insensível, simples e previsível.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function matches(query: string, label: string): boolean {
  if (!query) return true
  return normalize(label).includes(normalize(query))
}

export function CommandPalette({ open, onClose, onOpenSettings }: Props) {
  const setArea = useAppStore((s) => s.setArea)
  const setActiveProject = useAppStore((s) => s.setActiveProject)
  const openSession = useAppStore((s) => s.openSession)
  const closePane = useAppStore((s) => s.closePane)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [projects, setProjects] = useState<Project[]>([])
  // Repos de todos os projetos, carregados lazy quando a palette abre.
  const [reposByProject, setReposByProject] = useState<Record<string, Repo[]>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    inputRef.current?.focus()

    let cancelled = false
    void (async () => {
      const ps = await projectsApi.list()
      if (cancelled) return
      setProjects(ps)
      const entries = await Promise.all(
        ps.map(async (p) => [p.id, await projectsApi.listRepos(p.id)] as const),
      )
      if (cancelled) return
      setReposByProject(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'area-projects',
        label: 'Ir para Projetos',
        group: 'Navegação',
        run: () => setArea('projects'),
      },
      {
        id: 'area-cc',
        label: 'Ir para Configs do CC',
        group: 'Navegação',
        run: () => setArea('cc-configs'),
      },
      {
        id: 'open-settings',
        label: 'Abrir Configurações',
        group: 'Ações',
        run: () => onOpenSettings(),
      },
    ]

    for (const p of projects) {
      list.push({
        id: `goto-${p.id}`,
        label: `Ir para projeto: ${p.name}`,
        hint: p.icon ?? undefined,
        group: 'Projetos',
        run: () => {
          setActiveProject(p.id)
          setArea('projects')
        },
      })
    }

    for (const p of projects) {
      for (const r of reposByProject[p.id] ?? []) {
        list.push({
          id: `session-${r.id}`,
          label: `Nova sessão em: ${r.label}`,
          hint: p.name,
          group: 'Sessões',
          run: () => void openSession(r, p.name, p.icon, p.color),
        })
      }
    }

    const activePaneId = useAppStore.getState().panes[0]?.paneId
    if (activePaneId) {
      const panes = useAppStore.getState().panes
      list.push({
        id: 'close-pane',
        label: `Fechar pane: ${panes[panes.length - 1]?.repo.label ?? ''}`.trim(),
        group: 'Ações',
        run: () => closePane(panes[panes.length - 1].paneId),
      })
    }

    return list
  }, [projects, reposByProject, setArea, setActiveProject, openSession, closePane, onOpenSettings])

  const filtered = useMemo(
    () => commands.filter((c) => matches(query, c.label)),
    [commands, query],
  )

  useEffect(() => {
    setActive(0)
  }, [query])

  // Mantém o item ativo visível ao navegar por teclado.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  function runAt(idx: number) {
    const cmd = filtered[idx]
    if (!cmd) return
    onClose()
    cmd.run()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Agrupa preservando a ordem de inserção dos grupos.
  const groups: { group: string; items: { cmd: Command; idx: number }[] }[] = []
  filtered.forEach((cmd, idx) => {
    let g = groups.find((x) => x.group === cmd.group)
    if (!g) {
      g = { group: cmd.group, items: [] }
      groups.push(g)
    }
    g.items.push({ cmd, idx })
  })

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex w-[36rem] max-w-[90vw] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        <div className="border-b border-[var(--color-border)] px-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar ações, projetos, repos…"
            className="w-full bg-transparent py-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
          />
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              Nenhum resultado.
            </div>
          )}

          {groups.map((g) => (
            <div key={g.group} className="py-1">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
                {g.group}
              </div>
              {g.items.map(({ cmd, idx }) => (
                <button
                  key={cmd.id}
                  type="button"
                  data-idx={idx}
                  onMouseMove={() => setActive(idx)}
                  onClick={() => runAt(idx)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    idx === active
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)]'
                  }`}
                >
                  {cmd.hint && <span className="shrink-0 text-xs opacity-70">{cmd.hint}</span>}
                  <span className="truncate">{cmd.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-dim)]">
          <span>↑↓ navegar</span>
          <span>↵ selecionar</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  )
}
