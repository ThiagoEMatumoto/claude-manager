import { create } from 'zustand'
import { fsApi } from '@/lib/ipc'

// Persistência leve só de `open` e `width` (mesmo padrão do appStore: localStorage
// no renderer, sem IPC/DB). O resto do estado é volátil por sessão.
const PERSIST_KEY = 'cm:files-panel'
const DEFAULT_WIDTH = 280

interface Persisted {
  open: boolean
  width: number
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { open: false, width: DEFAULT_WIDTH }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      open: parsed.open ?? false,
      width: typeof parsed.width === 'number' ? parsed.width : DEFAULT_WIDTH,
    }
  } catch {
    return { open: false, width: DEFAULT_WIDTH }
  }
}

function writePersisted(p: Persisted): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(p))
  } catch {
    // localStorage indisponível — estado segue só em memória.
  }
}

export type FileMode = 'edit' | 'preview'

export interface OpenFile {
  path: string
  content: string
  dirty: boolean
  mode: FileMode
}

export interface FileRoot {
  name: string
  path: string
}

interface FilesState {
  open: boolean
  width: number
  roots: FileRoot[]
  selectedRoot: string | null
  expanded: Set<string>
  openFile: OpenFile | null
  error: string | null

  toggle: () => void
  setOpen: (open: boolean) => void
  setWidth: (width: number) => void
  setRoots: (roots: FileRoot[]) => void
  selectRoot: (path: string) => void
  setError: (error: string | null) => void
  toggleDir: (path: string) => void
  openPath: (path: string) => Promise<void>
  setContent: (text: string) => void
  setMode: (mode: FileMode) => void
  save: () => Promise<void>
}

const persisted = readPersisted()

export const useFilesStore = create<FilesState>((set, get) => ({
  open: persisted.open,
  width: persisted.width,
  roots: [],
  selectedRoot: null,
  expanded: new Set<string>(),
  openFile: null,
  error: null,

  toggle: () => {
    const next = !get().open
    writePersisted({ open: next, width: get().width })
    set({ open: next })
  },

  setOpen: (open) => {
    writePersisted({ open, width: get().width })
    set({ open })
  },

  setWidth: (width) => {
    writePersisted({ open: get().open, width })
    set({ width })
  },

  setRoots: (roots) => {
    // Pré-seleciona o primeiro repo (e auto-expande pra disparar o listDir do
    // root, senão a árvore nasce vazia). Mantém a seleção se ainda for válida.
    const cur = get().selectedRoot
    const stillValid = cur != null && roots.some((r) => r.path === cur)
    const nextSelected = stillValid ? cur : (roots[0]?.path ?? null)
    const expanded = new Set(get().expanded)
    if (nextSelected) expanded.add(nextSelected)
    set({ roots, selectedRoot: nextSelected, expanded })
  },

  selectRoot: (path) => {
    // Auto-expande o root escolhido pra carregar a árvore na hora.
    const expanded = new Set(get().expanded)
    expanded.add(path)
    set({ selectedRoot: path, expanded })
  },

  setError: (error) => set({ error }),

  toggleDir: (path) => {
    const next = new Set(get().expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ expanded: next })
  },

  openPath: async (path) => {
    try {
      const f = await fsApi.readFile(path)
      writePersisted({ open: true, width: get().width })
      set({
        openFile: {
          path,
          content: f.content,
          dirty: false,
          mode: path.endsWith('.md') ? 'preview' : 'edit',
        },
        open: true,
        error: null,
      })
    } catch (err) {
      console.error('[files-store] openPath falhou', path, err)
      set({ error: `Não foi possível abrir ${path}` })
    }
  },

  setContent: (text) => {
    const cur = get().openFile
    if (!cur) return
    set({ openFile: { ...cur, content: text, dirty: true } })
  },

  setMode: (mode) => {
    const cur = get().openFile
    if (!cur) return
    set({ openFile: { ...cur, mode } })
  },

  save: async () => {
    const cur = get().openFile
    if (!cur) return
    try {
      await fsApi.writeFile(cur.path, cur.content)
      // Re-lê do store: setContent pode ter rodado durante o await.
      const latest = get().openFile
      if (latest && latest.path === cur.path && latest.content === cur.content) {
        set({ openFile: { ...latest, dirty: false }, error: null })
      }
    } catch (err) {
      console.error('[files-store] save falhou', cur.path, err)
      set({ error: `Não foi possível salvar ${cur.path}` })
    }
  },
}))
