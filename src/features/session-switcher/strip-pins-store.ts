import { create } from 'zustand'
import { prefsApi } from '@/lib/ipc'
import { prunePinnedIds, sanitizePinnedIds, togglePinnedId } from './strip-pins'

const PINNED_SESSIONS_KEY = 'strip.pinnedSessions'

interface StripPinsState {
  // Ids de sessão (LiveSessionInfo.id) fixados, na ordem em que foram fixados.
  // Persistido em app_prefs; o SessionStrip poda ids de sessões mortas via prune.
  pinnedIds: string[]
  loaded: boolean
  load: () => Promise<void>
  togglePin: (id: string) => Promise<void>
  prune: (liveIds: ReadonlySet<string>) => Promise<void>
}

export const useStripPinsStore = create<StripPinsState>((set, get) => ({
  pinnedIds: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const raw = await prefsApi.get<unknown>(PINNED_SESSIONS_KEY)
    set({ pinnedIds: sanitizePinnedIds(raw), loaded: true })
  },

  togglePin: async (id) => {
    const next = togglePinnedId(get().pinnedIds, id)
    set({ pinnedIds: next })
    await prefsApi.set(PINNED_SESSIONS_KEY, next)
  },

  prune: async (liveIds) => {
    const { pinnedIds, loaded } = get()
    if (!loaded) return
    const next = prunePinnedIds(pinnedIds, liveIds)
    if (next === pinnedIds) return
    set({ pinnedIds: next })
    await prefsApi.set(PINNED_SESSIONS_KEY, next)
  },
}))
