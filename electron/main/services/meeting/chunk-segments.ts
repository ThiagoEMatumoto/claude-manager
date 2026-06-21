import type { PromptSegment } from './compose-extraction-prompt'

// Chunking/map-reduce para transcripts longos: fatia os segments em blocos que
// cabem na janela do modelo, com overlap entre blocos pra não perder itens que
// cruzam a fronteira. PURO (sem I/O) — testável direto.
//
// Estimativa de tokens: chars/4 (heurística usual). Acima de ~12k tokens (~48k
// chars) de transcript, fatiamos. O overlap é em nº de segments (não chars) pra
// ser determinístico e simples.

// chars/4 ≈ tokens. Conservador o suficiente pra pt-BR.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Acima disso, chunka. ~12k tokens = ~48k chars de transcript bruto (sem contar
// o boilerplate do prompt, que some no orçamento de cada chunk).
export const CHUNK_TOKEN_THRESHOLD = 12_000
const CHUNK_CHAR_BUDGET = CHUNK_TOKEN_THRESHOLD * 4
// Segments de overlap copiados do fim de um chunk pro início do próximo.
const OVERLAP_SEGMENTS = 2

function segmentChars(seg: PromptSegment): number {
  // +~24 chars pra modelar o prefixo `[SPEAKER @mm:ss] ` + newline.
  return (seg.text?.length ?? 0) + 24
}

export function totalTranscriptChars(segments: PromptSegment[]): number {
  return segments.reduce((acc, s) => acc + segmentChars(s), 0)
}

// True quando vale a pena chunkar (transcript estimado acima do threshold).
export function shouldChunk(segments: PromptSegment[]): boolean {
  return estimateTokens(' '.repeat(totalTranscriptChars(segments))) > CHUNK_TOKEN_THRESHOLD
}

// Fatia os segments em blocos <= CHUNK_CHAR_BUDGET, com OVERLAP_SEGMENTS de
// sobreposição. Garante progresso mesmo com um único segment gigante (ele vira
// um chunk sozinho). Retorna [segments] (1 chunk) quando não precisa chunkar.
export function chunkSegments(segments: PromptSegment[]): PromptSegment[][] {
  if (segments.length === 0) return []
  if (!shouldChunk(segments)) return [segments]

  const chunks: PromptSegment[][] = []
  let current: PromptSegment[] = []
  let currentChars = 0

  for (const seg of segments) {
    const segChars = segmentChars(seg)
    // Fecha o chunk atual se adicionar este segment estoura o orçamento (e o
    // chunk não está vazio — um segment gigante sozinho ainda entra).
    if (current.length > 0 && currentChars + segChars > CHUNK_CHAR_BUDGET) {
      chunks.push(current)
      const overlap = current.slice(-OVERLAP_SEGMENTS)
      current = [...overlap]
      currentChars = overlap.reduce((a, s) => a + segmentChars(s), 0)
    }
    current.push(seg)
    currentChars += segChars
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
