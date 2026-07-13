import type { ComponentType } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Circle,
  Loader,
  Maximize2,
  Pin,
  Power,
  Zap,
  type LucideProps,
} from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { relativeTime } from '@/lib/time'
import { useAppStore } from '@/store/appStore'
import { childSessionIds, useHandoffsStore } from '@/store/handoffsStore'
import { useWaitingCount } from './useWaitingCount'
import { orderSessions } from './strip-pins'
import { useStripPinsStore } from './strip-pins-store'
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
  const waitingCount = useWaitingCount()
  const pinnedIds = useStripPinsStore((s) => s.pinnedIds)
  const pinsLoaded = useStripPinsStore((s) => s.loaded)
  const loadPins = useStripPinsStore((s) => s.load)
  const togglePin = useStripPinsStore((s) => s.togglePin)
  const prunePins = useStripPinsStore((s) => s.prune)
  // Tick pra reavaliar os tempos relativos no tooltip sem novos broadcasts.
  const [, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    void loadPins()
  }, [loadPins])

  // Higiene: descarta pins de sessões que não existem mais. Poda contra TODAS
  // as liveSessions (não só as visíveis) pra não perder pin de filha de handoff
  // temporariamente oculta. Lista vazia = provável boot antes do 1º broadcast —
  // não podar, senão apagaríamos pins válidos.
  useEffect(() => {
    if (!pinsLoaded || liveSessions.length === 0) return
    void prunePins(new Set(liveSessions.map((item) => item.id)))
  }, [pinsLoaded, liveSessions, prunePins])

  // Filhas de handoffs ativos vivem no rollup do painel Handoffs, não na lista
  // flat — senão o usuário fica com N chips pra monitorar.
  const childIds = useMemo(() => childSessionIds(handoffs), [handoffs])
  const visibleSessions = useMemo(
    () => liveSessions.filter((item) => !childIds.has(item.id)),
    [liveSessions, childIds],
  )

  // Fixados primeiro (ordem de fixação); resto na ordem original. Sem
  // auto-reorder por status — o sinal de "aguardando" é a cor/badge.
  const orderedSessions = useMemo(
    () => orderSessions(visibleSessions.filter((item) => item.status !== 'ended'), pinnedIds),
    [visibleSessions, pinnedIds],
  )

  // ccSessionId → paneId das sessões exibidas no split (destaque "aberta").
  const openByCc = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of panes) {
      if (p.session.ccSessionId) m.set(p.session.ccSessionId, p.paneId)
    }
    return m
  }, [panes])

  // Overflow: quando há chip "aguardando" fora da viewport da barra, mostra um
  // indicador discreto que rola até ele — o chip não pula de posição sozinho.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [waitingOffscreen, setWaitingOffscreen] = useState(false)

  const findOffscreenWaiting = useCallback((): HTMLElement | null => {
    const el = scrollRef.current
    if (!el) return null
    const bounds = el.getBoundingClientRect()
    for (const chip of el.querySelectorAll<HTMLElement>('[data-waiting="true"]')) {
      const r = chip.getBoundingClientRect()
      if (r.right > bounds.right + 1 || r.left < bounds.left - 1) return chip
    }
    return null
  }, [])

  const checkOverflow = useCallback(() => {
    setWaitingOffscreen(findOffscreenWaiting() !== null)
  }, [findOffscreenWaiting])

  useEffect(() => {
    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return () => window.removeEventListener('resize', checkOverflow)
  }, [checkOverflow, orderedSessions])

  const scrollToWaiting = useCallback(() => {
    findOffscreenWaiting()?.scrollIntoView({ inline: 'nearest', behavior: 'smooth' })
  }, [findOffscreenWaiting])

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2"
    >
      {visibleSessions.length === 0 ? (
        <span className="px-1 text-[11px] text-[var(--color-text-dim)]">
          Nenhuma sessão viva — clique num repo.
        </span>
      ) : (
        <div
          ref={scrollRef}
          onScroll={checkOverflow}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          {orderedSessions.map((item) => {
            const paneId = openByCc.get(item.ccSessionId)
            const isOpen = paneId !== undefined
            const isFocused = isOpen && paneId === focusPaneId
            return (
              <Chip
                key={item.ccSessionId}
                item={item}
                isOpen={isOpen}
                isFocused={isFocused}
                isPinned={pinnedIds.includes(item.id)}
                onOpen={() => void focusOrOpenSession(item)}
                onEnd={() => endSession(item.id)}
                onTogglePin={() => void togglePin(item.id)}
              />
            )
          })}
        </div>
      )}

      {waitingOffscreen && (
        <button
          type="button"
          onClick={scrollToWaiting}
          title="Sessão aguardando fora da barra — rolar até ela"
          aria-label="Sessão aguardando fora da barra — rolar até ela"
          className="relative flex h-6 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Icon as={ChevronRight} size={13} />
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
        </button>
      )}

      <button
        type="button"
        onClick={onOpenSwitcher}
        title={
          waitingCount > 0
            ? `Abrir seletor de sessões · ${waitingCount} aguardando você`
            : 'Abrir seletor de sessões'
        }
        className="relative ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <Icon as={Maximize2} size={13} />
        {waitingCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-warning)] px-0.5 text-[9px] font-semibold leading-none text-black">
            {waitingCount}
          </span>
        )}
      </button>
    </div>
  )
}

interface ChipProps {
  item: LiveSessionInfo
  isOpen: boolean
  isFocused: boolean
  isPinned: boolean
  onOpen: () => void
  onEnd: () => void
  onTogglePin: () => void
}

function Chip({ item, isOpen, isFocused, isPinned, onOpen, onEnd, onTogglePin }: ChipProps) {
  const title = (item.title ?? item.name ?? item.repo?.label) || (item.repo?.label ?? 'Avulsa')
  const preview = item.lastText?.replace(/\s+/g, ' ').trim()
  const tooltip = `${statusLabel(item.status)} · ${relativeTime(item.lastActivityAt)}${
    preview ? `\n${preview}` : ''
  }`
  const { icon, spin } = statusIcon(item.status)

  return (
    <div
      data-waiting={item.status === 'waiting' || undefined}
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
      {/* Fixado: o próprio botão vira o indicador (sempre visível, preenchido). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        title={isPinned ? 'Desafixar do início da barra' : 'Fixar no início da barra'}
        aria-label={isPinned ? 'Desafixar do início da barra' : 'Fixar no início da barra'}
        aria-pressed={isPinned}
        className={`shrink-0 leading-none transition focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--color-accent)] ${
          isPinned
            ? 'text-[var(--color-accent)] opacity-100'
            : 'text-[var(--color-text-dim)] opacity-0 hover:text-[var(--color-text)] group-hover:opacity-100'
        }`}
      >
        <Icon as={Pin} size={11} className={isPinned ? 'fill-current' : undefined} />
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
