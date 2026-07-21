import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { getDb } from './db'
import { pingSyncMutation } from './notify'

export interface RepoRemoteInfo {
  // URL de fetch do remote `origin`, ou null se o repo não tem origin.
  remoteUrl: string | null
  // Branch default resolvida via origin/HEAD (fallback: branch em checkout), ou null.
  defaultBranch: string | null
}

// Lê a origin (fetch URL + branch default) de um repo local. Espelha o padrão de
// `sync/git-sync.ts:120` (getRemotes(true) → origin.refs.fetch). Retorna
// { null, null } quando o path não é um repo git ou não tem remote origin.
export async function readOriginUrl(repoPath: string): Promise<RepoRemoteInfo> {
  if (!existsSync(join(repoPath, '.git'))) {
    return { remoteUrl: null, defaultBranch: null }
  }
  const git = simpleGit(repoPath)

  let remoteUrl: string | null = null
  try {
    const remotes = await git.getRemotes(true)
    remoteUrl = remotes.find((r) => r.name === 'origin')?.refs.fetch ?? null
  } catch {
    remoteUrl = null
  }

  const defaultBranch = await readDefaultBranch(git)
  return { remoteUrl, defaultBranch }
}

// origin/HEAD aponta pra branch default do remote (ex. "origin/main"). Se não
// estiver resolvido localmente, cai pra branch em checkout. Null se nada disso der.
// Exportada pra reuso em repo-pull.ts como fallback quando repos.default_branch
// estiver NULL (repo ainda não passou pelo backfill).
export async function readDefaultBranch(git: ReturnType<typeof simpleGit>): Promise<string | null> {
  try {
    const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    if (ref) return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
  } catch {
    // origin/HEAD não resolvido — segue pro fallback.
  }
  try {
    const b = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (b && b !== 'HEAD') return b
  } catch {
    // sem commits ainda.
  }
  return null
}

export interface BackfillResult {
  scanned: number
  updated: number
}

// Preenche remote_url/default_branch dos repos que ainda estão nulos e cujo path
// existe no disco. Idempotente: só toca rows com remote_url NULL, e repos sem
// origin (blank/local-only) permanecem nulos. Seguro pra rodar múltiplas vezes.
export async function backfillRepoRemotes(): Promise<BackfillResult> {
  const db = getDb()
  const rows = db
    .prepare(`SELECT id, path FROM repos WHERE remote_url IS NULL AND path IS NOT NULL`)
    .all() as Array<{ id: string; path: string }>

  const update = db.prepare(
    `UPDATE repos SET remote_url = ?, default_branch = COALESCE(?, default_branch) WHERE id = ?`,
  )

  let updated = 0
  for (const row of rows) {
    if (!existsSync(row.path)) continue
    const { remoteUrl, defaultBranch } = await readOriginUrl(row.path)
    if (!remoteUrl) continue
    update.run(remoteUrl, defaultBranch, row.id)
    updated++
  }

  if (updated > 0) pingSyncMutation()
  return { scanned: rows.length, updated }
}
