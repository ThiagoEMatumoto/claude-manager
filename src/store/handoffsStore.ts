import { create } from 'zustand'
import { handoffsApi } from '@/lib/ipc'
import { useAppStore } from './appStore'
import type { Handoff } from '../../shared/types/ipc'

// Dono único da assinatura de onUpdated — assinada uma vez (StrictMode-safe),
// mesmo padrão do objectivesStore.
let offUpdated: (() => void) | null = null
let updatedStarted = false

interface HandoffsState {
  handoffs: Handoff[]
  loading: boolean
  error: string | null

  load: () => Promise<void>
  reject: (id: string) => Promise<void>
  // Aprova o handoff (com o prompt possivelmente editado), resolve o repo-alvo,
  // spawna a sessão-filha via openSession do appStore e marca mark-running com o
  // id da sessão criada. Erro de spawn vira `error` visível (não deixa o handoff
  // preso silenciosamente).
  approve: (id: string, editedPrompt: string) => Promise<void>

  startUpdatedWatch: () => void
  stopUpdatedWatch: () => void
}

export const useHandoffsStore = create<HandoffsState>((set, get) => ({
  handoffs: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const handoffs = await handoffsApi.list()
      set({ handoffs, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  reject: async (id) => {
    try {
      await handoffsApi.reject(id)
      await get().load()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  approve: async (id, editedPrompt) => {
    const handoff = get().handoffs.find((h) => h.id === id)
    set({ error: null })
    try {
      await handoffsApi.approve({ id, composedPrompt: editedPrompt })
      const ctx = await handoffsApi.spawnContext(id)
      const childSessionId = await useAppStore
        .getState()
        .openSession(
          ctx.repo,
          ctx.projectName,
          ctx.projectIcon,
          ctx.projectColor,
          undefined,
          handoff?.featureId ?? undefined,
          `handoff: ${ctx.repo.label}`,
          editedPrompt,
          undefined,
        )
      await handoffsApi.markRunning({ id, childSessionId })
      await get().load()
    } catch (err) {
      // Spawn/approve falhou: marca o handoff como failed (erro visível no inbox)
      // em vez de deixá-lo preso em approved sem filha. Mostra o erro e recarrega.
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await handoffsApi.fail({ id, error: msg })
      } catch {
        // fail() também falhou (IPC indisponível): só exibe o erro no store.
      }
      set({ error: msg })
      await get().load()
      throw err
    }
  },

  startUpdatedWatch: () => {
    if (updatedStarted) return
    updatedStarted = true
    offUpdated = handoffsApi.onUpdated(() => {
      void get().load()
    })
  },

  stopUpdatedWatch: () => {
    if (offUpdated) {
      offUpdated()
      offUpdated = null
    }
    updatedStarted = false
  },
}))

// Derivado: handoffs pendentes (aguardando gate humano). Recebe a lista crua —
// NÃO use como selector zustand (filter retorna array novo a cada chamada → loop
// de re-render no v5). Derive com useMemo no componente sobre `handoffs`.
export function pendingHandoffs(handoffs: Handoff[]): Handoff[] {
  return handoffs.filter((h) => h.status === 'pending')
}
