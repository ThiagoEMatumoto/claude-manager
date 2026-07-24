import type { CSSProperties } from 'react'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useOverviewStore } from '@/store/overviewStore'
import { HomeGrid } from './HomeGrid'
import { HomeHero } from './HomeHero'
import { ObjectiveTree } from './ObjectiveTree'
import { UsageChartCard } from './UsageChartCard'
import { UsageSideStats } from './UsageSideStats'
import { UsageStatsRow } from './UsageStatsRow'
import { useHomeMetrics } from './useHomeMetrics'
import { useOverview } from './useOverview'

// Home de status geral (área default no boot): hero (saudação + live pill +
// contadores) → tiles de uso do Claude → chart 30d + side stats → grid 2×2 →
// árvore de objetivos colapsável. Agregado vem numa chamada (objectives.
// overview); sessões vivas do appStore; métricas de uso do useHomeMetrics.
export function OverviewArea() {
  useOverview()
  const data = useOverviewStore((s) => s.data)
  const loading = useOverviewStore((s) => s.loading)
  const error = useOverviewStore((s) => s.error)
  const refresh = useOverviewStore((s) => s.refresh)
  const { snapshot, loading: metricsLoading } = useHomeMetrics()
  const [treeOpen, setTreeOpen] = useState(false)

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mx-auto mb-4 max-w-6xl rounded-lg border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {loading && !data && (
          <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">Carregando…</div>
        )}
        {data && (
          <div className="mx-auto flex max-w-[1120px] flex-col gap-[18px]">
            <div className="home-rise" style={{ '--i': 0 } as CSSProperties}>
              <HomeHero counts={data.counts} onRefresh={() => void refresh()} />
            </div>

            <UsageStatsRow snapshot={snapshot} loading={metricsLoading} />

            <div
              className="home-rise grid gap-[14px] lg:grid-cols-3"
              style={{ '--i': 5 } as CSSProperties}
            >
              <UsageChartCard snapshot={snapshot} loading={metricsLoading} />
              <UsageSideStats snapshot={snapshot} loading={metricsLoading} />
            </div>

            <HomeGrid data={data} />

            <section className="home-rise" style={{ '--i': 10 } as CSSProperties}>
              <button
                type="button"
                onClick={() => setTreeOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
              >
                <Icon
                  as={ChevronRight}
                  size={13}
                  className={`transition-transform ${treeOpen ? 'rotate-90' : ''}`}
                />
                Árvore de objetivos
              </button>
              {treeOpen && (
                <div className="mt-2">
                  <ObjectiveTree nodes={data.objectives} />
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
