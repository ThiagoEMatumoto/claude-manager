import '@xterm/xterm/css/xterm.css'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, Circle, Clock, Loader, Moon, X, Zap } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { Icon } from '@/components/ui/Icon'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { sessionsApi } from '@/lib/ipc'
import { matchCombo, resolveCombo } from '@/lib/keybindings'
import { useKeybindingsStore } from '@/lib/keybindings-store'
import { useAppStore } from '@/store/appStore'
import { useSession } from './useSession'
import { useTerminalPrefsStore } from '@/lib/terminal-prefs-store'
import type { Session, SessionActivity } from '../../../shared/types/ipc'

interface Props {
  session: Session
  repoLabel: string
  repoPath: string
  projectName: string
  projectIcon?: string | null
  projectColor?: string | null
  onClose: () => void
  onTitleChange?: (title: string) => void
  onReopen?: () => void
  onOpenSettings?: () => void
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

interface StatusView {
  label: string
  icon: ComponentType<LucideProps>
  className: string
  spin?: boolean
}

function activityStatusView(status: SessionActivity['status'] | undefined): StatusView | null {
  switch (status) {
    case 'working':
      return { label: 'trabalhando', icon: Zap, className: 'text-[var(--color-accent)]' }
    case 'waiting':
      return { label: 'aguardando você', icon: Clock, className: 'text-[var(--color-warning)]' }
    case 'idle':
      return { label: 'ocioso', icon: Moon, className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return { label: 'iniciando', icon: Loader, className: 'text-[var(--color-text-dim)]', spin: true }
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
  projectColor,
  onClose,
  onTitleChange,
  onReopen,
  onOpenSettings,
}: Props) {
  const { exited, exitCode, error, write, resize, setDataHandler } = useSession(session.id)
  const endSession = useAppStore((s) => s.endSession)
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Xterm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const fontSize = useTerminalPrefsStore((s) => s.fontSize)
  // Heurístico de "claude não encontrado": registramos se algum byte chegou do PTY.
  // Se o processo saiu rápido com código != 0 e nunca emitiu nada, provavelmente o
  // comando não foi resolvido (ENOENT) em vez de uma sessão de verdade ter morrido.
  const gotDataRef = useRef(false)
  // Instante do exit, pra medir quanto tempo a sessão viveu (heurístico abaixo).
  const exitAtRef = useRef<number | null>(null)

  const [title, setTitle] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [activity, setActivity] = useState<SessionActivity | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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

  // Precedência do nome em destaque: name do CC (live) > rename salvo no DB > label do repo.
  const displayTitle = activity?.name ?? title ?? repoLabel

  // Reflete o nome legível na aba do dockview. Ref pra callback evita re-disparar
  // quando o wrapper recria onTitleChange a cada render (dep só no displayTitle).
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  useEffect(() => {
    onTitleChangeRef.current?.(displayTitle)
  }, [displayTitle])

  // Só dá pra injetar /rename quando o claude está no prompt; em 'working' ele
  // está ocupado e a injeção concatenaria no meio de um comando/output.
  const canRename = !activity || activity.status !== 'working'

  const statusView = activityStatusView(activity?.status)
  const relTime = activity?.lastActivityAt ? formatRelative(now - activity.lastActivityAt) : null

  // Saiu em < 3s do start, com código != 0 e sem nunca ter emitido bytes →
  // tratamos como "claude não encontrado". Não é detecção perfeita, mas evita o
  // críptico "exited (127)" pro caso mais comum (comando não instalado / errado).
  if (exited && exitAtRef.current === null) exitAtRef.current = Date.now()
  const claudeNotFound =
    exited &&
    exitCode !== 0 &&
    !gotDataRef.current &&
    (exitAtRef.current ?? Date.now()) - session.startedAt < 3000

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
    const next = draft.replace(/[\r\n]+/g, ' ').trim()
    if (next.length === 0) return
    // Cache no nosso DB (Fase 4/listagem). A exibição prioriza activity.name.
    void sessionsApi.rename(session.id, next)
    // Fonte de verdade do nome é o claude: injeta /rename. \x15 (Ctrl+U) limpa a
    // linha atual do prompt pra não concatenar com algo que o usuário digitou.
    if (canRename) write('\x15/rename ' + next + '\r')
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
      fontSize: useTerminalPrefsStore.getState().fontSize,
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
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
      gotDataRef.current = true
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

      // Multiline: combo configurável (default Shift+Enter) + Alt+Enter fixo como alternativa.
      // O xterm manda `\r` puro (igual ao Enter); o claude só quebra linha quando recebe
      // ESC+CR (o mesmo que `/terminal-setup` configura no emulador nativo).
      // Lê overrides via getState() pra rebind valer sem recriar o xterm.
      const kbOverrides = useKeybindingsStore.getState().overrides
      if (matchCombo(e, resolveCombo('terminal.newline', kbOverrides)) || (e.key === 'Enter' && e.altKey)) {
        write('\x1b\r')
        return false
      }

      // Busca no terminal: combo configurável (default Ctrl/Cmd+F). Abre o overlay
      // por-pane ligado ao SearchAddon deste terminal.
      if (matchCombo(e, resolveCombo('terminal.search', useKeybindingsStore.getState().overrides))) {
        setSearchOpen(true)
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
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Zoom ao vivo: atualiza a fonte do xterm já montado quando o store muda, sem
  // recriar o terminal (a criação lê o tamanho via getState()).
  useEffect(() => {
    const term = xtermRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    term.options.fontSize = fontSize
    fit.fit()
    resize(term.cols, term.rows)
  }, [fontSize, resize])

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-start justify-between gap-3 border-b border-l-2 border-[var(--color-border)] px-4 py-2 text-xs"
        style={projectColor ? { borderLeftColor: projectColor } : undefined}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {projectName && (
              <span className="flex items-center gap-1 text-[var(--color-text-dim)]">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: projectColor ?? 'var(--color-border)' }}
                />
                <span className="shrink-0">{renderProjectIcon(projectIcon)}</span>
                <span>{projectName}</span>
                <Icon as={ChevronRight} size={12} className="text-[var(--color-border)]" />
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
                disabled={!canRename}
                onClick={() => {
                  setDraft(activity?.name ?? title ?? '')
                  setEditing(true)
                }}
                className="font-medium enabled:hover:text-[var(--color-accent)] disabled:cursor-not-allowed"
                title={canRename ? 'Renomear sessão' : 'Aguarde a sessão ficar ociosa pra renomear'}
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
                <span className={`flex items-center gap-1 ${statusView.className}`}>
                  <Icon
                    as={statusView.icon}
                    size={13}
                    className={statusView.spin ? 'animate-spin' : undefined}
                  />
                  {statusView.label}
                </span>
              ) : activity?.status === 'ended' ? (
                <span className="text-[var(--color-text-dim)]">encerrada</span>
              ) : (
                <span className="flex items-center gap-1 text-[var(--color-success)]">
                  <Icon as={Circle} size={9} className="fill-current" />
                  running
                </span>
              )}
              {relTime && <span className="text-[10px]">{relTime}</span>}
              {activity?.title && (
                <span className="max-w-40 truncate text-[10px] text-[var(--color-text-dim)]">
                  {activity.title}
                </span>
              )}
            </div>
          )}
          {exited &&
            (claudeNotFound ? (
              <span className="flex items-center gap-1 text-[var(--color-danger)]">
                <Icon as={AlertCircle} size={13} />
                claude não encontrado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--color-danger)]">
                <Icon as={Circle} size={9} className="fill-current" />
                encerrada ({exitCode ?? '?'})
              </span>
            ))}
          {error && !claudeNotFound && (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <Icon as={AlertCircle} size={13} />
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={() => endSession(session.id)}
            disabled={exited}
            title="Encerrar o processo (claude) nesta sessão"
            className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] disabled:opacity-40"
          >
            Encerrar
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Fechar a pane"
            aria-label="Fechar a pane"
            className="flex items-center rounded border border-[var(--color-border)] px-2 py-0.5 leading-none hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
          >
            <Icon as={X} size={14} />
          </button>
        </div>
      </div>

      {exited && (
        <div
          className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs"
          style={{ color: 'var(--color-text-dim)' }}
        >
          {claudeNotFound ? (
            <span className="text-[var(--color-text)]">
              <span className="text-[var(--color-danger)]">claude não encontrado</span> — verifique a instalação
              ou configure o comando em Configurações.
            </span>
          ) : (
            <span>
              A sessão foi encerrada{exitCode != null ? ` (código ${exitCode})` : ''}.
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            {claudeNotFound && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                Configurações
              </button>
            )}
            {onReopen && (
              <button
                type="button"
                onClick={onReopen}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
              >
                Reabrir
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full bg-[var(--color-bg)] p-2" />

        {searchOpen && (
          <div
            className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={searchQuery}
              placeholder="Buscar…"
              onChange={(e) => {
                const value = e.target.value
                setSearchQuery(value)
                searchRef.current?.findNext(value)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) searchRef.current?.findPrevious(searchQuery)
                  else searchRef.current?.findNext(searchQuery)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setSearchOpen(false)
                  xtermRef.current?.focus()
                }
              }}
              className="w-44 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
            />
            <button
              type="button"
              title="Anterior (Shift+Enter)"
              onClick={() => searchRef.current?.findPrevious(searchQuery)}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
            >
              ↑
            </button>
            <button
              type="button"
              title="Próximo (Enter)"
              onClick={() => searchRef.current?.findNext(searchQuery)}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
            >
              ↓
            </button>
            <button
              type="button"
              title="Fechar (Esc)"
              onClick={() => {
                setSearchOpen(false)
                xtermRef.current?.focus()
              }}
              className="rounded px-1 text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
            >
              ✕
            </button>
          </div>
        )}
      </div>

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
