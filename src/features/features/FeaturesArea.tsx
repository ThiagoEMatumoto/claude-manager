import { useEffect, useMemo, useState } from 'react'
import { projectsApi, featuresApi } from '@/lib/ipc'
import { useFeaturesStore } from '@/store/featuresStore'
import type { CreateFeatureInput, Project, Repo } from '../../../shared/types/ipc'
import { FeatureDoc } from './FeatureDoc'
import { FeatureList } from './FeatureList'
import { FeaturesSidebar, type StatusFilter } from './FeaturesSidebar'
import { NewFeatureDialog } from './NewFeatureDialog'
import { useFeatures } from './useFeatures'

export function FeaturesArea() {
  useFeatures()
  const features = useFeaturesStore((s) => s.features)
  const byProject = useFeaturesStore((s) => s.byProject)
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

  // Contagem de sessões ligadas por feature ainda não exposta no contrato — 0 por
  // ora (a UI já mostra o número quando > 0). Mapa vazio mantém a interface.
  const sessionCounts = useMemo(() => new Map<string, number>(), [])

  const q = query.trim().toLowerCase()
  const listed = useMemo(() => {
    return features.filter((f) => {
      if (filter !== 'all' && f.status !== filter) return false
      if (q && !f.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [features, filter, q])

  async function handleCreate(input: CreateFeatureInput) {
    const created = await featuresApi.create(input)
    await refresh()
    void select(created.id)
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
      />

      <main className="flex flex-1 overflow-hidden">
        {selectedId ? (
          <FeatureDoc feature={selectedDoc} loading={docLoading} reposById={reposById} />
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
