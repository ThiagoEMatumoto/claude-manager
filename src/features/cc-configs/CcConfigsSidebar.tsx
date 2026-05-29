export type CcTab = 'plugins' | 'agents' | 'skills' | 'mcps'

interface TabDef {
  id: CcTab
  label: string
}

const TABS: TabDef[] = [
  { id: 'plugins', label: 'Plugins' },
  { id: 'agents', label: 'Agents' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcps', label: 'MCPs' },
]

interface Props {
  active: CcTab
  counts: Record<CcTab, number>
  onSelect: (tab: CcTab) => void
  onReload: () => void
  loading: boolean
}

export function CcConfigsSidebar({ active, counts, onSelect, onReload, loading }: Props) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="text-sm font-semibold tracking-tight">Configs do CC</div>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs font-medium text-[var(--color-text)] transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? '…' : 'Atualizar'}
        </button>
      </div>

      <ul className="flex flex-col gap-px py-2">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
                  isActive
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="text-xs text-[var(--color-text-dim)]">{counts[tab.id]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
