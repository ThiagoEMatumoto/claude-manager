import { useState } from 'react'
import {
  AlertCircle,
  Circle,
  MessageSquare,
  Minus,
  Pencil,
  Power,
  SquareTerminal,
} from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { renderProjectIcon } from '@/components/ui/projectIcon'
import { usePanelTier } from './use-panel-tier'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import type { PaneMode } from '@/store/appStore'
import type { SessionActivity } from '../../../shared/types/ipc'

interface StatusDotView {
  label: string
  className: string
  pulse?: boolean
}

// Status vira um dot colorido (mesmas cores de sempre); o texto em caps e o
// tempo relativo migram pro tooltip/aria-label do dot — nada se perde.
function statusDotView(status: SessionActivity['status'] | undefined): StatusDotView {
  switch (status) {
    case 'working':
      return { label: 'Trabalhando', className: 'text-[var(--color-accent)]', pulse: true }
    case 'waiting':
      return { label: 'Aguardando você', className: 'text-[var(--color-warning)]' }
    case 'idle':
      return { label: 'Ocioso', className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return { label: 'Iniciando', className: 'text-[var(--color-text-dim)]', pulse: true }
    case 'ended':
      return { label: 'Encerrada', className: 'text-[var(--color-text-dim)]' }
    default:
      return { label: 'Running', className: 'text-[var(--color-success)]' }
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

// Header de cada sessão em UMA linha calma:
//   [dot status] [ícone] Projeto · título …… [NN%] [toggle ⇄] [Minus] [Power]
// Regra de ouro: nenhuma informação se perde — o que saiu da vista (label de
// status, tempo relativo, path do repo, detalhe de contexto) vive em
// tooltip/aria-label. Degrada por tier de largura REAL do painel (não da
// janela), da direita pra esquerda:
// - wide/mid: tudo (splits de 3-4 panes caem no mid e o % ainda cabe).
// - narrow: somem % + toggle + título/rename; ficam dot + ícone + Minus + Power.
export function SessionHeader({
  projectName,
  projectIcon,
  projectColor,
  repoLabel,
  repoPath,
  displayTitle,
  nameValue,
  isNamed: _isNamed,
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

  function commitRename() {
    setEditing(false)
    const next = draft.replace(/[\r\n]+/g, ' ').trim()
    if (next.length === 0) return
    onCommitRename(next)
  }

  const dot = statusDotView(activity?.status)
  const relTime = activity?.lastActivityAt ? formatRelative(now - activity.lastActivityAt) : null
  // Tooltip carrega tudo que era texto visível: label de status, tempo relativo
  // e o título da atividade corrente reportado pelo claude.
  const dotTooltip = [dot.label, relTime, activity?.title].filter(Boolean).join(' · ')

  return (
    <div
      ref={ref}
      className="group flex h-8 shrink-0 items-center justify-between gap-3 border-b border-l-2 border-[var(--color-border)] border-b-white/[0.06] bg-gradient-to-b from-[var(--color-surface-2)]/70 to-[var(--color-surface)]/50 px-3 text-xs"
      style={projectColor ? { borderLeftColor: projectColor } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {!exited && (
          <span
            role="status"
            title={dotTooltip}
            aria-label={dotTooltip}
            className={`shrink-0 ${dot.className}`}
          >
            <span
              className={`block h-2 w-2 rounded-full bg-current shadow-[0_0_4px_currentColor] ${
                dot.pulse ? 'animate-pulse' : ''
              }`}
            />
          </span>
        )}
        {projectName && <span className="shrink-0">{renderProjectIcon(projectIcon)}</span>}
        {tier !== 'narrow' &&
          (editing ? (
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
            <>
              {/* Path saiu da vista: vive no tooltip do nome e o clique segue copiando. */}
              <button
                type="button"
                onClick={() => {
                  if (repoPath) void navigator.clipboard.writeText(repoPath)
                }}
                title={repoPath ? `${repoPath} — clique para copiar` : undefined}
                className="min-w-0 truncate text-left font-medium hover:text-[var(--color-accent)]"
              >
                {projectName && (
                  <>
                    <span className="text-[var(--color-text-dim)]">{projectName}</span>
                    <span className="text-[var(--color-border)]"> · </span>
                  </>
                )}
                {displayTitle}
              </button>
              {/* Lápis só no hover do header — rename continua acessível sem poluir. */}
              <button
                type="button"
                disabled={!canRename}
                onClick={() => {
                  setDraft(nameValue)
                  setEditing(true)
                }}
                title={canRename ? 'Renomear sessão' : 'Aguarde a sessão ficar ociosa pra renomear'}
                aria-label="Renomear sessão"
                className="shrink-0 text-[var(--color-text-dim)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 enabled:hover:text-[var(--color-accent)] disabled:cursor-not-allowed"
              >
                <Icon as={Pencil} size={12} />
              </button>
            </>
          ))}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-[var(--color-text-dim)]">
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
        {/* Uso de contexto compacto (só NN%); detalhe completo no tooltip. Cabe
            até no mid (~36px; splits de 3-4 panes caem aqui) — some só no
            narrow, junto com o toggle. */}
        {!exited && tier !== 'narrow' && <ContextUsageIndicator activity={activity} compact />}
        {/* Toggle Terminal⇄Chat em 1 ícone: mostra o modo DESTINO. */}
        {onToggleMode && tier !== 'narrow' && (
          <button
            type="button"
            onClick={onToggleMode}
            title={
              mode === 'terminal'
                ? 'Mudar para Chat — transcript renderizado (PTY segue vivo por baixo)'
                : 'Mudar para Terminal — terminal cru (PTY)'
            }
            aria-label={mode === 'terminal' ? 'Mudar para Chat' : 'Mudar para Terminal'}
            className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent)]"
          >
            <Icon as={mode === 'terminal' ? MessageSquare : SquareTerminal} size={13} />
          </button>
        )}
        {/* Ícones consistentes com as tabs (lucide): Minus = minimizar, Power =
            encerrar (hover danger). Tooltip/aria-label preservam o texto antigo. */}
        <button
          type="button"
          onClick={onMinimize}
          title="Minimizar — mantém a sessão rodando em background, acessível no strip de sessões"
          aria-label="Minimizar"
          className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent)]"
        >
          <Icon as={Minus} size={13} />
        </button>
        <button
          type="button"
          onClick={onEndSession}
          disabled={exited}
          title="Encerrar o processo claude e fechar a sessão (some do strip)"
          aria-label="Encerrar"
          className="rounded border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-danger)] disabled:opacity-40"
        >
          <Icon as={Power} size={13} />
        </button>
      </div>
    </div>
  )
}
