// Lógica pura de ordenação/higiene dos pins do SessionStrip. Separada do store
// pra ser testável sem window.api (mesmo padrão de session-prefs-store).

// Sanitiza o JSON persistido em app_prefs: só strings, sem duplicatas. NÃO
// filtra contra sessões vivas aqui — no boot a lista de sessões ainda pode
// estar vazia e podaríamos pins válidos; a poda acontece no prune com carência.
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

export interface PruneOutcome {
  pinnedIds: string[]
  // Ids fixados ausentes NESTE snapshot (candidatos a remoção na próxima rodada).
  missing: ReadonlySet<string>
}

// Higiene com carência: só remove um pin quando o id falta em 2 snapshots
// não-vazios CONSECUTIVOS. Um snapshot pode chegar parcial (boot, reconexão do
// watch) e apagar o pin direto nas prefs seria destrutivo e permanente —
// presença em qualquer snapshot zera a carência. `excludeIds` (janela de undo
// do Encerrar) conta como presença: a sessão pode voltar via "Desfazer" e não
// deve nem acumular carência enquanto o toast está de pé.
// Retorna o MESMO array quando nada muda, pra callers pularem persistência.
export function prunePinnedIdsWithGrace(
  pinnedIds: string[],
  liveIds: ReadonlySet<string>,
  excludeIds: ReadonlySet<string>,
  missingLastRound: ReadonlySet<string>,
): PruneOutcome {
  const absent = pinnedIds.filter((id) => !liveIds.has(id) && !excludeIds.has(id))
  const removed = new Set(absent.filter((id) => missingLastRound.has(id)))
  const missing = new Set(absent.filter((id) => !removed.has(id)))
  const next = removed.size === 0 ? pinnedIds : pinnedIds.filter((id) => !removed.has(id))
  return { pinnedIds: next, missing }
}

// Merge do load: persistidos primeiro (ordem original), toggles feitos em
// memória antes do load resolver vão pro final. Retorna a MESMA referência de
// `persisted` quando nada novo entra (skip de persistência).
export function mergePinnedIds(persisted: string[], current: string[]): string[] {
  const additions = current.filter((id) => !persisted.includes(id))
  return additions.length === 0 ? persisted : [...persisted, ...additions]
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
