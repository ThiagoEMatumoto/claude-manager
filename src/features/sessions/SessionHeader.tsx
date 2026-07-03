import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Circle,
  Clock,
  Loader,
  Minimize2,
  Moon,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  Power,
  SquareTerminal,
  Zap,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { usePanelTier } from './use-panel-tier'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import type { PaneMode } from '@/store/appStore'
import type { SessionActivity } from '../../../shared/types/ipc'

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

// Confirmação de "Encerrar" dentro do menu de overflow (tier narrow) some sozinha
// se o usuário não confirmar a tempo — evita que reabrir o menu bem mais tarde
// encerre a sessão sem querer.
const END_CONFIRM_TIMEOUT_MS = 4000

interface Props {
  projectName: string
  projectIcon?: string | null
  projectColor?: string | null
  repoLabel: string
  repoPath: string
  // Precedência de nome já resolvida pelo Terminal.tsx (activity?.name > title > repoLabel).
  displayTitle: string
  // Valor pra semear o draft de rename — sem fallback pro label do repo
  // (activity?.name ?? title ?? ''), diferente de displayTitle.
  nameValue: string
  isNamed: boolean
  canRename: boolean
  onCommitRename: (next: string) => void
  exited: boolean
  activity: SessionActivity | null
  now: number
  claudeNotFound: boolean
  exitCode: number | null
  error: string | null
  mode: PaneMode
  onToggleMode?: () => void
  onMinimize: () => void
  onEndSession: () => void
}

// Header de cada sessão/terminal: identidade (projeto/nome/repoPath) + status
// (working/idle, tempo relativo, uso de contexto) + ações (toggle Terminal/Chat,
// Minimizar, Encerrar). Degrada por tier de largura REAL do painel (não da
// janela — cada painel dockview tem sua própria largura em splits):
// - wide: tudo visível como sempre foi.
// - mid: esconde activity.title/tempo relativo; ações viram ícone+tooltip.
// - narrow: só ícone-projeto + status-dot + toggle-ícone + menu ⋯ (Minimizar/Encerrar).
export function SessionHeader({
  projectName,
  projectIcon,
  projectColor,
  repoLabel,
  repoPath,
  displayTitle,
  nameValue,
  isNamed,
  canRename,
  onCommitRename,
  exited,
  activity,
  now,
  claudeNotFound,
  exitCode,
  error,
  mode,
  onToggleMode,
  onMinimize,
  onEndSession,
}: Props) {
  const { ref, tier } = usePanelTier<HTMLDivElement>()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const confirmTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current != null) clearTimeout(confirmTimeoutRef.current)
    }
  }, [])

  function commitRename() {
    setEditing(false)
    const next = draft.replace(/[\r\n]+/g, ' ').trim()
    if (next.length === 0) return
    onCommitRename(next)
  }

  // Fecha o menu E desarma a confirmação pendente — usado como onClose do <Menu>,
  // que dispara tanto no clique-fora/Escape quanto (via MenuButton) ANTES de todo
  // item.onClick(). Sem isso, fechar o menu por fora enquanto "Encerrar" está
  // armado deixava confirmingEnd=true pendurado: reabrir o menu dentro da janela
  // do timeout mostrava direto "Confirmar encerramento" e UM clique encerrava a
  // sessão, quebrando a garantia de 2 cliques explícitos.
  function closeMenu() {
    setMenuOpen(false)
    if (confirmTimeoutRef.current != null) clearTimeout(confirmTimeoutRef.current)
    setConfirmingEnd(false)
  }

  // 2º clique confirma — mesmo padrão de `confirmingBypass` do SpawnSessionDialog
  // (armar no 1º clique, exigir um 2º clique explícito pra executar). O Menu chama
  // closeMenu() (acima) antes de todo item.onClick(); reabrimos e re-armamos no
  // mesmo clique (setMenuOpen(true)/setConfirmingEnd(true) depois do closeMenu() já
  // ter rodado) — o batching do React 18 funde os setState da mesma tick num único
  // render, e a ÚLTIMA escrita de cada estado vence, então este handler ainda vê o
  // confirmingEnd do render anterior (closure) e decide certo mesmo com o
  // closeMenu() tendo rodado um instante antes na mesma tick.
  function handleEndClick() {
    if (!confirmingEnd) {
      setConfirmingEnd(true)
      setMenuOpen(true)
      if (confirmTimeoutRef.current != null) clearTimeout(confirmTimeoutRef.current)
      confirmTimeoutRef.current = window.setTimeout(() => setConfirmingEnd(false), END_CONFIRM_TIMEOUT_MS)
      return
    }
    if (confirmTimeoutRef.current != null) clearTimeout(confirmTimeoutRef.current)
    setConfirmingEnd(false)
    onEndSession()
  }

  const statusView = activityStatusView(activity?.status)
  const relTime = activity?.lastActivityAt ? formatRelative(now - activity.lastActivityAt) : null

  const overflowItems: MenuItem[] = [
    { label: 'Minimizar', onClick: onMinimize },
    {
      label: confirmingEnd ? 'Confirmar encerramento' : 'Encerrar',
      danger: true,
      onClick: handleEndClick,
    },
  ]

  return (
    <div
      ref={ref}
      className="flex items-start justify-between gap-3 border-b border-l-2 border-[var(--color-border)] border-b-white/[0.06] bg-gradient-to-b from-[var(--color-surface-2)]/70 to-[var(--color-surface)]/50 px-4 py-2 text-xs"
      style={projectColor ? { borderLeftColor: projectColor } : undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {projectName && (
            <span className="flex shrink-0 items-center gap-1.5 font-medium text-[var(--color-text-dim)]">
              <span className="shrink-0">{renderProjectIcon(projectIcon)}</span>
              {tier !== 'narrow' && <span className="max-w-40 truncate">{projectName}</span>}
            </span>
          )}
          {tier !== 'narrow' &&
            (editing ? (
              <>
                {projectName && <span className="text-[var(--color-border)]">·</span>}
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
              </>
            ) : isNamed || !projectName ? (
              // Nome custom (ou sem projeto pra contextualizar): mostra o título, clicável pra renomear.
              <>
                {projectName && <span className="text-[var(--color-border)]">·</span>}
                <button
                  type="button"
                  disabled={!canRename}
                  onClick={() => {
                    setDraft(nameValue)
                    setEditing(true)
                  }}
                  className="truncate font-medium enabled:hover:text-[var(--color-accent)] disabled:cursor-not-allowed"
                  title={canRename ? 'Renomear sessão' : 'Aguarde a sessão ficar ociosa pra renomear'}
                >
                  {displayTitle}
                </button>
              </>
            ) : (
              // Sem nome custom: a aba já mostra o nome da pasta — aqui só um lápis discreto pra nomear.
              canRename && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft('')
                    setEditing(true)
                  }}
                  className="shrink-0 text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
                  title="Nomear esta sessão"
                  aria-label="Nomear esta sessão"
                >
                  <Icon as={Pencil} size={12} />
                </button>
              )
            ))}
        </div>
        {tier !== 'narrow' && (
          <span className="truncate text-[10px] text-[var(--color-text-dim)]">{repoPath}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[var(--color-text-dim)]">
        {!exited &&
          (tier === 'narrow' ? (
            <span title={statusView?.label ?? 'running'}>
              <Icon
                as={statusView?.icon ?? Circle}
                size={10}
                className={
                  statusView
                    ? `${statusView.className} ${statusView.spin ? 'animate-spin' : ''}`
                    : 'fill-current text-[var(--color-success)]'
                }
              />
            </span>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              {statusView ? (
                <span
                  className={`flex items-center gap-1 text-[11px] uppercase tracking-wider ${statusView.className}`}
                >
                  <Icon
                    as={statusView.icon}
                    size={13}
                    className={
                      statusView.spin ? 'animate-spin' : 'drop-shadow-[0_0_4px_currentColor]'
                    }
                  />
                  {statusView.label}
                </span>
              ) : activity?.status === 'ended' ? (
                <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">
                  encerrada
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--color-success)]">
                  <Icon as={Circle} size={9} className="fill-current drop-shadow-[0_0_4px_currentColor]" />
                  running
                </span>
              )}
              {relTime && tier === 'wide' && <span className="text-[10px]">{relTime}</span>}
              {activity?.title && tier === 'wide' && (
                <span className="max-w-40 truncate text-[10px] text-[var(--color-text-dim)]">
                  {activity.title}
                </span>
              )}
            </div>
          ))}
        {/* Monitor de contexto: mesmo header (compartilhado pelos dois modos) já
            mostra o status acima; aqui repomos o uso da janela vs. o limite do
            modelo. Auto-oculta sem tokens+modelo. Escondido no tier narrow (só
            cabe o essencial: ícone-projeto + status-dot + toggle + overflow). */}
        {!exited && tier !== 'narrow' && <ContextUsageIndicator activity={activity} />}
        {exited &&
          tier !== 'narrow' &&
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
          <span
            className="flex items-center gap-1 text-[var(--color-danger)]"
            title={tier === 'narrow' ? error : undefined}
          >
            <Icon as={AlertCircle} size={13} />
            {tier !== 'narrow' && error}
          </span>
        )}
        {onToggleMode &&
          (tier === 'wide' ? (
            <div className="inline-flex overflow-hidden rounded border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => mode !== 'terminal' && onToggleMode()}
                title="Terminal cru (PTY)"
                className={`px-2 py-0.5 transition ${
                  mode === 'terminal'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                Terminal
              </button>
              <button
                type="button"
                onClick={() => mode !== 'chat' && onToggleMode()}
                title="Chat renderizado do transcript (PTY segue vivo por baixo)"
                className={`px-2 py-0.5 transition ${
                  mode === 'chat'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                Chat
              </button>
            </div>
          ) : (
            <div className="inline-flex overflow-hidden rounded border border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => mode !== 'terminal' && onToggleMode()}
                title="Terminal cru (PTY)"
                aria-label="Terminal cru (PTY)"
                className={`px-1.5 py-0.5 transition ${
                  mode === 'terminal'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                <Icon as={SquareTerminal} size={13} />
              </button>
              <button
                type="button"
                onClick={() => mode !== 'chat' && onToggleMode()}
                title="Chat renderizado do transcript (PTY segue vivo por baixo)"
                aria-label="Chat renderizado do transcript"
                className={`px-1.5 py-0.5 transition ${
                  mode === 'chat'
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
                }`}
              >
                <Icon as={MessageSquare} size={13} />
              </button>
            </div>
          ))}
        {tier === 'narrow' ? (
          <Menu open={menuOpen} onClose={closeMenu} items={overflowItems} portal align="right">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="Mais ações"
              aria-label="Mais ações"
              className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <Icon as={MoreHorizontal} size={13} />
            </button>
          </Menu>
        ) : (
          <>
            <button
              type="button"
              onClick={onMinimize}
              title="Minimizar — mantém a sessão rodando em background, acessível no strip de sessões"
              aria-label="Minimizar"
              className={`rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] ${
                tier === 'wide' ? 'px-2 py-0.5' : 'p-1'
              }`}
            >
              {tier === 'wide' ? 'Minimizar' : <Icon as={Minimize2} size={13} />}
            </button>
            <button
              type="button"
              onClick={onEndSession}
              disabled={exited}
              title="Encerrar o processo claude e fechar a sessão (some do strip)"
              aria-label="Encerrar"
              className={`rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] disabled:opacity-40 ${
                tier === 'wide' ? 'px-2 py-0.5' : 'p-1'
              }`}
            >
              {tier === 'wide' ? 'Encerrar' : <Icon as={Power} size={13} />}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
