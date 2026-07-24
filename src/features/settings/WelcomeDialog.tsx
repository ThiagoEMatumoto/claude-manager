import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { PitwallLogo } from '@/features/brand'
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
      showClose={false}
      footer={
        <Button onClick={handleStart} disabled={!root.trim()} loading={submitting}>
          Entrar no box
        </Button>
      }
    >
      <div className="mb-5 flex flex-col items-center text-center">
        <PitwallLogo state="box-aberto" size={52} className="text-[var(--color-text)]" />
        <div className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--color-text)]">
          Pitwall
        </div>
        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
          O cockpit do dev
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-dim)]">
        Antes de entrar em pista, monte o box: escolha uma pasta-raiz onde cada
        projeto ganha sua garagem. Dá pra remapear depois nas configurações.
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
