import { describe, expect, it } from 'vitest'
import {
  buildDigitKey,
  buildPlanKeys,
  findManualApproveIndex,
  playKeys,
} from './respond-keys'
import type { TuiMenu } from '../tui-menu-parser'

const DOWN = '\x1b[B'

describe('buildDigitKey', () => {
  it('turns a 0-based option index into the 1-based TUI digit', () => {
    expect(buildDigitKey(0)).toEqual(['1'])
    expect(buildDigitKey(2)).toEqual(['3'])
    expect(buildDigitKey(8)).toEqual(['9'])
  })

  it('fails closed outside the TUI digit handler range (1..9)', () => {
    expect(buildDigitKey(-1)).toEqual([])
    expect(buildDigitKey(9)).toEqual([])
    expect(buildDigitKey(1.5)).toEqual([])
  })

  it('never emits arrows or Enter (digit selects AND submits)', () => {
    const all = [buildDigitKey(0), buildDigitKey(4), buildDigitKey(8)].flat().join('')
    expect(all).not.toContain(DOWN)
    expect(all).not.toContain('\r')
  })
})

function planMenu(labels: string[]): TuiMenu {
  return {
    kind: 'plan',
    question: 'Would you like to proceed?',
    options: labels.map((label, index) => ({ index, label })),
    multiSelect: false,
  }
}

describe('findManualApproveIndex', () => {
  it('finds "Yes, manually approve edits" at any position', () => {
    expect(
      findManualApproveIndex(
        planMenu(['Yes, auto-accept edits', 'Yes, manually approve edits', 'No, keep planning']),
      ),
    ).toBe(1)
    expect(
      findManualApproveIndex(
        planMenu([
          'Yes, and bypass permissions',
          'Yes, auto-accept edits',
          'Yes, manually approve edits',
          'No, keep planning',
        ]),
      ),
    ).toBe(2)
  })

  it('never matches "Yes, auto-accept edits"', () => {
    expect(
      findManualApproveIndex(planMenu(['Yes, auto-accept edits', 'No, keep planning'])),
    ).toBeNull()
  })

  it('returns null for question menus', () => {
    const menu: TuiMenu = {
      kind: 'question',
      options: [{ index: 0, label: 'Yes, manually approve edits' }],
      multiSelect: false,
    }
    expect(findManualApproveIndex(menu)).toBeNull()
  })
})

describe('buildPlanKeys', () => {
  it('approves via the parsed manual-approve digit only', () => {
    expect(buildPlanKeys('approve', 1)).toEqual(['2'])
    expect(buildPlanKeys('approve', 2)).toEqual(['3'])
  })

  it('fails closed when the manual-approve option was not found', () => {
    expect(buildPlanKeys('approve', null)).toEqual([])
  })

  it('never approves with a blind Enter (would hit auto-accept edits)', () => {
    expect(buildPlanKeys('approve', 0).join('')).not.toContain('\r')
    expect(buildPlanKeys('approve', null).join('')).not.toContain('\r')
  })

  it('rejects with a single Esc (position-independent)', () => {
    expect(buildPlanKeys('reject', null)).toEqual(['\x1b'])
    expect(buildPlanKeys('reject', 1)).toEqual(['\x1b'])
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
