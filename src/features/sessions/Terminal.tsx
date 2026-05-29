// D0 minimal terminal: shows raw PTY output in a <pre>, captures keystrokes
// and writes them back. Will be replaced with xterm.js in D0.5 once the
// install finishes — but already exercises the full IPC pipeline end-to-end.

import { useEffect, useRef } from 'react'
import { useSession } from './useSession'

interface Props {
  repoId: string
  repoLabel: string
  repoPath: string
}

export function Terminal({ repoId, repoLabel, repoPath }: Props) {
  const { session, buffer, exited, exitCode, error, start, write, kill } = useSession(repoId)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void start()
    return () => kill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId])

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight })
  }, [buffer])

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!session || exited) return
    e.preventDefault()

    if (e.key === 'Enter') return write('\r')
    if (e.key === 'Backspace') return write('\x7f')
    if (e.key === 'Tab') return write('\t')
    if (e.key === 'Escape') return write('\x1b')
    if (e.key === 'ArrowUp') return write('\x1b[A')
    if (e.key === 'ArrowDown') return write('\x1b[B')
    if (e.key === 'ArrowRight') return write('\x1b[C')
    if (e.key === 'ArrowLeft') return write('\x1b[D')

    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0) - 64
      if (code >= 1 && code <= 26) return write(String.fromCharCode(code))
    }

    if (e.key.length === 1) write(e.key)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{repoLabel}</span>
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
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            kill
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto bg-black p-3 font-mono text-[13px] leading-tight outline-none"
      >
        <pre className="whitespace-pre-wrap break-all text-green-300">{buffer}</pre>
        {!session && !error && (
          <div className="text-[var(--color-text-dim)]">iniciando…</div>
        )}
      </div>
    </div>
  )
}
