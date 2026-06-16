import { describe, expect, it } from 'vitest'
import { bandFor, computeDelta, formatDelta, formatPct, kpiStatus } from './orchestration-kpi'

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

describe('bandFor', () => {
  // Thresholds canônicos (kz_dashboard health.py band_manager):
  // >=0.30 good | >=0.15 watch | <0.15 bad
  it('good na borda >= 0.30 e acima', () => {
    expect(bandFor(0.3).label).toBe('good')
    expect(bandFor(0.5).label).toBe('good')
  })

  it('watch na borda >= 0.15 e abaixo de 0.30', () => {
    expect(bandFor(0.15).label).toBe('watch')
    expect(bandFor(0.299).label).toBe('watch')
  })

  it('bad abaixo de 0.15', () => {
    expect(bandFor(0.149).label).toBe('bad')
    expect(bandFor(0).label).toBe('bad')
  })

  it('cada band tem um tone associado', () => {
    expect(bandFor(0.3).tone).toBe('good')
    expect(bandFor(0.2).tone).toBe('watch')
    expect(bandFor(0).tone).toBe('bad')
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
