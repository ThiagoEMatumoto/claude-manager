import { describe, it, expect, vi } from 'vitest'
import { isOllamaAvailable, ollamaGenerate, type FetchLike } from './ollama-client'

function fakeFetch(handlers: Record<string, () => Awaited<ReturnType<FetchLike>>>): FetchLike {
  return vi.fn(async (input: string) => {
    for (const [suffix, h] of Object.entries(handlers)) {
      if (input.endsWith(suffix)) return h()
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' }
  })
}

describe('isOllamaAvailable', () => {
  it('true quando /api/tags responde ok', async () => {
    const fetchImpl = fakeFetch({
      '/api/tags': () => ({ ok: true, status: 200, json: async () => ({ models: [] }), text: async () => '' }),
    })
    expect(await isOllamaAvailable({ fetchImpl })).toBe(true)
  })

  it('false quando !ok', async () => {
    const fetchImpl = fakeFetch({
      '/api/tags': () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }),
    })
    expect(await isOllamaAvailable({ fetchImpl })).toBe(false)
  })

  it('false (fail-closed) quando o fetch lança (ECONNREFUSED)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await isOllamaAvailable({ fetchImpl })).toBe(false)
  })
})

describe('ollamaGenerate', () => {
  it('POSTa /api/generate com format/stream/temperature e devolve response+model', async () => {
    const fetchImpl = fakeFetch({
      '/api/generate': () => ({
        ok: true,
        status: 200,
        json: async () => ({ response: '{"ok":true}', model: 'qwen2.5:7b' }),
        text: async () => '',
      }),
    })
    const schema = { type: 'object' }
    const res = await ollamaGenerate('prompt', schema, { fetchImpl, model: 'qwen2.5:7b' })

    expect(res.response).toBe('{"ok":true}')
    expect(res.model).toBe('qwen2.5:7b')
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1]?.body as string)
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.format).toEqual(schema)
    expect(body.stream).toBe(false)
    expect(body.options.temperature).toBe(0)
    expect(body.keep_alive).toBe('30s')
  })

  it('lança em HTTP != ok', async () => {
    const fetchImpl = fakeFetch({
      '/api/generate': () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }),
    })
    await expect(ollamaGenerate('p', {}, { fetchImpl })).rejects.toThrow(/HTTP 500/)
  })
})
