import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { notificationsApi } from '@/lib/ipc'
import { Icon } from '@/components/ui/Icon'
import type { NotificationEvent } from '../../../shared/types/ipc'

const AUTO_DISMISS_MS = 6000

export function NotificationToast() {
  const [event, setEvent] = useState<NotificationEvent | null>(null)

  useEffect(() => {
    return notificationsApi.onEvent((e) => setEvent(e))
  }, [])

  useEffect(() => {
    if (!event) return
    const timer = setTimeout(() => setEvent(null), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [event])

  if (!event) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-xs items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-elevated, var(--color-surface))',
        color: 'var(--color-text)',
      }}
    >
      <Icon as={Bell} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
      <div className="flex-1">
        <div className="font-medium">{event.title}</div>
        <div className="text-[var(--color-text-dim)]">{event.body}</div>
      </div>
      <button
        onClick={() => setEvent(null)}
        aria-label="Dispensar"
        className="flex shrink-0 items-center px-1"
        style={{ color: 'var(--color-text-dim)' }}
      >
        <Icon as={X} size={14} />
      </button>
    </div>
  )
}
