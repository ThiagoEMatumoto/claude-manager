import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { dialogApi, vaultApi } from '@/lib/ipc'

interface Props {
  onDone: () => void
}

export function WelcomeDialog({ onDone }: Props) {
  const [root, setRoot] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void vaultApi.getRoot().then(setRoot)
  }, [])

  async function pickFolder() {
    const picked = await dialogApi.openDirectory()
    if (picked) setRoot(picked)
  }

  async function handleStart() {
    if (!root.trim() || submitting) return
    setSubmitting(true)
    try {
      await vaultApi.ensureDir(root.trim())
      await vaultApi.setRoot(root.trim())
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={() => {}}
      title="Bem-vindo ao Claude Manager"
      footer={
        <Button onClick={handleStart} disabled={!root.trim()} loading={submitting}>
          Começar
        </Button>
      }
    >
      <p className="mb-4 text-sm text-[var(--color-text-dim)]">
        Seus projetos ficarão organizados sob uma pasta-raiz. Escolha onde os
        vaults dos projetos serão criados — você pode mudar isso depois nas
        configurações.
      </p>

      <Input
        label="Pasta-raiz"
        value={root}
        onChange={(e) => setRoot(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleStart()
        }}
      />

      <button
        type="button"
        onClick={pickFolder}
        className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
      >
        Escolher outra pasta
      </button>
    </Dialog>
  )
}
