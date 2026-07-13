import { Clock, Loader, Moon, Square, Zap } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LiveSessionInfo } from '../../../shared/types/ipc'

export type LiveStatus = LiveSessionInfo['status']

export interface StatusView {
  label: string
  icon: ComponentType<LucideProps>
  className: string
  spin?: boolean
}

// Aparência de cada status — fonte única pro SessionSwitcher e CommandPalette.
export function statusView(status: LiveStatus): StatusView {
  switch (status) {
    case 'working':
      return { label: 'trabalhando', icon: Zap, className: 'text-[var(--color-accent)]' }
    case 'waiting':
      return { label: 'aguardando você', icon: Clock, className: 'text-[var(--color-warning)]' }
    case 'idle':
      return { label: 'ocioso', icon: Moon, className: 'text-[var(--color-text-dim)]' }
    case 'starting':
      return {
        label: 'iniciando',
        icon: Loader,
        className: 'text-[var(--color-text-dim)]',
        spin: true,
      }
    case 'ended':
    default:
      return { label: 'encerrada', icon: Square, className: 'text-[var(--color-text-dim)]' }
  }
}
