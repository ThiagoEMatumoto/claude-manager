import type Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { exportBundle, type ExportOpts } from './exporter'

// Subdiretório dentro do working dir do clone onde o bundle determinístico é
// materializado. O repo inteiro = só esse bundle (+ .git).
export const BUNDLE_SUBDIR = 'sync-bundle'

export function bundleDirFor(workdir: string): string {
  return join(workdir, BUNDLE_SUBDIR)
}

// Comparação local vs origin/<branch> sem mutar o working tree.
export interface PullState {
  ahead: number // commits locais que origin não tem
  behind: number // commits de origin que o local não tem
  diverged: boolean // ambos > 0
  branch: string
}

export interface PushResult {
  pushed: boolean // houve commit novo empurrado
  rejected: boolean // push recusado por non-fast-forward (NÃO forçamos automaticamente)
}

export interface GitStatus {
  dirty: boolean
  ahead: number
  behind: number
  lastCommit: string | null
}

export interface GitSyncOpts {
  // Repassado ao exportBundle (featuresRoot/appVersion/machineId injetáveis p/ teste).
  exportOpts?: ExportOpts
}

// ---- Auth via credential helper do gh ----
//
// Usamos `gh` como credential helper em vez de embutir um token: o gh gerencia o
// segredo (efêmero, por chamada) e NADA toca disco. Por operação de rede
// (clone/fetch/push) injetamos via `-c`:
//   credential.helper=                          → limpa helpers herdados do env
//   credential.helper=!gh auth git-credential   → resolve a credencial pelo gh
// `GIT_TERMINAL_PROMPT=0` garante falha (em vez de prompt) se o gh não responder.
//
// Esse caminho é o MESMO exercido pelo E2E real contra o GitHub — a auth de
// produção é, portanto, testada de verdade.
const AUTH_CONFIG: string[] = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.helper=!gh auth git-credential',
]

// Instância simple-git para operações de REDE (clone/fetch/push). Precisa de
// `allowUnsafeCredentialHelper` porque injetamos `-c credential.helper=...` (o
// helper do gh) — o plugin "unsafe" do simple-git bloqueia essa config por
// padrão. Também limpamos GIT_EDITOR/EDITOR/PAGER/ASKPASS do env (o mesmo plugin
// recusa rodar com essas vars setadas), e setamos GIT_TERMINAL_PROMPT=0 para que
// uma credencial ausente FALHE em vez de abrir prompt.
function netGit(workdir: string): SimpleGit {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const k of UNSAFE_GIT_ENV) delete env[k]
  return simpleGit(workdir, { unsafe: { allowUnsafeCredentialHelper: true } }).env(env)
}

// Vars que o plugin "unsafe" do simple-git recusa quando presentes no env. Como
// passamos um env custom ao filho git e a auth é via credential helper (não
// askpass/editor), limpamos essas vars em vez de habilitar o modo unsafe.
const UNSAFE_GIT_ENV = [
  'GIT_EDITOR',
  'EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_PAGER',
  'PAGER',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
] as const

// Remotes file:// (usados nos testes de unidade) não exigem credencial: git
// ignora credential helper no transporte local. Só http(s) precisa do gh.
function needsAuth(remoteUrl: string): boolean {
  return /^https?:\/\//i.test(remoteUrl)
}

// Args de config a prefixar numa operação de rede. Para remotes http(s) garante
// que o gh está autenticado (erro claro caso contrário) e injeta o credential
// helper. Para file:// retorna [] (sem dependência do gh).
function authArgs(remoteUrl: string): string[] {
  if (!needsAuth(remoteUrl)) return []
  ensureGhReady()
  return AUTH_CONFIG
}

// Garante que o gh está disponível E autenticado antes de uma operação http(s).
// Lança erro claro caso contrário — a auth real acontece via credential helper,
// esta é só uma verificação de pré-requisito.
function ensureGhReady(): void {
  let status: number | null
  try {
    status = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).status
  } catch {
    status = null
  }
  if (status !== 0) {
    throw new Error('gh não autenticado — rode `gh auth login` para habilitar o sync git.')
  }
}

// Resolve a URL do remote origin (para decidir se a operação precisa de auth).
// NÃO engole erro de getRemotes: se a resolução falhar, `needsAuth('')` daria
// false e a operação de rede correria SEM credential helper (falha silenciosa de
// auth em http(s)). Propagar o erro faz a operação falhar alto e claro.
async function originUrl(git: SimpleGit): Promise<string> {
  const remotes = await git.getRemotes(true)
  return remotes.find((r) => r.name === 'origin')?.refs.fetch ?? ''
}

// Probe: `gh` disponível e autenticado? Mantido para callers que precisam decidir
// se há auth antes de tentar uma operação (não retorna o token em si).
export function ghAvailable(): boolean {
  try {
    return spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

// ---- branch helper ----

async function defaultBranch(git: SimpleGit): Promise<string> {
  // HEAD atual do clone. Após clone/fetch sempre existe.
  try {
    const b = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    if (b && b !== 'HEAD') return b
  } catch {
    // sem commits ainda
  }
  return 'main'
}

// ---- ensureRepo ----
//
// Idempotente:
//  - .git já existe        → no-op (ensure remote aponta pro repoUrl).
//  - workdir vazio/sem git → tenta clonar repoUrl; se o remote está vazio
//                            (clona nada), faz git init + remote add + commit
//                            inicial do bundle e push (popula o repo).
export async function ensureRepo(
  workdir: string,
  repoUrl: string,
  _opts?: GitSyncOpts,
): Promise<void> {
  mkdirSync(workdir, { recursive: true })

  if (existsSync(join(workdir, '.git'))) {
    const git = simpleGit(workdir)
    await ensureOrigin(git, repoUrl)
    return
  }

  // Tenta clonar. Se o remote tem conteúdo, clona e pronto. Se o remote está
  // VAZIO (bare recém-criado), o `git clone` "sucede" mas deixa um repo sem
  // commits (HEAD órfão) — nesse caso seedamos o commit inicial.
  const cloned = await tryClone(workdir, repoUrl)
  if (cloned) {
    if (await hasCommits(simpleGit(workdir))) return
    // Clone de remote vazio: garante remote + commit inicial.
    await seedInitialCommit(workdir, repoUrl)
    return
  }

  await initAndSeed(workdir, repoUrl)
}

async function ensureOrigin(git: SimpleGit, repoUrl: string): Promise<void> {
  const remotes = await git.getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin')
  if (!origin) {
    await git.addRemote('origin', repoUrl)
  } else if (origin.refs.fetch !== repoUrl) {
    await git.remote(['set-url', 'origin', repoUrl])
  }
}

async function tryClone(workdir: string, repoUrl: string, _opts?: GitSyncOpts): Promise<boolean> {
  try {
    // Clona NO PRÓPRIO workdir (já criado), usando '.' como destino dentro do cwd.
    // Os -c de auth (se http(s)) vêm ANTES do subcomando `clone`.
    await netGit(workdir).raw([...authArgs(repoUrl), 'clone', '--no-single-branch', repoUrl, '.'])
    // Clone só "vale" se trouxe um .git utilizável.
    return existsSync(join(workdir, '.git'))
  } catch {
    // Limpa qualquer resíduo parcial do clone falho (mas preserva o workdir).
    if (!existsSync(join(workdir, '.git'))) return false
    rmSync(join(workdir, '.git'), { recursive: true, force: true })
    return false
  }
}

async function hasCommits(git: SimpleGit): Promise<boolean> {
  try {
    // HEAD^{commit} força a resolução a um COMMIT real. Num clone de remote
    // vazio, HEAD é um symref não-nascido para refs/heads/main: `rev-parse
    // HEAD` resolve o symref (exit 0) mas `HEAD^{commit}` falha (não há commit).
    const out = (await git.raw(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim()
    return out.length > 0
  } catch {
    return false
  }
}

async function initAndSeed(workdir: string, repoUrl: string): Promise<void> {
  const git = simpleGit(workdir)
  await git.init()
  // Garante uma branch 'main' determinística.
  try {
    await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  } catch {
    // versões antigas do git: ignora.
  }
  await seedInitialCommit(workdir, repoUrl)
}

// Garante remote=origin + um commit inicial do bundle (estrutura vazia). Usado
// tanto no init from-scratch quanto após clonar um remote vazio.
async function seedInitialCommit(workdir: string, repoUrl: string): Promise<void> {
  const git = simpleGit(workdir)
  await ensureOrigin(git, repoUrl)
  try {
    await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  } catch {
    // já numa branch nomeada
  }
  mkdirSync(bundleDirFor(workdir), { recursive: true })
  writeFileSync(join(bundleDirFor(workdir), '.gitkeep'), '')
  await git.add(['-A'])
  await git.raw([
    '-c',
    'user.email=sync@claude-manager',
    '-c',
    'user.name=claude-manager',
    'commit',
    '-m',
    'chore(sync): initial empty bundle',
  ])
  // Empurra o commit inicial para que o remote deixe de estar vazio (e a
  // remote-tracking ref origin/main passe a existir). Sem isso, outras máquinas
  // clonariam um repo vazio e re-seedariam em loop. Tolera falha de rede: o
  // pushBundle subsequente reempurra.
  try {
    const a = authArgs(repoUrl)
    const g = netGit(workdir)
    await g.raw([...a, 'push', 'origin', 'HEAD:main'])
    await g.raw([...a, 'fetch', 'origin'])
  } catch {
    // offline / sem permissão de push agora — segue; pushBundle empurra depois.
  }
}

// ---- pull (read-only: fetch + compara, NÃO muta working tree) ----

export async function pull(workdir: string, _opts?: GitSyncOpts): Promise<PullState> {
  const git = simpleGit(workdir)
  const a = authArgs(await originUrl(git))
  await netGit(workdir).raw([...a, 'fetch', 'origin'])
  return computePullState(git)
}

async function computePullState(git: SimpleGit): Promise<PullState> {
  const branch = await defaultBranch(git)
  const remoteRef = `origin/${branch}`
  if (!(await remoteRefExists(git, remoteRef))) {
    // Remote ainda sem essa branch (repo recém-init sem push) → tudo local.
    const ahead = await countCommits(git, 'HEAD')
    return { ahead, behind: 0, diverged: false, branch }
  }
  // git rev-list --left-right --count HEAD...origin/<branch>
  // → "<ahead>\t<behind>"
  const out = (await git.raw(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])).trim()
  const [aheadStr, behindStr] = out.split(/\s+/)
  const ahead = Number.parseInt(aheadStr ?? '0', 10) || 0
  const behind = Number.parseInt(behindStr ?? '0', 10) || 0
  return { ahead, behind, diverged: ahead > 0 && behind > 0, branch }
}

async function remoteRefExists(git: SimpleGit, ref: string): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

async function countCommits(git: SimpleGit, ref: string): Promise<number> {
  try {
    const out = (await git.raw(['rev-list', '--count', ref])).trim()
    return Number.parseInt(out, 10) || 0
  } catch {
    return 0
  }
}

// ---- applyRemote (DESTRUTIVO: reset --hard origin/<branch>) ----
//
// Traz o bundle remoto pro disco. Só deve ser chamado quando seguro (sem
// trabalho local não-empurrado) — a decisão é do caller (boot/IPC).
export async function applyRemote(workdir: string): Promise<void> {
  const git = simpleGit(workdir)
  const branch = await defaultBranch(git)
  await git.raw(['reset', '--hard', `origin/${branch}`])
}

// ---- pushBundle ----
//
// exportBundle → git add -A → commit (no-op se nada mudou) → push. Se o push é
// recusado por non-fast-forward, retorna rejected:true SEM forçar (a menos que
// force:true seja passado explicitamente).
export async function pushBundle(
  workdir: string,
  db: Database.Database,
  message: string,
  opts?: GitSyncOpts & { force?: boolean },
): Promise<PushResult> {
  exportBundle(db, bundleDirFor(workdir), opts?.exportOpts)

  const git = simpleGit(workdir)
  const branch = await defaultBranch(git)
  await git.add(['-A'])

  const status = await git.status()
  let committed = false
  if (status.staged.length > 0 || status.files.length > 0) {
    await git.raw([
      '-c',
      'user.email=sync@claude-manager',
      '-c',
      'user.name=claude-manager',
      'commit',
      '-m',
      message,
    ])
    committed = true
  }

  // Há algo a empurrar? (commit novo OU local à frente de origin)
  const state = await safePullState(git, branch)
  const hasUnpushed = committed || state.ahead > 0
  if (!hasUnpushed) {
    return { pushed: false, rejected: false }
  }

  try {
    const pushArgs = [...authArgs(await originUrl(git)), 'push', 'origin', `HEAD:${branch}`]
    if (opts?.force) pushArgs.push('--force')
    await netGit(workdir).raw(pushArgs)
    return { pushed: true, rejected: false }
  } catch (err) {
    // Distingue rejeição por non-fast-forward (esperada em conflito) de erro
    // real de transporte/auth. Em ambos NÃO forçamos automaticamente.
    const msg = String((err as Error)?.message ?? err)
    if (/non-fast-forward|fetch first|rejected|Updates were rejected/i.test(msg)) {
      return { pushed: false, rejected: true }
    }
    throw err
  }
}

// pull-state sem fetch (origin já conhecido). Tolerante a remote-branch ausente.
async function safePullState(git: SimpleGit, branch: string): Promise<PullState> {
  const remoteRef = `origin/${branch}`
  if (!(await remoteRefExists(git, remoteRef))) {
    return { ahead: await countCommits(git, 'HEAD'), behind: 0, diverged: false, branch }
  }
  return computePullState(git)
}

// ---- status ----

export async function status(workdir: string): Promise<GitStatus> {
  const git = simpleGit(workdir)
  const s = await git.status()
  const branch = await defaultBranch(git)
  const state = await safePullState(git, branch)
  let lastCommit: string | null = null
  try {
    lastCommit = (await git.raw(['rev-parse', '--short', 'HEAD'])).trim() || null
  } catch {
    lastCommit = null
  }
  return {
    dirty: !s.isClean(),
    ahead: state.ahead,
    behind: state.behind,
    lastCommit,
  }
}
