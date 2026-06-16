import { useEffect, useState } from 'react'
import { File, Folder, FolderOpen } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { fsApi } from '@/lib/ipc'
import { useFilesStore } from '@/lib/files-store'
import type { FsEntry } from '../../../shared/types/ipc'

interface NodeProps {
  name: string
  path: string
  isDir: boolean
  depth: number
}

function TreeNode({ name, path, isDir, depth }: NodeProps) {
  const expanded = useFilesStore((s) => s.expanded.has(path))
  const toggleDir = useFilesStore((s) => s.toggleDir)
  const openPath = useFilesStore((s) => s.openPath)
  const setError = useFilesStore((s) => s.setError)
  const activePath = useFilesStore((s) => s.openFile?.path ?? null)

  const [children, setChildren] = useState<FsEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  // Busca filhos LAZY apenas quando o diretório está expandido (cacheia depois).
  // IMPORTANTE: deps = [isDir, expanded, path] APENAS. Incluir `children`/`loading`
  // fazia o setLoading(true) re-disparar o effect, cancelar a chamada em voo e travar
  // `loading` em true (o .finally só limpa se !cancelled) — a árvore nunca carregava.
  useEffect(() => {
    if (!isDir || !expanded || children !== null || loading) return
    let cancelled = false
    setLoading(true)
    fsApi
      .listDir(path)
      .then((entries) => {
        if (cancelled) return
        const sorted = [...entries].sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setChildren(sorted)
        setError(null)
      })
      .catch((err) => {
        console.error('[FileTree] listDir falhou', path, err)
        if (!cancelled) {
          setChildren([])
          setError(`Falha ao listar ${path}`)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDir, expanded, path])

  const isActive = !isDir && activePath === path

  return (
    <div>
      <button
        type="button"
        data-testid="file-tree-node"
        data-isdir={String(isDir)}
        onClick={() => (isDir ? toggleDir(path) : void openPath(path))}
        title={path}
        className={`flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-xs transition hover:bg-[var(--color-surface-2)] ${
          isActive ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'
        }`}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <Icon
          as={isDir ? (expanded ? FolderOpen : Folder) : File}
          size={14}
          className="shrink-0"
        />
        <span className="truncate">{name}</span>
      </button>

      {isDir && expanded && children !== null && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.path} name={c.name} path={c.path} isDir={c.isDir} depth={depth + 1} />
          ))}
          {children.length === 0 && (
            <div
              className="px-1.5 py-0.5 text-[10px] text-[var(--color-text-dim)] opacity-60"
              style={{ paddingLeft: 6 + (depth + 1) * 12 }}
            >
              vazio
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FileTree() {
  const roots = useFilesStore((s) => s.roots)
  const selectedRoot = useFilesStore((s) => s.selectedRoot)

  if (roots.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-[var(--color-text-dim)]">
        Nenhuma pasta no projeto ativo.
      </div>
    )
  }

  const root = roots.find((r) => r.path === selectedRoot)
  if (!root) {
    return (
      <div className="px-3 py-4 text-xs text-[var(--color-text-dim)]">
        Selecione um repositório.
      </div>
    )
  }

  return (
    <div className="flex flex-col py-1">
      <TreeNode key={root.path} name={root.name} path={root.path} isDir depth={0} />
    </div>
  )
}
