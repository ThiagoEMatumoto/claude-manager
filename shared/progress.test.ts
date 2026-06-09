import { describe, expect, it } from 'vitest'
import {
  computeProgress,
  computeTaskRollup,
  taskProgressChild,
  type ProgressChild,
  type ProgressInput,
} from './progress'

function input(overrides: Partial<ProgressInput>): ProgressInput {
  return {
    progressMode: 'manual',
    progressManual: null,
    baseline: null,
    current: null,
    target: null,
    direction: null,
    ...overrides,
  }
}

describe('computeProgress — manual', () => {
  it('returns progressManual as-is when in range', () => {
    expect(computeProgress(input({ progressMode: 'manual', progressManual: 42 }))).toBe(42)
  })

  it('clamps progressManual to 0–100', () => {
    expect(computeProgress(input({ progressMode: 'manual', progressManual: 150 }))).toBe(100)
    expect(computeProgress(input({ progressMode: 'manual', progressManual: -10 }))).toBe(0)
  })

  it('returns null when progressManual is absent', () => {
    expect(computeProgress(input({ progressMode: 'manual', progressManual: null }))).toBeNull()
  })
})

describe('computeProgress — metric', () => {
  it('increase: (current−baseline)/(target−baseline)·100', () => {
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'increase', baseline: 0, current: 50, target: 100 }),
      ),
    ).toBe(50)
  })

  it('decrease: (baseline−current)/(baseline−target)·100', () => {
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'decrease', baseline: 200, current: 150, target: 100 }),
      ),
    ).toBe(50)
  })

  it('clamps to 0–100 (overshoot and regression)', () => {
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'increase', baseline: 0, current: 120, target: 100 }),
      ),
    ).toBe(100)
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'increase', baseline: 50, current: 20, target: 100 }),
      ),
    ).toBe(0)
  })

  it('returns null when target === baseline (division by zero)', () => {
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'increase', baseline: 100, current: 100, target: 100 }),
      ),
    ).toBeNull()
  })

  it('returns null when a metric field is missing', () => {
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: 'increase', baseline: 0, current: null, target: 100 }),
      ),
    ).toBeNull()
    expect(
      computeProgress(
        input({ progressMode: 'metric', direction: null, baseline: 0, current: 50, target: 100 }),
      ),
    ).toBeNull()
  })

  it('maintain: 100 when current === target, 0 when it differs, null when missing', () => {
    expect(
      computeProgress(input({ progressMode: 'metric', direction: 'maintain', current: 10, target: 10 })),
    ).toBe(100)
    expect(
      computeProgress(input({ progressMode: 'metric', direction: 'maintain', current: 9, target: 10 })),
    ).toBe(0)
    expect(
      computeProgress(input({ progressMode: 'metric', direction: 'maintain', current: null, target: 10 })),
    ).toBeNull()
  })
})

describe('computeProgress — auto_rollup', () => {
  const child = (progress: number | null, weight: number | null = 1, status: ProgressChild['status'] = 'active'): ProgressChild => ({
    status,
    weight,
    progress,
  })

  it('returns null without children (phase 1: no task fallback)', () => {
    expect(computeProgress(input({ progressMode: 'auto_rollup' }))).toBeNull()
    expect(computeProgress(input({ progressMode: 'auto_rollup' }), [])).toBeNull()
  })

  it('weighted average (weights 1 and 3)', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(100, 1), child(0, 3)]),
    ).toBe(25)
  })

  it('excludes cancelled children from the denominator', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [
        child(100, 1),
        child(0, 1, 'cancelled'),
      ]),
    ).toBe(100)
  })

  it('returns null when all children are cancelled', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(100, 1, 'cancelled')]),
    ).toBeNull()
  })

  it('counts a child with null progress as 0', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(null, 1), child(100, 1)]),
    ).toBe(50)
  })

  it('defaults weight to 1 when null', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(100, null), child(0, 1)]),
    ).toBe(50)
  })
})

describe('taskProgressChild', () => {
  it('maps done to 100 and any other status to 0, preserving the status', () => {
    expect(taskProgressChild('done')).toEqual({ status: 'done', weight: null, progress: 100 })
    expect(taskProgressChild('todo').progress).toBe(0)
    expect(taskProgressChild('in_progress').progress).toBe(0)
    expect(taskProgressChild('blocked').progress).toBe(0)
    expect(taskProgressChild('cancelled').status).toBe('cancelled')
  })
})

describe('computeTaskRollup', () => {
  it('returns the % of done tasks', () => {
    expect(computeTaskRollup(['done', 'todo', 'done', 'todo'])).toBe(50)
    expect(computeTaskRollup(['done', 'done'])).toBe(100)
  })

  it('excludes cancelled tasks from the denominator', () => {
    expect(computeTaskRollup(['done', 'cancelled'])).toBe(100)
    expect(computeTaskRollup(['todo', 'cancelled', 'done'])).toBe(50)
  })

  it('returns null for an empty list or all-cancelled list', () => {
    expect(computeTaskRollup([])).toBeNull()
    expect(computeTaskRollup(['cancelled', 'cancelled'])).toBeNull()
  })

  it('counts blocked and in_progress as 0', () => {
    expect(computeTaskRollup(['done', 'blocked', 'in_progress', 'todo'])).toBe(25)
  })
})
