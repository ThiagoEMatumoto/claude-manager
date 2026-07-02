import { spawnSync } from 'node:child_process'
import simpleGit, { type SimpleGit } from 'simple-git'

// Auth via credential helper do gh, compartilhada entre o sync (sync/git-sync.ts)
// e o clone/pull dos repos de projeto (ipc/git.ts). Usamos `gh` como credential
// helper em vez de embutir um token: o gh gerencia o segredo (efêmero, por
// chamada) e NADA toca disco. Por operação de rede injetamos via `-c`:
//   credential.helper=                          → limpa helpers herdados do env
//   credential.helper=!gh auth git-credential   → resolve a credencial pelo gh
// `GIT_TERMINAL_PROMPT=0` garante falha (em vez de prompt) se o gh não responder.
const AUTH_CONFIG: string[] = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.helper=!gh auth git-credential',
]

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

// Instância simple-git para operações de REDE (clone/fetch/push). Precisa de
// `allowUnsafeCredentialHelper` porque injetamos `-c credential.helper=...` (o
// helper do gh) — o plugin "unsafe" do simple-git bloqueia essa config por
// padrão. Também limpamos GIT_EDITOR/EDITOR/PAGER/ASKPASS do env (o mesmo plugin
// recusa rodar com essas vars setadas), e setamos GIT_TERMINAL_PROMPT=0 para que
// uma credencial ausente FALHE em vez de abrir prompt.
export function netGit(workdir: string): SimpleGit {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const k of UNSAFE_GIT_ENV) delete env[k]
  return simpleGit(workdir, { unsafe: { allowUnsafeCredentialHelper: true } }).env(env)
}

// Remotes file:// (usados nos testes de unidade) não exigem credencial: git
// ignora credential helper no transporte local. Só http(s) precisa do gh.
function needsAuth(remoteUrl: string): boolean {
  return /^https?:\/\//i.test(remoteUrl)
}

// Args de config a prefixar numa operação de rede. Para remotes http(s) garante
// que o gh está autenticado (erro claro caso contrário) e injeta o credential
// helper. Para file:// retorna [] (sem dependência do gh).
export function authArgs(remoteUrl: string): string[] {
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

// Probe: `gh` disponível e autenticado? Mantido para callers que precisam decidir
// se há auth antes de tentar uma operação (não retorna o token em si).
export function ghAvailable(): boolean {
  try {
    return spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}
