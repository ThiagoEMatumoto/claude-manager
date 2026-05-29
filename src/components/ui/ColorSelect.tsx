import { useRef } from 'react'

const DEFAULT_OPTIONS = [
  '#ff7a45',
  '#f97316',
  '#facc15',
  '#a3e635',
  '#34d399',
  '#10b981',
  '#22d3ee',
  '#38bdf8',
  '#3b82f6',
  '#6366f1',
  '#a78bfa',
  '#d946ef',
  '#f472b6',
  '#f43f5e',
]

const RAINBOW =
  'conic-gradient(from 0deg, #f43f5e, #facc15, #34d399, #22d3ee, #6366f1, #d946ef, #f43f5e)'

interface Props {
  value: string
  onChange: (hex: string) => void
  options?: string[]
}

export function ColorSelect({ value, onChange, options = DEFAULT_OPTIONS }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isCustom = !options.includes(value)

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((c) => (
        <ColorChip key={c} color={c} selected={value === c} onClick={() => onChange(c)} />
      ))}

      {isCustom && <ColorChip color={value} selected onClick={() => inputRef.current?.click()} />}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Cor customizada"
        className="h-6 w-6 rounded-full border border-[var(--color-border)] transition"
        style={{ background: RAINBOW }}
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only absolute h-0 w-0"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}

function ColorChip({
  color,
  selected,
  onClick,
}: {
  color: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Cor ${color}`}
      className={`h-6 w-6 rounded-full transition ${
        selected ? 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)]' : ''
      }`}
      style={{ background: color, '--tw-ring-color': color } as React.CSSProperties}
    />
  )
}
