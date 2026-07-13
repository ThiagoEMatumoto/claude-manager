// Testa só a função pura de sanitização — o resto do módulo depende de
// window.api, que precisa existir ANTES do import (ipc.ts o lê no top-level).
import { describe, it, expect, vi } from 'vitest'

Object.defineProperty(window, 'api', {
  value: { prefs: { get: vi.fn(), set: vi.fn() } },
  configurable: true,
})

const { sanitizeRepoDefaults } = await import('./session-prefs-store')

describe('sanitizeRepoDefaults', () => {
  it('valores válidos passam intactos', () => {
    expect(
      sanitizeRepoDefaults({ model: 'opus', effort: 'high', permission: 'plan', advisor: 'fable' }),
    ).toEqual({ model: 'opus', effort: 'high', permission: 'plan', advisor: 'fable' })
  })

  it('valores fora da whitelist caem no vazio/default', () => {
    expect(
      sanitizeRepoDefaults({
        model: 'gpt-5',
        effort: 'turbo',
        permission: 'yolo',
        advisor: 'grok',
      }),
    ).toEqual({ model: '', effort: '', permission: 'default', advisor: '' })
  })

  it('não-objeto → null (sem override)', () => {
    expect(sanitizeRepoDefaults(null)).toBeNull()
    expect(sanitizeRepoDefaults('opus')).toBeNull()
    expect(sanitizeRepoDefaults(['opus'])).toBeNull()
  })

  it('objeto parcial completa com defaults', () => {
    expect(sanitizeRepoDefaults({ model: 'sonnet' })).toEqual({
      model: 'sonnet',
      effort: '',
      permission: 'default',
      advisor: '',
    })
  })
})
