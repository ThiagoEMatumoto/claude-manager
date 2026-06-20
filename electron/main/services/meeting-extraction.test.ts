import { describe, it, expect, vi } from 'vitest'
import {
  extractMeeting,
  isGrounded,
  normalizeForMatch,
  extractJsonBlock,
  ollamaResultJsonSchema,
  type ExtractDeps,
} from './meeting-extraction'
import type {
  Meeting,
  MeetingExtraction,
  MeetingSegment,
  UpdateMeetingInput,
} from '../../../shared/types/ipc'
import type { AddExtractionInput } from './meeting-store'
import type { RunResult } from './claude-cli'

function seg(idx: number, text: string, startMs = idx * 2500): MeetingSegment {
  return {
    id: `seg-${idx}`,
    meetingId: 'm1',
    idx,
    startMs,
    endMs: startMs + 2500,
    speakerLabel: `SPEAKER_0${idx % 2}`,
    text,
    wordsJson: null,
    avgLogprob: null,
    noSpeechProb: null,
    isPartial: false,
  }
}

const SEGMENTS: MeetingSegment[] = [
  seg(0, 'Bom dia pessoal, vamos começar a reunião.'),
  seg(1, 'O João ficou de mandar os números de conversão até sexta.'),
  seg(2, 'A integração com o Calendar está quase pronta.'),
]

const MEETING: Meeting = {
  id: 'm1',
  title: 'Planejamento',
  startedAt: 0,
  endedAt: null,
  source: null,
  audioPath: null,
  durationMs: null,
  lang: 'pt',
  sttModel: null,
  diarModel: null,
  extractor: null,
  status: 'ready',
  rawNotes: 'revisar roadmap',
  augmentedNotes: null,
  summary: null,
  createdAt: 0,
  updatedAt: 0,
}

// JSON com 2 itens: o 1º com quote LITERAL (deve casar → grounded=1); o 2º com
// quote INVENTADA (não está no transcript → grounded=0).
const MODEL_JSON = {
  summary: 'Reunião de planejamento do trimestre.',
  augmented_notes: '# Planejamento\n- Revisar roadmap',
  items: [
    {
      type: 'action_item',
      text: 'João envia os números de conversão até sexta',
      assignee: 'João',
      due_hint: 'até sexta',
      quote: 'O João ficou de mandar os números de conversão até sexta.',
      start_ms: 2500,
      end_ms: 5000,
      speaker_label: 'SPEAKER_01',
      confidence: 0.9,
      suggested_link: null,
    },
    {
      type: 'decision',
      text: 'Decidiram migrar para AWS',
      assignee: null,
      due_hint: null,
      quote: 'Vamos migrar tudo para a AWS no próximo mês.',
      start_ms: null,
      end_ms: null,
      speaker_label: null,
      confidence: 0.5,
      suggested_link: null,
    },
  ],
}

function makeStore(captured: MeetingExtraction[], updates: UpdateMeetingInput[]) {
  return {
    get: vi.fn((): Meeting | null => MEETING),
    listSegments: vi.fn((): MeetingSegment[] => SEGMENTS),
    update: vi.fn((input: UpdateMeetingInput): Meeting => {
      updates.push(input)
      return { ...MEETING, ...input } as Meeting
    }),
    addExtraction: vi.fn((input: AddExtractionInput): MeetingExtraction => {
      const ex: MeetingExtraction = {
        id: `ex-${captured.length}`,
        meetingId: 'm1',
        type: input.type,
        text: input.text,
        assignee: input.assignee ?? null,
        dueHint: input.dueHint ?? null,
        quote: input.quote ?? null,
        quoteSegmentId: null,
        startMs: input.startMs ?? null,
        endMs: input.endMs ?? null,
        speakerLabel: input.speakerLabel ?? null,
        confidence: input.confidence ?? null,
        grounded: input.grounded ?? false,
        materializedTaskId: null,
        createdAt: 0,
      }
      captured.push(ex)
      return ex
    }),
    deleteExtractions: vi.fn((): void => {
      captured.length = 0
    }),
  } satisfies ExtractDeps['store']
}

function okRun(stdout: string): RunResult {
  return { stdout, stderr: '', code: 0 }
}

describe('normalizeForMatch / isGrounded', () => {
  it('normaliza acentos, caixa e espaços', () => {
    expect(normalizeForMatch('  Olá   MUNDO ')).toBe('ola mundo')
  })

  it('quote literal casa por substring normalizado', () => {
    expect(isGrounded('os números de conversão', SEGMENTS)).toBe(true)
    expect(isGrounded('OS NÚMEROS DE CONVERSÃO', SEGMENTS)).toBe(true)
  })

  it('quote inventada não casa', () => {
    expect(isGrounded('migrar tudo para a AWS', SEGMENTS)).toBe(false)
  })

  it('quote vazia não é grounded', () => {
    expect(isGrounded('   ', SEGMENTS)).toBe(false)
  })

  it('quote que cruza 2 segments casa via concatenação (fallback)', () => {
    // A frase atravessa a fronteira seg(1)→seg(2): nenhum segment isolado a
    // contém, mas a concatenação normalizada sim.
    const crossSegment = 'até sexta. A integração com o Calendar'
    expect(SEGMENTS.some((s) => normalizeForMatch(s.text).includes(normalizeForMatch(crossSegment)))).toBe(
      false,
    )
    expect(isGrounded(crossSegment, SEGMENTS)).toBe(true)
  })
})

describe('extractJsonBlock', () => {
  it('recorta o JSON ignorando banner antes e lixo depois', () => {
    const stdout = 'banner de boas-vindas\n{"a":1,"b":{"c":2}}\nlixo final'
    expect(extractJsonBlock(stdout)).toBe('{"a":1,"b":{"c":2}}')
  })

  it('lida com chaves dentro de strings', () => {
    const stdout = '{"text":"contém } e { no meio","ok":true}'
    expect(extractJsonBlock(stdout)).toBe('{"text":"contém } e { no meio","ok":true}')
  })

  it('retorna null sem JSON', () => {
    expect(extractJsonBlock('só texto')).toBeNull()
  })
})

describe('extractMeeting', () => {
  it('parseia, valida, faz grounding e persiste cada item', async () => {
    const captured: MeetingExtraction[] = []
    const updates: UpdateMeetingInput[] = []
    const store = makeStore(captured, updates)
    const runClaude = vi.fn(
      async (args: string[]): Promise<RunResult> => {
        void args
        return okRun('Welcome to Claude\n```json\n' + JSON.stringify(MODEL_JSON) + '\n```')
      },
    )

    const result = await extractMeeting('m1', { runClaude, store, providerPref: 'claude' })

    // runClaude chamado em text-mode
    expect(runClaude).toHaveBeenCalledOnce()
    expect(runClaude.mock.calls[0]?.[0]).toEqual([
      '-p',
      expect.any(String),
      '--output-format',
      'text',
    ])

    // persistência da reunião (notas aumentadas + status extracted)
    expect(store.update).toHaveBeenCalledOnce()
    expect(updates[0]).toMatchObject({ status: 'extracted', extractor: 'claude -p' })

    // 2 itens persistidos via addExtraction
    expect(store.addExtraction).toHaveBeenCalledTimes(2)
    expect(captured).toHaveLength(2)

    // grounding: item 1 literal → grounded=1; item 2 inventado → grounded=0
    const action = captured.find((e) => e.type === 'action_item')!
    const decision = captured.find((e) => e.type === 'decision')!
    expect(action.grounded).toBe(true)
    expect(decision.grounded).toBe(false)

    expect(result.summary).toContain('planejamento')
    expect(result.extractions).toHaveLength(2)
  })

  it('re-extração limpa as extrações antigas ANTES de re-inserir (sem duplicar)', async () => {
    const captured: MeetingExtraction[] = []
    const store = makeStore(captured, [])
    const runClaude = vi.fn(async (): Promise<RunResult> => okRun(JSON.stringify(MODEL_JSON)))

    // 1ª extração: 2 itens.
    const first = await extractMeeting('m1', { runClaude, store, providerPref: 'claude' })
    expect(first.extractions).toHaveLength(2)
    expect(captured).toHaveLength(2)

    // 2ª extração (re-enriquecer): deleteExtractions zera antes do loop, então o
    // total persistido continua 2 (não 4).
    const second = await extractMeeting('m1', { runClaude, store, providerPref: 'claude' })
    expect(store.deleteExtractions).toHaveBeenCalledTimes(2)
    expect(second.extractions).toHaveLength(2)
    expect(captured).toHaveLength(2)
  })

  it('roda delete + inserts dentro de runInTransaction quando disponível', async () => {
    const captured: MeetingExtraction[] = []
    let txCalls = 0
    const store: ExtractDeps['store'] = {
      ...makeStore(captured, []),
      runInTransaction: <T>(fn: () => T): T => {
        txCalls++
        return fn()
      },
    }
    const runClaude = vi.fn(async (): Promise<RunResult> => okRun(JSON.stringify(MODEL_JSON)))

    await extractMeeting('m1', { runClaude, store, providerPref: 'claude' })
    expect(txCalls).toBe(1)
    // delete + inserts aconteceram dentro do wrapper.
    expect(store.deleteExtractions).toHaveBeenCalledOnce()
    expect(captured).toHaveLength(2)
  })

  it('faz retry 1x quando o primeiro JSON é inválido', async () => {
    const captured: MeetingExtraction[] = []
    const store = makeStore(captured, [])
    const runClaude = vi
      .fn()
      .mockResolvedValueOnce(okRun('isso não é json'))
      .mockResolvedValueOnce(okRun(JSON.stringify(MODEL_JSON)))

    await extractMeeting('m1', { runClaude, store, providerPref: 'claude' })
    expect(runClaude).toHaveBeenCalledTimes(2)
    expect(captured).toHaveLength(2)
  })

  it('propaga erro do claude (exit != 0) sem inventar resultado', async () => {
    const store = makeStore([], [])
    const runClaude = vi.fn(async (): Promise<RunResult> => ({ stdout: '', stderr: 'claude não encontrado', code: 127 }))

    await expect(extractMeeting('m1', { runClaude, store, providerPref: 'claude' })).rejects.toThrow(/exit 127/)
    expect(store.update).not.toHaveBeenCalled()
  })

  it('falha claro quando não há transcript', async () => {
    const captured: MeetingExtraction[] = []
    const store = makeStore(captured, [])
    store.listSegments.mockReturnValue([])
    const runClaude = vi.fn()
    await expect(extractMeeting('m1', { runClaude, store, providerPref: 'claude' })).rejects.toThrow(
      /não tem transcript/,
    )
    expect(runClaude).not.toHaveBeenCalled()
  })
})

// JSON Ollama mockado: 1 item grounded (literal) + 1 inventado.
function ollamaJson(): string {
  return JSON.stringify(MODEL_JSON)
}

// fetch fake do Ollama: tags ok (disponível) + generate devolvendo o JSON.
function makeOllamaFetch(opts: { available?: boolean; response?: string } = {}) {
  const { available = true, response = ollamaJson() } = opts
  return vi.fn(async (input: string, _init?: RequestInit) => {
    void _init
    if (input.endsWith('/api/tags')) {
      return { ok: available, status: available ? 200 : 503, json: async () => ({ models: [] }), text: async () => '' }
    }
    if (input.endsWith('/api/generate')) {
      return { ok: true, status: 200, json: async () => ({ response, model: 'qwen2.5:7b' }), text: async () => '' }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' }
  })
}

describe('extractMeeting — seleção de provedor + fallback Ollama', () => {
  it('providerPref=ollama gera via Ollama (sem tocar claude) e carimba extractor', async () => {
    const captured: MeetingExtraction[] = []
    const updates: UpdateMeetingInput[] = []
    const store = makeStore(captured, updates)
    const runClaude = vi.fn()
    const fetchImpl = makeOllamaFetch()

    const result = await extractMeeting('m1', {
      runClaude,
      store,
      providerPref: 'ollama',
      ollama: { fetchImpl },
    })

    // claude NUNCA chamado no modo ollama.
    expect(runClaude).not.toHaveBeenCalled()
    // generate foi pro /api/generate com format = JSON Schema do zod.
    const genCall = fetchImpl.mock.calls.find((c) => c[0].endsWith('/api/generate'))
    expect(genCall).toBeDefined()
    const sentBody = JSON.parse(genCall![1]?.body as string)
    expect(sentBody.format).toEqual(ollamaResultJsonSchema)
    expect(sentBody.stream).toBe(false)
    expect(sentBody.options.temperature).toBe(0)
    // extractor carimbado como ollama:<model>.
    expect(updates[0]?.extractor).toBe('ollama:qwen2.5:7b')
    expect(result.extractions).toHaveLength(2)
  })

  it('auto: claude falha + Ollama disponível → fallback Ollama', async () => {
    const captured: MeetingExtraction[] = []
    const updates: UpdateMeetingInput[] = []
    const store = makeStore(captured, updates)
    // claude indisponível (127).
    const runClaude = vi.fn(async (): Promise<RunResult> => ({ stdout: '', stderr: 'not found', code: 127 }))
    const fetchImpl = makeOllamaFetch({ available: true })

    const result = await extractMeeting('m1', {
      runClaude,
      store,
      providerPref: 'auto',
      ollama: { fetchImpl },
    })

    expect(runClaude).toHaveBeenCalledOnce() // tentou claude…
    expect(updates[0]?.extractor).toBe('ollama:qwen2.5:7b') // …e caiu no ollama.
    expect(result.extractions).toHaveLength(2)
  })

  it('auto: claude falha + Ollama indisponível → erro do claude sobe', async () => {
    const store = makeStore([], [])
    const runClaude = vi.fn(async (): Promise<RunResult> => ({ stdout: '', stderr: 'not found', code: 127 }))
    const fetchImpl = makeOllamaFetch({ available: false })

    await expect(
      extractMeeting('m1', { runClaude, store, providerPref: 'auto', ollama: { fetchImpl } }),
    ).rejects.toThrow(/exit 127/)
  })

  it('auto: claude OK → usa claude, sem fallback', async () => {
    const captured: MeetingExtraction[] = []
    const updates: UpdateMeetingInput[] = []
    const store = makeStore(captured, updates)
    const runClaude = vi.fn(async (): Promise<RunResult> => okRun(JSON.stringify(MODEL_JSON)))
    const fetchImpl = makeOllamaFetch({ available: true })

    await extractMeeting('m1', { runClaude, store, providerPref: 'auto', ollama: { fetchImpl } })

    expect(runClaude).toHaveBeenCalledOnce()
    expect(updates[0]?.extractor).toBe('claude -p')
    // generate do ollama NÃO foi chamado (só o tags do availability check).
    expect(fetchImpl.mock.calls.some((c) => c[0].endsWith('/api/generate'))).toBe(false)
  })
})

describe('extractMeeting — chunking/map-reduce', () => {
  // Transcript longo: muitos segments até estourar o threshold (~48k chars).
  function longSegments(): MeetingSegment[] {
    const filler = 'palavra '.repeat(120) // ~960 chars/segment
    const segs: MeetingSegment[] = []
    for (let i = 0; i < 80; i++) segs.push(seg(i, `${filler} item-${i}`))
    return segs
  }

  it('fatia transcript longo em múltiplas chamadas e consolida com dedupe', async () => {
    const captured: MeetingExtraction[] = []
    const updates: UpdateMeetingInput[] = []
    const store = makeStore(captured, updates)
    store.listSegments.mockReturnValue(longSegments())

    // generate injetado: conta chamadas e devolve SEMPRE o mesmo item (mesma
    // type+quote) → o overlap/repetição deve colapsar para 1 via dedupe.
    let calls = 0
    const sameItem = {
      summary: 'resumo',
      augmented_notes: 'notas',
      items: [
        {
          type: 'action_item',
          text: 'fazer X',
          assignee: null,
          due_hint: null,
          quote: 'item-1',
          start_ms: null,
          end_ms: null,
          speaker_label: null,
          confidence: 0.8,
          suggested_link: null,
        },
      ],
    }
    const generate = vi.fn(async () => {
      calls++
      return { stdout: JSON.stringify(sameItem), extractorLabel: 'claude -p' }
    })

    const result = await extractMeeting('m1', { store, generate, providerPref: 'claude' })

    // Múltiplos chunks → múltiplas chamadas de geração.
    expect(calls).toBeGreaterThan(1)
    // Dedupe por (type, quote): todos os chunks devolveram o MESMO item → 1 só.
    expect(result.extractions).toHaveLength(1)
    expect(captured).toHaveLength(1)
  })

  it('transcript curto não chunka (1 chamada só)', async () => {
    const captured: MeetingExtraction[] = []
    const store = makeStore(captured, [])
    let calls = 0
    const generate = vi.fn(async () => {
      calls++
      return { stdout: JSON.stringify(MODEL_JSON), extractorLabel: 'claude -p' }
    })

    await extractMeeting('m1', { store, generate, providerPref: 'claude' })
    expect(calls).toBe(1)
  })
})
