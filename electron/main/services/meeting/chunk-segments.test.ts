import { describe, it, expect } from 'vitest'
import {
  chunkSegments,
  shouldChunk,
  estimateTokens,
  CHUNK_TOKEN_THRESHOLD,
} from './chunk-segments'
import type { PromptSegment } from './compose-extraction-prompt'

function seg(text: string, idx = 0): PromptSegment {
  return { speakerLabel: `SPEAKER_0${idx % 2}`, startMs: idx * 1000, text }
}

describe('estimateTokens', () => {
  it('aproxima chars/4', () => {
    expect(estimateTokens('a'.repeat(40))).toBe(10)
  })
})

describe('shouldChunk / chunkSegments', () => {
  it('transcript curto: 1 chunk, sem fatiar', () => {
    const segs = [seg('oi'), seg('tudo bem', 1)]
    expect(shouldChunk(segs)).toBe(false)
    expect(chunkSegments(segs)).toEqual([segs])
  })

  it('vazio → []', () => {
    expect(chunkSegments([])).toEqual([])
  })

  it('transcript longo: fatia em múltiplos chunks com overlap', () => {
    // ~960 chars/segment * 80 ≈ 77k chars > 48k threshold.
    const filler = 'palavra '.repeat(120)
    const segs = Array.from({ length: 80 }, (_, i) => seg(`${filler} ${i}`, i))
    expect(shouldChunk(segs)).toBe(true)

    const chunks = chunkSegments(segs)
    expect(chunks.length).toBeGreaterThan(1)

    // Cada chunk (exceto o 1º) começa com o overlap do anterior: o 1º segment de
    // um chunk == um dos 2 últimos do chunk anterior.
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-2)
      expect(prevTail).toContainEqual(chunks[i][0])
    }

    // Todos os segments originais aparecem em algum chunk (cobertura).
    const seenTexts = new Set(chunks.flat().map((s) => s.text))
    for (const s of segs) expect(seenTexts.has(s.text)).toBe(true)
  })

  it('um único segment gigante vira um chunk sozinho (progresso garantido)', () => {
    const giant = seg('x'.repeat(CHUNK_TOKEN_THRESHOLD * 4 + 100))
    const chunks = chunkSegments([giant, seg('pequeno', 1)])
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]).toContainEqual(giant)
  })
})
