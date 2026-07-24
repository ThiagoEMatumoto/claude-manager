import { cx } from './cx'

interface Props {
  /** Preenchimento 0..100. */
  percent: number
  /** Rótulo curto à esquerda (ex.: "ctx", "5h", "7d"). */
  label?: string
  /** Texto à direita (ex.: "42%"). Se ausente, nenhum valor é exibido. */
  value?: string
  className?: string
}

const TOTAL = 10

// "Blocos de Medida": 10 blocos ▮/▯ (JetBrains Mono) representando percent 0..100.
// Cor por limiar: accent <70, atenção 70–89, bandeira 90+. Números tabulares.
export function MeasureBlocks({ percent, label, value, className }: Props) {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * TOTAL)
  const color =
    clamped >= 90
      ? 'var(--color-danger)'
      : clamped >= 70
        ? 'var(--color-warning)'
        : 'var(--color-accent)'

  const blocks = Array.from({ length: TOTAL }, (_, i) => (i < filled ? '▮' : '▯')).join('')

  return (
    <div
      className={cx('flex items-center gap-2 font-mono text-xs', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label ?? 'medida'}
    >
      {label && (
        <span className="uppercase tracking-wide text-[var(--color-text-dim)]">{label}</span>
      )}
      <span
        aria-hidden
        className="tabular-nums leading-none tracking-[-0.5px]"
        style={{ color }}
      >
        {blocks}
      </span>
      {value && (
        <span className="tabular-nums text-[var(--color-text-dim)]">{value}</span>
      )}
    </div>
  )
}
