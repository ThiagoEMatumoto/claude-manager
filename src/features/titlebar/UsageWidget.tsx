import { useEffect, useState } from 'react'
import { usageApi } from '@/lib/ipc'
import type { UsageStatus, UsageWindow } from '../../../shared/types/ipc'

function barColor(util: number): string {
  if (util > 90) return '#ef4444'
  if (util >= 70) return '#eab308'
  return '#22c55e'
}

function formatCountdown(resetsAt: string): string {
  const ms = new Date(resetsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'agora'
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / (60 * 24))
  const hours = Math.floor((mins % (60 * 24)) / 60)
  const rem = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${rem}m`
  return `${rem}m`
}

function Indicator({ label, window }: { label: string; window: UsageWindow }) {
  const util = Math.max(0, Math.min(100, window.utilization))
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${label}: ${util.toFixed(0)}% • reseta em ${formatCountdown(window.resetsAt)}`}
    >
      <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>
        {label}
      </span>
      <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-text)' }}>
        {util.toFixed(0)}%
      </span>
      <span
        className="h-1 w-10 overflow-hidden rounded-full"
        style={{ background: 'var(--color-surface-2)' }}
      >
        <span
          className="block h-full rounded-full transition-all"
          style={{ width: `${util}%`, background: barColor(util) }}
        />
      </span>
    </div>
  )
}

function Note({ text }: { text: string }) {
  return (
    <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
      {text}
    </span>
  )
}

export function UsageWidget() {
  const [status, setStatus] = useState<UsageStatus | null>(null)

  useEffect(() => {
    const unsub = usageApi.onStatus(setStatus)
    void usageApi.refresh()
    const onFocus = () => void usageApi.refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      unsub()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!status) return <Note text="—" />

  if (status.state === 'no-token' || status.state === 'unauthorized') {
    return <Note text="entre no Claude Code" />
  }

  const hasData = status.fiveHour || status.sevenDay
  if (status.state === 'error' && !hasData) {
    return <Note text="indisponível" />
  }

  return (
    <div className="flex items-center gap-3">
      {status.fiveHour && <Indicator label="5h" window={status.fiveHour} />}
      {status.sevenDay && <Indicator label="7d" window={status.sevenDay} />}
      {status.state === 'error' && <Note text="indisponível" />}
    </div>
  )
}
