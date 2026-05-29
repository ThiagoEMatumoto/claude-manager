import { useEffect, useRef, useState } from 'react'
import { Input } from './Input'

const DEFAULT_OPTIONS = [
  'Front-end',
  'Back-end',
  'Full-stack',
  'Mobile',
  'Database',
  'Infra/DevOps',
  'Biblioteca',
  'API',
  'Docs',
  'QA/Testes',
]

interface Props {
  value: string | null
  onChange: (v: string | null) => void
  options?: string[]
}

export function RoleSelect({ value, onChange, options = DEFAULT_OPTIONS }: Props) {
  const isPreset = value != null && options.includes(value)
  const [custom, setCustom] = useState(isPreset ? false : value != null)
  const customRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (custom) customRef.current?.focus()
  }, [custom])

  function pickPreset(opt: string) {
    setCustom(false)
    onChange(value === opt ? null : opt)
  }

  function toggleCustom() {
    if (custom) {
      setCustom(false)
      onChange(null)
    } else {
      setCustom(true)
      onChange(null)
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Role (opcional)</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = !custom && value === opt
          return (
            <Chip key={opt} selected={selected} onClick={() => pickPreset(opt)}>
              {opt}
            </Chip>
          )
        })}
        <Chip selected={custom} onClick={toggleCustom}>
          Outro…
        </Chip>
      </div>
      {custom && (
        <Input
          ref={customRef}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="ex: front, api"
          className="mt-2"
        />
      )}
    </div>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-text)] ring-2 ring-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]'
      }`}
    >
      {children}
    </button>
  )
}
