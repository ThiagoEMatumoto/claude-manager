import { describe, expect, it } from 'vitest'
import { nodeText, type HastNode } from './markdown-code'

describe('nodeText', () => {
  it('returns empty for nullish node', () => {
    expect(nodeText(undefined)).toBe('')
  })

  it('reads a bare text node', () => {
    expect(nodeText({ type: 'text', value: 'hello' })).toBe('hello')
  })

  it('concatenates text across nested highlight spans', () => {
    // Estrutura típica pós rehype-highlight: pre > code > spans/text.
    const tree: HastNode = {
      type: 'element',
      children: [
        {
          type: 'element',
          children: [
            { type: 'element', children: [{ type: 'text', value: 'const' }] },
            { type: 'text', value: ' x = ' },
            { type: 'element', children: [{ type: 'text', value: '1' }] },
            { type: 'text', value: '\n' },
          ],
        },
      ],
    }
    expect(nodeText(tree)).toBe('const x = 1\n')
  })

  it('handles element nodes without children', () => {
    expect(nodeText({ type: 'element' })).toBe('')
  })
})
