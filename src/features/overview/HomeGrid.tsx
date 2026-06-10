import type { ReactNode } from 'react'
import type { OverviewData } from '../../../shared/types/ipc'
import { SessionsCard } from './SessionsCard'
import { TasksCard } from './TasksCard'
import { FeaturesCard } from './FeaturesCard'
import { ObjectivesCard } from './ObjectivesCard'

// Grid 2×2 da Home: sessões agora / tasks urgentes / features em andamento /
// objetivos ativos. Cada card lê o que precisa (sessões vêm do appStore, o
// resto do agregado overview) — sem polling próprio.
export function HomeGrid({ data }: { data: OverviewData }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SessionsCard />
      <TasksCard pending={data.pending} />
      <FeaturesCard features={data.features} />
      <ObjectivesCard nodes={data.objectives} />
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
    <section className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
          {title}
        </h2>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-text-dim)]">
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
