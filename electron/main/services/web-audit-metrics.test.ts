import { describe, expect, it } from 'vitest'

import { parseMetricsBlock } from './web-audit-metrics'

// Relatório real termina com um bloco ```json de métricas (ver webAuditPlaybook em
// job-kickoff.ts). O parser é best-effort: qualquer desvio → null (nunca lança, nunca
// quebra o run). Casos: bloco válido, ausente, malformado, múltiplos blocos (pega o
// último), e o footgun do zero (consoleErrors: 0 é valor VÁLIDO, não "falsy").

describe('parseMetricsBlock', () => {
  it('extrai um bloco ```json válido no fim do relatório', () => {
    const report = [
      '## Desempenho',
      '- LCP alto.',
      '',
      '```json',
      '{"lcp": 3832, "ttfb": 210, "consoleErrors": 9, "networkFailures": 0}',
      '```',
    ].join('\n')
    expect(parseMetricsBlock(report)).toEqual({
      lcp: 3832,
      ttfb: 210,
      consoleErrors: 9,
      networkFailures: 0,
    })
  })

  it('sem bloco ```json → null (best-effort, não quebra o run)', () => {
    expect(parseMetricsBlock('## Relatório\nnada de métricas aqui.')).toBeNull()
    expect(parseMetricsBlock('')).toBeNull()
    expect(parseMetricsBlock(null)).toBeNull()
    expect(parseMetricsBlock(undefined)).toBeNull()
  })

  it('bloco ```json malformado (JSON inválido) → null', () => {
    const report = ['```json', '{"lcp": 3832, ttfb: oops}', '```'].join('\n')
    expect(parseMetricsBlock(report)).toBeNull()
  })

  it('múltiplos blocos ```json → pega o ÚLTIMO', () => {
    const report = [
      '```json',
      '{"lcp": 100, "ttfb": 50, "consoleErrors": 1, "networkFailures": 1}',
      '```',
      'texto no meio',
      '```json',
      '{"lcp": 999, "ttfb": 88, "consoleErrors": 3, "networkFailures": 2}',
      '```',
    ].join('\n')
    expect(parseMetricsBlock(report)).toEqual({
      lcp: 999,
      ttfb: 88,
      consoleErrors: 3,
      networkFailures: 2,
    })
  })

  it('zero é valor VÁLIDO (não confundir com ausência)', () => {
    const report = ['```json', '{"lcp": 0, "ttfb": 0, "consoleErrors": 0, "networkFailures": 0}', '```'].join('\n')
    expect(parseMetricsBlock(report)).toEqual({
      lcp: 0,
      ttfb: 0,
      consoleErrors: 0,
      networkFailures: 0,
    })
  })

  it('null explícito é preservado; chaves ausentes viram null', () => {
    const report = ['```json', '{"lcp": 3000, "ttfb": null}', '```'].join('\n')
    expect(parseMetricsBlock(report)).toEqual({
      lcp: 3000,
      ttfb: null,
      consoleErrors: null,
      networkFailures: null,
    })
  })

  it('valores não-numéricos (string/NaN) são descartados para null', () => {
    const report = ['```json', '{"lcp": "fast", "ttfb": 210}', '```'].join('\n')
    expect(parseMetricsBlock(report)).toEqual({
      lcp: null,
      ttfb: 210,
      consoleErrors: null,
      networkFailures: null,
    })
  })

  it('bloco json sem NENHUMA métrica numérica válida → null', () => {
    const report = ['```json', '{"foo": 1, "bar": 2}', '```'].join('\n')
    expect(parseMetricsBlock(report)).toBeNull()
  })
})
