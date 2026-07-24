import type { CSSProperties, ReactNode } from 'react'
import { cx } from './cx'

interface Props {
  children: ReactNode
  /** Radius externo em px. Default 16. */
  radius?: number
  /** Fundo do conteúdo interno. Default surface. */
  innerBg?: string
  /** Gradiente da borda. Default gradiente da marca. */
  gradient?: string
  /** Quando false, borda vira sólida (var(--color-border)) sem gradiente. */
  active?: boolean
  className?: string
  /** Classes aplicadas ao container interno (padding/layout do conteúdo). */
  innerClassName?: string
  style?: CSSProperties
}

// Wrapper de borda-gradiente (padrão repetido da casa): padding 1px com o
// gradiente como background, e o filho com bg sólido por cima — desenha a borda
// de 1px em gradiente. Usado por card de decisão, composer, modal, terminal ativo.
export function GradientBorder({
  children,
  radius = 16,
  innerBg = 'var(--color-surface)',
  gradient = 'var(--gradient-brand)',
  active = true,
  className,
  innerClassName,
  style,
}: Props) {
  return (
    <div
      className={cx('inline-block', className)}
      style={{
        padding: 1,
        borderRadius: radius,
        background: active ? gradient : 'var(--color-border)',
        ...style,
      }}
    >
      <div
        className={innerClassName}
        style={{ background: innerBg, borderRadius: Math.max(0, radius - 1) }}
      >
        {children}
      </div>
    </div>
  )
}
