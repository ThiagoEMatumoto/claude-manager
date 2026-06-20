import { describe, it, expect } from 'vitest'
import {
  composeExtractionPrompt,
  formatTranscript,
  type PromptSegment,
} from './compose-extraction-prompt'

const SEGMENTS: PromptSegment[] = [
  { speakerLabel: 'SPEAKER_00', startMs: 0, text: 'Bom dia pessoal, vamos começar.' },
  {
    speakerLabel: 'SPEAKER_01',
    startMs: 65000,
    text: 'O João ficou de mandar os números até sexta.',
  },
]

describe('formatTranscript', () => {
  it('formata cada linha como [SPEAKER @mm:ss] texto', () => {
    const out = formatTranscript(SEGMENTS)
    expect(out).toContain('[SPEAKER_00 @00:00] Bom dia pessoal, vamos começar.')
    expect(out).toContain('[SPEAKER_01 @01:05] O João ficou de mandar os números até sexta.')
  })

  it('usa --:-- quando start_ms é nulo e placeholder de speaker quando ausente', () => {
    const out = formatTranscript([{ speakerLabel: null, startMs: null, text: 'oi' }])
    expect(out).toBe('[SPEAKER_?? @--:--] oi')
  })
})

describe('composeExtractionPrompt', () => {
  it('inclui o transcript formatado e as notas', () => {
    const prompt = composeExtractionPrompt({
      rawNotes: 'minha nota: revisar roadmap',
      segments: SEGMENTS,
    })
    expect(prompt).toContain('[SPEAKER_01 @01:05] O João ficou de mandar os números até sexta.')
    expect(prompt).toContain('minha nota: revisar roadmap')
  })

  it('inclui as instruções de grounding e o schema JSON', () => {
    const prompt = composeExtractionPrompt({ rawNotes: null, segments: SEGMENTS })
    // grounding: quote literal + null quando não dito
    expect(prompt.toLowerCase()).toContain('quote')
    expect(prompt).toContain('literal')
    expect(prompt).toContain('null')
    // schema: tipos de item e campos-chave
    expect(prompt).toContain('action_item | decision | feedback | risk | question')
    expect(prompt).toContain('augmented_notes')
    expect(prompt).toContain('"summary"')
    expect(prompt).toContain('"items"')
    // instrução de responder só com JSON
    expect(prompt).toContain('```json')
  })

  it('lida com notas vazias com um placeholder explícito', () => {
    const prompt = composeExtractionPrompt({ rawNotes: '   ', segments: SEGMENTS })
    expect(prompt).toContain('o usuário não escreveu notas')
  })

  it('injeta objetivos e features ativos quando fornecidos', () => {
    const prompt = composeExtractionPrompt({
      rawNotes: null,
      segments: SEGMENTS,
      objectives: [{ id: 'obj-1', title: 'Aumentar conversão' }],
      features: [{ id: 'feat-1', title: 'Integração Calendar' }],
    })
    expect(prompt).toContain('Aumentar conversão (id: obj-1)')
    expect(prompt).toContain('Integração Calendar (id: feat-1)')
    expect(prompt).toContain('suggested_link')
  })

  it('omite a seção de vínculos quando não há objetivos/features', () => {
    const prompt = composeExtractionPrompt({ rawNotes: null, segments: SEGMENTS })
    expect(prompt).not.toContain('Vínculos disponíveis')
  })
})
