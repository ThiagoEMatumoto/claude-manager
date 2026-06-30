import { describe, expect, it } from 'vitest'
import { parsePermissionMode } from './permission-mode-parser'

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
