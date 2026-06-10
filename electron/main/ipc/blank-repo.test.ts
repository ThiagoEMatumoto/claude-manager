import { describe, expect, it } from 'vitest'
import { validateBlankRepoName } from './blank-repo'

function expectError(raw: string): string {
  const result = validateBlankRepoName(raw)
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

describe('validateBlankRepoName', () => {
  it('aceita nomes simples', () => {
    expect(validateBlankRepoName('meu-repo')).toEqual({ ok: true, name: 'meu-repo' })
    expect(validateBlankRepoName('app_v2')).toEqual({ ok: true, name: 'app_v2' })
    expect(validateBlankRepoName('repo.docs')).toEqual({ ok: true, name: 'repo.docs' })
    expect(validateBlankRepoName('Projeto 2026')).toEqual({ ok: true, name: 'Projeto 2026' })
  })

  it('normaliza espaços nas pontas', () => {
    expect(validateBlankRepoName('  arara  ')).toEqual({ ok: true, name: 'arara' })
  })

  it('rejeita vazio e só-espaços', () => {
    expectError('')
    expectError('   ')
  })

  it('rejeita separadores de caminho e traversal', () => {
    expectError('a/b')
    expectError('a\\b')
    expectError('../fora')
    expectError('..')
    expectError('.')
    expectError('/etc')
  })

  it('rejeita dotfiles e início não-alfanumérico', () => {
    expectError('.git')
    expectError('-repo')
    expectError(' _x')
  })

  it('rejeita caracteres fora do conjunto seguro', () => {
    expectError('repo:novo')
    expectError('repo*')
    expectError('nome\ncom-quebra')
  })

  it('rejeita nomes acima do limite', () => {
    expectError('a'.repeat(101))
    expect(validateBlankRepoName('a'.repeat(100)).ok).toBe(true)
  })
})
