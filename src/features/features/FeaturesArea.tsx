import { useEffect, useMemo, useState } from 'react'
import { LayoutList, Columns3 } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { projectsApi, featuresApi } from '@/lib/ipc'
import { useFeaturesStore } from '@/store/featuresStore'
import type { CreateFeatureInput, Project, Repo } from '../../../shared/types/ipc'
import { FeatureBoard } from './FeatureBoard'
import { FeatureDoc } from './FeatureDoc'
import { FeatureList } from './FeatureList'
import { FeaturesSidebar, type StatusFilter } from './FeaturesSidebar'
import { NewFeatureDialog } from './NewFeatureDialog'
import { useFeatures } from './useFeatures'

type ViewMode = 'list' | 'board'

export function FeaturesArea() {
  useFeatures()
  const features = useFeaturesStore((s) => s.features)
  const byProject = useFeaturesStore((s) => s.byProject)
  const withStats = useFeaturesStore((s) => s.withStats)
  const sessionCounts = useFeaturesStore((s) => s.sessionCounts)
  const selectedId = useFeaturesStore((s) => s.selectedId)
  const selectedDoc = useFeaturesStore((s) => s.selectedDoc)
  const loading = useFeaturesStore((s) => s.loading)
  const docLoading = useFeaturesStore((s) => s.docLoading)
  const select = useFeaturesStore((s) => s.select)
  const refresh = useFeaturesStore((s) => s.refresh)

  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<Repo[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [creating, setCreating] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')

  useEffect(() => {
    void projectsApi.list().then(setProjects)
  }, [])

  // Junta os repos de todos os projetos pra resolver labels nos chips/cards.
  useEffect(() => {
    let alive = true
    void Promise.all(projects.map((p) => projectsApi.listRepos(p.id))).then((lists) => {
      if (alive) setRepos(lists.flat())
    })
    return () => {
      alive = false
    }
  }, [projects])

  const reposById = useMemo(() => new Map(repos.map((r) => [r.id, r])), [repos])

  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    return features.filter((f) => {
      if (filter !== 'all' && f.status !== filter) return false
      if (q && !f.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [features, filter, q])

  // Board: usa a lista com stats (inclui arquivadas). Filtro de status do board é
  // por coluna, então só aplica a busca textual aqui.
  const boardFeatures = useMemo(() => {
    if (!q) return withStats
    return withStats.filter((f) => f.title.toLowerCase().includes(q))
  }, [withStats, q])

  async function handleCreate(input: CreateFeatureInput) {
    const created = await featuresApi.create(input)
    await refresh()
    void select(created.id)
  }

  async function handleBackfill() {
    setBackfilling(true)
    setBackfillMsg(null)
    try {
      const res = await featuresApi.backfill()
      await refresh()
      setBackfillMsg(
        `Backfill: ${res.created} criada(s), ${res.linked} vinculada(s), ${res.skipped} ignorada(s).`,
      )
    } catch {
      setBackfillMsg('Falha ao importar features de sessões anteriores.')
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <>
      <FeaturesSidebar
        projects={projects}
        byProject={byProject}
        selectedId={selectedId}
        loading={loading}
        query={query}
        filter={filter}
        onQuery={setQuery}
        onFilter={setFilter}
        onSelect={(id) => void select(id)}
        onReload={() => void refresh()}
        onNew={() => setCreating(true)}
        onBackfill={() => void handleBackfill()}
        backfilling={backfilling}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {backfillMsg && (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text)]">
            <span>{backfillMsg}</span>
            <button
              type="button"
              onClick={() => setBackfillMsg(null)}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
        {selectedId ? (
          <FeatureDoc feature={selectedDoc} loading={docLoading} reposById={reposById} />
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-end gap-1 border-b border-[var(--color-border)] px-4 py-2">
              <ViewToggle value={view} onChange={setView} />
            </div>
            {view === 'board' ? (
              <div className="flex-1 overflow-hidden p-5">
                <FeatureBoard
                  features={boardFeatures}
                  reposById={reposById}
                  sessionCounts={sessionCounts}
                  selectedId={selectedId}
                  onSelect={(id) => void select(id)}
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5">
                <FeatureList
                  features={listed}
                  reposById={reposById}
                  sessionCounts={sessionCounts}
                  selectedId={selectedId}
                  onSelect={(id) => void select(id)}
                />
              </div>
            )}
          </div>
        )}
        </div>
      </main>

      <NewFeatureDialog
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects}
        onCreate={handleCreate}
      />
    </>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[var(--color-border)] p-0.5">
      <button
        type="button"
        onClick={() => onChange('list')}
        title="Lista"
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
          value === 'list'
            ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
            : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
        }`}
      >
        <Icon as={LayoutList} size={13} />
        Lista
      </button>
      <button
        type="button"
        onClick={() => onChange('board')}
        title="Board"
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
          value === 'board'
            ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
            : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
        }`}
      >
        <Icon as={Columns3} size={13} />
        Board
      </button>
    </div>
  )
}
