import { useState } from 'react'
import { ChevronDown, Clock, Gauge } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import { EFFORT_LEVELS, type EffortLevel } from './ModelPill'
import type { PendingSelection } from './model-queue'

interface Props {
  /** Sessão ociosa — único estado em que é seguro injetar /effort. */
  canSwitch: boolean
  /** Troca escolhida enquanto a sessão estava ocupada, aguardando o próximo idle. */
  pending: PendingSelection
  onSelectEffort: (level: EffortLevel) => void
}

// Controle de esforço como pill próprio, ao lado do ModelPill (estilo barra do
// Claude Desktop). O claude não persiste o effort no transcript, então não há
// confirmação otimista: guardamos o último escolhido localmente pra exibir mesmo
// após o flush da fila (a prop `pending` some ao aplicar).
export function EffortPill({ canSwitch, pending, onSelectEffort }: Props) {
  const [open, setOpen] = useState(false)
  const [effort, setEffort] = useState<EffortLevel | null>(null)

  function pickEffort(level: EffortLevel) {
    onSelectEffort(level)
    setEffort(level)
  }

  const shown = pending.effort ?? effort
  const hasPending = pending.effort !== undefined

  const sections: MenuSection[] = [
    {
      title: 'Esforço',
      items: EFFORT_LEVELS.map((level) => ({
        label: level,
        active: shown === level,
        onClick: () => pickEffort(level),
      })),
    },
  ]

  const label = shown ?? 'esforço…'
  const dim = !shown

  return (
    <Menu open={open} onClose={() => setOpen(false)} sections={sections} portal align="left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          canSwitch
            ? 'Trocar o esforço desta sessão'
            : 'Sessão ocupada — a troca será aplicada quando ela ficar ociosa'
        }
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)] ${
          hasPending ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-border)]'
        } ${dim ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text)]'}`}
      >
        <Icon as={hasPending ? Clock : Gauge} size={11} className="text-[var(--color-accent)]" />
        <span className="whitespace-nowrap">{label}</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
