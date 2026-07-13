import { create } from 'zustand'

// Toasts LOCAIS do renderer (com ação opcional, ex: "Desfazer"), renderizados
// pelo NotificationToast junto com os eventos vindos do main via IPC. Store
// próprio porque o canal IPC não carrega callbacks de ação.
export interface LocalToast {
  id: number
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
  durationMs: number
}

interface ToastState {
  toasts: LocalToast[]
  show: (toast: Omit<LocalToast, 'id' | 'durationMs'> & { durationMs?: number }) => number
  dismiss: (id: number) => void
}

const DEFAULT_DURATION_MS = 6000

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  show: (toast) => {
    const id = nextId++
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id, durationMs: toast.durationMs ?? DEFAULT_DURATION_MS }],
    }))
    return id
  },

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

// Atalho pra código fora de componentes React (ex: appStore).
export function showToast(
  toast: Omit<LocalToast, 'id' | 'durationMs'> & { durationMs?: number },
): number {
  return useToastStore.getState().show(toast)
}

export function dismissToast(id: number): void {
  useToastStore.getState().dismiss(id)
}
