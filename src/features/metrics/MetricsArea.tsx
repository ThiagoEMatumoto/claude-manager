import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useMetricsStore } from '@/store/metricsStore'
import type { MetricsWindow } from '../../../shared/types/ipc'
import { ProjectBreakdown } from './ProjectBreakdown'
import { SessionTypeHistogram } from './SessionTypeHistogram'
import { TopToolsList } from './TopToolsList'
import { TotalsCards } from './TotalsCards'
import { TrendChart } from './TrendChart'

const WINDOWS: { id: MetricsWindow; label: string }[] = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'all', label: 'Tudo' },
]

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function MetricsArea() {
  const window = useMetricsStore((s) => s.window)
  const snapshot = useMetricsStore((s) => s.snapshot)
  const loading = useMetricsStore((s) => s.loading)
  const progress = useMetricsStore((s) => s.progress)
  const error = useMetricsStore((s) => s.error)
  const load = useMetricsStore((s) => s.load)
  const refresh = useMetricsStore((s) => s.refresh)
  const startProgressWatch = useMetricsStore((s) => s.startProgressWatch)
  const stopProgressWatch = useMetricsStore((s) => s.stopProgressWatch)

  useEffect(() => {
    startProgressWatch()
    return stopProgressWatch
  }, [startProgressWatch, stopProgressWatch])

  useEffect(() => {
    void load(window)
  }, [load, window])

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <header
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          Métricas
        </h1>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 rounded-md p-0.5"
            style={{ background: 'var(--color-surface-2)' }}
          >
            {WINDOWS.map((w) => {
              const active = w.id === window
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => void load(w.id)}
                  className={`rounded px-3 py-1 text-xs font-medium transition ${
                    active ? '' : 'hover:opacity-80'
                  }`}
                  style={{
                    background: active ? 'var(--color-surface)' : 'transparent',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-dim)',
                  }}
                >
                  {w.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title="Re-escanear transcripts"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <Icon as={RefreshCw} size={14} className={loading ? 'animate-spin' : undefined} />
            Atualizar
          </button>
        </div>
      </header>

      {progress && (
        <div className="px-5 pt-3">
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--color-text-dim)' }}>
            <span>
              Escaneando transcripts… {progress.processed}/{progress.total}
            </span>
            <span>{progressPct}%</span>
          </div>
          <span
            className="mt-1 block h-1 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--color-surface-2)' }}
          >
            <span
              className="block h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: 'var(--color-accent)' }}
            />
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
          >
            <Icon as={AlertTriangle} size={16} />
            <span>Falha ao carregar métricas: {error}</span>
          </div>
        )}

        {!snapshot && loading && (
          <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
            Carregando métricas…
          </p>
        )}

        {snapshot && (
          <div className="flex flex-col gap-5">
            {snapshot.unknownModels.length > 0 && (
              <div
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
              >
                <Icon as={AlertTriangle} size={16} className="mt-0.5 shrink-0" />
                <span>
                  Custo parcial: {snapshot.unknownModels.length} modelo(s) sem preço (
                  {snapshot.unknownModels.join(', ')}). O custo exibido pode estar subestimado.
                </span>
              </div>
            )}

            <TotalsCards totals={snapshot.totals} />

            <Panel title="Tendência diária (tokens + custo)">
              <TrendChart perDay={snapshot.perDay} />
            </Panel>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel title="Tipos de sessão">
                <SessionTypeHistogram buckets={snapshot.sessionTypeDistribution} />
              </Panel>
              <Panel title="Top ferramentas">
                <TopToolsList tools={snapshot.topTools} />
              </Panel>
            </div>

            <Panel title="Por projeto">
              <ProjectBreakdown rows={snapshot.perProject} />
            </Panel>
          </div>
        )}
      </div>
    </main>
  )
}
