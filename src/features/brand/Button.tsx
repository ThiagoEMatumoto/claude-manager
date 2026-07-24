import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant
  size?: Size
  children: ReactNode
  className?: string
}

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
}

const VARIANT: Record<Variant, string> = {
  // gradiente da marca, texto escuro (contraste sobre o gradiente claro), lift no hover.
  primary:
    'text-[var(--color-bg)] font-medium border border-transparent transition-transform hover:-translate-y-px active:translate-y-0',
  secondary:
    'border border-[var(--color-border)] text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)]/60',
  ghost:
    'border border-transparent text-[var(--color-text-dim)] transition-colors hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]',
  // coral translúcido — ações de parada ("Encerrar" / "Interromper").
  danger:
    'border text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]',
}

// Botão da marca. primary usa o gradiente; danger é a linguagem de "bandeira".
export function Button({
  variant = 'secondary',
  size = 'md',
  children,
  className,
  disabled,
  ...rest
}: Props) {
  const style =
    variant === 'primary'
      ? { background: 'var(--gradient-brand)' }
      : variant === 'danger'
        ? { borderColor: 'color-mix(in srgb, var(--color-danger) 45%, transparent)' }
        : undefined

  return (
    <button
      type="button"
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center rounded-full',
        SIZE[size],
        VARIANT[variant],
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      style={style}
      {...rest}
    >
      {children}
    </button>
  )
}
