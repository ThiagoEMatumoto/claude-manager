import { describe, it, expect } from 'vitest'
import { sanitizeCustomEnv, mergeCustomEnv } from './custom-env'

describe('sanitizeCustomEnv', () => {
  it('mapa válido passa intacto', () => {
    expect(sanitizeCustomEnv({ FOO: 'bar', TOKEN: 'sk-123' })).toEqual({
      FOO: 'bar',
      TOKEN: 'sk-123',
    })
  })

  it('null/array/string → {}', () => {
    expect(sanitizeCustomEnv(null)).toEqual({})
    expect(sanitizeCustomEnv(['FOO'])).toEqual({})
    expect(sanitizeCustomEnv('FOO=bar')).toEqual({})
  })

  it('ignora chaves vazias e valores não-string', () => {
    expect(
      sanitizeCustomEnv({ '': 'x', '  ': 'y', NUM: 1, OBJ: {}, OK: 'v' }),
    ).toEqual({ OK: 'v' })
  })

  it('trim na chave', () => {
    expect(sanitizeCustomEnv({ '  FOO  ': 'bar' })).toEqual({ FOO: 'bar' })
  })
})

describe('mergeCustomEnv', () => {
  it('custom tem precedência sobre a base (override do usuário)', () => {
    const merged = mergeCustomEnv({ PATH: '/usr/bin', FOO: 'base' }, { FOO: 'override' })
    expect(merged.FOO).toBe('override')
    expect(merged.PATH).toBe('/usr/bin')
  })

  it('base intacta quando custom vazio', () => {
    const base = { PATH: '/usr/bin' }
    expect(mergeCustomEnv(base, {})).toEqual(base)
  })

  it('retorna objeto novo (não muta a base)', () => {
    const base = { FOO: 'base' }
    const merged = mergeCustomEnv(base, { BAR: 'x' })
    expect(merged).not.toBe(base)
    expect(base).toEqual({ FOO: 'base' })
  })
})
