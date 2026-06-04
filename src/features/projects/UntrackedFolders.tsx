import { FolderInput, FolderPlus } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { UntrackedFolder } from '../../../shared/types/ipc'

interface Props {
  folders: UntrackedFolder[]
  onAdopt: (folder: UntrackedFolder) => Promise<void>
}

// Pastas que existem no vault mas não estão registradas como repo. Um clique em
// "Adicionar" as adota (registra como 'inside') sem mover/clonar nada.
export function UntrackedFolders({ folders, onAdopt }: Props) {
  if (folders.length === 0) return null
  return (
    <div className="mt-1 border-t border-[var(--color-border)]/40 pt-1">
      <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
        Pastas no vault não adicionadas
      </div>
      <ul className="flex flex-col gap-px pb-1">
        {folders.map((f) => (
          <li
            key={f.path}
            className="group flex items-center justify-between gap-1 px-1 py-1 text-xs"
          >
            <span
              className="flex min-w-0 flex-1 items-center gap-1.5 text-[var(--color-text-dim)]"
              title={f.path}
            >
              <Icon as={FolderInput} size={14} />
              <span className="truncate">{f.name}</span>
            </span>
            <button
              type="button"
              onClick={() => void onAdopt(f)}
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[var(--color-text-dim)] transition hover:text-[var(--color-accent)]"
              title={`Adicionar "${f.name}" ao projeto`}
            >
              <Icon as={FolderPlus} size={13} />
              Adicionar
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
