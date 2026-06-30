import type { SessionActivity } from '../../../shared/types/ipc'
import type { EffortLevel, ModelAlias } from './ModelPill'

export type ActivityStatus = SessionActivity['status']

// Troca de modelo/esforço escolhida enquanto a sessão está ocupada, aguardando o
// próximo idle pra ser injetada. Uma pendência por tipo — a última troca de cada
// tipo vence (ver mergePending).
export interface PendingSelection {
  model?: ModelAlias
  effort?: EffortLevel
  // Ativação enfileirada do mecanismo nativo `/effort ultracode` (não é um nível
  // de --effort). Mutuamente exclusivo com `effort` — selecionar um cancela o outro.
  ultracode?: boolean
}

export interface FlushResult {
  // O que injetar agora (null = nada a fazer neste passo).
  apply: PendingSelection | null
  // Pendência restante após este passo.
  pending: PendingSelection
}

export function isPendingEmpty(p: PendingSelection): boolean {
  return p.model === undefined && p.effort === undefined && !p.ultracode
}

// Acumula uma nova troca sobre a pendência atual. Última troca de cada tipo
// vence; model e effort coexistem.
export function mergePending(prev: PendingSelection, change: PendingSelection): PendingSelection {
  return { ...prev, ...change }
}

// Decide o flush da fila no momento em que o status muda. Só injeta na TRANSIÇÃO
// para 'idle' (único estado seguro p/ injetar /model | /effort) e exatamente uma
// vez: ao aplicar, a pendência é zerada, então um 'idle' subsequente sem nova
// troca é no-op. Permanecer em idle (prev === idle) não re-injeta.
export function nextPendingApply(
  prev: ActivityStatus | null,
  current: ActivityStatus | null,
  pending: PendingSelection,
): FlushResult {
  const becameIdle = current === 'idle' && prev !== 'idle'
  if (becameIdle && !isPendingEmpty(pending)) {
    return { apply: pending, pending: {} }
  }
  return { apply: null, pending }
}
