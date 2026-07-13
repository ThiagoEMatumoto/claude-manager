// Tabela de preço local (USD por token). Match por substring do `message.model`
// (`fable`/`opus`/`sonnet`/`haiku`) pra tolerar sufixos de versão/data
// (claude-fable-5, claude-opus-4-8, claude-haiku-4-5-20251001, etc). Nunca vai
// pra rede — é uma constante editável. 'opusplan' não entra: é alias de
// comportamento da CLI e nunca aparece em transcripts.
//
// Valores derivados das tabelas públicas da Anthropic (jun/2026, USD por milhão
// de tokens), convertidos pra por-token. cacheWrite = cache_creation (write 5m).
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const PER_MILLION = 1_000_000

// USD por milhão de tokens → convertido pra por-token na constante abaixo.
const TABLE_PER_MILLION: Record<string, ModelPrice> = {
  fable: { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 },
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

const PRICES: Record<string, ModelPrice> = Object.fromEntries(
  Object.entries(TABLE_PER_MILLION).map(([key, p]) => [
    key,
    {
      input: p.input / PER_MILLION,
      output: p.output / PER_MILLION,
      cacheRead: p.cacheRead / PER_MILLION,
      cacheWrite: p.cacheWrite / PER_MILLION,
    },
  ]),
)

// Resolve o preço por substring. Retorna null se não houver match — o chamador
// soma 0 ao custo e adiciona o modelo a unknownModels.
export function resolvePrice(model: string): ModelPrice | null {
  const lower = model.toLowerCase()
  for (const key of Object.keys(PRICES)) {
    if (lower.includes(key)) return PRICES[key]
  }
  return null
}
