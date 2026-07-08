import { describe, expect, it } from 'vitest'

import { composeJobKickoff } from './job-kickoff'

// composeJobKickoff é PURO (só tipos, sem electron). Aqui cobrimos o delta de
// MÉTRICAS da Fase 2 (a tendência entre runs do web-audit). previousMetrics é a
// string JSON crua de getLastMetrics; best-effort: inválida → bloco omitido.

const METRICS = '{"lcp":3000,"ttfb":200,"consoleErrors":9,"networkFailures":1}'

describe('composeJobKickoff — delta de métricas', () => {
  it('web-audit com previousMetrics injeta a tendência com os valores', () => {
    const kickoff = composeJobKickoff({
      prompt: 'audite',
      kind: 'web-audit',
      targetUrl: 'https://app.legalstaging.lexter.ai',
      previousMetrics: METRICS,
    })
    expect(kickoff).toContain('Métricas da execução anterior')
    expect(kickoff).toContain('LCP=3000ms')
    expect(kickoff).toContain('TTFB=200ms')
    expect(kickoff).toContain('erros de console=9')
    expect(kickoff).toContain('falhas de rede=1')
  })

  it('critique NÃO injeta o bloco de métricas (só web-audit)', () => {
    const kickoff = composeJobKickoff({
      prompt: 'critique o código',
      kind: 'critique',
      previousMetrics: METRICS,
    })
    expect(kickoff).not.toContain('Métricas da execução anterior')
  })

  it('web-audit sem previousMetrics → sem bloco de métricas (1º run)', () => {
    const kickoff = composeJobKickoff({
      prompt: 'audite',
      kind: 'web-audit',
      targetUrl: 'https://app.legalstaging.lexter.ai',
    })
    expect(kickoff).not.toContain('Métricas da execução anterior')
  })

  it('previousMetrics malformado → bloco omitido, sem quebrar (best-effort)', () => {
    const kickoff = composeJobKickoff({
      prompt: 'audite',
      kind: 'web-audit',
      targetUrl: 'https://app.legalstaging.lexter.ai',
      previousMetrics: '{lcp: not json}',
    })
    expect(kickoff).not.toContain('Métricas da execução anterior')
  })

  it('métrica null vira n/d na linha de tendência', () => {
    const kickoff = composeJobKickoff({
      prompt: 'audite',
      kind: 'web-audit',
      targetUrl: 'https://app.legalstaging.lexter.ai',
      previousMetrics: '{"lcp":null,"ttfb":150,"consoleErrors":0,"networkFailures":0}',
    })
    expect(kickoff).toContain('LCP=n/d')
    expect(kickoff).toContain('TTFB=150ms')
  })
})
