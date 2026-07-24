import { useMemo } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Input'
import { Button } from '@/features/brand'
import type {
  ObjectiveKind,
  ObjectiveStatus,
  ObjectiveWithProgress,
} from '../../../shared/types/ipc'
import { KIND_META, KIND_ORDER, STATUS_META, STATUS_ORDER } from './status'

export type KindFilter = 'all' | ObjectiveKind
export type StatusFilter = 'all' | ObjectiveStatus

interface Props {
  // Já filtrados por kind/status (filtro do store); query/tags são aplicados aqui.
  objectives: ObjectiveWithProgress[]
  selectedId: string | null
  loading: boolean
  query: string
  kindFilter: KindFilter
  statusFilter: StatusFilter
  selectedTags: string[]
  onQuery: (q: string) => void
  onKindFilter: (k: KindFilter) => void
  onStatusFilter: (s: StatusFilter) => void
  onToggleTag: (tag: string) => void
  onSelect: (id: string) => void
  onReload: () => void
  onNew: () => void
}

function Pill({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] transition ${
        active
          ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
          : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
      }`}
    >
      {label}
    </button>
  )
}

export function ObjectivesSidebar({
  objectives,
  selectedId,
  loading,
  query,
  kindFilter,
  statusFilter,
  selectedTags,
  onQuery,
  onKindFilter,
  onStatusFilter,
  onToggleTag,
  onSelect,
  onReload,
  onNew,
}: Props) {
  const q = query.trim().toLowerCase()

  // Tags disponíveis derivam da lista corrente (kind/status já aplicados).
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const o of objectives) for (const t of o.tags) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [objectives])

  const listed = useMemo(() => {
    return objectives.filter((o) => {
      if (q && !o.title.toLowerCase().includes(q)) return false
      if (selectedTags.length > 0 && !selectedTags.every((t) => o.tags.includes(t))) return false
      return true
    })
  }, [objectives, q, selectedTags])

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="text-sm font-semibold tracking-tight">Objetivos</div>
        <div className="flex items-center gap-1">
          <Button variant="primary" size="sm" onClick={onNew} title="Novo objetivo">
            <Icon as={Plus} size={13} />
            Novo
          </Button>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            title="Atualizar"
            className="flex items-center justify-center rounded-md bg-[var(--color-surface-2)] p-1.5 text-[var(--color-text)] transition hover:opacity-90 disabled:opacity-50"
          >
            <Icon as={RefreshCw} size={13} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] px-3 py-2.5">
        <Input
          placeholder="Buscar por título…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <Pill active={kindFilter === 'all'} label="Todos" onClick={() => onKindFilter('all')} />
          {KIND_ORDER.map((k) => (
            <Pill
              key={k}
              active={kindFilter === k}
              label={KIND_META[k].label}
              onClick={() => onKindFilter(k)}
            />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Pill
            active={statusFilter === 'all'}
            label="Todos"
            onClick={() => onStatusFilter('all')}
          />
          {STATUS_ORDER.map((s) => (
            <Pill
              key={s}
              active={statusFilter === s}
              label={STATUS_META[s].label}
              onClick={() => onStatusFilter(s)}
            />
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const on = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                    on
                      ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                  }`}
                >
                  #{tag}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {listed.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--color-text-dim)]">
            Nenhum objetivo.
          </div>
        )}
        <ul className="flex flex-col gap-px">
          {listed.map((o) => {
            const active = o.id === selectedId
            const meta = STATUS_META[o.status]
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onSelect(o.id)}
                  className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition ${
                    active
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: meta.color }}
                    title={meta.label}
                  />
                  <span className="truncate">{o.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                    {o.progress === null ? '—' : `${Math.round(o.progress)}%`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}
