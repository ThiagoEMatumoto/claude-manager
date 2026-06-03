import { describe, expect, it } from 'vitest'
import { computeDelta, formatDelta, formatPct, kpiStatus } from './orchestration-kpi'

describe('kpiStatus', () => {
  it('marca above quando valor >= alvo', () => {
    expect(kpiStatus(0.3, 0.3)).toBe('above')
    expect(kpiStatus(0.45, 0.4)).toBe('above')
  })

  it('marca below quando valor < alvo', () => {
    expect(kpiStatus(0.29, 0.3)).toBe('below')
    expect(kpiStatus(0, 0.4)).toBe('below')
  })
})

describe('computeDelta', () => {
  it('retorna null quando não há janela anterior', () => {
    expect(computeDelta(0.3, undefined)).toBeNull()
  })

  it('detecta alta', () => {
    const d = computeDelta(0.32, 0.28)
    expect(d).not.toBeNull()
    expect(d!.dir).toBe('up')
    expect(d!.abs).toBeCloseTo(0.04, 5)
  })

  it('detecta queda', () => {
    const d = computeDelta(0.2, 0.25)
    expect(d!.dir).toBe('down')
    expect(d!.abs).toBeCloseTo(-0.05, 5)
  })

  it('detecta estável dentro do epsilon', () => {
    const d = computeDelta(0.3, 0.3)
    expect(d!.dir).toBe('flat')
    expect(d!.abs).toBeCloseTo(0, 9)
  })
})

describe('formatPct', () => {
  it('formata razão como porcentagem com 1 casa', () => {
    expect(formatPct(0.156)).toBe('15.6%')
    expect(formatPct(0)).toBe('0.0%')
    expect(formatPct(1)).toBe('100.0%')
  })
})

describe('formatDelta', () => {
  it('usa pontos percentuais com sinal', () => {
    expect(formatDelta(computeDelta(0.32, 0.28)!)).toBe('+4.0 pp')
    expect(formatDelta(computeDelta(0.2, 0.25)!)).toBe('−5.0 pp')
    expect(formatDelta(computeDelta(0.3, 0.3)!)).toBe('0.0 pp')
  })
})
