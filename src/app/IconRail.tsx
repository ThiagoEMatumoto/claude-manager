import {
  BarChart3,
  Blocks,
  ClipboardList,
  Folder,
  Home,
  Inbox,
  ListTodo,
  Network,
  ScrollText,
  Settings,
  Target,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Area } from '@/store/appStore'
import { useAppStore } from '@/store/appStore'
import { Icon, ICON_SIZE_HEADER } from '@/components/ui/Icon'

interface AreaDef {
  id: Area
  icon: ComponentType<LucideProps>
  label: string
}

const AREAS: AreaDef[] = [
  // Home primeiro: é a área default no boot.
  { id: 'overview', icon: Home, label: 'Home' },
  { id: 'projects', icon: Folder, label: 'Projetos' },
  { id: 'architecture', icon: Network, label: 'Arquitetura' },
  { id: 'handoffs', icon: Inbox, label: 'Handoffs' },
  { id: 'dossiers', icon: ScrollText, label: 'Dossiês' },
  { id: 'features', icon: ClipboardList, label: 'Features' },
  { id: 'objectives', icon: Target, label: 'Objetivos' },
  { id: 'tasks', icon: ListTodo, label: 'Tarefas' },
  { id: 'cc-configs', icon: Blocks, label: 'Configs do CC' },
  { id: 'metrics', icon: BarChart3, label: 'Métricas' },
]

interface Props {
  onOpenSettings: () => void
}

export function IconRail({ onOpenSettings }: Props) {
  const area = useAppStore((s) => s.area)
  const setArea = useAppStore((s) => s.setArea)

  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-center justify-between border-r border-[var(--color-border)] bg-[var(--color-bg)] py-3">
      <ul className="flex flex-col items-center gap-1">
        {AREAS.map((a) => {
          const active = a.id === area
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setArea(a.id)}
                title={a.label}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition ${
                  active
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                }`}
              >
                <Icon as={a.icon} size={ICON_SIZE_HEADER} />
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onOpenSettings}
        title="Configurações"
        className="flex h-10 w-10 items-center justify-center rounded-md text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]"
      >
        <Icon as={Settings} size={ICON_SIZE_HEADER} />
      </button>
    </nav>
  )
}
