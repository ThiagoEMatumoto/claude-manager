import { describe, expect, it } from 'vitest'
import { navigateHistory, resolveComposerKey, resolveForwardKey } from './composer-keys'

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

describe('resolveForwardKey', () => {
  const empty = true
  const withText = false

  it('arrows forward to the PTY when the composer is empty', () => {
    expect(resolveForwardKey({ key: 'ArrowUp' }, empty)).toEqual({ seq: '\x1b[A' })
    expect(resolveForwardKey({ key: 'ArrowDown' }, empty)).toEqual({ seq: '\x1b[B' })
    expect(resolveForwardKey({ key: 'ArrowRight' }, empty)).toEqual({ seq: '\x1b[C' })
    expect(resolveForwardKey({ key: 'ArrowLeft' }, empty)).toEqual({ seq: '\x1b[D' })
  })

  it('arrows edit the draft (stay in textarea) when there is text', () => {
    expect(resolveForwardKey({ key: 'ArrowUp' }, withText)).toEqual({ handleInTextarea: true })
    expect(resolveForwardKey({ key: 'ArrowLeft' }, withText)).toEqual({ handleInTextarea: true })
  })

  it('PageUp/PageDown/Home/End forward only when empty', () => {
    expect(resolveForwardKey({ key: 'PageUp' }, empty)).toEqual({ seq: '\x1b[5~' })
    expect(resolveForwardKey({ key: 'PageDown' }, empty)).toEqual({ seq: '\x1b[6~' })
    expect(resolveForwardKey({ key: 'Home' }, empty)).toEqual({ seq: '\x1b[H' })
    expect(resolveForwardKey({ key: 'End' }, empty)).toEqual({ seq: '\x1b[F' })
    expect(resolveForwardKey({ key: 'PageUp' }, withText)).toEqual({ handleInTextarea: true })
  })

  it('Ctrl+C interrupts (SIGINT) only when empty; otherwise preserves native copy', () => {
    expect(resolveForwardKey({ key: 'c', ctrl: true }, empty)).toEqual({ seq: '\x03' })
    expect(resolveForwardKey({ key: 'C', ctrl: true }, empty)).toEqual({ seq: '\x03' })
    expect(resolveForwardKey({ key: 'c', ctrl: true }, withText)).toEqual({ handleInTextarea: true })
  })

  it('Cmd+C never interrupts (mac copy stays native)', () => {
    expect(resolveForwardKey({ key: 'c', meta: true }, empty)).toEqual({ handleInTextarea: true })
  })

  it('Ctrl+D → EOF', () => {
    expect(resolveForwardKey({ key: 'd', ctrl: true }, empty)).toEqual({ seq: '\x04' })
  })

  it('Esc always forwards (cancel claude prompts/menus)', () => {
    expect(resolveForwardKey({ key: 'Escape' }, empty)).toEqual({ seq: '\x1b' })
    expect(resolveForwardKey({ key: 'Escape' }, withText)).toEqual({ seq: '\x1b' })
  })

  it('Tab → \\t; Shift+Tab → CSI Z (permission cycle)', () => {
    expect(resolveForwardKey({ key: 'Tab' }, empty)).toEqual({ seq: '\t' })
    expect(resolveForwardKey({ key: 'Tab', shift: true }, empty)).toEqual({ seq: '\x1b[Z' })
    expect(resolveForwardKey({ key: 'Tab', shift: true }, withText)).toEqual({ seq: '\x1b[Z' })
  })

  it('Enter with empty composer → \\r (confirm prompts); with text → handled by composer', () => {
    expect(resolveForwardKey({ key: 'Enter' }, empty)).toEqual({ seq: '\r' })
    expect(resolveForwardKey({ key: 'Enter' }, withText)).toEqual({ handleInTextarea: true })
    // Shift+Enter (newline) is never forwarded — the composer handles it.
    expect(resolveForwardKey({ key: 'Enter', shift: true }, empty)).toEqual({ handleInTextarea: true })
  })

  it('printable characters stay in the textarea', () => {
    expect(resolveForwardKey({ key: 'a' }, empty)).toEqual({ handleInTextarea: true })
    expect(resolveForwardKey({ key: 'a' }, withText)).toEqual({ handleInTextarea: true })
    expect(resolveForwardKey({ key: ' ' }, empty)).toEqual({ handleInTextarea: true })
  })

  it('Ctrl/Alt+arrows are NOT forwarded (reserved for prompt history)', () => {
    expect(resolveForwardKey({ key: 'ArrowUp', ctrl: true }, empty)).toEqual({
      handleInTextarea: true,
    })
    expect(resolveForwardKey({ key: 'ArrowDown', alt: true }, empty)).toEqual({
      handleInTextarea: true,
    })
    // plain arrow still forwards
    expect(resolveForwardKey({ key: 'ArrowUp' }, empty)).toEqual({ seq: '\x1b[A' })
  })
})

describe('navigateHistory', () => {
  const hist = ['first', 'second', 'third'] // cronológico: third = mais recente

  it('empty history → empty draft', () => {
    expect(navigateHistory([], 0, 'prev')).toEqual({ value: '', index: 0 })
    expect(navigateHistory([], 0, 'next')).toEqual({ value: '', index: 0 })
  })

  it('prev from the draft slot → most recent prompt', () => {
    expect(navigateHistory(hist, hist.length, 'prev')).toEqual({ value: 'third', index: 2 })
  })

  it('successive prev walks back to older prompts and clamps at the oldest', () => {
    expect(navigateHistory(hist, 2, 'prev')).toEqual({ value: 'second', index: 1 })
    expect(navigateHistory(hist, 1, 'prev')).toEqual({ value: 'first', index: 0 })
    expect(navigateHistory(hist, 0, 'prev')).toEqual({ value: 'first', index: 0 })
  })

  it('next walks forward and returns to an empty draft at the bottom', () => {
    expect(navigateHistory(hist, 0, 'next')).toEqual({ value: 'second', index: 1 })
    expect(navigateHistory(hist, 2, 'next')).toEqual({ value: '', index: 3 })
    expect(navigateHistory(hist, 3, 'next')).toEqual({ value: '', index: 3 })
  })
})
