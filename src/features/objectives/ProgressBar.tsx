interface Props {
  // 0–100; null = indeterminado (mostra "—" no lugar do percentual).
  value: number | null
  className?: string
}

export function ProgressBar({ value, className = '' }: Props) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${pct}%`,
            background: value === null ? 'transparent' : 'var(--color-accent)',
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-text-dim)]">
        {value === null ? '—' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}
