import { describe, expect, it } from 'vitest'
import {
  isDraftFeature,
  isListedFeature,
  stalledDays,
  STALLED_THRESHOLD_DAYS,
} from './feature-visibility'

describe('isDraftFeature', () => {
  it('auto-criada sem registros é rascunho', () => {
    expect(isDraftFeature('auto', 0)).toBe(true)
  })

  it('auto-criada com 1+ registros deixa de ser rascunho', () => {
    expect(isDraftFeature('auto', 1)).toBe(false)
    expect(isDraftFeature('auto', 5)).toBe(false)
  })

  it('manual nunca é rascunho, mesmo sem registros', () => {
    expect(isDraftFeature('manual', 0)).toBe(false)
    expect(isDraftFeature('manual', 3)).toBe(false)
  })
})

describe('isListedFeature', () => {
  it('manual sem registros aparece (não é rascunho)', () => {
    expect(isListedFeature('manual', 0, null)).toBe(true)
  })

  it('rascunho fica fora da listagem padrão', () => {
    expect(isListedFeature('auto', 0, null)).toBe(false)
  })

  it('auto com registro aparece', () => {
    expect(isListedFeature('auto', 1, null)).toBe(true)
  })

  it('arquivada fica fora independente de origin/registros', () => {
    expect(isListedFeature('manual', 4, 123)).toBe(false)
    expect(isListedFeature('auto', 0, 123)).toBe(false)
  })
})

describe('stalledDays', () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = Date.UTC(2026, 5, 10)

  it('in-progress sem atividade há mais de 14 dias está parada', () => {
    expect(stalledDays('in-progress', NOW - 15 * DAY, NOW)).toBe(15)
    expect(stalledDays('blocked', NOW - 30 * DAY, NOW)).toBe(30)
  })

  it('atividade dentro do limiar não marca parada (14d é o limite, exclusivo)', () => {
    expect(stalledDays('in-progress', NOW - STALLED_THRESHOLD_DAYS * DAY, NOW)).toBeNull()
    expect(stalledDays('in-progress', NOW - 2 * DAY, NOW)).toBeNull()
  })

  it('só se aplica a in-progress/blocked', () => {
    expect(stalledDays('pending', NOW - 60 * DAY, NOW)).toBeNull()
    expect(stalledDays('done', NOW - 60 * DAY, NOW)).toBeNull()
    expect(stalledDays('paused', NOW - 60 * DAY, NOW)).toBeNull()
  })
})
