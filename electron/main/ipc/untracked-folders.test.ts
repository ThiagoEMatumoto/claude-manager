import { describe, expect, it } from 'vitest'
import { normalizePath, selectUntracked, type DirEntryLike } from './untracked-folders'

function dir(name: string): DirEntryLike {
  return { name, isDirectory: () => true }
}
function file(name: string): DirEntryLike {
  return { name, isDirectory: () => false }
}

describe('normalizePath', () => {
  it('remove barra final', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b')
  })
  it('resolve . e ..', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c')
  })
})

describe('selectUntracked', () => {
  const vault = '/vault'

  it('retorna só diretórios não-registrados', () => {
    const entries = [dir('arara'), dir('claude-manager'), file('README.md')]
    const registered = ['/vault/claude-manager']
    expect(selectUntracked(vault, entries, registered)).toEqual([
      { name: 'arara', path: '/vault/arara' },
    ])
  })

  it('exclui dotfiles e arquivos', () => {
    const entries = [dir('.git'), file('notes.txt'), dir('app')]
    expect(selectUntracked(vault, entries, [])).toEqual([{ name: 'app', path: '/vault/app' }])
  })

  it('ignora barra final divergente nos paths registrados', () => {
    const entries = [dir('arara')]
    expect(selectUntracked(vault, entries, ['/vault/arara/'])).toEqual([])
  })

  it('ordena por nome', () => {
    const entries = [dir('zeta'), dir('alpha')]
    expect(selectUntracked(vault, entries, []).map((f) => f.name)).toEqual(['alpha', 'zeta'])
  })

  it('vault vazio retorna lista vazia', () => {
    expect(selectUntracked(vault, [], [])).toEqual([])
  })
})
