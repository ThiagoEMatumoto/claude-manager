import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'
import { authArgs, netGit } from './git-auth'
import { readOriginUrl } from './git-remote'
import type { PullRepoResult } from '../../../shared/types/ipc'

// Máximo de pulls simultâneos: limita rede/CPU ao atualizar muitos repos sem
// serializar tudo. Mesmo teto do clone.
const PULL_CONCURRENCY = 3

interface RepoRow {
  id: string
  label: string
  path: string
  remote_url: string | null
}

interface PullTarget {
  repoId: string
  label: string
  path: string
  remoteUrl: string | null
}

// Campos do `simple-git .status()` de que a classificação precisa. Mantido
// mínimo pra o teste stubar sem montar um StatusResult inteiro.
export interface PullStatusInput {
  ahead: number
  files: unknown[]
}

export type PullEligibility = 'dirty' | 'diverged' | 'eligible'

// Puro e testável: dado o status do repo, decide se é seguro dar um pull
// fast-forward. `dirty` (working tree com mudanças que impediriam o FF) tem
// prioridade sobre `diverged` (commits locais ainda não empurrados). Só
// `eligible` (limpo e sem commits locais adiante) é puxado.
export function classifyPullEligibility(status: PullStatusInput): PullEligibility {
  if (status.files.length > 0) return 'dirty'
  if (status.ahead > 0) return 'diverged'
  return 'eligible'
}

function listPullTargets(): PullTarget[] {
  const rows = getDb()
    .prepare('SELECT id, label, path, remote_url FROM repos WHERE path IS NOT NULL')
    .all() as RepoRow[]
  const out: PullTarget[] = []
  for (const row of rows) {
    if (!existsSync(row.path)) continue
    out.push({ repoId: row.id, label: row.label, path: row.path, remoteUrl: row.remote_url })
  }
  return out
}

// Fast-forward pull de UM repo. Nunca destrói trabalho: repos sujos/divergentes
// são pulados; o `--ff-only` garante que um remote divergente FALHE em vez de
// mesclar. Classifica em pulled (HEAD avançou) vs up-to-date (nada a puxar).
export async function pullRepo(target: PullTarget): Promise<PullRepoResult> {
  const base = { repoId: target.repoId, label: target.label, path: target.path }
  if (!existsSync(join(target.path, '.git'))) {
    return { ...base, status: 'skipped', detail: 'sem .git' }
  }
  try {
    const git = netGit(target.path)
    const status = await git.status()
    const eligibility = classifyPullEligibility(status)
    if (eligibility !== 'eligible') return { ...base, status: 'skipped', detail: eligibility }

    // A URL do remote decide se o credential-helper do gh entra (http[s]) ou não
    // (file://). Preferimos a origin real do disco; caímos pro remote_url do DB.
    const url = (await readOriginUrl(target.path)).remoteUrl ?? target.remoteUrl ?? ''

    const before = (await git.revparse(['HEAD'])).trim()
    await git.raw([...authArgs(url), 'pull', '--ff-only'])
    const after = (await git.revparse(['HEAD'])).trim()
    return { ...base, status: before === after ? 'up-to-date' : 'pulled' }
  } catch (err) {
    return { ...base, status: 'error', detail: (err as Error).message }
  }
}

// Progresso emitido antes de cada pull (índice 1-based / total + label).
export interface PullProgress {
  index: number
  total: number
  label: string
}

// Puxa todos os repos com path existente, concorrência limitada. Chama
// onProgress antes de iniciar cada pull (toast sequencial). Retorna o resumo.
export async function pullAllRepos(
  onProgress?: (p: PullProgress) => void,
): Promise<PullRepoResult[]> {
  const targets = listPullTargets()
  const total = targets.length
  const results: PullRepoResult[] = new Array(total)

  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= total) return
      const target = targets[i]
      onProgress?.({ index: i + 1, total, label: target.label })
      results[i] = await pullRepo(target)
    }
  }

  const workers = Array.from({ length: Math.min(PULL_CONCURRENCY, total) }, () => worker())
  await Promise.all(workers)
  return results
}

// Pull de um único repo resolvido por id OU por path (usado pelo handler
// repos:pull-one e pelo item de menu por-repo).
export async function pullOneRepo(selector: {
  repoId?: string
  path?: string
}): Promise<PullRepoResult> {
  const db = getDb()
  const row = selector.repoId
    ? (db
        .prepare('SELECT id, label, path, remote_url FROM repos WHERE id = ?')
        .get(selector.repoId) as RepoRow | undefined)
    : (db
        .prepare('SELECT id, label, path, remote_url FROM repos WHERE path = ?')
        .get(selector.path) as RepoRow | undefined)
  if (!row) throw new Error('repo não encontrado')
  return pullRepo({
    repoId: row.id,
    label: row.label,
    path: row.path,
    remoteUrl: row.remote_url,
  })
}
