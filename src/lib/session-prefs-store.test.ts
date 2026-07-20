// window.api precisa existir ANTES do import (ipc.ts o lê no top-level).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prefsGet = vi.fn()
const prefsSet = vi.fn()

Object.defineProperty(window, 'api', {
  value: { prefs: { get: prefsGet, set: prefsSet } },
  configurable: true,
})

const { sanitizeRepoDefaults, useSessionPrefsStore } = await import('./session-prefs-store')

describe('sanitizeRepoDefaults', () => {
  it('valores válidos passam intactos', () => {
    expect(
      sanitizeRepoDefaults({
        model: 'opus',
        effort: 'high',
        permission: 'plan',
        advisor: 'fable',
        paneMode: 'chat',
      }),
    ).toEqual({
      model: 'opus',
      effort: 'high',
      permission: 'plan',
      advisor: 'fable',
      paneMode: 'chat',
    })
  })

  it('valores fora da whitelist caem no vazio/default', () => {
    expect(
      sanitizeRepoDefaults({
        model: 'gpt-5',
        effort: 'turbo',
        permission: 'yolo',
        advisor: 'grok',
        paneMode: 'holograma',
      }),
    ).toEqual({
      model: '',
      effort: '',
      permission: 'default',
      advisor: '',
      paneMode: 'terminal',
    })
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
      paneMode: 'terminal',
    })
  })

  it('JSON legado (gravado antes do paneMode) cai no default do painel', () => {
    expect(
      sanitizeRepoDefaults({
        model: 'opus',
        effort: 'high',
        permission: 'plan',
        advisor: '',
      }),
    ).toEqual({
      model: 'opus',
      effort: 'high',
      permission: 'plan',
      advisor: '',
      paneMode: 'terminal',
    })
  })
})

describe('load() — defaultPaneMode', () => {
  beforeEach(() => {
    prefsGet.mockReset()
    prefsSet.mockReset()
    useSessionPrefsStore.setState({ loaded: false, defaultPaneMode: 'terminal' })
  })

  function mockPrefs(values: Record<string, unknown>) {
    prefsGet.mockImplementation(async (key: string) => values[key] ?? null)
  }

  it('lê session.defaultPaneMode do app_prefs', async () => {
    mockPrefs({ 'session.defaultPaneMode': 'chat' })
    await useSessionPrefsStore.getState().load()
    expect(useSessionPrefsStore.getState().defaultPaneMode).toBe('chat')
  })

  it('valor inválido cai em terminal', async () => {
    mockPrefs({ 'session.defaultPaneMode': 'holograma' })
    await useSessionPrefsStore.getState().load()
    expect(useSessionPrefsStore.getState().defaultPaneMode).toBe('terminal')
  })

  it('chave ausente cai em terminal', async () => {
    mockPrefs({})
    await useSessionPrefsStore.getState().load()
    expect(useSessionPrefsStore.getState().defaultPaneMode).toBe('terminal')
  })
})
