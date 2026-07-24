import { cx } from './cx'

interface Props {
  /** Diâmetro do dot em px. */
  size?: number
  /** Quando false, some o anel e o pulso (estado estático). Default true. */
  active?: boolean
  /** Override de cor (ex.: coral da bandeira). Default = gradiente da marca. */
  color?: string
  className?: string
  /** Se presente, expõe o dot como imagem acessível com este rótulo. */
  title?: string
}

// "O Ápice": dot com gradiente da marca + anel que expande e some (pw-ring).
// Regra da casa: UM por vista. Em prefers-reduced-motion o anel/pulso somem
// (as classes pw-* são neutralizadas pelo index.css), restando o dot estático.
export function ApexDot({ size = 10, active = true, color, className, title }: Props) {
  const dotBg = color ?? 'var(--gradient-brand)'
  const ringColor = color ?? 'var(--color-accent)'

  return (
    <span
      className={cx('relative inline-block align-middle', className)}
      style={{ width: size, height: size }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {active && (
        <span
          className="pw-ring absolute inset-0 rounded-full"
          style={{ border: `1px solid ${ringColor}`, transformOrigin: 'center' }}
        />
      )}
      <span
        className={cx('absolute inset-0 rounded-full', active && 'pw-pulse')}
        style={{ background: dotBg, transformOrigin: 'center' }}
      />
    </span>
  )
}
