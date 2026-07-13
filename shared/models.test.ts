import { describe, expect, it } from 'vitest'
import {
  MODEL_ALIASES,
  MODEL_CONTEXT_LIMITS,
  MODEL_LABELS,
  MODEL_SUPPORTS_XHIGH,
  SPAWNABLE_MODEL_ALIASES,
  modelAliasFromId,
} from './models'

describe('MODEL_REGISTRY derivations', () => {
  it('conhece os 5 aliases canônicos', () => {
    expect([...MODEL_ALIASES].sort()).toEqual(['fable', 'haiku', 'opus', 'opusplan', 'sonnet'])
  })

  it('todos os aliases são spawnable (valores válidos de --model)', () => {
    expect([...SPAWNABLE_MODEL_ALIASES].sort()).toEqual([...MODEL_ALIASES].sort())
  })

  it('limites de contexto: 1M pra fable/opus/sonnet/opusplan, 200k pra haiku', () => {
    expect(MODEL_CONTEXT_LIMITS.fable).toBe(1_000_000)
    expect(MODEL_CONTEXT_LIMITS.opus).toBe(1_000_000)
    expect(MODEL_CONTEXT_LIMITS.sonnet).toBe(1_000_000)
    expect(MODEL_CONTEXT_LIMITS.opusplan).toBe(1_000_000)
    expect(MODEL_CONTEXT_LIMITS.haiku).toBe(200_000)
  })

  it('xhigh: haiku é o único sem suporte', () => {
    expect(MODEL_SUPPORTS_XHIGH.fable).toBe(true)
    expect(MODEL_SUPPORTS_XHIGH.opusplan).toBe(true)
    expect(MODEL_SUPPORTS_XHIGH.haiku).toBe(false)
  })

  it('labels exibíveis pra todos os aliases', () => {
    expect(MODEL_LABELS.fable).toBe('Fable')
    expect(MODEL_LABELS.opusplan).toBe('Opus Plan')
  })
})

describe('modelAliasFromId', () => {
  it('mapeia ids de transcript por substring', () => {
    expect(modelAliasFromId('claude-fable-5')).toBe('fable')
    expect(modelAliasFromId('claude-opus-4-8-20260101')).toBe('opus')
    expect(modelAliasFromId('claude-sonnet-4-5')).toBe('sonnet')
    expect(modelAliasFromId('claude-haiku-4-5-20251001')).toBe('haiku')
  })

  it("match do alias mais específico primeiro: 'opusplan' vence 'opus'", () => {
    expect(modelAliasFromId('opusplan')).toBe('opusplan')
  })

  it('id desconhecido, synthetic ou ausente → null', () => {
    expect(modelAliasFromId('gpt-something')).toBeNull()
    expect(modelAliasFromId('<synthetic>')).toBeNull()
    expect(modelAliasFromId(null)).toBeNull()
    expect(modelAliasFromId(undefined)).toBeNull()
  })
})
