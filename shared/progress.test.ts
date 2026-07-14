import { describe, expect, it } from 'vitest'
import {
  computeFeatureProgress,
  computeProgress,
  computeTaskRollup,
  featureProgressChild,
  objectiveProgressTone,
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

  it('excludes an unmeasured child (null progress) from numerator AND denominator', () => {
    // Regra única de null (Onda 0): antes um child null contava como 0 falso
    // e ainda ocupava o denominador (75/(1+1)=37.5 seria o resultado antigo).
    // Agora ele sai do rollup — só o child medido conta.
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(null, 1), child(100, 1)]),
    ).toBe(100)
  })

  it('returns null when every child is unmeasured', () => {
    expect(
      computeProgress(input({ progressMode: 'auto_rollup' }), [child(null, 1), child(null, 2)]),
    ).toBeNull()
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

  it('without tasks: done → 100, pending (never started) → null, started statuses → 0', () => {
    // Regra única de null (Onda 0): 'pending' nunca começou → indeterminado,
    // fora do rollup do pai. in-progress/blocked/paused já começaram → 0
    // explícito em vez de sumir do denominador.
    expect(computeFeatureProgress('done', [])).toBe(100)
    expect(computeFeatureProgress('pending', [])).toBeNull()
    expect(computeFeatureProgress('in-progress', [])).toBe(0)
    expect(computeFeatureProgress('blocked', [])).toBe(0)
    expect(computeFeatureProgress('paused', [])).toBe(0)
  })

  it('all-cancelled tasks fall back to the status rule', () => {
    expect(computeFeatureProgress('done', ['cancelled'])).toBe(100)
    expect(computeFeatureProgress('in-progress', ['cancelled'])).toBe(0)
    expect(computeFeatureProgress('pending', ['cancelled'])).toBeNull()
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

  it('returns null (out of the rollup) only for a never-started feature (pending, no tasks)', () => {
    expect(featureProgressChild(feature('pending'), [])).toBeNull()
  })

  it('counts a started feature without measurable tasks as 0, still in the rollup', () => {
    // in-progress/blocked/paused já começaram: sem tasks (ou só cancelled)
    // conta como 0 em vez de sumir do denominador (regra única de null).
    expect(featureProgressChild(feature('in-progress'), ['cancelled'])).toEqual({
      status: 'active',
      weight: null,
      progress: 0,
    })
    expect(featureProgressChild(feature('blocked'), [])?.progress).toBe(0)
    expect(featureProgressChild(feature('paused'), [])?.progress).toBe(0)
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

  it('unified null rule: an unmeasured KR-like child and a never-started feature both leave the rollup, a started-empty feature counts as 0', () => {
    // Simula o mix real de um objetivo: um KR sem measurement (progress null,
    // vindo direto de keyResultProgress), uma feature nunca iniciada (fora) e
    // uma feature já iniciada sem tasks (conta 0) ao lado de um KR medido.
    const unmeasuredKr: ProgressChild = { status: 'active', weight: 1, progress: null }
    const measuredKr: ProgressChild = { status: 'active', weight: 1, progress: 80 }
    const children: ProgressChild[] = [
      unmeasuredKr,
      measuredKr,
      featureProgressChild({ status: 'pending', archivedAt: null }, []), // nunca iniciada → fora
      featureProgressChild({ status: 'in-progress', archivedAt: null }, []), // iniciada, sem tasks → 0
    ].filter((c): c is ProgressChild => c !== null)
    // Fora do rollup: unmeasuredKr (null) e a feature pending (null). Contam:
    // measuredKr (80) e a feature in-progress vazia (0) → média 40.
    expect(computeProgress(input({ progressMode: 'auto_rollup' }), children)).toBe(40)
  })
})

describe('objectiveProgressTone', () => {
  const DAY = 24 * 60 * 60 * 1000
  const start = 0
  const end = 100 * DAY
  const now = 50 * DAY // 50% do prazo decorrido

  it('returns accent without endDate or startDate', () => {
    expect(objectiveProgressTone({ progress: 10, startDate: null, endDate: end }, now)).toBe('accent')
    expect(objectiveProgressTone({ progress: 10, startDate: start, endDate: null }, now)).toBe('accent')
  })

  it('returns accent when progress is indeterminate', () => {
    expect(objectiveProgressTone({ progress: null, startDate: start, endDate: end }, now)).toBe('accent')
  })

  it('returns accent when on schedule or ahead', () => {
    expect(objectiveProgressTone({ progress: 50, startDate: start, endDate: end }, now)).toBe('accent')
    expect(objectiveProgressTone({ progress: 90, startDate: start, endDate: end }, now)).toBe('accent')
  })

  it('returns warning when more than 15 points behind schedule', () => {
    expect(objectiveProgressTone({ progress: 34, startDate: start, endDate: end }, now)).toBe('warning')
  })

  it('returns danger when more than 30 points behind schedule', () => {
    expect(objectiveProgressTone({ progress: 19, startDate: start, endDate: end }, now)).toBe('danger')
  })

  it('returns accent for an invalid interval (endDate <= startDate)', () => {
    expect(objectiveProgressTone({ progress: 0, startDate: end, endDate: start }, now)).toBe('accent')
  })
})
