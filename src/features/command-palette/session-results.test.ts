import { describe, expect, it } from 'vitest'
import {
  capByGroup,
  GARAGE_GROUP as ENDED_SESSIONS_GROUP,
  SESSION_GROUP_CAPS,
  WAITING_GROUP as LIVE_SESSIONS_GROUP,
} from './session-results'

function items(group: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ group, id: `${group}-${i}` }))
}

describe('capByGroup', () => {
  it('caps live sessions at 8 and ended at 5, keeping the first of each group', () => {
    const list = [...items(LIVE_SESSIONS_GROUP, 12), ...items(ENDED_SESSIONS_GROUP, 9)]
    const out = capByGroup(list, SESSION_GROUP_CAPS)
    expect(out.filter((i) => i.group === LIVE_SESSIONS_GROUP)).toHaveLength(8)
    expect(out.filter((i) => i.group === ENDED_SESSIONS_GROUP)).toHaveLength(5)
    // Corte mantém os primeiros (que chegam ordenados por urgência).
    expect(out[0].id).toBe(`${LIVE_SESSIONS_GROUP}-0`)
  })

  it('leaves groups without cap untouched', () => {
    const list = [...items('Ações', 20), ...items(LIVE_SESSIONS_GROUP, 3)]
    const out = capByGroup(list, SESSION_GROUP_CAPS)
    expect(out).toHaveLength(23)
  })

  it('preserves relative order of surviving items', () => {
    const list = [
      { group: 'Ações', id: 'a' },
      ...items(LIVE_SESSIONS_GROUP, 10),
      { group: 'Projetos', id: 'p' },
    ]
    const out = capByGroup(list, SESSION_GROUP_CAPS)
    expect(out[0].id).toBe('a')
    expect(out[out.length - 1].id).toBe('p')
  })
})
