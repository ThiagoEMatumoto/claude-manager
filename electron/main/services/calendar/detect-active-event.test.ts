import { describe, it, expect } from 'vitest'
import { parseIcs } from './ics-parser'
import { findActiveMeetEvents, dedupeKey, DEFAULT_WINDOW_MS } from './detect-active-event'

// Helper: monta um ICS com 1 VEVENT a partir de overrides, sem rede.
function ics(opts: {
  uid?: string
  startMs: number
  summary?: string
  withMeet?: boolean
}): string {
  const dt = new Date(opts.startMs)
  const stamp = dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `UID:${opts.uid ?? 'uid-1'}`,
    `DTSTART:${stamp}`,
    `SUMMARY:${opts.summary ?? 'Reunião'}`,
    opts.withMeet ?? true
      ? 'LOCATION:https://meet.google.com/abc-defg-hij'
      : 'LOCATION:Sala física',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

const NOW = Date.UTC(2026, 5, 20, 14, 30, 0)

describe('findActiveMeetEvents', () => {
  it('detecta evento começando AGORA com Meet (dentro da janela ±2min)', () => {
    const events = parseIcs(ics({ startMs: NOW + 60_000 }))
    const found = findActiveMeetEvents(events, NOW)
    expect(found).toHaveLength(1)
    expect(found[0].event.meetUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('inclui o evento exatamente no limite da janela e exclui logo além', () => {
    const onEdge = parseIcs(ics({ startMs: NOW + DEFAULT_WINDOW_MS }))
    expect(findActiveMeetEvents(onEdge, NOW)).toHaveLength(1)

    const justPast = parseIcs(ics({ startMs: NOW + DEFAULT_WINDOW_MS + 1000 }))
    expect(findActiveMeetEvents(justPast, NOW)).toHaveLength(0)
  })

  it('detecta evento que começou há pouco (lado negativo da janela)', () => {
    const events = parseIcs(ics({ startMs: NOW - 90_000 }))
    expect(findActiveMeetEvents(events, NOW)).toHaveLength(1)
  })

  it('ignora evento na janela mas SEM link do Meet', () => {
    const events = parseIcs(ics({ startMs: NOW, withMeet: false }))
    expect(findActiveMeetEvents(events, NOW)).toHaveLength(0)
  })

  it('ignora evento com Meet mas fora da janela', () => {
    const events = parseIcs(ics({ startMs: NOW + 30 * 60_000 }))
    expect(findActiveMeetEvents(events, NOW)).toHaveLength(0)
  })

  it('ordena pelo início mais próximo de now primeiro', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:far',
      `DTSTART:${new Date(NOW + 110_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      'SUMMARY:Mais longe',
      'LOCATION:https://meet.google.com/far-far-far',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:near',
      `DTSTART:${new Date(NOW + 10_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      'SUMMARY:Mais perto',
      'LOCATION:https://meet.google.com/nea-rnea-rne',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const found = findActiveMeetEvents(parseIcs(raw), NOW)
    expect(found.map((f) => f.event.uid)).toEqual(['near', 'far'])
  })
})

describe('dedupeKey', () => {
  it('é estável pro mesmo UID + start, e distinto pra outra ocorrência', () => {
    const a = parseIcs(ics({ uid: 'x', startMs: NOW }))[0]
    const a2 = parseIcs(ics({ uid: 'x', startMs: NOW }))[0]
    const b = parseIcs(ics({ uid: 'x', startMs: NOW + 86_400_000 }))[0]
    expect(dedupeKey(a)).toBe(dedupeKey(a2))
    expect(dedupeKey(a)).not.toBe(dedupeKey(b))
  })

  it('cai pro summary+meetUrl quando não há UID', () => {
    const e = parseIcs(
      ['BEGIN:VEVENT', 'DTSTART:20260620T143000Z', 'SUMMARY:S', 'LOCATION:https://meet.google.com/aaa-bbbb-ccc', 'END:VEVENT'].join('\r\n'),
    )[0]
    expect(dedupeKey(e)).toContain('S|https://meet.google.com/aaa-bbbb-ccc')
  })
})
