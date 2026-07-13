export const LIVE_SESSIONS_GROUP = 'Sessões ativas'
export const ENDED_SESSIONS_GROUP = 'Sessões encerradas'

// Teto por grupo: sessões aparecem no palette mas não afogam os comandos.
// Como as vivas chegam ordenadas por urgência, o corte mantém as acionáveis.
export const SESSION_GROUP_CAPS: Record<string, number> = {
  [LIVE_SESSIONS_GROUP]: 8,
  [ENDED_SESSIONS_GROUP]: 5,
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
