import { fmtTokens } from '../overview/usage-format'
import { modelAliasFromId, type ModelAlias } from './ModelPill'

// Limite da janela de contexto (tokens de input) por modelo. opus/sonnet operam
// na janela de 1M; haiku em 200k. Default conservador de 200k pra ids que não
// casam com nenhum alias conhecido — subestimar o limite só deixa o % mais
// alarmista, nunca esconde consumo real.
export const MODEL_CONTEXT_LIMITS: Record<ModelAlias, number> = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  haiku: 200_000,
}

const DEFAULT_LIMIT = 200_000

export interface ContextUsage {
  used: number
  limit: number
  pct: number
}

// Cálculo puro do uso de contexto. `tokens.context` já é `cache_read + input`
// (a janela efetivamente ocupada na última resposta do assistant). Retorna null
// quando faltam tokens OU modelo — sem os dois não há como dimensionar o uso, e
// o indicador não deve renderizar nada (sessão recém-aberta, sem 1ª resposta).
export function contextUsage(input: {
  tokens?: { output: number; context: number }
  model: string | null
}): ContextUsage | null {
  const ctx = input.tokens?.context
  if (ctx == null || input.model == null) return null
  const alias = modelAliasFromId(input.model)
  const limit = alias ? MODEL_CONTEXT_LIMITS[alias] : DEFAULT_LIMIT
  const pct = limit > 0 ? Math.min(100, Math.round((ctx / limit) * 100)) : 0
  return { used: ctx, limit, pct }
}

// "95k / 1.0M · 10%" — reusa o formatador compacto de tokens da Home pra manter
// consistência visual com o resto do app.
export function formatContextUsage(u: ContextUsage): string {
  return `${fmtTokens(u.used)} / ${fmtTokens(u.limit)} · ${u.pct}%`
}
