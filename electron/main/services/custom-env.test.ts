import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sanitizeCustomEnv, mergeCustomEnv, getEnvVar } from './custom-env'
import { getPref } from './prefs-store'

vi.mock('./prefs-store', () => ({ getPref: vi.fn() }))

const getPrefMock = vi.mocked(getPref)

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

describe('getEnvVar', () => {
  beforeEach(() => {
    getPrefMock.mockReset()
    delete process.env.CM_TEST_KEY
  })

  afterEach(() => {
    delete process.env.CM_TEST_KEY
  })

  it('pref tem precedência sobre process.env', () => {
    getPrefMock.mockReturnValue({ CM_TEST_KEY: 'from-pref' })
    process.env.CM_TEST_KEY = 'from-env'
    expect(getEnvVar('CM_TEST_KEY')).toBe('from-pref')
  })

  it('cai para process.env quando a pref não tem a chave', () => {
    getPrefMock.mockReturnValue({})
    process.env.CM_TEST_KEY = 'from-env'
    expect(getEnvVar('CM_TEST_KEY')).toBe('from-env')
  })

  it('valor vazio na pref não mascara o process.env', () => {
    getPrefMock.mockReturnValue({ CM_TEST_KEY: '' })
    process.env.CM_TEST_KEY = 'from-env'
    expect(getEnvVar('CM_TEST_KEY')).toBe('from-env')
  })

  it('ausente nos dois → undefined', () => {
    getPrefMock.mockReturnValue(null)
    expect(getEnvVar('CM_TEST_KEY')).toBeUndefined()
  })
})
