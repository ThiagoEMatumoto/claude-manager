// Cliente mínimo do Ollama (HTTP local) para a extração de reunião offline/
// privada. Sem deps: usa o `fetch` global (Node 18+/Electron). Só o subconjunto
// que a extração precisa: detectar disponibilidade (`GET /api/tags`) e gerar com
// JSON Schema enforçado (`POST /api/generate` com `format`, stream:false).
//
// Função PURA-ish (I/O via fetch injetável) para ser testável sem rede: os testes
// passam um `fetchImpl` que devolve respostas mockadas.

const DEFAULT_HOST = 'http://localhost:11434'
const DEFAULT_MODEL = 'qwen2.5:7b'

export type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface OllamaOptions {
  host?: string
  model?: string
  fetchImpl?: FetchLike
  // Timeout por chamada de generate. tags usa metade.
  timeoutMs?: number
}

function resolvedFetch(opts: OllamaOptions): FetchLike {
  if (opts.fetchImpl) return opts.fetchImpl
  // O fetch global do Electron/Node tem assinatura compatível com FetchLike.
  return globalThis.fetch as unknown as FetchLike
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

// `GET /api/tags` — Ollama no ar? Qualquer falha (ECONNREFUSED, timeout, !ok)
// vira `false` (fail-closed: sem Ollama = indisponível, não exceção).
export async function isOllamaAvailable(opts: OllamaOptions = {}): Promise<boolean> {
  const host = opts.host?.trim() || DEFAULT_HOST
  const fetchImpl = resolvedFetch(opts)
  const timeoutMs = opts.timeoutMs ?? 4_000
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl(`${host}/api/tags`, {
        method: 'GET',
        signal,
      } as RequestInit)
      return res.ok
    })
  } catch {
    return false
  }
}

export interface OllamaGenerateResult {
  // O texto que o modelo gerou (campo `response` do /api/generate). Com `format`
  // de JSON Schema, vem já como JSON serializado.
  response: string
  // Modelo efetivamente usado (eco do request) — pra carimbar o `extractor`.
  model: string
}

// `POST /api/generate` com JSON Schema (`format`), determinístico (temp 0),
// stream:false. Lança em erro de rede/HTTP — o caller decide o fallback.
export async function ollamaGenerate(
  prompt: string,
  format: unknown,
  opts: OllamaOptions = {},
): Promise<OllamaGenerateResult> {
  const host = opts.host?.trim() || DEFAULT_HOST
  const model = opts.model?.trim() || DEFAULT_MODEL
  const fetchImpl = resolvedFetch(opts)
  const timeoutMs = opts.timeoutMs ?? 120_000

  const body = {
    model,
    prompt,
    format,
    stream: false as const,
    options: { temperature: 0 },
    keep_alive: '30s',
  }

  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetchImpl(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    } as RequestInit)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Ollama /api/generate falhou (HTTP ${res.status}): ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as { response?: unknown; model?: unknown }
    const response = typeof data.response === 'string' ? data.response : ''
    return { response, model: typeof data.model === 'string' ? data.model : model }
  })
}

export const OLLAMA_DEFAULTS = { host: DEFAULT_HOST, model: DEFAULT_MODEL }
