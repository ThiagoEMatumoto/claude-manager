import type { ButtonHTMLAttributes, CSSProperties } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

// Linguagem da marca Pitwall: pill; primária no gradiente da casa (texto escuro
// sobre o gradiente claro), danger em coral translúcido ("bandeira").
const base =
  'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary:
    'text-[var(--color-bg)] border border-transparent transition-transform hover:-translate-y-px active:translate-y-0',
  ghost:
    'border border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-accent)]/60 hover:text-[var(--color-text)]',
  danger:
    'text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)]',
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  style,
  children,
  ...rest
}: Props) {
  const variantStyle: CSSProperties | undefined =
    variant === 'primary'
      ? { background: 'var(--gradient-brand)' }
      : variant === 'danger'
        ? { border: '1px solid color-mix(in srgb, var(--color-danger) 45%, transparent)' }
        : undefined

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{ ...variantStyle, ...style }}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading && (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
}
