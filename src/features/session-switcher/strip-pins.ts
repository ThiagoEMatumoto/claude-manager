// Lógica pura de ordenação/higiene dos pins do SessionStrip. Separada do store
// pra ser testável sem window.api (mesmo padrão de session-prefs-store).

// Sanitiza o JSON persistido em app_prefs: só strings, sem duplicatas. NÃO
// filtra contra sessões vivas aqui — no boot a lista de sessões ainda pode
// estar vazia e podaríamos pins válidos; a poda acontece em prunePinnedIds.
export function sanitizePinnedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

// Higiene: descarta pins de sessões que não existem mais. Retorna o MESMO array
// quando nada muda, pra callers poderem pular persistência/re-render.
export function prunePinnedIds(pinnedIds: string[], liveIds: ReadonlySet<string>): string[] {
  const pruned = pinnedIds.filter((id) => liveIds.has(id))
  return pruned.length === pinnedIds.length ? pinnedIds : pruned
}

export function togglePinnedId(pinnedIds: string[], id: string): string[] {
  return pinnedIds.includes(id) ? pinnedIds.filter((p) => p !== id) : [...pinnedIds, id]
}

// Fixados primeiro, na ordem em que foram fixados; o resto mantém a ordem de
// entrada. Sem auto-reorder por status — tab que pula sozinha é anti-padrão.
export function orderSessions<T extends { id: string }>(sessions: T[], pinnedIds: string[]): T[] {
  if (pinnedIds.length === 0) return sessions
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const pinned: T[] = []
  for (const id of pinnedIds) {
    const s = byId.get(id)
    if (s) pinned.push(s)
  }
  if (pinned.length === 0) return sessions
  const pinnedSet = new Set(pinned.map((s) => s.id))
  return [...pinned, ...sessions.filter((s) => !pinnedSet.has(s.id))]
}
