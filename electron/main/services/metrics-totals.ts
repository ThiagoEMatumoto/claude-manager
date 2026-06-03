import type { MetricsTotals, MetricsWindow } from '../../../shared/types/ipc'

// Subconjunto numérico de CacheRow necessário pra computar os totais da janela.
// Mantido aqui (sem deps de electron/db) pra ser testável isoladamente.
export interface TotalsRow {
  turns: number
  agent_calls: number
  skill_calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
  agent_rounds: number
  parallel_rounds: number
  inline_explore_calls: number
}

// Soma os totais (incl. ratios de orquestração e cache) sobre as sessões de uma
// janela. Pura — recebe as rows do cache, não toca no DB.
export function computeTotals(rows: TotalsRow[]): MetricsTotals {
  const totals: MetricsTotals = {
    sessions: 0,
    turns: 0,
    agentCalls: 0,
    skillCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    cacheHitRate: 0,
    parallelizationRatio: 0,
    inlineDelegationRatio: 0,
  }
  let totalAgentRounds = 0
  let totalParallelRounds = 0
  let totalInlineExploreCalls = 0

  for (const row of rows) {
    totals.sessions += 1
    totals.turns += row.turns
    totals.agentCalls += row.agent_calls
    totals.skillCalls += row.skill_calls
    totals.inputTokens += row.input_tokens
    totals.outputTokens += row.output_tokens
    totals.cacheReadTokens += row.cache_read_tokens
    totals.cacheWriteTokens += row.cache_write_tokens
    totals.costUsd += row.cost_usd
    totalAgentRounds += row.agent_rounds
    totalParallelRounds += row.parallel_rounds
    totalInlineExploreCalls += row.inline_explore_calls
  }

  const cacheBase = totals.cacheReadTokens + totals.inputTokens
  totals.cacheHitRate = cacheBase > 0 ? totals.cacheReadTokens / cacheBase : 0
  totals.parallelizationRatio = totalAgentRounds > 0 ? totalParallelRounds / totalAgentRounds : 0
  const delegationBase = totals.agentCalls + totalInlineExploreCalls
  totals.inlineDelegationRatio = delegationBase > 0 ? totals.agentCalls / delegationBase : 0

  return totals
}

// Janela imediatamente anterior à corrente, p/ delta. 'all' não tem anterior.
// 7d → [now-14d, now-7d); 30d → [now-60d, now-30d).
export function previousWindowRange(
  window: MetricsWindow,
  now: number,
): { from: number; to: number } | null {
  if (window === 'all') return null
  const ms = (window === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000
  const to = now - ms
  return { from: to - ms, to }
}
