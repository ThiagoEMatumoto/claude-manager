import { Loader2 } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import { ApexDot } from './ApexDot'
import { cx } from './cx'

export type SessionState = 'no-box' | 'em-pista' | 'na-garagem' | 'bandeira'

interface Props {
  state: SessionState
  /** Texto custom; se ausente usa o default do estado. */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

const DEFAULT_LABEL: Record<SessionState, string> = {
  'no-box': 'no box · sua vez',
  'em-pista': 'em pista',
  'na-garagem': 'na garagem',
  bandeira: 'bandeira',
}

// Chip de estado de sessão, no vocabulário da casa (voz de engenheiro de pista).
// no-box (sua vez) é o único com "O Ápice" pulsante — um por vista.
export function SessionChip({ state, label, size = 'md', className }: Props) {
  const text = label ?? DEFAULT_LABEL[state]
  const sm = size === 'sm'
  const dotPx = sm ? 7 : 9

  const base = cx(
    'inline-flex items-center rounded-full border',
    sm ? 'gap-1.5 px-2 py-0.5 text-[11px]' : 'gap-1.5 px-2.5 py-1 text-xs',
    className,
  )

  if (state === 'no-box') {
    return (
      <span
        className={base}
        style={{
          borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
          background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
          color: 'var(--color-text)',
        }}
      >
        <ApexDot size={dotPx} active />
        {text}
      </span>
    )
  }

  if (state === 'em-pista') {
    return (
      <span
        className={base}
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
      >
        <Icon
          as={Loader2}
          size={dotPx + 2}
          className="animate-spin text-[var(--color-accent2)] motion-reduce:animate-none"
        />
        {text}
      </span>
    )
  }

  if (state === 'bandeira') {
    return (
      <span
        className={base}
        style={{
          borderColor: 'color-mix(in srgb, var(--color-danger) 45%, transparent)',
          color: 'var(--color-danger)',
        }}
      >
        <ApexDot size={dotPx} active={false} color="var(--color-danger)" />
        {text}
      </span>
    )
  }

  // na-garagem: dot outline "faint", sem animação.
  return (
    <span
      className={base}
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
    >
      <span
        aria-hidden
        className="rounded-full border"
        style={{
          width: dotPx,
          height: dotPx,
          borderColor: 'color-mix(in srgb, var(--color-text-dim) 55%, transparent)',
        }}
      />
      {text}
    </span>
  )
}
