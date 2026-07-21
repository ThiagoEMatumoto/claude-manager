import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// repo-pull importa db/notify/git-auth, que tocam electron no topo (mesmo
// mock do repo-pull.test.ts). Remotes file:// não passam por needsAuth (só
// http[s]), então `gh` nunca entra em jogo aqui — os testes são 100% locais.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { pullRepo } from './repo-pull'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// Monta: origin bare (main com 1 commit) → clone de trabalho. Avança
// origin/main com um 2º commit e dá checkout numa feature branch no clone
// ANTES de puxar o avanço — reproduz o cenário do bug (usuário parado numa
// feature branch enquanto a default do remote segue adiante).
function setupRepos(dir: string): { originPath: string; clonePath: string } {
  const originPath = join(dir, 'origin.git')
  const clonePath = join(dir, 'clone')
  const seedPath = join(dir, 'seed')

  git(dir, 'init', '--bare', '-b', 'main', originPath)

  git(dir, 'clone', originPath, seedPath)
  git(seedPath, 'config', 'user.email', 'test@example.com')
  git(seedPath, 'config', 'user.name', 'Test')
  writeFileSync(join(seedPath, 'file.txt'), 'v1')
  git(seedPath, 'add', 'file.txt')
  git(seedPath, 'commit', '-m', 'init')
  git(seedPath, 'push', 'origin', 'main')

  git(dir, 'clone', originPath, clonePath)
  git(clonePath, 'config', 'user.email', 'test@example.com')
  git(clonePath, 'config', 'user.name', 'Test')

  // Origin avança DEPOIS do clone — o clone local ainda está no commit v1.
  writeFileSync(join(seedPath, 'file.txt'), 'v2')
  git(seedPath, 'commit', '-am', 'advance main')
  git(seedPath, 'push', 'origin', 'main')

  // Checkout numa feature branch a partir do main local (ainda em v1) — nunca
  // fez fetch do avanço acima. Publica + rastreia upstream (cenário comum:
  // branch já empurrada) pra que o `pull --ff-only` da branch atual tenha
  // tracking info em vez de falhar por "no tracking information".
  git(clonePath, 'checkout', '-b', 'feat/x')
  git(clonePath, 'push', '-u', 'origin', 'feat/x')

  return { originPath, clonePath }
}

describe('pullRepo (integração — repos git temporários)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'repo-pull-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('atualiza a default (main) via fetch sem tocar a feature branch em checkout', async () => {
    const { originPath, clonePath } = setupRepos(dir)
    const originMain = git(originPath, 'rev-parse', 'main')
    const featBefore = git(clonePath, 'rev-parse', 'feat/x')

    const result = await pullRepo({
      repoId: 'r1',
      label: 'clone',
      path: clonePath,
      remoteUrl: originPath,
      defaultBranch: 'main',
    })

    // (a) o ref local `main` avançou e alcançou o origin.
    expect(git(clonePath, 'rev-parse', 'main')).toBe(originMain)
    // (b) a feature branch (checkout atual) ficou intocada.
    expect(git(clonePath, 'rev-parse', 'feat/x')).toBe(featBefore)
    expect(git(clonePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/x')
    // (c) `branches` reflete os dois resultados.
    expect(result.branches).toHaveLength(2)
    expect(result.branches?.find((b) => b.branch === 'main')?.status).toBe('pulled')
    expect(result.branches?.find((b) => b.branch === 'feat/x')?.status).toBe('up-to-date')
    expect(result.status).toBe('pulled')
  })

  it('working tree suja: default ainda avança via fetch, branch atual é pulada', async () => {
    const { originPath, clonePath } = setupRepos(dir)
    const originMain = git(originPath, 'rev-parse', 'main')
    const featBefore = git(clonePath, 'rev-parse', 'feat/x')
    // Suja a working tree (mudança não commitada) na feature branch em checkout.
    writeFileSync(join(clonePath, 'file.txt'), 'dirty')

    const result = await pullRepo({
      repoId: 'r1',
      label: 'clone',
      path: clonePath,
      remoteUrl: originPath,
      defaultBranch: 'main',
    })

    expect(git(clonePath, 'rev-parse', 'main')).toBe(originMain)
    expect(git(clonePath, 'rev-parse', 'feat/x')).toBe(featBefore)
    expect(result.branches?.find((b) => b.branch === 'main')?.status).toBe('pulled')
    const featOutcome = result.branches?.find((b) => b.branch === 'feat/x')
    expect(featOutcome?.status).toBe('skipped')
    expect(featOutcome?.detail).toBe('dirty')
  })
})
