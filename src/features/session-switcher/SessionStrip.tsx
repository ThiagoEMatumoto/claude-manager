import type { ComponentType } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Circle, Loader, Maximize2, Power, Zap, type LucideProps } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { relativeTime } from '@/lib/time'
import { useAppStore } from '@/store/appStore'
import { childSessionIds, useHandoffsStore } from '@/store/handoffsStore'
import type { LiveSessionInfo } from '../../../shared/types/ipc'

type LiveStatus = LiveSessionInfo['status']

interface Props {
  onOpenSwitcher: () => void
}

// Ícone por estado: a FORMA carrega o status (spin trabalhando, raio aguardando,
// círculo ocioso) e a COR carrega o projeto — um glifo só, sem dots redundantes.
function statusIcon(status: LiveStatus): { icon: ComponentType<LucideProps>; spin: boolean } {
  switch (status) {
    case 'working':
    case 'starting':
      return { icon: Loader, spin: true }
    case 'waiting':
      return { icon: Zap, spin: false }
    case 'idle':
    case 'ended':
    default:
      return { icon: Circle, spin: false }
  }
}

function statusLabel(status: LiveStatus): string {
  switch (status) {
    case 'working':
      return 'trabalhando'
    case 'starting':
      return 'iniciando'
    case 'waiting':
      return 'aguardando você'
    case 'idle':
      return 'ocioso'
    case 'ended':
    default:
      return 'encerrada'
  }
}

export function SessionStrip({ onOpenSwitcher }: Props) {
  const liveSessions = useAppStore((s) => s.liveSessions)
  const panes = useAppStore((s) => s.panes)
  const focusPaneId = useAppStore((s) => s.focusPaneId)
  const focusOrOpenSession = useAppStore((s) => s.focusOrOpenSession)
  const endSession = useAppStore((s) => s.endSession)
  const handoffs = useHandoffsStore((s) => s.handoffs)
  // Tick pra reavaliar os tempos relativos no tooltip sem novos broadcasts.
  const [, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  // Filhas de handoffs ativos vivem no rollup do painel Handoffs, não na lista
  // flat — senão o usuário fica com N chips pra monitorar.
  const childIds = useMemo(() => childSessionIds(handoffs), [handoffs])
  const visibleSessions = useMemo(
    () => liveSessions.filter((item) => !childIds.has(item.id)),
    [liveSessions, childIds],
  )

  // ccSessionId → paneId das sessões exibidas no split (destaque "aberta").
  const openByCc = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of panes) {
      if (p.session.ccSessionId) m.set(p.session.ccSessionId, p.paneId)
    }
    return m
  }, [panes])

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2"
    >
      {visibleSessions.length === 0 ? (
        <span className="px-1 text-[11px] text-[var(--color-text-dim)]">
          Nenhuma sessão viva — clique num repo.
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {visibleSessions
            .filter((item) => item.status !== 'ended')
            .map((item) => {
            const paneId = openByCc.get(item.ccSessionId)
            const isOpen = paneId !== undefined
            const isFocused = isOpen && paneId === focusPaneId
            return (
              <Chip
                key={item.ccSessionId}
                item={item}
                isOpen={isOpen}
                isFocused={isFocused}
                onOpen={() => void focusOrOpenSession(item)}
                onEnd={() => endSession(item.id)}
              />
            )
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenSwitcher}
        title="Abrir seletor de sessões"
        className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <Icon as={Maximize2} size={13} />
      </button>
    </div>
  )
}

interface ChipProps {
  item: LiveSessionInfo
  isOpen: boolean
  isFocused: boolean
  onOpen: () => void
  onEnd: () => void
}

function Chip({ item, isOpen, isFocused, onOpen, onEnd }: ChipProps) {
  const title = (item.title ?? item.name ?? item.repo?.label) || (item.repo?.label ?? 'Avulsa')
  const preview = item.lastText?.replace(/\s+/g, ' ').trim()
  const tooltip = `${statusLabel(item.status)} · ${relativeTime(item.lastActivityAt)}${
    preview ? `\n${preview}` : ''
  }`
  const { icon, spin } = statusIcon(item.status)

  return (
    <div
      className={`group flex h-6 shrink-0 items-center gap-1.5 rounded border px-2 text-[11px] transition ${
        isFocused
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
          : isOpen
            ? 'border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-[var(--color-text)]'
            : 'border-transparent text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
      }`}
      title={tooltip}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2">
        <Icon
          as={icon}
          size={12}
          className={spin ? 'shrink-0 animate-spin' : 'shrink-0'}
          style={{ color: item.projectColor ?? 'var(--color-border)' }}
        />
        <span className="max-w-40 truncate">{title}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onEnd()
        }}
        title="Encerrar o processo desta sessão"
        aria-label="Encerrar o processo desta sessão"
        className="shrink-0 leading-none text-[var(--color-text-dim)] opacity-0 transition hover:text-[var(--color-danger)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-danger)] group-hover:opacity-100"
      >
        <Icon as={Power} size={12} />
      </button>
    </div>
  )
}
