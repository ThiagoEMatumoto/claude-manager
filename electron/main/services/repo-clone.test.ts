import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

// repo-clone importa db/notify, que tocam electron no topo. Mockamos o mínimo;
// selectMissingRepos é puro e não usa nada disso.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { selectMissingRepos } from './repo-clone'

function row(over: Partial<{ id: string; label: string; path: string; remote_url: string | null }>) {
  return {
    id: 'r1',
    label: 'repo',
    path: '/does/not/exist',
    remote_url: 'https://github.com/acme/repo.git',
    ...over,
  }
}

describe('selectMissingRepos', () => {
  const missing = (_p: string) => false
  const present = (_p: string) => true

  it('lista repo com path inexistente + remote_url', () => {
    const out = selectMissingRepos([row({})], missing)
    expect(out).toEqual([
      {
        repoId: 'r1',
        label: 'repo',
        path: '/does/not/exist',
        remoteUrl: 'https://github.com/acme/repo.git',
      },
    ])
  })

  it('ignora repo cujo path existe no disco', () => {
    expect(selectMissingRepos([row({})], present)).toEqual([])
  })

  it('ignora repo sem remote_url', () => {
    expect(selectMissingRepos([row({ remote_url: null })], missing)).toEqual([])
  })

  it('filtra em lote misto', () => {
    const rows = [
      row({ id: 'a', path: '/gone/a' }),
      row({ id: 'b', path: '/here/b' }),
      row({ id: 'c', path: '/gone/c', remote_url: null }),
    ]
    const exists = (p: string) => p.startsWith('/here')
    expect(selectMissingRepos(rows, exists).map((r) => r.repoId)).toEqual(['a'])
  })
})
