import { afterEach, describe, expect, it, vi } from 'vitest'
import { TavilySourceProvider } from './tavily-source-provider'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => body,
    text: async () => '',
  } as unknown as Response
}

function textResponse(text: string, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    text: async () => text,
    json: async () => ({}),
  } as unknown as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('TavilySourceProvider — construtor', () => {
  it('exige a chave', () => {
    expect(() => new TavilySourceProvider('')).toThrow(/TAVILY_API_KEY/)
  })
})

describe('TavilySourceProvider.search', () => {
  it('mapeia results→snippets com sourceClass e envia chave + max_results', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        results: [
          { title: 'TCU', url: 'https://portal.tcu.gov.br/audit', content: 'fila de perícia' },
          { title: 'Astrea', url: 'https://www.aurum.com.br/astrea', content: 'CRM jurídico' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new TavilySourceProvider('tvly-test')
    const snippets = await provider.search('bpc loas perícia', { limit: 4 })

    expect(snippets).toHaveLength(2)
    expect(snippets[0].sourceClass).toBe('primary_official')
    expect(snippets[0].snippet).toBe('fila de perícia')
    expect(snippets[0].publisher).toBe('portal.tcu.gov.br')
    expect(snippets[1].sourceClass).toBe('vendor_marketing')

    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(String(endpoint)).toContain('api.tavily.com/search')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.api_key).toBe('tvly-test')
    expect(body.max_results).toBe(4)
    expect(body.query).toBe('bpc loas perícia')
  })

  it('lança erro claro em HTTP não-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 401)))
    const provider = new TavilySourceProvider('tvly-test')
    await expect(provider.search('x')).rejects.toThrow(/Tavily/)
  })
})

describe('TavilySourceProvider.fetch', () => {
  it('busca via Jina Reader e devolve texto + segmentos com âncora real', async () => {
    const md =
      '# Título da Página\n\n' +
      'Parágrafo substancial com bem mais de sessenta caracteres para virar um segmento de proveniência rastreável.\n\n' +
      'curto'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      textResponse(md),
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new TavilySourceProvider('tvly-test')
    const doc = await provider.fetch('https://exemplo.com/p')

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://r.jina.ai/https://exemplo.com/p')
    expect(doc.text).toBe(md)
    expect(doc.title).toBe('Título da Página')
    expect(doc.segments && doc.segments.length).toBeGreaterThanOrEqual(1)
    // O segmento é substring exata de doc.text (o extractor casa por indexOf).
    const seg = doc.segments![0]
    expect(doc.text.includes(seg.text)).toBe(true)
    expect(seg.anchor).toMatch(/^char:\d+$/)
  })

  it('lança em erro do Jina', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('', false, 500)))
    const provider = new TavilySourceProvider('tvly-test')
    await expect(provider.fetch('https://x.com')).rejects.toThrow(/Jina/)
  })
})
