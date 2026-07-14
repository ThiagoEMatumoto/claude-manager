import type { ProgressTone } from '../../../shared/progress'

const TONE_COLOR: Record<ProgressTone, string> = {
  accent: 'var(--color-accent)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
}

interface Props {
  // 0–100; null = indeterminado (mostra "—" no lugar do percentual).
  value: number | null
  className?: string
  // Cor semântica (Onda 1): accent (default) = sem prazo pra avaliar atraso;
  // warning/danger = progresso atrás do tempo decorrido. Ver objectiveProgressTone.
  tone?: ProgressTone
}

export function ProgressBar({ value, className = '', tone = 'accent' }: Props) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value))
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${pct}%`,
            background: value === null ? 'transparent' : TONE_COLOR[tone],
          }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-[var(--color-text-dim)]">
        {value === null ? '—' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}
