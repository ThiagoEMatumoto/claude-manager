import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import chokidar, { FSWatcher } from 'chokidar'
import { getDb } from './db'
import type {
  Feature,
  FeatureRepoLink,
  FeatureStatus,
  FeatureSynthMode,
  FeatureWithStats,
  CreateFeatureInput,
  UpdateFeatureInput,
} from '../../../shared/types/ipc'

// Paths próprios escritos pela síntese/CRUD são registrados aqui ANTES da escrita
// para que o watcher os ignore (evita loop watcher↔re-index). A síntese autônoma
// (fase 8) usa markSelfWrite() antes de cada writeFileSync.
export const pendingSelfWrites = new Set<string>()

export function markSelfWrite(path: string): void {
  pendingSelfWrites.add(path)
}

export function featuresRoot(): string {
  return join(app.getPath('userData'), 'features')
}

function projectDir(projectId: string): string {
  return join(featuresRoot(), projectId)
}

function docPathFor(projectId: string, slug: string): string {
  return join(projectDir(projectId), `${slug}.md`)
}

// ---- slug ----

function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // tira acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'feature'
  )
}

// Slug único por projeto: anexa -2, -3... se já existir uma row com o mesmo slug.
function uniqueSlug(projectId: string, title: string): string {
  const base = slugify(title)
  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM features WHERE project_id = ? AND slug = ?')
  let candidate = base
  let n = 2
  while (exists.get(projectId, candidate)) {
    candidate = `${base}-${n++}`
  }
  return candidate
}

// ---- frontmatter <-> Feature ----

interface Frontmatter {
  id: string
  slug: string
  title: string
  status: FeatureStatus
  project_id: string
  objective: string | null
  created: number
  last_updated: number
  completed: number | null
  repos: Array<{ repo_id: string; branch: string | null; worktree_path: string | null }>
  synth_mode: FeatureSynthMode
  model: string | null
}

const SECTIONS = [
  'Overview',
  'Business Rules',
  'Approach',
  'Decisions',
  'Progress',
  'Next Steps',
  'Context/References',
  'History',
] as const

function skeletonBody(seed: { overview?: string; businessRules?: string; approach?: string }): string {
  const map: Record<string, string> = {
    Overview: seed.overview?.trim() ?? '',
    'Business Rules': seed.businessRules?.trim() ?? '',
    Approach: seed.approach?.trim() ?? '',
  }
  return (
    SECTIONS.map((h) => {
      const content = map[h] ?? ''
      return `## ${h}\n\n${content}`.trimEnd() + '\n'
    }).join('\n') + '\n'
  )
}

function toFrontmatter(f: Feature): Frontmatter {
  return {
    id: f.id,
    slug: f.slug,
    title: f.title,
    status: f.status,
    project_id: f.projectId,
    objective: f.objective,
    created: f.createdAt,
    last_updated: f.updatedAt,
    completed: f.completedAt,
    repos: f.repos.map((r) => ({
      repo_id: r.repoId,
      branch: r.branch,
      worktree_path: r.worktreePath,
    })),
    synth_mode: f.synthMode,
    model: f.model,
  }
}

function fromFrontmatter(fm: Partial<Frontmatter>, docPath: string, body: string): Feature | null {
  if (!fm.id || !fm.project_id || !fm.slug || !fm.title || !fm.status) return null
  const repos: FeatureRepoLink[] = Array.isArray(fm.repos)
    ? fm.repos
        .filter((r) => r && typeof r.repo_id === 'string')
        .map((r) => ({
          repoId: r.repo_id,
          branch: r.branch ?? null,
          worktreePath: r.worktree_path ?? null,
        }))
    : []
  return {
    id: fm.id,
    projectId: fm.project_id,
    slug: fm.slug,
    title: fm.title,
    status: fm.status,
    objective: fm.objective ?? null,
    docPath,
    synthMode: fm.synth_mode ?? 'threshold',
    model: fm.model ?? null,
    repos,
    createdAt: typeof fm.created === 'number' ? fm.created : Date.now(),
    updatedAt: typeof fm.last_updated === 'number' ? fm.last_updated : Date.now(),
    completedAt: typeof fm.completed === 'number' ? fm.completed : null,
    archivedAt: null, // archive vive só no SQLite, não no frontmatter
    body,
  }
}

// Serializa Feature+corpo no `.md` com self-write guard (o watcher ignora a escrita).
function writeDoc(f: Feature, body: string): void {
  const dir = projectDir(f.projectId)
  mkdirSync(dir, { recursive: true })
  const content = matter.stringify(body, toFrontmatter(f))
  markSelfWrite(f.docPath)
  writeFileSync(f.docPath, content, 'utf8')
}

function readDoc(docPath: string): { feature: Feature; body: string } | null {
  let raw: string
  try {
    raw = readFileSync(docPath, 'utf8')
  } catch {
    return null
  }
  const parsed = matter(raw)
  const feature = fromFrontmatter(parsed.data as Partial<Frontmatter>, docPath, parsed.content)
  if (!feature) return null
  return { feature, body: parsed.content }
}

// ---- SQLite index ----

interface FeatureRow {
  id: string
  project_id: string
  slug: string
  title: string
  status: string
  objective: string | null
  doc_path: string
  synth_mode: string
  model: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  archived_at: number | null
}

function rowToFeature(row: FeatureRow, repos: FeatureRepoLink[], body?: string): Feature {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    status: row.status as FeatureStatus,
    objective: row.objective,
    docPath: row.doc_path,
    synthMode: row.synth_mode as FeatureSynthMode,
    model: row.model,
    repos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    body,
  }
}

function loadRepos(featureId: string): FeatureRepoLink[] {
  const rows = getDb()
    .prepare('SELECT repo_id, branch, worktree_path FROM feature_repos WHERE feature_id = ?')
    .all(featureId) as Array<{ repo_id: string; branch: string | null; worktree_path: string | null }>
  return rows.map((r) => ({ repoId: r.repo_id, branch: r.branch, worktreePath: r.worktree_path }))
}

function writeRepos(featureId: string, repos: FeatureRepoLink[]): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM feature_repos WHERE feature_id = ?').run(featureId)
    const ins = db.prepare(
      'INSERT INTO feature_repos (feature_id, repo_id, branch, worktree_path) VALUES (?, ?, ?, ?)',
    )
    for (const r of repos) ins.run(featureId, r.repoId, r.branch, r.worktreePath)
  })
  tx()
}

// Upsert da row + feature_repos a partir de um Feature derivado do frontmatter.
function upsertIndex(f: Feature): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO features
         (id, project_id, slug, title, status, objective, doc_path,
          synth_mode, model, created_at, updated_at, completed_at, archived_at)
       VALUES (@id, @project_id, @slug, @title, @status, @objective, @doc_path,
               @synth_mode, @model, @created_at, @updated_at, @completed_at, @archived_at)
       ON CONFLICT(id) DO UPDATE SET
         project_id  = excluded.project_id,
         slug        = excluded.slug,
         title       = excluded.title,
         status      = excluded.status,
         objective   = excluded.objective,
         doc_path    = excluded.doc_path,
         synth_mode  = excluded.synth_mode,
         model       = excluded.model,
         updated_at  = excluded.updated_at,
         completed_at = excluded.completed_at`,
    ).run({
      id: f.id,
      project_id: f.projectId,
      slug: f.slug,
      title: f.title,
      status: f.status,
      objective: f.objective,
      doc_path: f.docPath,
      synth_mode: f.synthMode,
      model: f.model,
      created_at: f.createdAt,
      updated_at: f.updatedAt,
      completed_at: f.completedAt,
      // archived_at não vem do frontmatter; preservado via COALESCE no UPDATE acima
      // omitido — a coluna não é tocada no DO UPDATE.
      archived_at: f.archivedAt,
    })
    db.prepare('DELETE FROM feature_repos WHERE feature_id = ?').run(f.id)
    const ins = db.prepare(
      'INSERT INTO feature_repos (feature_id, repo_id, branch, worktree_path) VALUES (?, ?, ?, ?)',
    )
    for (const r of f.repos) ins.run(f.id, r.repoId, r.branch, r.worktreePath)
  })
  tx()
}

// ---- API pública ----

export function create(input: CreateFeatureInput): Feature {
  const now = Date.now()
  const slug = uniqueSlug(input.projectId, input.title)
  const id = randomUUID()
  const feature: Feature = {
    id,
    projectId: input.projectId,
    slug,
    title: input.title.trim(),
    status: input.status ?? 'pending',
    objective: input.objective?.trim() ? input.objective.trim() : null,
    docPath: docPathFor(input.projectId, slug),
    synthMode: input.synthMode ?? 'threshold',
    model: input.model ?? null,
    repos: input.repos ?? [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
  }
  const body = skeletonBody({
    overview: input.overview,
    businessRules: input.businessRules,
    approach: input.approach,
  })
  writeDoc(feature, body)
  upsertIndex(feature)
  return { ...feature, body }
}

interface ListOpts {
  projectId?: string
  includeArchived?: boolean
}

// Carrega as rows do índice. Por padrão exclui arquivadas (archived_at IS NULL),
// preservando o comportamento histórico de list(); includeArchived as inclui
// (usado pela coluna "archived" do board).
function listRows(opts: ListOpts): FeatureRow[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (opts.projectId) {
    where.push('project_id = ?')
    params.push(opts.projectId)
  }
  if (!opts.includeArchived) {
    where.push('archived_at IS NULL')
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return db
    .prepare(`SELECT * FROM features ${clause} ORDER BY updated_at DESC`)
    .all(...params) as FeatureRow[]
}

export function list(projectId?: string): Feature[] {
  return listRows({ projectId }).map((row) => rowToFeature(row, loadRepos(row.id)))
}

// Agrega a contagem de sessões ligadas (sessions.feature_id) num único GROUP BY,
// evitando N+1. Retorna o mapa featureId -> count.
function sessionCounts(): Map<string, number> {
  const rows = getDb()
    .prepare(
      'SELECT feature_id, COUNT(*) AS n FROM sessions WHERE feature_id IS NOT NULL GROUP BY feature_id',
    )
    .all() as Array<{ feature_id: string; n: number }>
  return new Map(rows.map((r) => [r.feature_id, r.n]))
}

// list() enriquecido com sessionCount real. includeArchived traz as arquivadas
// (coluna do board). Sem corpo — é índice, igual a list().
export function listWithStats(opts?: { includeArchived?: boolean }): FeatureWithStats[] {
  const counts = sessionCounts()
  return listRows({ includeArchived: opts?.includeArchived }).map((row) => ({
    ...rowToFeature(row, loadRepos(row.id)),
    sessionCount: counts.get(row.id) ?? 0,
  }))
}

export function get(id: string): Feature | null {
  const row = getDb().prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined
  if (!row) return null
  // Corpo vem do `.md` (fonte de verdade); cai pra string vazia se o arquivo sumiu.
  const doc = readDoc(row.doc_path)
  return rowToFeature(row, loadRepos(row.id), doc?.body ?? '')
}

// ---- Helpers de resolução (auto-vínculo de sessões a features, fase 8) ----

// Resolve o project_id de um repo. Retorna null se o repo não existe.
export function getProjectIdForRepo(repoId: string): string | null {
  const row = getDb().prepare('SELECT project_id FROM repos WHERE id = ?').get(repoId) as
    | { project_id: string }
    | undefined
  return row?.project_id ?? null
}

// Resolve o path em disco de um repo (usado como worktree_path default na auto-criação).
export function getRepoPath(repoId: string): string | null {
  const row = getDb().prepare('SELECT path FROM repos WHERE id = ?').get(repoId) as
    | { path: string }
    | undefined
  return row?.path ?? null
}

// Acha a feature NÃO-arquivada cujo feature_repos casa (repo_id, branch).
// Dedup natural: sessões repetidas na mesma branch caem na mesma feature.
export function findFeatureByRepoBranch(repoId: string, branch: string): Feature | null {
  const row = getDb()
    .prepare(
      `SELECT f.* FROM features f
         JOIN feature_repos fr ON fr.feature_id = f.id
        WHERE fr.repo_id = ? AND fr.branch = ? AND f.archived_at IS NULL
        ORDER BY f.updated_at DESC
        LIMIT 1`,
    )
    .get(repoId, branch) as FeatureRow | undefined
  if (!row) return null
  return rowToFeature(row, loadRepos(row.id))
}

// Features NÃO-arquivadas de um projeto (sem corpo). Reusa list(projectId).
export function listActiveFeaturesByProject(projectId: string): Feature[] {
  return list(projectId)
}

export function update(input: UpdateFeatureInput): Feature {
  const current = get(input.id)
  if (!current) throw new Error(`feature not found: ${input.id}`)

  const status = input.status ?? current.status
  const next: Feature = {
    ...current,
    title: input.title?.trim() || current.title,
    status,
    objective:
      input.objective === undefined
        ? current.objective
        : input.objective?.trim()
          ? input.objective.trim()
          : null,
    synthMode: input.synthMode ?? current.synthMode,
    model: input.model === undefined ? current.model : input.model,
    updatedAt: Date.now(),
    completedAt:
      status === 'done' ? (current.completedAt ?? Date.now()) : current.completedAt,
  }
  writeDoc(next, current.body ?? '')
  upsertIndex(next)
  return next
}

export function archive(id: string): void {
  const now = Date.now()
  getDb().prepare('UPDATE features SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
}

export function setRepos(id: string, repos: FeatureRepoLink[]): Feature {
  const current = get(id)
  if (!current) throw new Error(`feature not found: ${id}`)
  const next: Feature = { ...current, repos, updatedAt: Date.now() }
  writeRepos(id, repos)
  getDb().prepare('UPDATE features SET updated_at = ? WHERE id = ?').run(next.updatedAt, id)
  writeDoc(next, current.body ?? '')
  return next
}

// Re-parseia o frontmatter de um `.md` e faz upsert em features/feature_repos.
// Usado pelo watcher quando o arquivo muda por fora do app. Retorna o Feature
// re-indexado (ou null se o arquivo for inválido). Em unlink, archiva a row.
export function reindexFromFile(path: string): Feature | null {
  if (!existsSync(path)) {
    // arquivo removido: tenta achar a row pelo doc_path e archivar
    const row = getDb().prepare('SELECT id FROM features WHERE doc_path = ?').get(path) as
      | { id: string }
      | undefined
    if (row) archive(row.id)
    return null
  }
  const doc = readDoc(path)
  if (!doc) return null
  // preserva archived_at existente
  const existing = getDb()
    .prepare('SELECT archived_at FROM features WHERE id = ?')
    .get(doc.feature.id) as { archived_at: number | null } | undefined
  const feature: Feature = { ...doc.feature, archivedAt: existing?.archived_at ?? null }
  upsertIndex(feature)
  return feature
}

// ---- Watcher ----

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

const DEBOUNCE_MS = 300

class FeatureWatcher {
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (this.watcher) return
    const root = featuresRoot()
    mkdirSync(root, { recursive: true })
    // depth:1 cobre <root>/<projectId>/<slug>.md.
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    })
    const onPath = (p: string) => {
      if (!p.endsWith('.md')) return
      // Escrita própria (CRUD/síntese): ignora uma vez e consome o marcador.
      if (pendingSelfWrites.has(p)) {
        pendingSelfWrites.delete(p)
        return
      }
      this.pending.add(p)
      this.schedule()
    }
    this.watcher.on('add', onPath)
    this.watcher.on('change', onPath)
    this.watcher.on('unlink', onPath)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  private flush(): void {
    const paths = [...this.pending]
    this.pending.clear()
    for (const p of paths) {
      try {
        const feature = reindexFromFile(p)
        if (feature) broadcast('feature:updated', feature)
        else broadcast('feature:updated', { docPath: p })
      } catch (err) {
        console.error('[feature-watcher] reindex failed:', p, err)
      }
    }
  }

  close(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
    this.pending.clear()
  }
}

export const featureWatcher = new FeatureWatcher()

export function startFeatureWatcher(): void {
  featureWatcher.start()
}

export function stopFeatureWatcher(): void {
  featureWatcher.close()
}

// Helper para testes/limpeza: remove o `.md` de uma feature (não usado em runtime).
export function deleteDoc(docPath: string): void {
  try {
    rmSync(docPath)
  } catch {
    // já removido
  }
}
