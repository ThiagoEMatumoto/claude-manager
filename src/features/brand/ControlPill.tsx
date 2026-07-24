import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { cx } from './cx'

type Tone = 'default' | 'accent' | 'warning'

interface Props {
  icon?: ComponentType<LucideProps>
  label: string
  /** Mostra o caret ▾ (indica menu). */
  caret?: boolean
  tone?: Tone
  onClick?: () => void
  disabled?: boolean
  className?: string
  title?: string
}

const TONE_TEXT: Record<Tone, string> = {
  default: 'text-[var(--color-text-dim)]',
  accent: 'text-[var(--color-accent)]',
  warning: 'text-[var(--color-warning)]',
}

// Pill de controle (model/effort/permission): borda 1px, radius full, hover
// realça borda e cor. Vira <button> quando há onClick, senão <span> estático.
export function ControlPill({
  icon,
  label,
  caret,
  tone = 'default',
  onClick,
  disabled,
  className,
  title,
}: Props) {
  const interactive = !!onClick && !disabled
  const cls = cx(
    'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)]',
    'px-2.5 py-1 text-xs',
    TONE_TEXT[tone],
    interactive &&
      'transition-colors hover:border-[var(--color-accent)]/60 hover:text-[var(--color-text)]',
    disabled && 'opacity-50',
    className,
  )

  const content = (
    <>
      {icon && <Icon as={icon} size={13} className="shrink-0" />}
      <span className="truncate">{label}</span>
      {caret && <Icon as={ChevronDown} size={12} className="shrink-0 opacity-70" />}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}>
        {content}
      </button>
    )
  }
  return (
    <span className={cls} title={title}>
      {content}
    </span>
  )
}
