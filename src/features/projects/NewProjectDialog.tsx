import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (name: string, color: string | null) => Promise<void>
}

const COLORS = ['#ff7a45', '#22d3ee', '#a78bfa', '#34d399', '#facc15', '#f472b6']

export function NewProjectDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(COLORS[0])
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setColor(COLORS[0])
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      await onCreate(name.trim(), color)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-96 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl"
      >
        <div className="mb-4 text-lg font-semibold">Novo projeto</div>

        <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Nome</label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: site"
          className="mb-4 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />

        <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Cor</label>
        <div className="mb-6 flex gap-2">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Cor ${c}`}
              className={`h-6 w-6 rounded-full transition ${
                color === c ? 'ring-2 ring-offset-2 ring-offset-[var(--color-surface)]' : ''
              }`}
              style={{ background: c, '--tw-ring-color': c } as React.CSSProperties}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  )
}
