import { describe, expect, it } from 'vitest'
import { contextUsage, formatContextUsage, MODEL_CONTEXT_LIMITS } from './model-context-limits'

describe('contextUsage', () => {
  it('computes pct against the model limit', () => {
    const u = contextUsage({ tokens: { output: 0, context: 100_000 }, model: 'claude-opus-4-5-20991231' })
    expect(u).toEqual({ used: 100_000, limit: MODEL_CONTEXT_LIMITS.opus, pct: 10 })
  })

  it('uses the haiku limit (200k) for a haiku id', () => {
    const u = contextUsage({ tokens: { output: 0, context: 100_000 }, model: 'claude-haiku-4-5' })
    expect(u).toEqual({ used: 100_000, limit: 200_000, pct: 50 })
  })

  it('falls back to the default limit for an unknown model id', () => {
    const u = contextUsage({ tokens: { output: 0, context: 20_000 }, model: 'gpt-something' })
    expect(u).toEqual({ used: 20_000, limit: 200_000, pct: 10 })
  })

  it('caps pct at 100 even when context exceeds the limit', () => {
    const u = contextUsage({ tokens: { output: 0, context: 5_000_000 }, model: 'claude-sonnet-4-5' })
    expect(u?.pct).toBe(100)
  })

  it('returns null without tokens', () => {
    expect(contextUsage({ model: 'claude-opus-4-5' })).toBeNull()
  })

  it('returns null without a model', () => {
    expect(contextUsage({ tokens: { output: 0, context: 100_000 }, model: null })).toBeNull()
  })
})

describe('formatContextUsage', () => {
  it('renders used / limit · pct with compact tokens', () => {
    expect(formatContextUsage({ used: 95_000, limit: 1_000_000, pct: 10 })).toBe('95k / 1.0M · 10%')
  })
})
