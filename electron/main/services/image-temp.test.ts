import { describe, expect, it } from 'vitest'
import {
  buildImageFilename,
  extFromMime,
  isImageTempFile,
  isSessionImageTempFile,
} from './image-temp'

describe('extFromMime', () => {
  it('maps known image mimes to extensions', () => {
    expect(extFromMime('image/png')).toBe('png')
    expect(extFromMime('image/jpeg')).toBe('jpg')
    expect(extFromMime('image/webp')).toBe('webp')
    expect(extFromMime('image/svg+xml')).toBe('svg')
  })

  it('is case/whitespace tolerant', () => {
    expect(extFromMime('  IMAGE/PNG  ')).toBe('png')
  })

  it('falls back to png for unknown or empty mime', () => {
    expect(extFromMime('application/pdf')).toBe('png')
    expect(extFromMime('')).toBe('png')
  })
})

describe('buildImageFilename', () => {
  it('builds img-<sessionId>-<id>.<ext>', () => {
    expect(buildImageFilename({ id: 'abc', mime: 'image/png', sessionId: 'sess1' })).toBe(
      'img-sess1-abc.png',
    )
    expect(buildImageFilename({ id: 'xyz', mime: 'image/jpeg', sessionId: 'sess1' })).toBe(
      'img-sess1-xyz.jpg',
    )
  })
})

describe('isImageTempFile', () => {
  it('recognizes our temp image files', () => {
    expect(isImageTempFile('img-sess1-abc.png')).toBe(true)
    expect(isImageTempFile('img-sess1-abc.JPG')).toBe(true)
  })

  it('ignores unrelated temp files', () => {
    expect(isImageTempFile('feature-context-123.md')).toBe(false)
    expect(isImageTempFile('img-sess1-abc.md')).toBe(false)
    expect(isImageTempFile('notimg-abc.png')).toBe(false)
    expect(isImageTempFile('img-.png')).toBe(false)
  })
})

describe('isSessionImageTempFile', () => {
  it('matches only the given session', () => {
    expect(isSessionImageTempFile('img-sess1-abc.png', 'sess1')).toBe(true)
    expect(isSessionImageTempFile('img-sess1-abc.png', 'sess2')).toBe(false)
  })

  it('does not match non-image temp files', () => {
    expect(isSessionImageTempFile('img-sess1-abc.md', 'sess1')).toBe(false)
  })

  it('treats sessionId as a literal (no regex injection)', () => {
    expect(isSessionImageTempFile('img-sess1-abc.png', 's.ss1')).toBe(false)
  })
})
