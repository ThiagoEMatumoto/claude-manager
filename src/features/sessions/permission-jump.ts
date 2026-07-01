import type { PermissionMode } from '../../../shared/types/ipc'

export type JumpDecision = 'reached' | 'stop' | 'step'

// Decide o proximo passo do "pular ate o modo alvo" via Shift+Tab ciclico.
// current=modo agora (parseado); target=alvo; start=modo antes de comecar; steps=nº de transicoes ja observadas.
export function jumpDecision(
  current: PermissionMode | null,
  target: PermissionMode,
  start: PermissionMode | null,
  steps: number,
  max = 8,
): JumpDecision {
  if (current === target) return 'reached'
  if (steps >= max) return 'stop'
  if (steps > 0 && current === start) return 'stop' // ciclou de volta sem achar -> inalcancavel
  return 'step'
}
