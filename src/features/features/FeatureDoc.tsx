import { useMemo } from 'react'
import { ExternalLink, GitBranch } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'
import { shellApi } from '@/lib/ipc'
import type { Feature, Repo } from '../../../shared/types/ipc'
import { StatusBadge } from './FeatureList'
import { FeatureObjectiveLinksSection } from './FeatureObjectiveLinksSection'
import { FeatureTasksSection } from './FeatureTasksSection'
import { useObjectiveLookups } from './useObjectiveLookups'

interface Props {
  feature: Feature | null
  loading: boolean
  reposById: Map<string, Repo>
}

function fmtDate(ts: number | null): string | null {
  if (!ts) return null
  return new Date(ts).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// Separa o corpo num bloco "History" (heading `## History` até o próximo H2/fim)
// pra renderizar como timeline, e o restante como markdown corrido.
function splitHistory(body: string): { main: string; history: string | null } {
  const re = /^##\s+history\s*$/im
  const m = re.exec(body)
  if (!m) return { main: body, history: null }
  const start = m.index
  const after = body.slice(start + m[0].length)
  const nextH2 = /^##\s+/m.exec(after)
  const end = nextH2 ? start + m[0].length + nextH2.index : body.length
  const history = body.slice(start + m[0].length, end).trim()
  const main = (body.slice(0, start) + body.slice(end)).trim()
  return { main, history: history || null }
}

function historyEntries(history: string): string[] {
  // Itens de lista (- / *) viram entradas da timeline; senão, parágrafos.
  const lines = history.split('\n')
  const items = lines
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
  if (items.length > 0) return items
  return history
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function FeatureDoc({ feature, loading, reposById }: Props) {
  const split = useMemo(
    () => (feature?.body ? splitHistory(feature.body) : { main: '', history: null }),
    [feature?.body],
  )
  // Lookup compartilhado pelas seções de Tarefas e Objetivos (uma busca só).
  const { objectives, krTitles } = useObjectiveLookups()

  if (!feature) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">
        {loading ? 'Carregando…' : 'Selecione uma feature para ver os detalhes.'}
      </div>
    )
  }

  const created = fmtDate(feature.createdAt)
  const updated = fmtDate(feature.updatedAt)
  const completed = fmtDate(feature.completedAt)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold text-[var(--color-text)]">{feature.title}</h1>
          <button
            type="button"
            onClick={() => void shellApi.openPath(feature.docPath)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
            title={feature.docPath}
          >
            <Icon as={ExternalLink} size={13} />
            Abrir no editor
          </button>
        </div>

        {feature.objective && (
          <p className="mt-2 text-sm text-[var(--color-text-dim)]">{feature.objective}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={feature.status} />
          {feature.repos.map((link) => (
            <span
              key={link.repoId}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
              title={link.branch ? `branch: ${link.branch}` : undefined}
            >
              <Icon as={GitBranch} size={10} />
              {reposById.get(link.repoId)?.label ?? link.repoId}
              {link.branch && <span className="opacity-60">· {link.branch}</span>}
            </span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-dim)]">
          {created && <span>criada: {created}</span>}
          {updated && <span>atualizada: {updated}</span>}
          {completed && <span>concluída: {completed}</span>}
          <span>synth: {feature.synthMode}</span>
          {feature.model && <span>modelo: {feature.model}</span>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && !feature.body ? (
          <p className="text-sm text-[var(--color-text-dim)]">Carregando documento…</p>
        ) : (
          <>
            <article className="max-w-none text-sm leading-relaxed text-[var(--color-text)]">
              <MarkdownViewer content={split.main} />
            </article>

            {split.history && (
              <section className="mt-8">
                <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">History</h2>
                <ol className="flex flex-col gap-3 border-l border-[var(--color-border)] pl-4">
                  {historyEntries(split.history).map((entry, i) => (
                    <li key={i} className="relative text-xs text-[var(--color-text-dim)]">
                      <span
                        className="absolute -left-[21px] top-1 h-2 w-2 rounded-full"
                        style={{ background: 'var(--color-accent)' }}
                      />
                      <MarkdownViewer content={entry} />
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        <FeatureTasksSection featureId={feature.id} objectives={objectives} krTitles={krTitles} />
        <FeatureObjectiveLinksSection
          featureId={feature.id}
          objectives={objectives}
          krTitles={krTitles}
        />
      </div>
    </div>
  )
}
