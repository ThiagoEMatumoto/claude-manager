import { useEffect } from 'react'
import { Eye, Pencil, Save } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { MarkdownViewer } from '@/components/ui/MarkdownViewer'
import { useFilesStore } from '@/lib/files-store'

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

export function FileEditor() {
  const openFile = useFilesStore((s) => s.openFile)
  const setContent = useFilesStore((s) => s.setContent)
  const setMode = useFilesStore((s) => s.setMode)
  const save = useFilesStore((s) => s.save)

  // Ctrl+S / Cmd+S salva, sem disparar o "salvar página" do browser/Electron.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        if (!useFilesStore.getState().openFile) return
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  if (!openFile) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-[var(--color-text-dim)]">
        Selecione um arquivo na árvore para editar.
      </div>
    )
  }

  const isMd = openFile.path.endsWith('.md')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text)]" title={openFile.path}>
          <span className="truncate">{basename(openFile.path)}</span>
          {openFile.dirty && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--color-accent)' }}
              title="Alterações não salvas"
            />
          )}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isMd && (
            <button
              type="button"
              onClick={() => setMode(openFile.mode === 'edit' ? 'preview' : 'edit')}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-1 text-[11px] text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)]"
              title={openFile.mode === 'edit' ? 'Pré-visualizar' : 'Editar'}
            >
              <Icon as={openFile.mode === 'edit' ? Eye : Pencil} size={13} />
              {openFile.mode === 'edit' ? 'Preview' : 'Editar'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!openFile.dirty}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-1 text-[11px] text-[var(--color-text)] transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Salvar (Ctrl+S)"
          >
            <Icon as={Save} size={13} />
            Salvar
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isMd && openFile.mode === 'preview' ? (
          <div className="markdown-body px-4 py-3 text-sm leading-relaxed text-[var(--color-text)]">
            <MarkdownViewer content={openFile.content} />
          </div>
        ) : (
          <textarea
            data-testid="file-editor-textarea"
            value={openFile.content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-full w-full resize-none bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-[var(--color-text)] outline-none"
          />
        )}
      </div>
    </div>
  )
}
