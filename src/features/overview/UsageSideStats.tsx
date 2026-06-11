import { ArrowRight } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useAppStore } from '@/store/appStore'
import type { MetricsSnapshot } from '../../../shared/types/ipc'
import { fmtInt, fmtModelName } from './usage-format'

// Coluna lateral da faixa de métricas: cache hit rate, top 3 tools e
// distribuição por modelo (janela 30d), com atalho pra área Metrics.
export function UsageSideStats({
  snapshot,
  loading,
}: {
  snapshot: MetricsSnapshot | null
  loading: boolean
}) {
  const setArea = useAppStore((s) => s.setArea)

  return (
    <section className="glass-card flex flex-col gap-4 px-5 py-4">
      {loading && !snapshot ? (
        <div className="flex animate-pulse flex-col gap-4">
          <div className="h-3 w-24 rounded bg-[var(--color-surface-2)]" />
          <div className="h-2 w-full rounded bg-[var(--color-surface-2)]" />
          <div className="h-3 w-24 rounded bg-[var(--color-surface-2)]" />
          <div className="h-16 w-full rounded bg-[var(--color-surface-2)]" />
        </div>
      ) : (
        <>
          <CacheHit rate={snapshot?.totals.cacheHitRate ?? 0} />
          <TopTools snapshot={snapshot} />
          <Models snapshot={snapshot} />
        </>
      )}

      <button
        type="button"
        onClick={() => setArea('metrics')}
        className="mt-auto inline-flex items-center gap-1 self-start text-xs font-medium text-[var(--color-accent)] transition hover:text-[var(--color-accent-dim)]"
      >
        Ver métricas
        <Icon as={ArrowRight} size={12} />
      </button>
    </section>
  )
}

function Label({ children }: { children: string }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
      {children}
    </div>
  )
}

function CacheHit({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>Cache hit</Label>
        <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  )
}

function TopTools({ snapshot }: { snapshot: MetricsSnapshot | null }) {
  const tools = snapshot?.topTools.slice(0, 3) ?? []
  if (tools.length === 0) return null
  const max = tools[0].count
  return (
    <div>
      <Label>Top tools · 30d</Label>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {tools.map((tool) => (
          <li key={tool.name} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate text-[var(--color-text)]">{tool.name}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <span
                className="block h-full rounded-full bg-[var(--color-accent)]/60"
                style={{ width: `${(tool.count / max) * 100}%` }}
              />
            </span>
            <span className="tabular-nums text-[var(--color-text-dim)]">{fmtInt(tool.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Models({ snapshot }: { snapshot: MetricsSnapshot | null }) {
  const models = snapshot?.modelDistribution.slice(0, 3) ?? []
  if (models.length === 0) return null
  return (
    <div>
      <Label>Modelos · 30d</Label>
      <ul className="mt-1.5 flex flex-col gap-1 text-xs">
        {models.map((m) => (
          <li key={m.model} className="flex items-center justify-between gap-2">
            <span className="truncate text-[var(--color-text)]">{fmtModelName(m.model)}</span>
            <span className="tabular-nums text-[var(--color-text-dim)]">
              {fmtInt(m.sessions)} sessões
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
