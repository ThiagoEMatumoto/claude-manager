import { useEffect, useRef } from 'react'
import type { AgentInfo, ClaudeConfigs, McpInfo, SkillInfo } from '../../../shared/types/ipc'
import type { ComponentTab } from './CcConfigsSidebar'
import type { FocusedItem } from './navigation'
import { Badge, Card, CenterMessage } from './ui'

// Abas de inventário simples (agents/skills/mcps). Hooks tem aba própria
// (HooksTab) porque ganhou toggle por entry — os helpers de card/focus são
// exportados daqui pra ela reutilizar.
type ListTab = Exclude<ComponentTab, 'hooks'>

interface Props {
  tab: ListTab
  configs: ClaudeConfigs
  loading: boolean
  focus: FocusedItem | null
  onClearFocus: () => void
}

const EMPTY_LABEL: Record<ListTab, string> = {
  agents: 'Nenhum agent encontrado.',
  skills: 'Nenhuma skill encontrada.',
  mcps: 'Nenhum MCP server encontrado.',
}

function originLabel(origin: string): string {
  return origin === 'user' ? 'user' : origin
}

export function isFocused(
  focus: FocusedItem | null,
  tab: ComponentTab,
  name: string,
  origin: string,
) {
  if (!focus || focus.tab !== tab || focus.name !== name) return false
  return focus.origin == null || focus.origin === origin
}

export function CcConfigsView({ tab, configs, loading, focus, onClearFocus }: Props) {
  const items = tab === 'agents' ? configs.agents : tab === 'skills' ? configs.skills : configs.mcps

  if (loading && items.length === 0) return <CenterMessage text="Carregando…" />
  if (items.length === 0) return <CenterMessage text={EMPTY_LABEL[tab]} />

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mb-3 text-xs text-[var(--color-text-dim)]">{items.length} itens</div>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {tab === 'agents' &&
          configs.agents.map((a) => (
            <AgentCard
              key={`${a.origin}:${a.name}`}
              agent={a}
              focused={isFocused(focus, 'agents', a.name, a.origin)}
              onClearFocus={onClearFocus}
            />
          ))}
        {tab === 'skills' &&
          configs.skills.map((s) => (
            <SkillCard
              key={`${s.origin}:${s.name}`}
              skill={s}
              focused={isFocused(focus, 'skills', s.name, s.origin)}
              onClearFocus={onClearFocus}
            />
          ))}
        {tab === 'mcps' &&
          configs.mcps.map((m) => (
            <McpCard
              key={`${m.origin}:${m.name}`}
              mcp={m}
              focused={isFocused(focus, 'mcps', m.name, m.origin)}
              onClearFocus={onClearFocus}
            />
          ))}
      </div>
    </div>
  )
}

export function FocusableCard({
  focused,
  onClearFocus,
  children,
}: {
  focused: boolean
  onClearFocus: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focused) return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = window.setTimeout(onClearFocus, 2500)
    return () => window.clearTimeout(timer)
  }, [focused, onClearFocus])

  return (
    <div
      ref={ref}
      className={
        focused
          ? 'rounded-lg ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)] transition'
          : ''
      }
    >
      {children}
    </div>
  )
}

export function EntityCard({
  name,
  badge,
  origin,
  description,
}: {
  name: string
  badge: string
  origin: string
  description?: string
}) {
  const fromUser = origin === 'user'
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={fromUser ? 'neutral' : 'on'}>{originLabel(origin)}</Badge>
          <Badge>{badge}</Badge>
        </div>
      </div>
      {description && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-[var(--color-text-dim)]">
          {description}
        </p>
      )}
    </Card>
  )
}

function AgentCard({
  agent,
  focused,
  onClearFocus,
}: {
  agent: AgentInfo
  focused: boolean
  onClearFocus: () => void
}) {
  return (
    <FocusableCard focused={focused} onClearFocus={onClearFocus}>
      <EntityCard
        name={agent.name}
        badge="agent"
        origin={agent.origin}
        description={agent.description || undefined}
      />
    </FocusableCard>
  )
}

function SkillCard({
  skill,
  focused,
  onClearFocus,
}: {
  skill: SkillInfo
  focused: boolean
  onClearFocus: () => void
}) {
  return (
    <FocusableCard focused={focused} onClearFocus={onClearFocus}>
      <EntityCard
        name={skill.name}
        badge="skill"
        origin={skill.origin}
        description={skill.description || undefined}
      />
    </FocusableCard>
  )
}

function McpCard({
  mcp,
  focused,
  onClearFocus,
}: {
  mcp: McpInfo
  focused: boolean
  onClearFocus: () => void
}) {
  return (
    <FocusableCard focused={focused} onClearFocus={onClearFocus}>
      <EntityCard name={mcp.name} badge={mcp.kind} origin={mcp.origin} />
    </FocusableCard>
  )
}
