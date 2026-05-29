import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { dialogApi, vaultApi } from '@/lib/ipc'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: Props) {
  const [root, setRoot] = useState('')

  useEffect(() => {
    if (!open) return
    void vaultApi.getRoot().then(setRoot)
  }, [open])

  async function changeRoot() {
    const picked = await dialogApi.openDirectory()
    if (!picked) return
    await vaultApi.ensureDir(picked)
    await vaultApi.setRoot(picked)
    setRoot(picked)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Configurações"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-dim)]">Pasta-raiz dos projetos</span>
          <button
            type="button"
            onClick={changeRoot}
            className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
          >
            Trocar
          </button>
        </div>
        <div className="truncate text-sm text-[var(--color-text)]" title={root || undefined}>
          {root || <span className="text-[var(--color-text-dim)]">carregando…</span>}
        </div>
      </div>
    </Dialog>
  )
}
