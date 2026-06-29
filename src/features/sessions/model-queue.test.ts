import { describe, expect, it } from 'vitest'
import { isPendingEmpty, mergePending, nextPendingApply } from './model-queue'

describe('mergePending', () => {
  it('starts empty and accumulates model + effort', () => {
    let p = mergePending({}, { model: 'opus' })
    p = mergePending(p, { effort: 'high' })
    expect(p).toEqual({ model: 'opus', effort: 'high' })
  })

  it('multiple changes of the same type keep only the last', () => {
    let p = mergePending({}, { model: 'opus' })
    p = mergePending(p, { model: 'sonnet' })
    p = mergePending(p, { model: 'haiku' })
    expect(p).toEqual({ model: 'haiku' })
  })
})

describe('nextPendingApply', () => {
  it('flushes pending on the working → idle transition, exactly once', () => {
    const pending = { model: 'opus' as const, effort: 'high' as const }
    const first = nextPendingApply('working', 'idle', pending)
    expect(first.apply).toEqual(pending)
    expect(first.pending).toEqual({})

    // Next step still idle, now with the cleared pending → no re-injection.
    const second = nextPendingApply('idle', 'idle', first.pending)
    expect(second.apply).toBeNull()
    expect(second.pending).toEqual({})
  })

  it('is a no-op when there is no pending', () => {
    const res = nextPendingApply('working', 'idle', {})
    expect(res.apply).toBeNull()
    expect(res.pending).toEqual({})
  })

  it('holds the pending while still busy (working → waiting)', () => {
    const pending = { effort: 'max' as const }
    const res = nextPendingApply('working', 'waiting', pending)
    expect(res.apply).toBeNull()
    expect(res.pending).toEqual(pending)
  })

  it('does not re-flush while staying idle (idle → idle)', () => {
    const pending = { model: 'sonnet' as const }
    const res = nextPendingApply('idle', 'idle', pending)
    expect(res.apply).toBeNull()
    expect(res.pending).toEqual(pending)
  })

  it('flushes after waiting → idle (permission prompt resolved)', () => {
    const pending = { model: 'haiku' as const }
    const res = nextPendingApply('waiting', 'idle', pending)
    expect(res.apply).toEqual(pending)
    expect(res.pending).toEqual({})
  })

  it('treats null prev (initial mount) reaching idle as a flush', () => {
    const pending = { effort: 'low' as const }
    const res = nextPendingApply(null, 'idle', pending)
    expect(res.apply).toEqual(pending)
  })
})

describe('isPendingEmpty', () => {
  it('is true only with no model and no effort', () => {
    expect(isPendingEmpty({})).toBe(true)
    expect(isPendingEmpty({ model: 'opus' })).toBe(false)
    expect(isPendingEmpty({ effort: 'high' })).toBe(false)
  })
})
