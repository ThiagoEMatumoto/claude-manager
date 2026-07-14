import { describe, expect, it } from 'vitest'
import {
  groupLiveSessions,
  isStalledFeature,
  selectActiveObjectives,
  selectFeaturesWithoutObjective,
  selectRecentUsage,
  selectTodayUsage,
  selectUrgentTasks,
  STALLED_FEATURE_MS,
  usageDayKey,
  type LiveStatus,
  type UrgentTaskInput,
  type UsageDayPoint,
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

describe('usage selectors', () => {
  // now fixo em UTC pra casar com o dayKey UTC do metrics-service.
  const now = Date.UTC(2026, 5, 11, 15, 0, 0) // 2026-06-11T15:00Z

  function point(day: string, overrides: Partial<UsageDayPoint> = {}): UsageDayPoint {
    return { day, tokens: 0, costUsd: 0, turns: 0, sessions: 0, ...overrides }
  }

  function dayAgo(n: number): string {
    return usageDayKey(now - n * DAY)
  }

  describe('usageDayKey', () => {
    it('uses the UTC calendar day (mirrors metrics-service dayKey)', () => {
      expect(usageDayKey(now)).toBe('2026-06-11')
      expect(usageDayKey(Date.UTC(2026, 5, 11, 23, 59, 59))).toBe('2026-06-11')
      expect(usageDayKey(Date.UTC(2026, 5, 12, 0, 0, 1))).toBe('2026-06-12')
    })
  })

  describe('selectTodayUsage', () => {
    it("picks today's bucket from perDay", () => {
      const result = selectTodayUsage(
        [
          point(dayAgo(1), { costUsd: 9, tokens: 900, turns: 9 }),
          point(dayAgo(0), { costUsd: 1.5, tokens: 1200, turns: 7 }),
        ],
        now,
      )
      expect(result).toEqual({ costUsd: 1.5, tokens: 1200, turns: 7 })
    })

    it('returns zeros when today has no bucket', () => {
      expect(selectTodayUsage([point(dayAgo(3), { costUsd: 4 })], now)).toEqual({
        costUsd: 0,
        tokens: 0,
        turns: 0,
      })
    })
  })

  describe('selectRecentUsage', () => {
    it('sums the last 7 days (today inclusive) into current', () => {
      const { current } = selectRecentUsage(
        [
          point(dayAgo(0), { costUsd: 1, tokens: 10, turns: 1, sessions: 1 }),
          point(dayAgo(6), { costUsd: 2, tokens: 20, turns: 3, sessions: 2 }),
          point(dayAgo(7), { costUsd: 100, tokens: 999, turns: 9, sessions: 9 }),
        ],
        now,
      )
      expect(current).toEqual({ costUsd: 3, tokens: 30, turns: 4, sessions: 3 })
    })

    it('sums days 7..13 into previous and ignores anything older', () => {
      const { previous } = selectRecentUsage(
        [
          point(dayAgo(7), { costUsd: 5, tokens: 50, turns: 2, sessions: 1 }),
          point(dayAgo(13), { costUsd: 1, tokens: 10, turns: 1, sessions: 1 }),
          point(dayAgo(14), { costUsd: 77, tokens: 777, turns: 7, sessions: 7 }),
        ],
        now,
      )
      expect(previous).toEqual({ costUsd: 6, tokens: 60, turns: 3, sessions: 2 })
    })

    it('computes cost delta % vs the previous window', () => {
      const { costDeltaPct } = selectRecentUsage(
        [point(dayAgo(0), { costUsd: 6 }), point(dayAgo(8), { costUsd: 4 })],
        now,
      )
      expect(costDeltaPct).toBeCloseTo(50)
    })

    it('returns null delta when the previous window has no cost', () => {
      const { costDeltaPct } = selectRecentUsage([point(dayAgo(0), { costUsd: 6 })], now)
      expect(costDeltaPct).toBeNull()
    })
  })
})

describe('selectFeaturesWithoutObjective', () => {
  function feature(id: string, objectiveLinkCount: number): { id: string; objectiveLinkCount: number } {
    return { id, objectiveLinkCount }
  }

  it('keeps only features with zero objective links', () => {
    const result = selectFeaturesWithoutObjective([
      feature('a', 0),
      feature('b', 2),
      feature('c', 0),
      feature('d', 1),
    ])
    expect(result.map((f) => f.id)).toEqual(['a', 'c'])
  })

  it('returns empty when every feature has at least one link', () => {
    expect(selectFeaturesWithoutObjective([feature('a', 1)])).toEqual([])
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
