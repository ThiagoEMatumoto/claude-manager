import { describe, expect, it } from 'vitest'
import { computeTotals, previousWindowRange, type TotalsRow } from './metrics-totals'

function mkRow(partial: Partial<TotalsRow> = {}): TotalsRow {
  return {
    turns: 0,
    agent_calls: 0,
    skill_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    agent_rounds: 0,
    parallel_rounds: 0,
    inline_explore_calls: 0,
    ...partial,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('computeTotals', () => {
  it('zera tudo sem linhas', () => {
    const t = computeTotals([])
    expect(t.sessions).toBe(0)
    expect(t.turns).toBe(0)
    expect(t.parallelizationRatio).toBe(0)
    expect(t.inlineDelegationRatio).toBe(0)
    expect(t.cacheHitRate).toBe(0)
  })

  it('soma colunas por sessão', () => {
    const t = computeTotals([
      mkRow({ turns: 10, agent_calls: 2, skill_calls: 1, cost_usd: 1.5 }),
      mkRow({ turns: 5, agent_calls: 3, cost_usd: 0.5 }),
    ])
    expect(t.sessions).toBe(2)
    expect(t.turns).toBe(15)
    expect(t.agentCalls).toBe(5)
    expect(t.skillCalls).toBe(1)
    expect(t.costUsd).toBeCloseTo(2.0, 5)
  })

  it('calcula parallelizationRatio = parallel_rounds / agent_rounds', () => {
    const t = computeTotals([
      mkRow({ agent_rounds: 4, parallel_rounds: 1 }),
      mkRow({ agent_rounds: 6, parallel_rounds: 2 }),
    ])
    expect(t.parallelizationRatio).toBeCloseTo(3 / 10, 5)
  })

  it('parallelizationRatio = 0 quando não há agent rounds', () => {
    expect(computeTotals([mkRow({ parallel_rounds: 0 })]).parallelizationRatio).toBe(0)
  })

  it('calcula inlineDelegationRatio = agent_calls / (agent_calls + inline_explore_calls)', () => {
    const t = computeTotals([mkRow({ agent_calls: 3, inline_explore_calls: 1 })])
    expect(t.inlineDelegationRatio).toBeCloseTo(0.75, 5)
  })

  it('inlineDelegationRatio = 0 quando denominador é 0', () => {
    expect(computeTotals([mkRow()]).inlineDelegationRatio).toBe(0)
  })

  it('calcula cacheHitRate = cacheRead / (cacheRead + input)', () => {
    const t = computeTotals([mkRow({ cache_read_tokens: 75, input_tokens: 25 })])
    expect(t.cacheHitRate).toBeCloseTo(0.75, 5)
  })
})

describe('previousWindowRange', () => {
  const now = 1_000 * DAY // referência determinística

  it('7d → [now-14d, now-7d)', () => {
    expect(previousWindowRange('7d', now)).toEqual({ from: now - 14 * DAY, to: now - 7 * DAY })
  })

  it('30d → [now-60d, now-30d)', () => {
    expect(previousWindowRange('30d', now)).toEqual({ from: now - 60 * DAY, to: now - 30 * DAY })
  })

  it('all → null (sem janela anterior)', () => {
    expect(previousWindowRange('all', now)).toBeNull()
  })
})
