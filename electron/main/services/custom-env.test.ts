import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sanitizeCustomEnv,
  mergeCustomEnv,
  getEnvVar,
  withAutoCompactDisabled,
  sessionSpawnEnv,
  DISABLE_AUTOCOMPACT_KEY,
  CUSTOM_ENV_VARS_KEY,
} from './custom-env'
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

describe('withAutoCompactDisabled', () => {
  it('disabled → DISABLE_AUTOCOMPACT=1', () => {
    expect(withAutoCompactDisabled({ PATH: '/usr/bin' }, true)).toEqual({
      PATH: '/usr/bin',
      DISABLE_AUTOCOMPACT: '1',
    })
  })

  it('não-disabled → chave ausente (nunca 0)', () => {
    const env = withAutoCompactDisabled({ PATH: '/usr/bin' }, false)
    expect('DISABLE_AUTOCOMPACT' in env).toBe(false)
  })

  it('retorna objeto novo (não muta a base)', () => {
    const base = { PATH: '/usr/bin' }
    const env = withAutoCompactDisabled(base, true)
    expect(env).not.toBe(base)
    expect(base).toEqual({ PATH: '/usr/bin' })
  })
})

describe('sessionSpawnEnv', () => {
  function mockPrefs(prefs: { disableAutoCompact?: boolean; custom?: unknown }) {
    getPrefMock.mockImplementation((key: string, fallback: unknown) => {
      if (key === DISABLE_AUTOCOMPACT_KEY) return prefs.disableAutoCompact ?? fallback
      if (key === CUSTOM_ENV_VARS_KEY) return prefs.custom ?? fallback
      return fallback
    })
  }

  beforeEach(() => {
    getPrefMock.mockReset()
  })

  it('pref ligada → DISABLE_AUTOCOMPACT=1', () => {
    mockPrefs({ disableAutoCompact: true })
    expect(sessionSpawnEnv({ PATH: '/usr/bin' }).DISABLE_AUTOCOMPACT).toBe('1')
  })

  it('pref desligada → chave ausente', () => {
    mockPrefs({ disableAutoCompact: false })
    expect('DISABLE_AUTOCOMPACT' in sessionSpawnEnv({ PATH: '/usr/bin' })).toBe(false)
  })

  it('pref ausente → chave ausente', () => {
    mockPrefs({})
    expect('DISABLE_AUTOCOMPACT' in sessionSpawnEnv({ PATH: '/usr/bin' })).toBe(false)
  })

  it('custom env do usuário sobrescreve a var', () => {
    mockPrefs({ disableAutoCompact: true, custom: { DISABLE_AUTOCOMPACT: '0', FOO: 'bar' } })
    const env = sessionSpawnEnv({ PATH: '/usr/bin' })
    expect(env.DISABLE_AUTOCOMPACT).toBe('0')
    expect(env.FOO).toBe('bar')
  })

  it('não muta a base', () => {
    mockPrefs({ disableAutoCompact: true })
    const base = { PATH: '/usr/bin' }
    const env = sessionSpawnEnv(base)
    expect(env).not.toBe(base)
    expect(base).toEqual({ PATH: '/usr/bin' })
  })
})
