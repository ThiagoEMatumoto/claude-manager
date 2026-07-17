import { describe, expect, it } from 'vitest'
import { buildPlanKeys, buildQuestionKeys, playKeys } from './respond-keys'

const DOWN = '\x1b[B'

describe('buildQuestionKeys', () => {
  it('selects the first option with a plain Enter (initial highlight)', () => {
    expect(buildQuestionKeys(0)).toEqual(['\r'])
  })

  it('navigates N down then Enter for the Nth option', () => {
    expect(buildQuestionKeys(1)).toEqual([DOWN, '\r'])
    expect(buildQuestionKeys(2)).toEqual([DOWN, DOWN, '\r'])
    expect(buildQuestionKeys(4)).toEqual([DOWN, DOWN, DOWN, DOWN, '\r'])
  })
})

describe('buildPlanKeys', () => {
  it('approves with a single Enter (initial highlight = Yes)', () => {
    expect(buildPlanKeys('approve')).toEqual(['\r'])
  })

  it('rejects with a single Esc (position-independent)', () => {
    expect(buildPlanKeys('reject')).toEqual(['\x1b'])
  })

  it('never uses arrow keys (plan menu has a variable option count)', () => {
    expect(buildPlanKeys('approve').join('')).not.toContain(DOWN)
    expect(buildPlanKeys('reject').join('')).not.toContain(DOWN)
  })
})

describe('playKeys', () => {
  it('interleaves writes with sleeps between chunks (never before the first)', async () => {
    const log: string[] = []
    const sleep = (ms: number) => {
      log.push(`sleep:${ms}`)
      return Promise.resolve()
    }
    await playKeys([DOWN, DOWN, '\r'], (s) => log.push(s), 30, sleep)
    expect(log).toEqual([DOWN, 'sleep:30', DOWN, 'sleep:30', '\r'])
  })

  it('writes a single sequence without sleeping', async () => {
    const log: string[] = []
    await playKeys(['\r'], (s) => log.push(s), 30, (ms) => {
      log.push(`sleep:${ms}`)
      return Promise.resolve()
    })
    expect(log).toEqual(['\r'])
  })

  it('does nothing for an empty list', async () => {
    const writes: string[] = []
    await playKeys([], (s) => writes.push(s), 30, () => Promise.resolve())
    expect(writes).toEqual([])
  })
})
