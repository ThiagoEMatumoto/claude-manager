import { describe, it, expect } from 'vitest'
import {
  parseIcs,
  unfoldLines,
  parseIcsDate,
  extractMeetUrl,
} from './ics-parser'

// Fixture INLINE (sem rede): VEVENT canônico com a maioria das propriedades que
// nos interessam + um fold de linha RFC5545 na DESCRIPTION.
const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VEVENT',
  'UID:abc123@google.com',
  'DTSTART:20260620T143000Z',
  'DTEND:20260620T150000Z',
  'SUMMARY:Weekly sync com o time',
  'LOCATION:https://meet.google.com/abc-defg-hij',
  'DESCRIPTION:Pauta do dia\\nLinha 2 com vírgula\\, e ponto-e-vírgula\\; ok',
  'ORGANIZER;CN=Thiago:mailto:thiago@example.com',
  'ATTENDEE;CN=Ana:mailto:ana@example.com',
  'ATTENDEE;CN=Bob:mailto:bob@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('unfoldLines', () => {
  it('junta linhas dobradas (espaço líder) na anterior', () => {
    const raw = 'SUMMARY:Uma reunião\r\n  bem longa\r\nLOCATION:online'
    expect(unfoldLines(raw)).toEqual(['SUMMARY:Uma reunião bem longa', 'LOCATION:online'])
  })

  it('aceita TAB como continuação e LF puro', () => {
    const raw = 'DESCRIPTION:parte1\n\tparte2'
    expect(unfoldLines(raw)).toEqual(['DESCRIPTION:parte1parte2'])
  })
})

describe('parseIcsDate', () => {
  it('parseia UTC com Z', () => {
    expect(parseIcsDate('20260620T143000Z')).toBe(Date.UTC(2026, 5, 20, 14, 30, 0))
  })

  it('parseia all-day (VALUE=DATE) como meia-noite UTC', () => {
    expect(parseIcsDate('20260620')).toBe(Date.UTC(2026, 5, 20))
  })

  it('resolve TZID nomeada para o UTC correto', () => {
    // 14:30 em São Paulo (UTC-3) = 17:30Z.
    const got = parseIcsDate('20260620T143000', { TZID: 'America/Sao_Paulo' })
    expect(got).toBe(Date.UTC(2026, 5, 20, 17, 30, 0))
  })

  it('sem Z e sem TZID → trata como UTC (best-effort)', () => {
    expect(parseIcsDate('20260620T143000')).toBe(Date.UTC(2026, 5, 20, 14, 30, 0))
  })

  it('valor inválido → null', () => {
    expect(parseIcsDate('not-a-date')).toBeNull()
    expect(parseIcsDate('')).toBeNull()
  })
})

describe('extractMeetUrl', () => {
  it('acha o link na location', () => {
    expect(
      extractMeetUrl({
        location: 'https://meet.google.com/abc-defg-hij',
        description: null,
        url: null,
      }),
    ).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('acha o link na description quando location não tem', () => {
    expect(
      extractMeetUrl({
        location: 'Sala 3',
        description: 'Entre por https://meet.google.com/xyz-1234-pqr agora',
        url: null,
      }),
    ).toBe('https://meet.google.com/xyz-1234-pqr')
  })

  it('null quando não há link do Meet', () => {
    expect(
      extractMeetUrl({ location: 'Zoom', description: 'https://zoom.us/j/123', url: null }),
    ).toBeNull()
  })
})

describe('parseIcs', () => {
  it('extrai um VEVENT completo', () => {
    const events = parseIcs(SAMPLE)
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.uid).toBe('abc123@google.com')
    expect(e.summary).toBe('Weekly sync com o time')
    expect(e.startMs).toBe(Date.UTC(2026, 5, 20, 14, 30, 0))
    expect(e.endMs).toBe(Date.UTC(2026, 5, 20, 15, 0, 0))
    expect(e.meetUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('unescapa TEXT (\\n, \\, , \\;) na description', () => {
    const e = parseIcs(SAMPLE)[0]
    expect(e.description).toBe('Pauta do dia\nLinha 2 com vírgula, e ponto-e-vírgula; ok')
  })

  it('coleta organizer + attendees como e-mails puros, sem duplicar', () => {
    const e = parseIcs(SAMPLE)[0]
    expect(e.attendees).toEqual([
      'thiago@example.com',
      'ana@example.com',
      'bob@example.com',
    ])
  })

  it('parseia múltiplos VEVENTs e marca meetUrl null quando não há Meet', () => {
    const multi = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:1',
      'DTSTART:20260620T100000Z',
      'SUMMARY:Com Meet',
      'DESCRIPTION:link https://meet.google.com/aaa-bbbb-ccc',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:2',
      'DTSTART:20260620T110000Z',
      'SUMMARY:Sem Meet',
      'LOCATION:Sala física',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const events = parseIcs(multi)
    expect(events).toHaveLength(2)
    expect(events[0].meetUrl).toBe('https://meet.google.com/aaa-bbbb-ccc')
    expect(events[1].meetUrl).toBeNull()
  })

  it('feed vazio / sem VEVENT → []', () => {
    expect(parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual([])
    expect(parseIcs('')).toEqual([])
  })
})
