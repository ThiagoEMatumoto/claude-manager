import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  CreateRepoDependencyInput,
  RepoDependency,
  RepoDependencyKind,
  UpdateRepoDependencyInput,
} from '../../../shared/types/ipc'

interface RepoDependencyRow {
  id: string
  from_repo_id: string
  to_repo_id: string
  kind: string
  label: string | null
  created_at: number
}

function toEntity(row: RepoDependencyRow): RepoDependency {
  return {
    id: row.id,
    fromRepoId: row.from_repo_id,
    toRepoId: row.to_repo_id,
    kind: row.kind as RepoDependencyKind,
    label: row.label,
    createdAt: row.created_at,
  }
}

// Dependências de todos os repos de um projeto. Join via from_repo_id → repos
// (uma aresta "pertence" ao projeto do repo de origem; ambos os repos vivem no
// mesmo projeto na prática, mas o join na origem é suficiente e indexado).
export function listByProject(projectId: string): RepoDependency[] {
  const rows = getDb()
    .prepare(
      `SELECT rd.* FROM repo_dependencies rd
         JOIN repos r ON r.id = rd.from_repo_id
        WHERE r.project_id = ?
        ORDER BY rd.created_at ASC`,
    )
    .all(projectId) as RepoDependencyRow[]
  return rows.map(toEntity)
}

// Cria a aresta. Idempotente: se já existir (from, to, kind), devolve a existente
// em vez de violar o UNIQUE — o frontend pode re-disparar sem tratamento de erro.
export function create(input: CreateRepoDependencyInput): RepoDependency {
  const db = getDb()
  const existing = db
    .prepare(
      'SELECT * FROM repo_dependencies WHERE from_repo_id = ? AND to_repo_id = ? AND kind = ?',
    )
    .get(input.fromRepoId, input.toRepoId, input.kind) as RepoDependencyRow | undefined
  if (existing) return toEntity(existing)

  const row: RepoDependencyRow = {
    id: randomUUID(),
    from_repo_id: input.fromRepoId,
    to_repo_id: input.toRepoId,
    kind: input.kind,
    label: input.label ?? null,
    created_at: Date.now(),
  }
  db.prepare(
    `INSERT INTO repo_dependencies (id, from_repo_id, to_repo_id, kind, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.from_repo_id, row.to_repo_id, row.kind, row.label, row.created_at)
  return toEntity(row)
}

// Atualiza kind e/ou label de uma aresta existente.
export function update(input: UpdateRepoDependencyInput): RepoDependency {
  const db = getDb()
  const sets: string[] = []
  const values: unknown[] = []
  if (input.kind !== undefined) {
    sets.push('kind = ?')
    values.push(input.kind)
  }
  if (input.label !== undefined) {
    sets.push('label = ?')
    values.push(input.label)
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE repo_dependencies SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values,
      input.id,
    )
  }
  const row = db
    .prepare('SELECT * FROM repo_dependencies WHERE id = ?')
    .get(input.id) as RepoDependencyRow | undefined
  if (!row) throw new Error(`repo dependency not found: ${input.id}`)
  return toEntity(row)
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM repo_dependencies WHERE id = ?').run(id)
}

// Persiste a posição livre do repo no canvas do grafo.
export function setRepoPosition(repoId: string, x: number, y: number): void {
  getDb()
    .prepare('UPDATE repos SET canvas_x = ?, canvas_y = ? WHERE id = ?')
    .run(x, y, repoId)
}
