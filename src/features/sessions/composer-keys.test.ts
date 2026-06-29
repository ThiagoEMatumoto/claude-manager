import { describe, expect, it } from 'vitest'
import { resolveComposerKey } from './composer-keys'

describe('resolveComposerKey', () => {
  it('Enter in enter-sends mode → send', () => {
    expect(resolveComposerKey({ key: 'Enter' }, 'enter-sends')).toBe('send')
  })

  it('Shift+Enter in enter-sends mode → newline', () => {
    expect(resolveComposerKey({ key: 'Enter', shift: true }, 'enter-sends')).toBe('newline')
  })

  it('Enter in enter-newline mode → newline', () => {
    expect(resolveComposerKey({ key: 'Enter' }, 'enter-newline')).toBe('newline')
  })

  it('Cmd/Ctrl+Enter in enter-newline mode → send', () => {
    expect(resolveComposerKey({ key: 'Enter', meta: true }, 'enter-newline')).toBe('send')
    expect(resolveComposerKey({ key: 'Enter', ctrl: true }, 'enter-newline')).toBe('send')
  })

  it('Cmd/Ctrl+Enter in enter-sends mode → send', () => {
    expect(resolveComposerKey({ key: 'Enter', meta: true }, 'enter-sends')).toBe('send')
  })

  it('non-Enter keys → noop', () => {
    expect(resolveComposerKey({ key: 'a' }, 'enter-sends')).toBe('noop')
    expect(resolveComposerKey({ key: 'Shift' }, 'enter-newline')).toBe('noop')
  })
})
