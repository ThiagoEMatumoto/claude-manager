import type { SubagentActivity } from '../../../shared/types/ipc'

// Módulo PURO (sem electron/fs): recebe as metas dos subagentes + o TEXTO do
// tail de 64KB do transcript já lido pelo session-activity e deriva o estado de
// cada subagente cruzando toolUseId com os tool_use/tool_result do tail.

export interface SubagentMetaInput {
  toolUseId: string
  name: string
  description: string
}

// Cap de itens no payload: o HUD só mostra os primeiros; manter o broadcast enxuto.
export const MAX_SUBAGENTS = 4

interface TailContentItem {
  type?: string
  id?: string
  tool_use_id?: string
  is_error?: boolean
}

interface TailLine {
  message?: {
    content?: TailContentItem[] | string
  }
}

// Regras:
// - tool_result com o tool_use_id da meta presente no tail → 'ok' ou 'error' (is_error)
// - tool_use visto sem tool_result → 'running'
// - nenhum dos dois no tail → OMITIR (subagente antigo, fora da janela de 64KB)
// Ordenação: running primeiro (ordem de disparo), depois concluídos do mais
// recente pro mais antigo. Cap de MAX_SUBAGENTS itens.
export function deriveSubagentActivity(
  metas: SubagentMetaInput[],
  tail: string
): SubagentActivity[] {
  const toolUses = new Map<string, number>()
  const results = new Map<string, { isError: boolean; order: number }>()
  let order = 0

  for (const raw of tail.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let parsed: TailLine
    try {
      parsed = JSON.parse(line) as TailLine
    } catch {
      continue // linha partida (início do tail) ou escrita parcial — ignorar.
    }
    const content = parsed.message?.content
    if (!Array.isArray(content)) continue
    for (const item of content) {
      if (item.type === 'tool_use' && typeof item.id === 'string') {
        toolUses.set(item.id, order++)
      } else if (item.type === 'tool_result' && typeof item.tool_use_id === 'string') {
        results.set(item.tool_use_id, { isError: item.is_error === true, order: order++ })
      }
    }
  }

  const running: { activity: SubagentActivity; order: number }[] = []
  const done: { activity: SubagentActivity; order: number }[] = []
  for (const meta of metas) {
    const result = results.get(meta.toolUseId)
    if (result) {
      done.push({
        activity: {
          name: meta.name,
          description: meta.description,
          state: result.isError ? 'error' : 'ok',
        },
        order: result.order,
      })
      continue
    }
    const useOrder = toolUses.get(meta.toolUseId)
    if (useOrder !== undefined) {
      running.push({
        activity: { name: meta.name, description: meta.description, state: 'running' },
        order: useOrder,
      })
    }
    // Sem tool_use nem tool_result no tail → omitido.
  }

  running.sort((a, b) => a.order - b.order)
  done.sort((a, b) => b.order - a.order)
  return [...running, ...done].slice(0, MAX_SUBAGENTS).map((e) => e.activity)
}
