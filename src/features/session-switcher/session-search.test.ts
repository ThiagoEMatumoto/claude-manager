import { describe, expect, it } from 'vitest'
import { matchesSession, sessionSearchText, sortByUrgency } from './session-search'
import type { LiveSessionInfo, Repo } from '../../../shared/types/ipc'

function session(overrides: Partial<LiveSessionInfo> = {}): LiveSessionInfo {
  return {
    id: 'id-1',
    ccSessionId: 'cc-1',
    name: null,
    title: null,
    status: 'idle',
    repo: null,
    projectName: null,
    projectIcon: null,
    projectColor: null,
    lastActivityAt: null,
    lastText: null,
    ...overrides,
  }
}

const repo = { id: 'r1', label: 'legal-core' } as Repo

describe('matchesSession', () => {
  it('matches by title, name, projectName and repo label', () => {
    const s = session({
      title: 'Fix auth redirect',
      name: 'auth-fix',
      projectName: 'Prognósticos',
      repo,
    })
    expect(matchesSession('redirect', s)).toBe(true)
    expect(matchesSession('auth-fix', s)).toBe(true)
    expect(matchesSession('legal-core', s)).toBe(true)
    expect(matchesSession('nada-a-ver', s)).toBe(false)
  })

  it('is case and accent insensitive', () => {
    const s = session({ projectName: 'Prognósticos' })
    expect(matchesSession('prognosticos', s)).toBe(true)
    expect(matchesSession('PROGNÓSTICOS', s)).toBe(true)
  })

  it('empty query matches everything', () => {
    expect(matchesSession('', session())).toBe(true)
  })
})

describe('sessionSearchText', () => {
  it('joins fields with newline so queries do not match across field boundaries', () => {
    const s = session({ title: 'foo', name: 'bar', projectName: 'baz', repo })
    expect(sessionSearchText(s)).toBe('foo\nbar\nbaz\nlegal-core')
  })

  it('skips empty fields', () => {
    expect(sessionSearchText(session({ title: 'só título' }))).toBe('só título')
  })
})

describe('sortByUrgency', () => {
  it('orders waiting > working/starting > idle, stable within rank', () => {
    const items = [
      session({ ccSessionId: 'a', status: 'idle' }),
      session({ ccSessionId: 'b', status: 'working' }),
      session({ ccSessionId: 'c', status: 'waiting' }),
      session({ ccSessionId: 'd', status: 'starting' }),
      session({ ccSessionId: 'e', status: 'waiting' }),
    ]
    expect(sortByUrgency(items).map((s) => s.ccSessionId)).toEqual(['c', 'e', 'b', 'd', 'a'])
  })

  it('does not mutate the input array', () => {
    const items = [session({ status: 'idle' }), session({ status: 'waiting' })]
    sortByUrgency(items)
    expect(items[0].status).toBe('idle')
  })
})
