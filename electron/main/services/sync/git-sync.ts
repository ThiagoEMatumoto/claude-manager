import type Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  // Token efêmero (ex: do `gh auth token`). NUNCA é escrito em sync-config nem
  // logado; injetado por GIT_ASKPASS num script temp apagado após o uso.
  authToken?: string
  // Repassado ao exportBundle (featuresRoot/appVersion/machineId injetáveis p/ teste).
  exportOpts?: ExportOpts
}

// ---- Auth efêmero ----
//
// O token NUNCA toca o disco do app (sync-config) nem é logado. Para o push/clone
// HTTPS autenticado, criamos um GIT_ASKPASS temporário num tmpdir do OS que apenas
// ecoa o token, setamos GIT_ASKPASS apontando pra ele + GIT_TERMINAL_PROMPT=0, e
// REMOVEMOS o script (e seu dir) no finally. O git invoca o askpass para
// username e password; respondemos token nos dois (GitHub aceita o PAT como
// senha; o usuário é irrelevante). O token vive só na env do processo git filho.
async function withEphemeralAuth<T>(
  git: SimpleGit,
  authToken: string | undefined,
  fn: (git: SimpleGit) => Promise<T>,
): Promise<T> {
  if (!authToken) return fn(git)

  const dir = mkdtempSync(join(tmpdir(), 'cm-git-askpass-'))
  const askpass = join(dir, 'askpass.sh')
  // Script lê o token de uma env var (CM_GIT_TOKEN) em vez de embutí-lo no
  // arquivo — o token não fica em disco nem mesmo dentro do script.
  writeFileSync(askpass, '#!/bin/sh\nprintf %s "$CM_GIT_TOKEN"\n', { mode: 0o700 })
  chmodSync(askpass, 0o700)
  try {
    git.env({
      ...process.env,
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: '0',
      CM_GIT_TOKEN: authToken,
    })
    return await fn(git)
  } finally {
    git.env({ ...process.env, GIT_TERMINAL_PROMPT: '0' })
    rmSync(dir, { recursive: true, force: true })
  }
}

// Resolve o token de auth via `gh auth token` (efêmero). Retorna undefined se o
// gh não está disponível/autenticado — o caller decide se segue sem token
// (remotes file:// em teste não precisam).
export function ghAuthToken(): string | undefined {
  try {
    const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
    if (r.status === 0) {
      const tok = r.stdout.trim()
      return tok || undefined
    }
  } catch {
    // gh ausente — sem token.
  }
  return undefined
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
  opts?: GitSyncOpts,
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
  const cloned = await tryClone(workdir, repoUrl, opts)
  if (cloned) {
    if (await hasCommits(simpleGit(workdir))) return
    // Clone de remote vazio: garante remote + commit inicial.
    await seedInitialCommit(workdir, repoUrl, opts)
    return
  }

  await initAndSeed(workdir, repoUrl, opts)
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

async function tryClone(workdir: string, repoUrl: string, opts?: GitSyncOpts): Promise<boolean> {
  const into = simpleGit(workdir)
  try {
    // Clona NO PRÓPRIO workdir (já criado), usando '.' como destino dentro do cwd.
    await withEphemeralAuth(into, opts?.authToken, async (g) => {
      await g.clone(repoUrl, '.', ['--no-single-branch'])
    })
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

async function initAndSeed(workdir: string, repoUrl: string, opts?: GitSyncOpts): Promise<void> {
  const git = simpleGit(workdir)
  await git.init()
  // Garante uma branch 'main' determinística.
  try {
    await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  } catch {
    // versões antigas do git: ignora.
  }
  await seedInitialCommit(workdir, repoUrl, opts)
}

// Garante remote=origin + um commit inicial do bundle (estrutura vazia). Usado
// tanto no init from-scratch quanto após clonar um remote vazio.
async function seedInitialCommit(
  workdir: string,
  repoUrl: string,
  opts?: GitSyncOpts,
): Promise<void> {
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
    await withEphemeralAuth(git, opts?.authToken, async (g) => {
      await g.push(['origin', 'HEAD:main'])
      await g.fetch(['origin'])
    })
  } catch {
    // offline / sem permissão de push agora — segue; pushBundle empurra depois.
  }
}

// ---- pull (read-only: fetch + compara, NÃO muta working tree) ----

export async function pull(workdir: string, opts?: GitSyncOpts): Promise<PullState> {
  const git = simpleGit(workdir)
  await withEphemeralAuth(git, opts?.authToken, async (g) => {
    await g.fetch(['origin'])
  })
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
    await withEphemeralAuth(git, opts?.authToken, async (g) => {
      const args = ['origin', `HEAD:${branch}`]
      if (opts?.force) args.push('--force')
      await g.push(args)
    })
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
