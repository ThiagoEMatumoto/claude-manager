import { describe, expect, it } from 'vitest'
import {
  computeFeatureProgress,
  computeProgress,
  computeTaskRollup,
  featureProgressChild,
  taskProgressChild,
  type FeatureRollupSource,
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

describe('computeFeatureProgress', () => {
  it('returns the % of done tasks when the feature has tasks', () => {
    expect(computeFeatureProgress('in-progress', ['done', 'todo'])).toBe(50)
    expect(computeFeatureProgress('pending', ['done', 'done'])).toBe(100)
  })

  it('task rollup wins over the feature status when tasks exist', () => {
    // Feature done com tarefas pendentes reflete as tarefas, não o status.
    expect(computeFeatureProgress('done', ['todo', 'todo'])).toBe(0)
  })

  it('without tasks: done → 100, any other status → null', () => {
    expect(computeFeatureProgress('done', [])).toBe(100)
    expect(computeFeatureProgress('pending', [])).toBeNull()
    expect(computeFeatureProgress('in-progress', [])).toBeNull()
    expect(computeFeatureProgress('blocked', [])).toBeNull()
    expect(computeFeatureProgress('paused', [])).toBeNull()
  })

  it('all-cancelled tasks fall back to the status rule', () => {
    expect(computeFeatureProgress('done', ['cancelled'])).toBe(100)
    expect(computeFeatureProgress('in-progress', ['cancelled'])).toBeNull()
  })
})

describe('featureProgressChild', () => {
  const feature = (
    status: FeatureRollupSource['status'],
    archivedAt: number | null = null,
  ): FeatureRollupSource => ({ status, archivedAt })

  it('maps an eligible feature to a weight-1 non-cancelled child', () => {
    expect(featureProgressChild(feature('in-progress'), ['done', 'todo'])).toEqual({
      status: 'active',
      weight: null,
      progress: 50,
    })
    expect(featureProgressChild(feature('done'), [])?.progress).toBe(100)
  })

  it('returns null (out of the rollup) when progress is indeterminate', () => {
    expect(featureProgressChild(feature('pending'), [])).toBeNull()
    expect(featureProgressChild(feature('in-progress'), ['cancelled'])).toBeNull()
  })

  it('returns null for an archived feature even with done tasks', () => {
    expect(featureProgressChild(feature('done', 123), ['done'])).toBeNull()
  })
})

describe('auto_rollup mixing tasks and features', () => {
  it('averages task and feature children with weight 1 each', () => {
    const children: ProgressChild[] = [
      taskProgressChild('done'), // 100
      taskProgressChild('todo'), // 0
      featureProgressChild({ status: 'in-progress', archivedAt: null }, ['done', 'done']), // 100
    ].filter((c): c is ProgressChild => c !== null)
    expect(computeProgress(input({ progressMode: 'auto_rollup' }), children)).toBe(
      (100 + 0 + 100) / 3,
    )
  })

  it('indeterminate and archived features stay out of the denominator', () => {
    const children: ProgressChild[] = [
      taskProgressChild('done'), // 100
      featureProgressChild({ status: 'pending', archivedAt: null }, []), // null → fora
      featureProgressChild({ status: 'done', archivedAt: 1 }, ['done']), // arquivada → fora
    ].filter((c): c is ProgressChild => c !== null)
    expect(computeProgress(input({ progressMode: 'auto_rollup' }), children)).toBe(100)
  })
})
