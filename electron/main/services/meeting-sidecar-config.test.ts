import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  isMeetingSidecarConfigured,
  resolveSidecar,
  resolveSidecarPython,
  DEFAULT_VENV_PYTHON_REL,
  type SidecarConfigEnv,
} from './meeting-sidecar-config'

const REAL = '/repo/sidecar/sidecar.py'
const FAKE = '/repo/sidecar/fake_sidecar.py'
const VENV_PY = '/home/u/.claude-manager/meeting-sidecar/.venv/bin/python'

// existsSync injetável: o set é o conjunto de caminhos que "existem".
function existsFrom(present: string[]): (p: string) => boolean {
  const set = new Set(present)
  return (p) => set.has(p)
}

function env(over: Partial<SidecarConfigEnv>): SidecarConfigEnv {
  return {
    pythonPref: VENV_PY,
    realScriptPath: REAL,
    fakeScriptPath: FAKE,
    exists: existsFrom([VENV_PY, REAL, FAKE]),
    ...over,
  }
}

describe('isMeetingSidecarConfigured', () => {
  it('true quando pref + python + sidecar.py existem', () => {
    expect(isMeetingSidecarConfigured(env({}))).toBe(true)
  })

  it('false quando a pref está ausente', () => {
    expect(isMeetingSidecarConfigured(env({ pythonPref: null }))).toBe(false)
    expect(isMeetingSidecarConfigured(env({ pythonPref: '' }))).toBe(false)
    expect(isMeetingSidecarConfigured(env({ pythonPref: '   ' }))).toBe(false)
  })

  it('false quando o python da pref não existe no disco', () => {
    expect(isMeetingSidecarConfigured(env({ exists: existsFrom([REAL, FAKE]) }))).toBe(false)
  })

  it('false quando o sidecar.py real não existe', () => {
    expect(isMeetingSidecarConfigured(env({ exists: existsFrom([VENV_PY, FAKE]) }))).toBe(false)
  })
})

describe('resolveSidecar', () => {
  const FALLBACK = '/usr/bin/python3'

  it('pref presente e válida → sidecar REAL (python do venv + sidecar.py)', () => {
    const r = resolveSidecar(env({}), FALLBACK)
    expect(r).toEqual({
      configured: true,
      command: VENV_PY,
      script: REAL,
      mode: 'real',
    })
  })

  it('pref ausente → FAKE (python3 herdado + fake_sidecar.py)', () => {
    const r = resolveSidecar(env({ pythonPref: null }), FALLBACK)
    expect(r).toEqual({
      configured: false,
      command: FALLBACK,
      script: FAKE,
      mode: 'fake',
    })
  })

  it('pref aponta pra python inexistente → FAKE', () => {
    const r = resolveSidecar(env({ exists: existsFrom([REAL, FAKE]) }), FALLBACK)
    expect(r.mode).toBe('fake')
    expect(r.command).toBe(FALLBACK)
    expect(r.script).toBe(FAKE)
  })

  it('trim na pref (espaços não contam como configurado)', () => {
    const r = resolveSidecar(env({ pythonPref: `  ${VENV_PY}  ` }), FALLBACK)
    // trim acontece: o caminho com espaços trimado existe no set → real.
    expect(r.mode).toBe('real')
    expect(r.command).toBe(VENV_PY)
  })
})

describe('resolveSidecarPython (auto-detecção do venv)', () => {
  const HOME = '/home/u'
  const AUTO = join(HOME, DEFAULT_VENV_PYTHON_REL)

  it('pref preenchida tem precedência (não auto-detecta)', () => {
    const r = resolveSidecarPython({
      pythonPref: '/custom/python',
      home: HOME,
      exists: existsFrom([AUTO]),
      join,
    })
    expect(r).toBe('/custom/python')
  })

  it('pref vazia + venv no path padrão existe → auto-detecta', () => {
    const r = resolveSidecarPython({
      pythonPref: null,
      home: HOME,
      exists: existsFrom([AUTO]),
      join,
    })
    expect(r).toBe(AUTO)
  })

  it('pref vazia + venv ausente → null (cai no fake)', () => {
    const r = resolveSidecarPython({
      pythonPref: '',
      home: HOME,
      exists: existsFrom([]),
      join,
    })
    expect(r).toBeNull()
  })

  it('pref só com espaços → tenta auto-detectar', () => {
    const r = resolveSidecarPython({
      pythonPref: '   ',
      home: HOME,
      exists: existsFrom([AUTO]),
      join,
    })
    expect(r).toBe(AUTO)
  })
})
