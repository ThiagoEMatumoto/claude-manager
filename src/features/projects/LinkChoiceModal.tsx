import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { repoApi } from '@/lib/ipc'
import type { CreateRepoInput } from '../../../shared/types/ipc'

interface Props {
  open: boolean
  onClose: () => void
  source: string
  vaultPath: string
  label: string
  onChoose: (repo: Omit<CreateRepoInput, 'projectId'>) => Promise<void>
}

type Choice = 'move' | 'symlink' | 'external'

export function LinkChoiceModal({ open, onClose, source, vaultPath, label, onChoose }: Props) {
  const [busy, setBusy] = useState<Choice | null>(null)

  async function pick(choice: Choice) {
    if (busy) return
    setBusy(choice)
    try {
      if (choice === 'move') {
        const { path } = await repoApi.moveIntoVault(source, vaultPath, label)
        await onChoose({ label, path, linkKind: 'inside', source: 'local' })
      } else if (choice === 'symlink') {
        const { path } = await repoApi.symlinkIntoVault(source, vaultPath, label)
        await onChoose({ label, path, linkKind: 'symlink', source: 'local' })
      } else {
        await onChoose({ label, path: source, linkKind: 'external', source: 'local' })
      }
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Esta pasta está fora do vault">
      <p className="mb-4 text-sm text-[var(--color-text-dim)]">
        Como você quer adicionar <span className="text-[var(--color-text)]">{label}</span>?
      </p>

      <div className="flex flex-col gap-3">
        <Option
          title="Mover pra dentro"
          desc="Move a pasta para dentro do vault. Recomendado."
          loading={busy === 'move'}
          disabled={!!busy}
          onClick={() => pick('move')}
        />
        <Option
          title="Criar symlink"
          desc="Mantém a origem e cria um link no vault. Se mover/deletar a origem, o link quebra."
          loading={busy === 'symlink'}
          disabled={!!busy}
          onClick={() => pick('symlink')}
        />
        <Option
          title="Só referenciar"
          desc="Não toca no filesystem. Aponta para a pasta onde ela está."
          loading={busy === 'external'}
          disabled={!!busy}
          onClick={() => pick('external')}
        />
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="ghost" onClick={onClose} disabled={!!busy}>
          Cancelar
        </Button>
      </div>
    </Dialog>
  )
}

function Option({
  title,
  desc,
  loading,
  disabled,
  onClick,
}: {
  title: string
  desc: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 text-left transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
        {loading && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {title}
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-text-dim)]">{desc}</div>
    </button>
  )
}
