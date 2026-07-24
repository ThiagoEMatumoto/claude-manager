import type { LiveStatus } from '../session-switcher/status-view'

// Vocabulário da casa (F1) para os grupos de sessão no palette. O header do
// palette já aplica uppercase — guardamos em caixa normal.
export const WAITING_GROUP = 'No box · sua vez'
export const WORKING_GROUP = 'Em pista · trabalhando'
export const FLAG_GROUP = 'Bandeira · atenção'
export const GARAGE_GROUP = 'Na garagem · ociosa'

// Status vivo → grupo. 'waiting' pede decisão (sua vez); 'working'/'starting'
// estão em pista; 'idle'/'ended' na garagem. Não há status de erro no modelo,
// então o grupo Bandeira fica vazio e é omitido pela render.
export function liveSessionGroup(status: LiveStatus): string {
  switch (status) {
    case 'waiting':
      return WAITING_GROUP
    case 'working':
    case 'starting':
      return WORKING_GROUP
    case 'idle':
    case 'ended':
    default:
      return GARAGE_GROUP
  }
}

// Teto por grupo: sessões aparecem no palette mas não afogam os comandos.
// Como as vivas chegam ordenadas por urgência, o corte mantém as acionáveis.
export const SESSION_GROUP_CAPS: Record<string, number> = {
  [WAITING_GROUP]: 8,
  [WORKING_GROUP]: 8,
  [FLAG_GROUP]: 8,
  [GARAGE_GROUP]: 5,
}

export function capByGroup<T extends { group: string }>(
  items: T[],
  caps: Record<string, number>,
): T[] {
  const counts = new Map<string, number>()
  return items.filter((it) => {
    const cap = caps[it.group]
    if (cap === undefined) return true
    const n = counts.get(it.group) ?? 0
    if (n >= cap) return false
    counts.set(it.group, n + 1)
    return true
  })
}
