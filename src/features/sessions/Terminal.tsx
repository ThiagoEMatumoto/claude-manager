import '@xterm/xterm/css/xterm.css'

import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { sessionsApi } from '@/lib/ipc'
import { useSession } from './useSession'

interface Props {
  repoId: string
  repoLabel: string
  repoPath: string
  onClose: () => void
}

const THEME = {
  background: '#0b0b0f',
  foreground: '#e8e8ef',
  cursor: '#ff7a45',
  cursorAccent: '#0b0b0f',
  selectionBackground: '#2a2a35',
  black: '#14141b',
  brightBlack: '#9c9cae',
}

export function Terminal({ repoId, repoLabel, repoPath, onClose }: Props) {
  const { session, exited, exitCode, error, start, write, kill, resize, setDataHandler } =
    useSession(repoId)
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  const [title, setTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setTitle(session?.title ?? null)
  }, [session?.title])

  const displayTitle = title ?? repoLabel

  function commitRename() {
    setEditing(false)
    const next = draft.trim()
    if (!session || next === (title ?? '')) return
    setTitle(next.length > 0 ? next : null)
    void sessionsApi.rename(session.id, next)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      theme: THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(new SearchAddon())
    term.loadAddon(new ClipboardAddon())
    term.open(host)
    fit.fit()

    xtermRef.current = term
    fitRef.current = fit

    // Registrar o sink antes do spawn garante que os primeiros bytes do claude
    // sejam escritos no xterm sem perda.
    setDataHandler((data) => term.write(data))
    term.onData((d) => write(d))

    void start(term.cols, term.rows)

    const observer = new ResizeObserver(() => {
      if (!xtermRef.current || !fitRef.current) return
      fitRef.current.fit()
      resize(xtermRef.current.cols, xtermRef.current.rows)
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      setDataHandler(null)
      kill()
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder={repoLabel}
              className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-0.5 font-medium outline-none focus:border-[var(--color-accent)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(title ?? '')
                setEditing(true)
              }}
              className="font-medium hover:text-[var(--color-accent)]"
              title="Renomear sessão"
            >
              {displayTitle}
            </button>
          )}
          <span className="text-[var(--color-text-dim)]">{repoPath}</span>
        </div>
        <div className="flex items-center gap-3 text-[var(--color-text-dim)]">
          {session && !exited && <span className="text-emerald-400">● running</span>}
          {exited && <span>● exited ({exitCode ?? '?'})</span>}
          {error && <span className="text-red-400">⚠ {error}</span>}
          <button
            type="button"
            onClick={kill}
            disabled={!session || exited}
            title="Encerrar o processo (claude) nesta sessão"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            kill
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Fechar a pane"
            aria-label="Fechar a pane"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 leading-none hover:bg-[var(--color-surface-2)] hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>

      <div ref={hostRef} className="min-h-0 flex-1 bg-[var(--color-bg)] p-2" />
    </div>
  )
}
