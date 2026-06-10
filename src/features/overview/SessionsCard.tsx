import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { Circle, Loader, Zap, type LucideProps } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { relativeTime } from '@/lib/time'
import { useAppStore } from '@/store/appStore'
import { groupLiveSessions } from '../../../shared/home-selectors'
import type { LiveSessionInfo } from '../../../shared/types/ipc'
import { CardEmpty, HomeCard } from './HomeGrid'

// Card "Sessões agora": liveSessions do appStore (watcher global já ativo no
// AppShell), agrupadas em aguardando/trabalhando/ociosas. Clique = foca a pane
// (ou re-attacha) e navega pra Projetos — mesmo fluxo do SessionStrip.
export function SessionsCard() {
  const liveSessions = useAppStore((s) => s.liveSessions)
  const focusOrOpenSession = useAppStore((s) => s.focusOrOpenSession)

  const groups = useMemo(() => groupLiveSessions(liveSessions), [liveSessions])
  const total = groups.waiting.length + groups.working.length + groups.idle.length

  return (
    <HomeCard title="Sessões agora" count={total}>
      {total === 0 ? (
        <CardEmpty>Nenhuma sessão viva.</CardEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          <SessionGroup
            label="Aguardando você"
            icon={Zap}
            items={groups.waiting}
            onOpen={focusOrOpenSession}
          />
          <SessionGroup
            label="Trabalhando"
            icon={Loader}
            spin
            items={groups.working}
            onOpen={focusOrOpenSession}
          />
          <SessionGroup
            label="Ociosas"
            icon={Circle}
            items={groups.idle}
            onOpen={focusOrOpenSession}
          />
        </div>
      )}
    </HomeCard>
  )
}

function SessionGroup({
  label,
  icon,
  spin = false,
  items,
  onOpen,
}: {
  label: string
  icon: ComponentType<LucideProps>
  spin?: boolean
  items: LiveSessionInfo[]
  onOpen: (item: LiveSessionInfo) => Promise<void>
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
        {label}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.ccSessionId}>
            <SessionRow item={item} icon={icon} spin={spin} onOpen={() => void onOpen(item)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function SessionRow({
  item,
  icon,
  spin,
  onOpen,
}: {
  item: LiveSessionInfo
  icon: ComponentType<LucideProps>
  spin: boolean
  onOpen: () => void
}) {
  // Mesmo fallback de título do chip do SessionStrip.
  const title = (item.title ?? item.name ?? item.repo?.label) || (item.repo?.label ?? 'Avulsa')
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.lastText?.replace(/\s+/g, ' ').trim() || title}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--color-surface-2)]/60"
    >
      <Icon
        as={icon}
        size={13}
        className={spin ? 'shrink-0 animate-spin' : 'shrink-0'}
        style={{ color: item.projectColor ?? 'var(--color-border)' }}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">{title}</span>
      {item.projectName && (
        <span className="max-w-28 shrink-0 truncate text-[10px] text-[var(--color-text-dim)]">
          {item.projectName}
        </span>
      )}
      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-dim)]">
        {relativeTime(item.lastActivityAt)}
      </span>
    </button>
  )
}
