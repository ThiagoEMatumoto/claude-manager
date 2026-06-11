import { RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useAppStore } from '@/store/appStore'
import { groupLiveSessions } from '../../../shared/home-selectors'
import type { OverviewCounts } from '../../../shared/types/ipc'

// Hero da Home: saudação + data por extenso, pill live das sessões (appStore)
// e os contadores que eram o SummaryPanel, sob um glow radial sutil do accent.
export function HomeHero({ counts, onRefresh }: { counts: OverviewCounts; onRefresh: () => void }) {
  const liveSessions = useAppStore((s) => s.liveSessions)
  const groups = groupLiveSessions(liveSessions)
  const liveCount = groups.working.length + groups.waiting.length + groups.idle.length
  const now = new Date()

  return (
    <section className="glass-card relative overflow-hidden px-6 py-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/3 h-56 w-[28rem]"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent)',
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">
            {greeting(now.getHours())}
          </h1>
          <p className="mt-0.5 text-sm capitalize text-[var(--color-text-dim)]">{longDate(now)}</p>
        </div>

        <div className="flex items-center gap-2">
          <LivePill working={groups.working.length} waiting={groups.waiting.length} live={liveCount} />
          <button
            type="button"
            onClick={onRefresh}
            title="Recarregar"
            className="rounded-md p-1.5 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]"
          >
            <Icon as={RefreshCw} size={15} />
          </button>
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap items-center gap-2">
        <CountChip label="objetivos ativos" value={counts.activeObjectives} />
        <CountChip label="pendências" value={counts.pendingTasks} />
        <CountChip label="vencem hoje" value={counts.dueToday} />
        <CountChip label="atrasadas" value={counts.overdue} danger={counts.overdue > 0} />
      </div>
    </section>
  )
}

function greeting(hour: number): string {
  if (hour >= 6 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function longDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function LivePill({ working, waiting, live }: { working: number; waiting: number; live: number }) {
  if (live === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/60 px-3 py-1 text-xs text-[var(--color-text-dim)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-border)]" />
        Nenhuma sessão ativa
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent-dim)]/40 bg-[var(--color-surface)]/60 px-3 py-1 text-xs text-[var(--color-text)]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
      <span className="tabular-nums">{working} trabalhando</span>
      <span className="text-[var(--color-text-dim)]">/</span>
      <span className="tabular-nums">{waiting} aguardando</span>
    </span>
  )
}

function CountChip({
  label,
  value,
  danger = false,
}: {
  label: string
  value: number
  danger?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--color-surface)]/60 px-3 py-1 text-xs"
      style={{ borderColor: danger ? 'var(--color-danger)' : 'var(--color-border)' }}
    >
      <span
        className="font-semibold tabular-nums"
        style={{ color: danger ? 'var(--color-danger)' : 'var(--color-text)' }}
      >
        {value}
      </span>
      <span className="text-[var(--color-text-dim)]">{label}</span>
    </span>
  )
}
