import { describe, expect, it } from 'vitest'
import { formatRelative, shortenAgentName, statusDotView } from './status-view'

describe('statusDotView', () => {
  it('working → accent label with pulse', () => {
    expect(statusDotView('working')).toEqual({
      label: 'Trabalhando',
      className: 'text-[var(--color-accent)]',
      pulse: true,
    })
  })

  it('waiting → warning label', () => {
    expect(statusDotView('waiting')).toEqual({
      label: 'Aguardando você',
      className: 'text-[var(--color-warning)]',
    })
  })

  it('idle/starting/ended → dim label', () => {
    expect(statusDotView('idle').label).toBe('Ocioso')
    expect(statusDotView('starting')).toMatchObject({ label: 'Iniciando', pulse: true })
    expect(statusDotView('ended').label).toBe('Encerrada')
    for (const s of ['idle', 'starting', 'ended'] as const) {
      expect(statusDotView(s).className).toBe('text-[var(--color-text-dim)]')
    }
  })

  it('undefined → generic Running (success)', () => {
    expect(statusDotView(undefined)).toEqual({
      label: 'Running',
      className: 'text-[var(--color-success)]',
    })
  })
})

describe('formatRelative', () => {
  it('seconds under a minute', () => {
    expect(formatRelative(5_000)).toBe('há 5s')
    expect(formatRelative(0)).toBe('há 0s')
    expect(formatRelative(-2_000)).toBe('há 0s')
  })

  it('minutes under an hour', () => {
    expect(formatRelative(90_000)).toBe('há 2min')
    expect(formatRelative(60_000)).toBe('há 1min')
  })

  it('hours beyond that', () => {
    expect(formatRelative(3 * 3600_000)).toBe('há 3h')
  })
})

describe('shortenAgentName', () => {
  it('strips plugin prefix', () => {
    expect(shortenAgentName('kaizen-workflow:kz-implementer')).toBe('kz-implementer')
  })

  it('keeps plain names', () => {
    expect(shortenAgentName('Explore')).toBe('Explore')
    expect(shortenAgentName('general-purpose')).toBe('general-purpose')
  })

  it('falls back to the full name when the suffix is empty', () => {
    expect(shortenAgentName('weird:')).toBe('weird:')
  })
})
