import type { CSSProperties, ReactNode } from 'react'
import { cx } from '@/features/brand'
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
    <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
      {cards.map((card, i) => (
        <div key={card.key} className="home-rise" style={{ '--i': i + 6 } as CSSProperties}>
          {card}
        </div>
      ))}
    </div>
  )
}

// Casca compartilhada dos 4 cards: dot de estado + título + contador + corpo
// rolável com altura máxima (mantém o grid acima da dobra). O `dot` segue o
// design da Home (accent pulsante nas sessões, atenção nas tasks, etc.).
export function HomeCard({
  title,
  count,
  dot,
  action,
  children,
}: {
  title: string
  count?: number
  dot?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="glass-card flex h-full flex-col overflow-hidden transition hover:-translate-y-px hover:border-[var(--color-accent-dim)]/40">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
        {dot}
        <h2 className="text-xs font-semibold text-[var(--color-text)]">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-[var(--color-bg)]/70 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--color-text-dim)]">
            {count}
          </span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      <div className="max-h-72 flex-1 overflow-y-auto p-2.5">{children}</div>
    </section>
  )
}

// Dot colorido do header dos cards (design: 6px, accent pulsa via O Ápice).
export function CardDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('h-1.5 w-1.5 shrink-0 rounded-full', pulse && 'pw-pulse')}
      style={{ background: color }}
    />
  )
}

// Vazio padrão dos cards.
export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-6 text-center text-sm text-[var(--color-text-dim)]">{children}</div>
  )
}
