import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { MetricsTotals } from '../../../shared/types/ipc'
import { AgentOrchestrationMetrics } from './AgentOrchestrationMetrics'

function makeTotals(overrides: Partial<MetricsTotals> = {}): MetricsTotals {
  return {
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
    ...overrides,
  }
}

describe('AgentOrchestrationMetrics', () => {
  it('valor abaixo da meta usa cor de danger', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.1 })}
        subagentTypeDistribution={[]}
      />,
    )
    const value = screen.getAllByTestId('kpi-value')[0]
    expect(value.style.color).toContain('--color-danger')
  })

  it('valor acima/igual à meta usa cor de success', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.3 })}
        subagentTypeDistribution={[]}
      />,
    )
    const value = screen.getAllByTestId('kpi-value')[0]
    expect(value.style.color).toContain('--color-success')
  })

  it('com previousTotals menor que o atual mostra chip de delta para cima', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.2 })}
        previousTotals={makeTotals({ parallelizationRatio: 0.1 })}
        subagentTypeDistribution={[]}
      />,
    )
    const delta = screen.getAllByTestId('kpi-delta')[0]
    expect(delta.textContent).toContain('▲')
    expect(delta.textContent).toContain('pp')
  })

  it('sem previousTotals não renderiza chip de delta', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.2 })}
        subagentTypeDistribution={[]}
      />,
    )
    expect(screen.queryByTestId('kpi-delta')).toBeNull()
  })

  it('exibe a meta do KPI', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.2 })}
        subagentTypeDistribution={[]}
      />,
    )
    const target = screen.getAllByTestId('kpi-target')[0]
    expect(target.textContent).toContain('Meta >')
  })

  it('marca o baseline no track', () => {
    render(
      <AgentOrchestrationMetrics
        totals={makeTotals({ parallelizationRatio: 0.2 })}
        subagentTypeDistribution={[]}
      />,
    )
    expect(screen.getAllByTestId('kpi-baseline-marker').length).toBeGreaterThan(0)
  })
})
