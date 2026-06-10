import { useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useOverviewStore } from '@/store/overviewStore'
import { HomeGrid } from './HomeGrid'
import { ObjectiveTree } from './ObjectiveTree'
import { SummaryPanel } from './SummaryPanel'
import { useOverview } from './useOverview'

// Home de status geral (área default no boot): linha compacta de contadores +
// grid 2×2 (sessões agora / tasks urgentes / features em andamento / objetivos
// ativos) + árvore de objetivos colapsável abaixo da dobra. Full-width (sem
// sidebar própria) — o agregado vem numa chamada (objectives.overview);
// sessões vivas vêm do appStore (watcher global do AppShell).
export function OverviewArea() {
  useOverview()
  const data = useOverviewStore((s) => s.data)
  const loading = useOverviewStore((s) => s.loading)
  const error = useOverviewStore((s) => s.error)
  const refresh = useOverviewStore((s) => s.refresh)
  const [treeOpen, setTreeOpen] = useState(false)

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <h1 className="text-sm font-semibold text-[var(--color-text)]">Home</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Recarregar"
          className="rounded-md p-1.5 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]"
        >
          <Icon as={RefreshCw} size={15} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mx-auto mb-4 max-w-5xl rounded-lg border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}
        {loading && !data && (
          <div className="py-12 text-center text-sm text-[var(--color-text-dim)]">Carregando…</div>
        )}
        {data && (
          <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <SummaryPanel counts={data.counts} />
            <HomeGrid data={data} />

            <section>
              <button
                type="button"
                onClick={() => setTreeOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-dim)] transition hover:text-[var(--color-text)]"
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
