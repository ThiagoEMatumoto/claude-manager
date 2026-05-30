import { useEffect, useState } from 'react'
import { updatesApi } from '@/lib/ipc'
import type { UpdateStatus } from '../../../shared/types/ipc'

export function UpdateToast() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return updatesApi.onStatus((s) => {
      setDismissed(false)
      setStatus(s)
    })
  }, [])

  if (!status || dismissed) return null
  // 'available' é coberto pelo 'downloading' que vem em seguida (autoDownload).
  if (status.state === 'available') return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-xs items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-elevated, var(--color-surface))',
        color: 'var(--color-text)',
      }}
    >
      <div className="flex-1">{renderBody(status)}</div>
      {status.state === 'downloaded' && (
        <button
          onClick={() => void updatesApi.install()}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium"
          style={{ background: 'var(--color-accent)', color: 'var(--color-bg)' }}
        >
          Reiniciar e instalar
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dispensar"
        className="shrink-0 px-1 text-xs"
        style={{ color: 'var(--color-text-dim)' }}
      >
        ✕
      </button>
    </div>
  )
}

function renderBody(status: UpdateStatus) {
  switch (status.state) {
    case 'downloading':
      return <span>baixando atualização… ({status.percent}%)</span>
    case 'downloaded':
      return (
        <span>
          atualização v{status.version} pronta
        </span>
      )
    case 'error':
      return (
        <span style={{ color: 'var(--color-text-dim)' }}>
          falha ao atualizar: {status.message}
        </span>
      )
    default:
      return null
  }
}
