import { cx } from './cx'

type ProgressProps = {
  variant?: 'progress'
  /** Marcos explícitos: cada done=true acende um tick. Tem precedência sobre value. */
  steps?: { done: boolean }[]
  /** Progresso contínuo 0..1, fatiado em `count` ticks. Ignorado se `steps` vier. */
  value?: number
  /** Número de ticks quando usando `value`. Default 12. */
  count?: number
  height?: number
  className?: string
  'aria-label'?: string
}

type EqualizerProps = {
  variant: 'equalizer'
  /** Número de barras oscilando. Default 5. */
  count?: number
  height?: number
  className?: string
  'aria-label'?: string
}

type Props = ProgressProps | EqualizerProps

const BAR = 'w-[2px] rounded-full'

// "A Régua": fileira de barras verticais finas (2px, gap 3px).
// - progress: ticks acesos (accent) marcam progresso/marcos; apagados = border.
// - equalizer: barras oscilando (pw-eq) para "agente pensando / em pista".
export function Ruler(props: Props) {
  const height = props.height ?? 14
  const label = props['aria-label']

  if (props.variant === 'equalizer') {
    const count = props.count ?? 5
    return (
      <div
        className={cx('flex items-end gap-[3px]', props.className)}
        style={{ height }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className={cx(BAR, 'pw-eq-bar')}
            style={{
              height,
              background: 'var(--color-accent2)',
              // dessincroniza a onda; barras centrais mais adiantadas.
              ['--pw-eq-delay' as string]: `${(i % 3) * 120 + (i % 2) * 60}ms`,
            }}
          />
        ))}
      </div>
    )
  }

  // progress
  const ticks: boolean[] = props.steps
    ? props.steps.map((s) => s.done)
    : deriveTicks(props.value ?? 0, props.count ?? 12)
  const doneCount = ticks.filter(Boolean).length
  const total = ticks.length

  return (
    <div
      className={cx('flex items-center gap-[3px]', props.className)}
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={doneCount}
      aria-label={label ?? 'progresso'}
    >
      {ticks.map((on, i) => (
        <span
          key={i}
          className={BAR}
          style={{
            height,
            background: on ? 'var(--color-accent)' : 'var(--color-border)',
          }}
        />
      ))}
    </div>
  )
}

function deriveTicks(value: number, count: number): boolean[] {
  const clamped = Math.max(0, Math.min(1, value))
  const lit = Math.round(clamped * count)
  return Array.from({ length: count }, (_, i) => i < lit)
}
