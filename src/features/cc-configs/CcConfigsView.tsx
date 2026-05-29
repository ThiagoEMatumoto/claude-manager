import type { AgentInfo, ClaudeConfigs, McpInfo, SkillInfo } from '../../../shared/types/ipc'
import type { CcTab } from './CcConfigsSidebar'
import { CenterMessage } from './ui'

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
      <ul className="flex flex-col gap-px">
        {tab === 'agents' && configs.agents.map((a) => <AgentRow key={a.name} agent={a} />)}
        {tab === 'skills' && configs.skills.map((s) => <SkillRow key={s.name} skill={s} />)}
        {tab === 'mcps' && configs.mcps.map((m) => <McpRow key={m.name} mcp={m} />)}
      </ul>
    </div>
  )
}

function RowShell({ name, meta, badge }: { name: string; meta?: string; badge?: React.ReactNode }) {
  return (
    <li className="rounded-md px-3 py-2 transition hover:bg-[var(--color-surface-2)]/50">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--color-text)]">{name}</span>
        {badge}
      </div>
      {meta && <div className="mt-0.5 text-xs text-[var(--color-text-dim)]">{meta}</div>}
    </li>
  )
}

function AgentRow({ agent }: { agent: AgentInfo }) {
  return <RowShell name={agent.name} meta={agent.description || undefined} />
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  return <RowShell name={skill.name} meta={skill.description || undefined} />
}

function McpRow({ mcp }: { mcp: McpInfo }) {
  return (
    <RowShell
      name={mcp.name}
      badge={
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-dim)]">
          {mcp.kind}
        </span>
      }
    />
  )
}
