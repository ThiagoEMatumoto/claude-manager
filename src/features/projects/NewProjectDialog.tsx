import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EmojiPicker } from '@/components/ui/EmojiPicker'
import { ColorSelect } from '@/components/ui/ColorSelect'
import { dialogApi, vaultApi } from '@/lib/ipc'
import type { CreateProjectInput } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateProjectInput) => Promise<void>
}

export const COLORS = [
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

function joinPath(root: string, name: string): string {
  const trimmed = root.replace(/\/+$/, '')
  return `${trimmed}/${name}`
}

export function NewProjectDialog({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(COLORS[0])
  const [icon, setIcon] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [root, setRoot] = useState('')
  const [override, setOverride] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setColor(COLORS[0])
    setIcon('')
    setOverride(null)
    void vaultApi.getRoot().then(setRoot)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  const slug = name.trim().replace(/\s+/g, '-').toLowerCase()
  const vaultPath = override ?? (root && slug ? joinPath(root, slug) : '')

  async function pickFolder() {
    const picked = await dialogApi.openDirectory()
    if (picked) setOverride(picked)
  }

  async function changeRoot() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    await vaultApi.setRoot(picked)
    setRoot(picked)
    setOverride(null)
  }

  async function handleSubmit() {
    if (!name.trim() || !vaultPath || submitting) return
    setSubmitting(true)
    try {
      const { created, wasEmpty } = await vaultApi.ensureDir(vaultPath)
      if (!created && !wasEmpty) {
        if (!confirm('Esta pasta já tem arquivos — continuar?')) return
      }
      await onCreate({
        name: name.trim(),
        color,
        icon: icon.trim() || null,
        vaultPath,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Novo projeto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !vaultPath}
            loading={submitting}
          >
            Criar
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-dim)]">Ícone</label>
          <EmojiPicker value={icon} onChange={setIcon} />
        </div>
        <Input
          ref={inputRef}
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit()
          }}
          placeholder="Ex: site"
        />
      </div>

      <label className="mb-1 mt-4 block text-xs text-[var(--color-text-dim)]">Cor</label>
      <ColorSelect value={color} onChange={setColor} options={COLORS} />

      <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-dim)]">Pasta do projeto</span>
          <button
            type="button"
            onClick={changeRoot}
            className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
          >
            alterar raiz
          </button>
        </div>
        <div
          className="truncate text-sm text-[var(--color-text)]"
          title={vaultPath || undefined}
        >
          {vaultPath || <span className="text-[var(--color-text-dim)]">defina um nome…</span>}
        </div>
        <button
          type="button"
          onClick={pickFolder}
          className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
        >
          Escolher outra pasta
        </button>
      </div>
    </Dialog>
  )
}
