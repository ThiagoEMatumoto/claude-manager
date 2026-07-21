import { describe, expect, it } from 'vitest'
import { parsePermissionMode, shouldNotifyModeChange } from './permission-mode-parser'

describe('parsePermissionMode', () => {
  it('reads acceptEdits from "accept edits on"', () => {
    expect(parsePermissionMode('accept edits on')).toBe('acceptEdits')
  })

  it('reads plan from "plan mode on"', () => {
    expect(parsePermissionMode('plan mode on')).toBe('plan')
  })

  it('reads auto from "auto mode on"', () => {
    expect(parsePermissionMode('auto mode on')).toBe('auto')
  })

  it('does not read "auto-accept edits on" as acceptEdits', () => {
    expect(parsePermissionMode('auto-accept edits on')).toBe('auto')
  })

  it('reads bypassPermissions from "bypass permissions"', () => {
    expect(parsePermissionMode('bypass permissions')).toBe('bypassPermissions')
  })

  it('returns null when no indicator is present', () => {
    expect(parsePermissionMode('just some terminal output without any footer')).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(parsePermissionMode('')).toBeNull()
  })

  it('lets the last (rightmost) occurrence win', () => {
    expect(parsePermissionMode('plan mode on ... accept edits on')).toBe('acceptEdits')
    expect(parsePermissionMode('accept edits on ... plan mode on')).toBe('plan')
  })
})

describe('shouldNotifyModeChange', () => {
  it('does not notify on mount (prev and next both null)', () => {
    expect(shouldNotifyModeChange(null, null)).toBe(false)
  })

  it('does not notify on the first real detection (baseline, prev still null)', () => {
    expect(shouldNotifyModeChange(null, 'default')).toBe(false)
    expect(shouldNotifyModeChange(null, 'plan')).toBe(false)
  })

  it('does not notify when the mode stays the same', () => {
    expect(shouldNotifyModeChange('default', 'default')).toBe(false)
    expect(shouldNotifyModeChange('plan', 'plan')).toBe(false)
  })

  it('notifies on a real transition between two known modes', () => {
    expect(shouldNotifyModeChange('default', 'plan')).toBe(true)
    expect(shouldNotifyModeChange('plan', 'acceptEdits')).toBe(true)
  })

  it('does not notify if next somehow reverts to null', () => {
    expect(shouldNotifyModeChange('plan', null)).toBe(false)
  })
})
