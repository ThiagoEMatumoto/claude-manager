import { describe, expect, it } from 'vitest'
import { resolvePrice } from './metrics-pricing'

// Preços oficiais (docs Anthropic, jun/2026) em USD/MTok, aqui verificados já
// convertidos pra por-token. O match é por substring do model id do transcript.
describe('resolvePrice', () => {
  it('resolve claude-fable-5 por substring (10/50, cache 1.0/12.5 por MTok)', () => {
    expect(resolvePrice('claude-fable-5')).toEqual({
      input: 10 / 1_000_000,
      output: 50 / 1_000_000,
      cacheRead: 1.0 / 1_000_000,
      cacheWrite: 12.5 / 1_000_000,
    })
  })

  it('opus atualizado pra 5/25 (cache 0.5/6.25 por MTok)', () => {
    expect(resolvePrice('claude-opus-4-8')).toEqual({
      input: 5 / 1_000_000,
      output: 25 / 1_000_000,
      cacheRead: 0.5 / 1_000_000,
      cacheWrite: 6.25 / 1_000_000,
    })
  })

  it('haiku atualizado pra 1/5 (cache 0.1/1.25 por MTok)', () => {
    expect(resolvePrice('claude-haiku-4-5-20251001')).toEqual({
      input: 1 / 1_000_000,
      output: 5 / 1_000_000,
      cacheRead: 0.1 / 1_000_000,
      cacheWrite: 1.25 / 1_000_000,
    })
  })

  it('sonnet permanece 3/15', () => {
    const p = resolvePrice('claude-sonnet-4-5')
    expect(p?.input).toBe(3 / 1_000_000)
    expect(p?.output).toBe(15 / 1_000_000)
  })

  it('modelo desconhecido → null (chamador soma 0 e marca unknownModels)', () => {
    expect(resolvePrice('gpt-something')).toBeNull()
    expect(resolvePrice('<synthetic>')).toBeNull()
  })
})
