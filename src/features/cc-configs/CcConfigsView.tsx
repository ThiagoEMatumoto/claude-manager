import type { AgentInfo, ClaudeConfigs, McpInfo, SkillInfo } from '../../../shared/types/ipc'
import type { CcTab } from './CcConfigsSidebar'
import { Badge, Card, CenterMessage } from './ui'

interface Props {
  tab: Exclude<CcTab, 'plugins' | 'marketplace'>
  configs: ClaudeConfigs
  loading: boolean
}

const EMPTY_LABEL: Record<string, string> = {
  agents: 'Nenhum agent em ~/.claude/agents.',
  skills: 'Nenhuma skill em ~/.claude/skills.',
  mcps: 'Nenhum MCP server em ~/.claude/.mcp.json.',
}

export function CcConfigsView({ tab, configs, loading }: Props) {
  const items =
    tab === 'agents' ? configs.agents : tab === 'skills' ? configs.skills : configs.mcps

  if (loading && items.length === 0) return <CenterMessage text="Carregando…" />
  if (items.length === 0) return <CenterMessage text={EMPTY_LABEL[tab]} />

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mb-3 text-xs text-[var(--color-text-dim)]">{items.length} itens</div>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
        {tab === 'agents' && configs.agents.map((a) => <AgentCard key={a.name} agent={a} />)}
        {tab === 'skills' && configs.skills.map((s) => <SkillCard key={s.name} skill={s} />)}
        {tab === 'mcps' && configs.mcps.map((m) => <McpCard key={m.name} mcp={m} />)}
      </div>
    </div>
  )
}

function EntityCard({
  name,
  badge,
  description,
}: {
  name: string
  badge: string
  description?: string
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text)]">
          {name}
        </span>
        <Badge>{badge}</Badge>
      </div>
      {description && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-[var(--color-text-dim)]">
          {description}
        </p>
      )}
    </Card>
  )
}

function AgentCard({ agent }: { agent: AgentInfo }) {
  return <EntityCard name={agent.name} badge="agent" description={agent.description || undefined} />
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  return <EntityCard name={skill.name} badge="skill" description={skill.description || undefined} />
}

function McpCard({ mcp }: { mcp: McpInfo }) {
  return <EntityCard name={mcp.name} badge={mcp.kind} />
}
