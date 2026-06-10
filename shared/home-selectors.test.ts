import { describe, expect, it } from 'vitest'
import {
  groupLiveSessions,
  isStalledFeature,
  selectActiveObjectives,
  selectUrgentTasks,
  STALLED_FEATURE_MS,
  type LiveStatus,
  type UrgentTaskInput,
} from './home-selectors'
import type { ObjectiveStatus, TaskPriority, TaskStatus } from './types/ipc'

const DAY = 24 * 60 * 60 * 1000

// "now" fixo no meio do dia local pra classifyDue ser determinístico.
function middayNow(): number {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d.getTime()
}

interface TestTask extends UrgentTaskInput {
  id: string
}

function task(
  id: string,
  overrides: Partial<{
    status: TaskStatus
    priority: TaskPriority | null
    dueDate: number | null
    position: number
  }> = {},
): TestTask {
  return { id, status: 'todo', priority: null, dueDate: null, position: 0, ...overrides }
}

describe('selectUrgentTasks', () => {
  const now = middayNow()

  it('orders overdue → today → in_progress', () => {
    const result = selectUrgentTasks(
      [
        task('doing', { status: 'in_progress' }),
        task('today', { dueDate: now }),
        task('overdue', { dueDate: now - 2 * DAY }),
      ],
      now,
    )
    expect(result.map((t) => t.id)).toEqual(['overdue', 'today', 'doing'])
  })

  it('excludes tasks that are neither due-urgent nor in_progress', () => {
    const result = selectUrgentTasks(
      [
        task('someday', { dueDate: now + 5 * DAY }),
        task('no-due-todo'),
        task('blocked-no-due', { status: 'blocked' }),
      ],
      now,
    )
    expect(result).toEqual([])
  })

  it('does not duplicate an in_progress task that is also overdue', () => {
    const result = selectUrgentTasks(
      [task('both', { status: 'in_progress', dueDate: now - DAY })],
      now,
    )
    expect(result.map((t) => t.id)).toEqual(['both'])
  })

  it('orders by priority within each bucket', () => {
    const result = selectUrgentTasks(
      [
        task('over-low', { priority: 'low', dueDate: now - DAY, position: 1 }),
        task('over-high', { priority: 'high', dueDate: now - DAY, position: 2 }),
        task('today-null', { priority: null, dueDate: now, position: 3 }),
        task('today-med', { priority: 'medium', dueDate: now, position: 4 }),
      ],
      now,
    )
    expect(result.map((t) => t.id)).toEqual(['over-high', 'over-low', 'today-med', 'today-null'])
  })
})

describe('groupLiveSessions', () => {
  function session(id: string, status: LiveStatus): { id: string; status: LiveStatus } {
    return { id, status }
  }

  it('groups waiting / working(+starting) / idle and drops ended', () => {
    const groups = groupLiveSessions([
      session('a', 'working'),
      session('b', 'waiting'),
      session('c', 'starting'),
      session('d', 'idle'),
      session('e', 'ended'),
    ])
    expect(groups.waiting.map((s) => s.id)).toEqual(['b'])
    expect(groups.working.map((s) => s.id)).toEqual(['a', 'c'])
    expect(groups.idle.map((s) => s.id)).toEqual(['d'])
  })

  it('returns empty groups for empty input', () => {
    expect(groupLiveSessions([])).toEqual({ waiting: [], working: [], idle: [] })
  })
})

describe('isStalledFeature', () => {
  const now = 1_000_000_000_000

  it('is stalled when last session is older than the threshold', () => {
    expect(isStalledFeature({ lastSessionAt: now - STALLED_FEATURE_MS - 1 }, now)).toBe(true)
  })

  it('is not stalled at or within the threshold', () => {
    expect(isStalledFeature({ lastSessionAt: now - STALLED_FEATURE_MS }, now)).toBe(false)
    expect(isStalledFeature({ lastSessionAt: now - DAY }, now)).toBe(false)
  })

  it('is not stalled without any session (frente A handles "sem registros")', () => {
    expect(isStalledFeature({ lastSessionAt: null }, now)).toBe(false)
  })
})

describe('selectActiveObjectives', () => {
  function node(id: string, status: ObjectiveStatus): { id: string; objective: { status: ObjectiveStatus } } {
    return { id, objective: { status } }
  }

  it('keeps only active roots, preserving order', () => {
    const result = selectActiveObjectives([
      node('a', 'active'),
      node('b', 'paused'),
      node('c', 'done'),
      node('d', 'active'),
    ])
    expect(result.map((n) => n.id)).toEqual(['a', 'd'])
  })
})
