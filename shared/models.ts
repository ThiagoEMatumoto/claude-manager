// Registro canônico dos modelos do Claude Code conhecidos pelo app — fonte ÚNICA
// de onde TODAS as whitelists derivam: aliases do pill (/model), whitelist do
// --model no spawn (re-validada no main), opções dos dialogs, limites de contexto
// e gate de xhigh. Módulo PURO (sem electron, sem I/O), compartilhado entre
// renderer e main. Mudou modelo/limite/capacidade → muda AQUI, os derivados seguem.
//
// Anti-injeção: os aliases abaixo são literais e são a ÚNICA fonte do que pode
// ser injetado no PTY (/model) ou chegar à linha de comando (--model). Nunca
// interpolar texto livre a partir deles; o main SEMPRE re-valida o que recebe.
//
// Dados oficiais (docs Anthropic, jun/2026). 'opusplan' é alias de COMPORTAMENTO
// da CLI (Opus no plan mode, Sonnet na execução) — não é model id de API e NUNCA
// aparece em transcripts, mas é valor válido de /model e de --model.

export interface ModelInfo {
  alias: string
  label: string
  contextLimit: number
  supportsXhigh: boolean
  // Aceito como --model no spawn (e como /model na sessão viva).
  spawnable: boolean
}

export const MODEL_REGISTRY = [
  { alias: 'fable', label: 'Fable', contextLimit: 1_000_000, supportsXhigh: true, spawnable: true },
  { alias: 'opus', label: 'Opus', contextLimit: 1_000_000, supportsXhigh: true, spawnable: true },
  { alias: 'sonnet', label: 'Sonnet', contextLimit: 1_000_000, supportsXhigh: true, spawnable: true },
  { alias: 'haiku', label: 'Haiku', contextLimit: 200_000, supportsXhigh: false, spawnable: true },
  {
    alias: 'opusplan',
    label: 'Opus Plan',
    contextLimit: 1_000_000,
    supportsXhigh: true,
    spawnable: true,
  },
] as const satisfies readonly ModelInfo[]

export type ModelAlias = (typeof MODEL_REGISTRY)[number]['alias']

export const MODEL_ALIASES: readonly ModelAlias[] = MODEL_REGISTRY.map((m) => m.alias)

export const MODEL_LABELS = Object.fromEntries(
  MODEL_REGISTRY.map((m) => [m.alias, m.label]),
) as Record<ModelAlias, string>

// Limite da janela de contexto (tokens de input) por modelo.
export const MODEL_CONTEXT_LIMITS = Object.fromEntries(
  MODEL_REGISTRY.map((m) => [m.alias, m.contextLimit]),
) as Record<ModelAlias, number>

export const MODEL_SUPPORTS_XHIGH = Object.fromEntries(
  MODEL_REGISTRY.map((m) => [m.alias, m.supportsXhigh]),
) as Record<ModelAlias, boolean>

// Aliases aceitos como --model no spawn — base da SPAWN_MODEL_WHITELIST do main.
export const SPAWNABLE_MODEL_ALIASES: readonly ModelAlias[] = MODEL_REGISTRY.filter(
  (m) => m.spawnable,
).map((m) => m.alias)

// Match do alias mais específico primeiro (por comprimento decrescente):
// 'opusplan' precisa vencer 'opus' quando o valor comparado o contém. Transcripts
// nunca reportam opusplan (a CLI reporta opus/sonnet), mas o match específico
// protege comparações de valores de /model e ids futuros que embutam outro alias.
const ALIASES_BY_SPECIFICITY: readonly ModelAlias[] = [...MODEL_ALIASES].sort(
  (a, b) => b.length - a.length,
)

// Mapeia o model id completo do transcript (ex: 'claude-opus-4-8-...',
// 'claude-fable-5') pro alias exibível, por substring. Ids desconhecidos
// (ou '<synthetic>') → null.
export function modelAliasFromId(id: string | null | undefined): ModelAlias | null {
  if (!id) return null
  const lower = id.toLowerCase()
  for (const alias of ALIASES_BY_SPECIFICITY) {
    if (lower.includes(alias)) return alias
  }
  return null
}
