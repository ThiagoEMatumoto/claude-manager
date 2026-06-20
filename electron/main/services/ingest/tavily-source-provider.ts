import { classifySource } from './classify-source'
import type {
  DocumentSegment,
  FetchedDocument,
  SearchOpts,
  Snippet,
  SourceProvider,
} from '../dossier-pipeline-types'

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
const JINA_PREFIX = 'https://r.jina.ai/'
const DEFAULT_MAX_RESULTS = 6
const FETCH_TIMEOUT_MS = 30_000
const MIN_SEGMENT_CHARS = 60
const MAX_SEGMENTS = 5

interface TavilyResult {
  title?: string
  url: string
  content?: string
  score?: number
}

interface TavilyResponse {
  results?: TavilyResult[]
}

// Provedor de ingestão real do funil: BUSCA via Tavily, FETCH via Jina Reader.
// Cada resultado nasce classificado (classe → trust tier) e o fetch popula
// `segments` com offsets de char reais, pra o extractor produzir verbatim quotes
// rastreáveis. A chave vem só de process.env.TAVILY_API_KEY — nunca hardcoded.
export class TavilySourceProvider implements SourceProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('TavilySourceProvider: TAVILY_API_KEY ausente')
  }

  async search(query: string, opts?: SearchOpts): Promise<Snippet[]> {
    const maxResults = opts?.limit ?? DEFAULT_MAX_RESULTS
    const res = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'basic',
        include_answer: false,
        max_results: maxResults,
      }),
    })
    if (!res.ok) {
      throw new Error(`Tavily search falhou: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as TavilyResponse
    return (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      publisher: hostnameOrUndefined(r.url),
      sourceClass: classifySource(r.url),
      snippet: r.content ?? '',
    }))
  }

  async fetch(url: string): Promise<FetchedDocument> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(`${JINA_PREFIX}${url}`, {
        headers: { Accept: 'text/markdown' },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Jina fetch falhou (${res.status}) para ${url}`)
      }
      const text = await res.text()
      return {
        url,
        title: deriveTitle(text),
        text,
        segments: toSegments(text),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

function hostnameOrUndefined(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

// Primeiro heading markdown como título, se houver.
function deriveTitle(text: string): string | undefined {
  const m = text.match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : undefined
}

// Quebra o markdown em parágrafos substanciais. Cada `text` é substring exata de
// `text` original (o extractor casa por indexOf), e a âncora é o offset de char.
function toSegments(text: string): DocumentSegment[] {
  const segments: DocumentSegment[] = []
  for (const para of text.split(/\n{2,}/)) {
    const trimmed = para.trim()
    if (trimmed.length < MIN_SEGMENT_CHARS || trimmed.startsWith('#')) continue
    const offset = text.indexOf(trimmed)
    if (offset < 0) continue
    segments.push({ anchor: `char:${offset}`, text: trimmed })
    if (segments.length >= MAX_SEGMENTS) break
  }
  return segments
}
