import { getDb } from '../services/db'
import { listByRepo } from '../services/repo-dependency-store'
import {
  buildRepoArchitectureContent,
  type ArchEdge,
} from '../services/architecture/repo-architecture'

// Wrapper I/O do bloco de arquitetura do repo. O builder PURO (testável sem
// electron/db) vive em ../services/architecture/repo-architecture.ts.

interface RepoBriefRow {
  label: string
  role: string | null
}

function repoBrief(id: string): RepoBriefRow | null {
  const row = getDb()
    .prepare('SELECT label, role FROM repos WHERE id = ?')
    .get(id) as RepoBriefRow | undefined
  return row ?? null
}

// Resolve o repo + arestas e monta o bloco. null se o repo não existe ou não tem
// conexões.
export function buildRepoArchitectureOrNull(repoId: string): string | null {
  const repo = repoBrief(repoId)
  if (!repo) return null

  const deps = listByRepo(repoId)
  const edges: ArchEdge[] = []
  for (const dep of deps) {
    const outgoing = dep.fromRepoId === repoId
    const otherId = outgoing ? dep.toRepoId : dep.fromRepoId
    const other = repoBrief(otherId)
    if (!other) continue
    edges.push({
      kind: dep.kind,
      label: dep.label,
      direction: outgoing ? 'outgoing' : 'incoming',
      other: { label: other.label, role: other.role },
    })
  }

  return buildRepoArchitectureContent({
    repo: { label: repo.label, role: repo.role },
    edges,
  })
}
