import type { Area } from '@/store/appStore'
import { useAppStore } from '@/store/appStore'

interface AreaDef {
  id: Area
  icon: string
  label: string
}

const AREAS: AreaDef[] = [{ id: 'projects', icon: '🗂', label: 'Projetos' }]

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
                className={`flex h-10 w-10 items-center justify-center rounded-md text-lg transition ${
                  active
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]'
                }`}
              >
                {a.icon}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onOpenSettings}
        title="Configurações"
        className="flex h-10 w-10 items-center justify-center rounded-md text-lg text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]"
      >
        ⚙
      </button>
    </nav>
  )
}
