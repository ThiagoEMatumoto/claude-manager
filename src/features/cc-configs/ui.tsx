import type { ReactNode } from 'react'

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'on' | 'off' | 'warn'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]',
    on: 'bg-[var(--color-success)]/20 text-[var(--color-success)]',
    off: 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]',
    warn: 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function CenterMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--color-text-dim)]">
      {text}
    </div>
  )
}

export function Card({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const interactive = onClick != null
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-3.5 transition ${
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]/60'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      } ${interactive ? 'cursor-pointer hover:border-[var(--color-text-dim)]' : ''}`}
    >
      {children}
    </div>
  )
}
