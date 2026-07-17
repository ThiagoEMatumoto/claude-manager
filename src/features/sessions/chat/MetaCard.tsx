import { useState } from 'react'
import { ChevronRight, FileInput } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

interface Props {
  // Conteúdo integral injetado (SKILL.md, system-reminder, caveat, …).
  text: string
  // Resumo curto derivado no parser (primeira linha), pro chip colapsado.
  label: string
}

// Conteúdo INJETADO no turno do usuário que o humano não digitou. Chip
// centralizado ultra-discreto, colapsado por default — o conteúdo costuma ser
// longo (skills inteiras) e é secundário à conversa. Expande em <pre> dim.
export function MetaCard({ text, label }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/40 text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[var(--color-text-dim)]"
        >
          <Icon
            as={ChevronRight}
            size={11}
            className={`shrink-0 transition ${open ? 'rotate-90' : ''}`}
          />
          <Icon as={FileInput} size={11} className="shrink-0" />
          <span className="truncate">
            Contexto injetado · <span className="font-medium">{label}</span>
          </span>
        </button>
        {open && (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--color-border)] px-2 py-1.5 text-[var(--color-text-dim)]">
            {text}
          </pre>
        )}
      </div>
    </div>
  )
}
