import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import { mergePinnedIds, prunePinnedIdsWithGrace, sanitizePinnedIds, togglePinnedId } from './strip-pins'

const PINNED_SESSIONS_KEY = 'strip.pinnedSessions'

const EMPTY_SET: ReadonlySet<string> = new Set()

// Carência do prune: ids fixados ausentes no ÚLTIMO snapshot não-vazio. Um pin
// só cai quando falta em 2 snapshots consecutivos — snapshot parcial não pode
// apagar pin permanentemente das prefs. Presença zera a carência (ver
// prunePinnedIdsWithGrace). Módulo-level como pendingEnds no appStore.
let missingLastRound: ReadonlySet<string> = new Set()

interface StripPinsState {
  // Ids de sessão (LiveSessionInfo.id) fixados, na ordem em que foram fixados.
  // Persistido em app_prefs; o SessionStrip poda ids de sessões mortas via prune.
  pinnedIds: string[]
  loaded: boolean
  load: () => Promise<void>
  togglePin: (id: string) => Promise<void>
  prune: (liveIds: ReadonlySet<string>, excludeIds?: ReadonlySet<string>) => Promise<void>
}

export const useStripPinsStore = create<StripPinsState>((set, get) => ({
  pinnedIds: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const persisted = sanitizePinnedIds(await prefsApi.get<unknown>(PINNED_SESSIONS_KEY))
    // Merge, não substituição: um toggle feito antes do load resolver já vive
    // em pinnedIds e seria clobberado por um set() cru. Persistidos primeiro
    // (ordem original), toggles pré-load ao final.
    const merged = mergePinnedIds(persisted, get().pinnedIds)
    set({ pinnedIds: merged, loaded: true })
    if (merged !== persisted) await prefsApi.set(PINNED_SESSIONS_KEY, merged)
  },

  togglePin: async (id) => {
    const next = togglePinnedId(get().pinnedIds, id)
    set({ pinnedIds: next })
    // Antes do load, gravar sobrescreveria as prefs com uma lista parcial —
    // o merge do load é quem persiste os toggles pré-load.
    if (get().loaded) await prefsApi.set(PINNED_SESSIONS_KEY, next)
  },

  prune: async (liveIds, excludeIds = EMPTY_SET) => {
    const { pinnedIds, loaded } = get()
    if (!loaded) return
    const result = prunePinnedIdsWithGrace(pinnedIds, liveIds, excludeIds, missingLastRound)
    missingLastRound = result.missing
    if (result.pinnedIds === pinnedIds) return
    set({ pinnedIds: result.pinnedIds })
    await prefsApi.set(PINNED_SESSIONS_KEY, result.pinnedIds)
  },
}))
