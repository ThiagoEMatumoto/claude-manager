import { Bot, Plug, Puzzle, RefreshCw, Sparkles, Store, Webhook } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Icon } from '@/components/ui/Icon'

export type CcTab = 'plugins' | 'marketplace' | 'agents' | 'skills' | 'mcps' | 'hooks'

// Abas que renderizam componentes agregados de ccConfigs.read().
export type ComponentTab = 'agents' | 'skills' | 'mcps' | 'hooks'

interface TabDef {
  id: CcTab
  label: string
  icon: ComponentType<LucideProps>
}

const TABS: TabDef[] = [
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcps', label: 'MCPs', icon: Plug },
  { id: 'hooks', label: 'Hooks', icon: Webhook },
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
          title="Atualizar"
          className="flex items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs font-medium text-[var(--color-text)] transition hover:opacity-90 disabled:opacity-50"
        >
          <Icon as={RefreshCw} size={13} className={loading ? 'animate-spin' : undefined} />
          Atualizar
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
                <span className="flex items-center gap-2">
                  <Icon as={tab.icon} className={isActive ? undefined : 'text-[var(--color-text-dim)]'} />
                  {tab.label}
                </span>
                <span className="text-xs text-[var(--color-text-dim)]">{counts[tab.id]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
