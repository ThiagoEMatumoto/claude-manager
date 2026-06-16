import { X } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { useFilesStore } from '@/lib/files-store'
import { FileTree } from './FileTree'
import { FileEditor } from './FileEditor'

export function FilesPanel() {
  const width = useFilesStore((s) => s.width)
  const setOpen = useFilesStore((s) => s.setOpen)
  const error = useFilesStore((s) => s.error)
  const roots = useFilesStore((s) => s.roots)
  const selectedRoot = useFilesStore((s) => s.selectedRoot)
  const selectRoot = useFilesStore((s) => s.selectRoot)

  return (
    <div
      data-testid="files-panel"
      className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center justify-between gap-1 border-b border-[var(--color-border)] px-2 py-1.5">
        {roots.length > 0 ? (
          <select
            data-testid="files-repo-select"
            value={selectedRoot ?? ''}
            onChange={(e) => selectRoot(e.target.value)}
            title="Repositório"
            className="min-w-0 flex-1 truncate rounded bg-transparent text-xs font-medium text-[var(--color-text)] outline-none hover:bg-[var(--color-surface-2)]"
          >
            {roots.map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-medium text-[var(--color-text)]">Arquivos</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Fechar painel de arquivos"
          className="rounded p-1 text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Icon as={X} size={14} />
        </button>
      </header>

      {error && (
        <div className="shrink-0 border-b border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-[1.2] overflow-auto border-b border-[var(--color-border)]">
        <FileTree />
      </div>

      <div className="flex min-h-0 flex-[2] flex-col">
        <FileEditor />
      </div>
    </div>
  )
}
