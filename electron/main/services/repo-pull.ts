import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SimpleGit, StatusResult } from 'simple-git'
import { getDb } from './db'
import { authArgs, netGit } from './git-auth'
import { readDefaultBranch, readOriginUrl } from './git-remote'
import type { BranchPullOutcome, PullRepoResult } from '../../../shared/types/ipc'

// Máximo de pulls simultâneos: limita rede/CPU ao atualizar muitos repos sem
// serializar tudo. Mesmo teto do clone.
const PULL_CONCURRENCY = 3

interface RepoRow {
  id: string
  label: string
  path: string
  remote_url: string | null
  default_branch: string | null
}

interface PullTarget {
  repoId: string
  label: string
  path: string
  remoteUrl: string | null
  defaultBranch: string | null
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
    .prepare('SELECT id, label, path, remote_url, default_branch FROM repos WHERE path IS NOT NULL')
    .all() as RepoRow[]
  const out: PullTarget[] = []
  for (const row of rows) {
    if (!existsSync(row.path)) continue
    out.push({
      repoId: row.id,
      label: row.label,
      path: row.path,
      remoteUrl: row.remote_url,
      defaultBranch: row.default_branch,
    })
  }
  return out
}

// Pull ff-only da branch em checkout (mantém o comportamento original: um
// remote divergente FALHA em vez de mesclar; repo sujo/com commits locais é
// pulado, nunca destruído).
async function pullCurrentBranch(
  git: SimpleGit,
  current: string,
  status: PullStatusInput,
  url: string,
): Promise<BranchPullOutcome> {
  const eligibility = classifyPullEligibility(status)
  if (eligibility !== 'eligible') return { branch: current, status: 'skipped', detail: eligibility }
  try {
    const before = (await git.revparse(['HEAD'])).trim()
    await git.raw([...authArgs(url), 'pull', '--ff-only'])
    const after = (await git.revparse(['HEAD'])).trim()
    return { branch: current, status: before === after ? 'up-to-date' : 'pulled' }
  } catch (err) {
    return { branch: current, status: 'error', detail: (err as Error).message }
  }
}

// Fast-forward do ref local da branch default SEM checkout: `fetch origin
// def:def` escreve direto no ref, sem tocar a working tree. Só é chamada quando
// `def !== current` (garantido pelo caller), então a default nunca está em
// checkout — o git não recusa com "refusing to fetch into checked-out branch".
// Se a default ainda não existe localmente, `before` falha (try/catch) e
// contamos como `pulled`. Se o remote divergiu do ref local, o fetch recusa o
// non-fast-forward e caímos no catch externo como `error` — seguro, nunca
// destrói (a working tree não é tocada de qualquer forma).
async function pullDefaultBranch(git: SimpleGit, url: string, def: string): Promise<BranchPullOutcome> {
  let before: string | null = null
  try {
    before = (await git.revparse([def])).trim()
  } catch {
    before = null // ref local da default ainda não existe
  }
  try {
    await git.raw([...authArgs(url), 'fetch', 'origin', `${def}:${def}`])
    if (before === null) return { branch: def, status: 'pulled' }
    const after = (await git.revparse([def])).trim()
    return { branch: def, status: before === after ? 'up-to-date' : 'pulled' }
  } catch (err) {
    return { branch: def, status: 'error', detail: (err as Error).message }
  }
}

function summarizeBranch(b: BranchPullOutcome): string {
  return b.detail ? `${b.branch}: ${b.status}(${b.detail})` : `${b.branch}: ${b.status}`
}

// Puro e testável: agrega o breakdown por-branch num status único de repo.
// Prioridade: error (algo falhou) > pulled (algo avançou) > up-to-date (tudo em
// dia) > skipped (nada foi tentado, ex. repo detached sem default resolvida).
export function deriveOverallStatus(
  branches: BranchPullOutcome[],
): { status: PullRepoResult['status']; detail?: string } {
  const detail = branches.map(summarizeBranch).join(' · ') || undefined
  if (branches.some((b) => b.status === 'error')) return { status: 'error', detail }
  if (branches.some((b) => b.status === 'pulled')) return { status: 'pulled', detail }
  if (branches.some((b) => b.status === 'up-to-date')) return { status: 'up-to-date', detail }
  return { status: 'skipped', detail }
}

// Pull de UM repo, cobrindo até duas unidades de trabalho: a branch em checkout
// (fast-forward via `pull`, comportamento original) e a branch default (via
// `fetch` sem checkout, quando diverge da atual — é o fix: sem isso a default
// nunca avança enquanto o usuário estiver numa feature branch). Nunca destrói
// trabalho: repos sujos/divergentes são pulados na unidade correspondente.
export async function pullRepo(target: PullTarget): Promise<PullRepoResult> {
  const base = { repoId: target.repoId, label: target.label, path: target.path }
  if (!existsSync(join(target.path, '.git'))) {
    return { ...base, status: 'skipped', detail: 'sem .git' }
  }
  try {
    const git = netGit(target.path)
    const status: StatusResult = await git.status()
    const current = status.current
    const def = target.defaultBranch ?? (await readDefaultBranch(git))

    // A URL do remote decide se o credential-helper do gh entra (http[s]) ou não
    // (file://). Preferimos a origin real do disco; caímos pro remote_url do DB.
    const url = (await readOriginUrl(target.path)).remoteUrl ?? target.remoteUrl ?? ''

    const branches: BranchPullOutcome[] = []
    if (current) branches.push(await pullCurrentBranch(git, current, status, url))
    if (def && def !== current) branches.push(await pullDefaultBranch(git, url, def))

    const { status: overall, detail } = deriveOverallStatus(branches)
    return { ...base, status: overall, detail, branches }
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
        .prepare('SELECT id, label, path, remote_url, default_branch FROM repos WHERE id = ?')
        .get(selector.repoId) as RepoRow | undefined)
    : (db
        .prepare('SELECT id, label, path, remote_url, default_branch FROM repos WHERE path = ?')
        .get(selector.path) as RepoRow | undefined)
  if (!row) throw new Error('repo não encontrado')
  return pullRepo({
    repoId: row.id,
    label: row.label,
    path: row.path,
    remoteUrl: row.remote_url,
    defaultBranch: row.default_branch,
  })
}
