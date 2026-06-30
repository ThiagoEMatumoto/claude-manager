import { useState } from 'react'
import { ChevronDown, Clock, Gauge } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { Menu, type MenuSection } from '@/components/ui/Menu'
import { EFFORT_LEVELS, type EffortLevel } from './ModelPill'
import { effortStyle } from './pill-state'

interface Props {
  /** Nível de esforço ativo da sessão (null = ainda não definido). */
  effort: EffortLevel | null
  /** Troca enfileirada enquanto a sessão estava ocupada, aguardando o próximo idle. */
  pending?: EffortLevel
  /** Modelo suporta xhigh → habilita o ultracode no menu. */
  xhighCapable: boolean
  /** `/effort ultracode` ativo nesta sessão (sobrepõe o nível exibido). */
  ultracodeActive: boolean
  /** Aceita os níveis de --effort + o pseudo-nível nativo 'ultracode'. */
  onSelect: (level: EffortLevel | 'ultracode') => void
  /** Sessão ociosa — único estado seguro pra injetar /effort. Default true. */
  canSwitch?: boolean
}

// Controle de esforço como pill próprio, ao lado do ModelPill (estilo barra do
// Claude Desktop). A cor segue o nível ATIVO via effortStyle (fonte única de
// cor-por-estado). 'ultracode' não é um valor de --effort: é o mecanismo nativo
// `/effort ultracode`, só disponível quando o modelo suporta xhigh — por isso
// entra no TOPO do menu (violeta) e só aparece quando `xhighCapable`.
export function EffortPill({
  effort,
  pending,
  xhighCapable,
  ultracodeActive,
  onSelect,
  canSwitch = true,
}: Props) {
  const [open, setOpen] = useState(false)

  const shown = pending ?? effort
  const hasPending = pending !== undefined

  // ultracode ativo vence o nível numérico na exibição do pill.
  const activeStyle = ultracodeActive
    ? effortStyle('ultracode')
    : shown
      ? effortStyle(shown)
      : null

  const label = ultracodeActive ? 'ultracode' : (shown ?? 'esforço…')
  const textClass = activeStyle?.text ?? 'text-[var(--color-text-dim)]'
  const iconClass = hasPending ? 'text-[var(--color-accent)]' : textClass
  const LeadingIcon = hasPending ? Clock : (activeStyle?.icon ?? Gauge)

  const sections: MenuSection[] = [
    // ultracode no TOPO, só quando o modelo suporta xhigh.
    ...(xhighCapable
      ? [
          {
            title: 'Ultra',
            items: [
              {
                label: 'ultracode',
                active: ultracodeActive,
                onClick: () => onSelect('ultracode'),
              },
            ],
          },
        ]
      : []),
    {
      title: 'Esforço',
      items: EFFORT_LEVELS.map((level) => ({
        label: level,
        active: !ultracodeActive && shown === level,
        onClick: () => onSelect(level),
      })),
    },
  ]

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
        } ${textClass}`}
      >
        <Icon as={LeadingIcon} size={11} className={iconClass} />
        <span className="whitespace-nowrap">{label}</span>
        <Icon as={ChevronDown} size={10} className="text-[var(--color-text-dim)]" />
      </button>
    </Menu>
  )
}
