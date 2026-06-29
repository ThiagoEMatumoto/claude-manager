import { describe, expect, it } from 'vitest'
import { insertPathToken, pickImageFiles, pickImageItems } from './image-paste'

describe('pickImageItems', () => {
  it('keeps only file items with an image mime', () => {
    const items = [
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png' },
      { kind: 'file', type: 'application/pdf' },
      { kind: 'file', type: 'image/jpeg' },
    ]
    expect(pickImageItems(items)).toEqual([
      { kind: 'file', type: 'image/png' },
      { kind: 'file', type: 'image/jpeg' },
    ])
  })

  it('returns empty when there are no image files', () => {
    expect(pickImageItems([{ kind: 'string', type: 'text/plain' }])).toEqual([])
  })
})

describe('pickImageFiles', () => {
  it('keeps only image files', () => {
    const files = [
      { type: 'image/png', name: 'a.png' },
      { type: 'text/plain', name: 'b.txt' },
      { type: 'image/gif', name: 'c.gif' },
    ]
    expect(pickImageFiles(files)).toEqual([
      { type: 'image/png', name: 'a.png' },
      { type: 'image/gif', name: 'c.gif' },
    ])
  })
})

describe('insertPathToken', () => {
  it('inserts into empty input with a trailing space', () => {
    const res = insertPathToken('', '/tmp/img-1.png', 0, 0)
    expect(res.value).toBe('/tmp/img-1.png ')
    expect(res.cursor).toBe(res.value.length)
  })

  it('adds a leading space when appending after non-space text', () => {
    const value = 'olha isto'
    const res = insertPathToken(value, '/tmp/x.png', value.length, value.length)
    expect(res.value).toBe('olha isto /tmp/x.png ')
    expect(res.cursor).toBe(res.value.length)
  })

  it('does not double the leading space when text already ends with one', () => {
    const value = 'olha isto '
    const res = insertPathToken(value, '/tmp/x.png', value.length, value.length)
    expect(res.value).toBe('olha isto /tmp/x.png ')
  })

  it('inserts at the cursor in the middle and reuses an existing following space', () => {
    const value = 'antes  depois'
    // cursor entre os dois espaços (após "antes ", índice 6)
    const res = insertPathToken(value, '/p.png', 6, 6)
    expect(res.value).toBe('antes /p.png depois')
    // o trailing reusou o espaço já existente, então o cursor para antes dele
    expect(res.cursor).toBe('antes /p.png'.length)
  })

  it('replaces the current selection', () => {
    const value = 'sub esta parte'
    const res = insertPathToken(value, '/p.png', 4, 8) // "esta"
    expect(res.value).toBe('sub /p.png parte')
  })
})
