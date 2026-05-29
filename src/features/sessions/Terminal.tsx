import '@xterm/xterm/css/xterm.css'

import { useEffect, useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { sessionsApi } from '@/lib/ipc'
import { useSession } from './useSession'
import type { Session, SessionActivity } from '../../../shared/types/ipc'

interface Props {
  session: Session
  repoLabel: string
  repoPath: string
  projectName: string
  projectIcon?: string | null
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

function activityStatusView(
  status: SessionActivity['status'] | undefined,
): { label: string; className: string } | null {
  switch (status) {
    case 'working':
      return { label: '✦ trabalhando', className: 'text-[var(--color-accent)]' }
    case 'waiting':
      return { label: '⏳ aguardando você', className: 'text-amber-400' }
    case 'idle':
      return { label: '☾ ocioso', className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return { label: '… iniciando', className: 'text-[var(--color-text-dim)]' }
    case 'ended':
    default:
      return null
  }
}

function formatRelative(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `há ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.round(m / 60)
  return `há ${h}h`
}

export function Terminal({
  session,
  repoLabel,
  repoPath,
  projectName,
  projectIcon,
  onClose,
}: Props) {
  const { exited, exitCode, error, write, kill, resize, setDataHandler } = useSession(session.id)
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  const [title, setTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [activity, setActivity] = useState<SessionActivity | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setTitle(session.title ?? null)
  }, [session.title])

  // O ccSessionId é o próprio session.id (ver sessions:spawn no main).
  const ccSessionId = session.ccSessionId ?? null

  useEffect(() => {
    if (!ccSessionId || exited) return
    void sessionsApi.watchActivity(ccSessionId)
    const off = sessionsApi.onActivity((a) => {
      if (a.ccSessionId === ccSessionId) setActivity(a)
    })
    return () => {
      off()
      void sessionsApi.unwatchActivity(ccSessionId)
    }
  }, [ccSessionId, exited])

  // Tick para manter o "há Xs" relativo atualizado sem novos broadcasts.
  useEffect(() => {
    if (!activity?.lastActivityAt || exited) return
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [activity?.lastActivityAt, exited])

  // Precedência do nome em destaque: rename do usuário > name do CC (live) > label do repo.
  const displayTitle = title ?? activity?.name ?? repoLabel

  const statusView = activityStatusView(activity?.status)
  const relTime = activity?.lastActivityAt ? formatRelative(now - activity.lastActivityAt) : null

  function copySelection() {
    const sel = xtermRef.current?.getSelection()
    if (sel) void navigator.clipboard.writeText(sel)
  }

  async function paste() {
    const text = await navigator.clipboard.readText()
    if (text) write(text)
  }

  function commitRename() {
    setEditing(false)
    const next = draft.trim()
    if (next === (title ?? '')) return
    setTitle(next.length > 0 ? next : null)
    void sessionsApi.rename(session.id, next)
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

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

    // O processo já foi spawnado no clique, então pode já ter emitido bytes.
    // Para o replay: acumulamos a saída live num buffer (`liveTotal`) e buscamos
    // o backlog (snapshot do histórico no main). O backlog é prefixo do que vimos
    // até agora; escrevemos o backlog inteiro, depois só a cauda do live que ele
    // ainda não cobria. Assim não duplicamos os bytes que entraram em `liveTotal`
    // enquanto o IPC do backlog estava em voo. Idempotente em remounts (StrictMode)
    // porque o term é novo e zerado a cada mount.
    let flushed = false
    let liveTotal = ''
    setDataHandler((data) => {
      if (flushed) term.write(data)
      else liveTotal += data
    })
    term.onData((d) => write(d))

    void sessionsApi.getBacklog(session.id).then((backlog) => {
      if (xtermRef.current !== term) return
      term.write(backlog)
      if (liveTotal.length > backlog.length) term.write(liveTotal.slice(backlog.length))
      liveTotal = ''
      flushed = true
    })

    // Copy-on-select: copiar automaticamente o que for selecionado.
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) void navigator.clipboard.writeText(sel)
    })

    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // Copiar: Ctrl+Shift+C (todas plataformas), ou Cmd+C no mac só se houver seleção.
      if ((e.ctrlKey && e.shiftKey && e.key === 'C') || (e.shiftKey && e.key === 'C' && e.metaKey)) {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      if (isMac && e.metaKey && !e.shiftKey && e.key === 'c') {
        const sel = term.getSelection()
        if (!sel) return true // sem seleção, deixa o Cmd+C passar
        void navigator.clipboard.writeText(sel)
        return false
      }

      // Colar: Ctrl+Shift+V (todas plataformas) ou Cmd+V no mac.
      if ((e.ctrlKey && e.shiftKey && e.key === 'V') || (isMac && e.metaKey && e.key === 'v')) {
        void paste()
        return false
      }

      // Ctrl+C simples NÃO é interceptado: precisa chegar ao claude como SIGINT/interrupt.
      return true
    })

    resize(term.cols, term.rows)

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      setMenu({ x: e.clientX, y: e.clientY, hasSelection: term.hasSelection() })
    }
    host.addEventListener('contextmenu', onContextMenu)

    const observer = new ResizeObserver(() => {
      if (!xtermRef.current || !fitRef.current) return
      fitRef.current.fit()
      resize(xtermRef.current.cols, xtermRef.current.rows)
    })
    observer.observe(host)

    // O cleanup NÃO mata a sessão — só desfaz o xterm e os listeners. A sessão
    // morre quando a pane é fechada (App.closePane → sessions:kill) ou via botão kill.
    return () => {
      host.removeEventListener('contextmenu', onContextMenu)
      observer.disconnect()
      setDataHandler(null)
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {projectName && (
              <span className="flex items-center gap-1 text-[var(--color-text-dim)]">
                {projectIcon && <span>{projectIcon}</span>}
                <span>{projectName}</span>
                <span className="text-[var(--color-border)]">›</span>
              </span>
            )}
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
                  setDraft(title ?? activity?.name ?? '')
                  setEditing(true)
                }}
                className="font-medium hover:text-[var(--color-accent)]"
                title="Renomear sessão"
              >
                {displayTitle}
              </button>
            )}
          </div>
          <span className="truncate text-[10px] text-[var(--color-text-dim)]">{repoPath}</span>
        </div>
        <div className="flex items-center gap-3 text-[var(--color-text-dim)]">
          {!exited && (
            <div className="flex min-w-0 items-center gap-2">
              {statusView ? (
                <span className={statusView.className}>{statusView.label}</span>
              ) : activity?.status === 'ended' ? (
                <span className="text-[var(--color-text-dim)]">encerrada</span>
              ) : (
                <span className="text-emerald-400">● running</span>
              )}
              {relTime && <span className="text-[10px]">{relTime}</span>}
              {activity?.title && (
                <span className="max-w-40 truncate text-[10px] text-[var(--color-text-dim)]">
                  {activity.title}
                </span>
              )}
            </div>
          )}
          {exited && <span>● exited ({exitCode ?? '?'})</span>}
          {error && <span className="text-red-400">⚠ {error}</span>}
          <button
            type="button"
            onClick={kill}
            disabled={exited}
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

      {menu && (
        <div
          className="fixed z-50 min-w-28 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 text-xs shadow-lg"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.hasSelection && (
            <button
              type="button"
              onClick={() => {
                copySelection()
                setMenu(null)
              }}
              className="block w-full px-3 py-1 text-left hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
            >
              Copiar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void paste()
              setMenu(null)
            }}
            className="block w-full px-3 py-1 text-left hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]"
          >
            Colar
          </button>
        </div>
      )}
    </div>
  )
}
