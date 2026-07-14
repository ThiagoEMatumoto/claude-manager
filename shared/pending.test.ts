import { describe, expect, it } from 'vitest'
import {
  classifyDue,
  comparePendingTasks,
  isPendingStatus,
  selectStoppedAutoTasks,
  sortPendingTasks,
  startOfLocalDay,
  STOPPED_AUTO_TASK_MS,
  type PendingOrderInput,
  type StoppedAutoTaskInput,
} from './pending'
import type { TaskStatus } from './types/ipc'

function task(overrides: Partial<PendingOrderInput>): PendingOrderInput {
  return { priority: null, dueDate: null, position: 0, ...overrides }
}

describe('isPendingStatus', () => {
  it('treats todo/in_progress/blocked as pending', () => {
    expect(isPendingStatus('todo')).toBe(true)
    expect(isPendingStatus('in_progress')).toBe(true)
    expect(isPendingStatus('blocked')).toBe(true)
  })

  it('treats done/cancelled as not pending', () => {
    expect(isPendingStatus('done')).toBe(false)
    expect(isPendingStatus('cancelled')).toBe(false)
  })
})

describe('comparePendingTasks / sortPendingTasks', () => {
  it('orders by priority high > medium > low > null', () => {
    const sorted = sortPendingTasks([
      task({ priority: null, position: 1 }),
      task({ priority: 'low', position: 2 }),
      task({ priority: 'high', position: 3 }),
      task({ priority: 'medium', position: 4 }),
    ])
    expect(sorted.map((t) => t.priority)).toEqual(['high', 'medium', 'low', null])
  })

  it('breaks priority ties by dueDate asc with null last', () => {
    const sorted = sortPendingTasks([
      task({ priority: 'high', dueDate: null, position: 1 }),
      task({ priority: 'high', dueDate: 2000, position: 2 }),
      task({ priority: 'high', dueDate: 1000, position: 3 }),
    ])
    expect(sorted.map((t) => t.dueDate)).toEqual([1000, 2000, null])
  })

  it('breaks dueDate ties by position asc', () => {
    const sorted = sortPendingTasks([
      task({ priority: 'medium', dueDate: 1000, position: 5 }),
      task({ priority: 'medium', dueDate: 1000, position: 2 }),
    ])
    expect(sorted.map((t) => t.position)).toEqual([2, 5])
  })

  it('priority dominates dueDate (overdue low priority stays after high)', () => {
    const sorted = sortPendingTasks([
      task({ priority: 'low', dueDate: 1, position: 1 }),
      task({ priority: 'high', dueDate: null, position: 2 }),
    ])
    expect(sorted.map((t) => t.priority)).toEqual(['high', 'low'])
  })

  it('does not mutate the input array', () => {
    const input = [task({ priority: 'low' }), task({ priority: 'high' })]
    sortPendingTasks(input)
    expect(input.map((t) => t.priority)).toEqual(['low', 'high'])
  })

  it('compare is consistent for equal tasks', () => {
    const a = task({ priority: 'medium', dueDate: 1000, position: 1 })
    expect(comparePendingTasks(a, { ...a })).toBe(0)
  })
})

describe('classifyDue', () => {
  // Meio-dia local de um dia arbitrário — fronteiras derivadas em horário local.
  const now = new Date(2026, 5, 9, 12, 0, 0).getTime()
  const dayStart = startOfLocalDay(now)

  it('returns none without dueDate', () => {
    expect(classifyDue(null, now)).toBe('none')
  })

  it('classifies before the start of the local day as overdue', () => {
    expect(classifyDue(dayStart - 1, now)).toBe('overdue')
    expect(classifyDue(new Date(2026, 5, 8, 23, 59).getTime(), now)).toBe('overdue')
  })

  it('classifies within the current local day as today', () => {
    expect(classifyDue(dayStart, now)).toBe('today')
    expect(classifyDue(now, now)).toBe('today')
    expect(classifyDue(new Date(2026, 5, 9, 23, 59, 59).getTime(), now)).toBe('today')
  })

  it('classifies from the next local day on as upcoming', () => {
    expect(classifyDue(new Date(2026, 5, 10, 0, 0).getTime(), now)).toBe('upcoming')
    expect(classifyDue(new Date(2026, 6, 1).getTime(), now)).toBe('upcoming')
  })
})

// Sanidade: TaskStatus cobre exatamente os 5 estados conhecidos — se um status
// novo surgir, este teste lembra de revisar PENDING_STATUSES.
describe('TaskStatus coverage', () => {
  it('every known status is classified', () => {
    const all: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled']
    for (const s of all) expect(typeof isPendingStatus(s)).toBe('boolean')
  })
})

describe('selectStoppedAutoTasks', () => {
  const now = new Date(2026, 5, 9, 12, 0, 0).getTime()

  function autoTask(overrides: Partial<StoppedAutoTaskInput>): StoppedAutoTaskInput {
    return { origin: 'auto', status: 'todo', updatedAt: now, ...overrides }
  }

  it('picks auto tasks pending and untouched for more than the threshold', () => {
    const stale = autoTask({ updatedAt: now - STOPPED_AUTO_TASK_MS - 1 })
    const result = selectStoppedAutoTasks([stale], now)
    expect(result).toEqual([stale])
  })

  it('ignores manual tasks even if stale', () => {
    const stale = autoTask({ origin: 'manual', updatedAt: now - STOPPED_AUTO_TASK_MS - 1 })
    expect(selectStoppedAutoTasks([stale], now)).toEqual([])
  })

  it('ignores auto tasks already done/cancelled', () => {
    const done = autoTask({ status: 'done', updatedAt: now - STOPPED_AUTO_TASK_MS - 1 })
    const cancelled = autoTask({ status: 'cancelled', updatedAt: now - STOPPED_AUTO_TASK_MS - 1 })
    expect(selectStoppedAutoTasks([done, cancelled], now)).toEqual([])
  })

  it('ignores auto tasks touched recently', () => {
    const fresh = autoTask({ updatedAt: now - 1000 })
    expect(selectStoppedAutoTasks([fresh], now)).toEqual([])
  })
})
