import {
  Bot,
  FileText,
  Keyboard,
  Plug,
  Puzzle,
  RefreshCw,
  ScrollText,
  Server,
  SlidersHorizontal,
  Sparkles,
  Store,
  Webhook,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Icon } from '@/components/ui/Icon'
import { activeMarker } from '@/features/brand'

export type CcTab =
  | 'plugins'
  | 'marketplace'
  | 'agents'
  | 'skills'
  | 'mcps'
  | 'hooks'
  | 'settings'
  | 'mcp'
  | 'claude-md'
  | 'rules'
  | 'keybindings'

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

// Superfícies de configuração do CLI claude (~/.claude) — separadas das abas
// de inventário acima porque EDITAM arquivos do CLI, não do app.
const CLI_TABS: TabDef[] = [
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'claude-md', label: 'CLAUDE.md', icon: FileText },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
]

interface Props {
  active: CcTab
  counts: Partial<Record<CcTab, number>>
  onSelect: (tab: CcTab) => void
  onReload: () => void
  loading: boolean
}

function TabButton({
  tab,
  isActive,
  count,
  onSelect,
}: {
  tab: TabDef
  isActive: boolean
  count: number | undefined
  onSelect: (tab: CcTab) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(tab.id)}
        className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition ${
          isActive
            ? `bg-[var(--color-surface-2)] text-[var(--color-text)] ${activeMarker}`
            : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
        }`}
      >
        <span className="flex items-center gap-2">
          <Icon as={tab.icon} className={isActive ? undefined : 'text-[var(--color-text-dim)]'} />
          {tab.label}
        </span>
        {count != null && (
          <span className="font-mono text-xs tabular-nums text-[var(--color-text-dim)]">{count}</span>
        )}
      </button>
    </li>
  )
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
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === active}
            count={counts[tab.id]}
            onSelect={onSelect}
          />
        ))}
      </ul>

      <div className="border-t border-[var(--color-border)] px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
        CLI claude (~/.claude)
      </div>
      <ul className="flex flex-col gap-px pb-2">
        {CLI_TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            isActive={tab.id === active}
            count={counts[tab.id]}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </aside>
  )
}
