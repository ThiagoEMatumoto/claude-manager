import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { updatesApi } from '@/lib/ipc'
import { Icon } from '@/components/ui/Icon'
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

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-xs items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-elevated, var(--color-surface))',
        color: 'var(--color-text)',
      }}
    >
      <Icon
        as={status.state === 'downloaded' || status.state === 'awaiting-install' ? RefreshCw : Download}
        className="shrink-0 text-[var(--color-accent)]"
      />
      <div className="flex-1">{renderBody(status)}</div>
      {status.state === 'available' && (
        <button
          onClick={() => void updatesApi.apply()}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium"
          style={{ background: 'var(--color-accent)', color: 'var(--color-bg)' }}
        >
          Atualizar
        </button>
      )}
      {status.state === 'downloaded' && (
        <button
          onClick={() => void updatesApi.install()}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium"
          style={{ background: 'var(--color-accent)', color: 'var(--color-bg)' }}
        >
          Reiniciar e instalar
        </button>
      )}
      {status.state === 'error' && (
        <button
          onClick={() => void updatesApi.openRelease()}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium"
          style={{ background: 'var(--color-accent)', color: 'var(--color-bg)' }}
        >
          Abrir release
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dispensar"
        className="flex shrink-0 items-center px-1"
        style={{ color: 'var(--color-text-dim)' }}
      >
        <Icon as={X} size={14} />
      </button>
    </div>
  )
}

function renderBody(status: UpdateStatus) {
  switch (status.state) {
    case 'available':
      return <span>atualização v{status.version} disponível</span>
    case 'downloading':
      return <span>baixando atualização… ({status.percent}%)</span>
    case 'downloaded':
      return <span>atualização v{status.version} pronta</span>
    case 'awaiting-install':
      return <span>instalador aberto — conclua a instalação e reabra o app.</span>
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
