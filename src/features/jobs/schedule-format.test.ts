import { describe, expect, it } from 'vitest'
import { formatSchedule } from './schedule-format'

describe('formatSchedule', () => {
  it('interval', () => {
    expect(formatSchedule({ type: 'interval', hours: 6 })).toBe('A cada 6h')
    expect(formatSchedule({ type: 'interval', hours: 24 })).toBe('A cada 24h')
    // hours < 1 é clampado pra 1 (mesma invariante de computeNextRunAt).
    expect(formatSchedule({ type: 'interval', hours: 0.5 })).toBe('A cada 1h')
  })

  it('daily zero-pads horas e minutos', () => {
    expect(formatSchedule({ type: 'daily', hour: 9, minute: 0 })).toBe('Todo dia 09:00')
    expect(formatSchedule({ type: 'daily', hour: 18, minute: 30 })).toBe('Todo dia 18:30')
  })

  it('weekly nomeia o dia da semana (0=domingo)', () => {
    expect(formatSchedule({ type: 'weekly', dayOfWeek: 1, hour: 9, minute: 0 })).toBe(
      'Toda segunda 09:00',
    )
    expect(formatSchedule({ type: 'weekly', dayOfWeek: 0, hour: 8, minute: 5 })).toBe(
      'Toda domingo 08:05',
    )
  })
})
