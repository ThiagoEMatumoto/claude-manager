import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { RoleSelect } from '@/components/ui/RoleSelect'
import type { LinkKind, Repo, UpdateRepoInput } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  repo: Repo
  onSave: (input: UpdateRepoInput) => Promise<void>
}

const LINK_LABEL: Record<LinkKind, string> = {
  inside: 'Dentro do vault',
  symlink: 'Symlink',
  external: 'Referência externa',
}

export function EditRepoDialog({ open, onClose, repo, onSave }: Props) {
  const [label, setLabel] = useState(repo.label)
  const [role, setRole] = useState<string | null>(repo.role)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLabel(repo.label)
    setRole(repo.role)
  }, [open, repo])

  async function handleSubmit() {
    if (!label.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSave({ id: repo.id, label: label.trim(), role })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar repo"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!label.trim()} loading={submitting}>
            Salvar
          </Button>
        </>
      }
    >
      <Input
        label="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleSubmit()
        }}
        className="mb-3"
      />
      <RoleSelect value={role} onChange={setRole} />

      <div className="mt-4 space-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 text-xs text-[var(--color-text-dim)]">
        <div className="truncate" title={repo.path}>
          <span className="opacity-60">Caminho:</span> {repo.path}
        </div>
        <div>
          <span className="opacity-60">Vínculo:</span> {LINK_LABEL[repo.linkKind]}
        </div>
        {repo.source && (
          <div className="truncate" title={repo.source}>
            <span className="opacity-60">Origem:</span> {repo.source}
          </div>
        )}
      </div>
    </Dialog>
  )
}
