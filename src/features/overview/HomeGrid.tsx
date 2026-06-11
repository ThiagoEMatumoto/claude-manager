import type { CSSProperties, ReactNode } from 'react'
import type { OverviewData } from '../../../shared/types/ipc'
import { SessionsCard } from './SessionsCard'
import { TasksCard } from './TasksCard'
import { FeaturesCard } from './FeaturesCard'
import { ObjectivesCard } from './ObjectivesCard'

// Grid 2×2 da Home: sessões agora / tasks urgentes / features em andamento /
// objetivos ativos. Cada card lê o que precisa (sessões vêm do appStore, o
// resto do agregado overview) — sem polling próprio. Stagger via --i.
export function HomeGrid({ data }: { data: OverviewData }) {
  const cards = [
    <SessionsCard key="sessions" />,
    <TasksCard key="tasks" pending={data.pending} />,
    <FeaturesCard key="features" features={data.features} />,
    <ObjectivesCard key="objectives" nodes={data.objectives} />,
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((card, i) => (
        <div key={card.key} className="home-rise" style={{ '--i': i + 6 } as CSSProperties}>
          {card}
        </div>
      ))}
    </div>
  )
}

// Casca compartilhada dos 4 cards: título + contador + corpo rolável com
// altura máxima (mantém o grid acima da dobra).
export function HomeCard({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="glass-card flex h-full flex-col overflow-hidden transition hover:-translate-y-px hover:border-[var(--color-accent-dim)]/40">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
          {title}
        </h2>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--color-bg)]/70 px-2 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-text-dim)]">
            {count}
          </span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      <div className="max-h-72 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  )
}

// Vazio padrão dos cards.
export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-[var(--color-text-dim)]">{children}</div>
  )
}
